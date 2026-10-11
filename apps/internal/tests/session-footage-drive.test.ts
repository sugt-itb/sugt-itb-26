import { checkDriveConnectionAction } from "-/app/(app)/pengaturan/actions";
import {
  editPerjadinSessionAction,
  updatePerjadinDatesAction,
} from "-/app/(app)/perjadin/[id]/actions";
import { moveSessionDateAction } from "-/app/(app)/sesi/[id]/actions";
import {
  deleteFootageAction,
  openFootageUploadAction,
  recordFootageAction,
} from "-/app/(app)/sesi/[id]/foto-video/actions";
import { describeDriveCheck } from "-/lib/drive/check-report";
import { FOOTAGE_FOLDER_NAME } from "-/lib/drive/dokumen-folders";
import { FakeDrive } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { reconcileFootage } from "-/lib/drive/reconcile-footage";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import {
  activityLogAksi,
  activityLogRincian,
  deleteSessionFootage,
  recordSessionFootage,
  sessionFootageList,
  type Person,
} from "@sugt/db/queries";
import { MAX_FOOTAGE_PHOTO_BYTES, MAX_FOOTAGE_VIDEO_BYTES } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logActivity } from "../../../packages/db/src/queries/activity-log";
import { connectDrive, digestOf, FORBIDDEN, jpeg, pdf, stubTokenEndpoint } from "./support/drive";
import {
  addCluster,
  addGrant,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Session Footage goes to the company Google Drive** (#424, ADR-0046), against the real database
 * and the in-memory `FakeDrive` — the same fakes as the Dokumen tests: Google's token endpoint, Drive,
 * the browser's upload (`land`), the signed-in Person, the request's `Origin` and `next/cache`. The
 * guards, the sniff, the names, the write order, the reconcile and the renames are the real code.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "https://preview-42.sugt.test" })),
}));
// The Activity Log write, wrapped so one test can refuse it inside the commit's transaction.
vi.mock("../../../packages/db/src/queries/activity-log", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../packages/db/src/queries/activity-log")>();
  return { ...actual, logActivity: vi.fn(actual.logActivity) };
});
vi.mock("@sugt/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sugt/db/queries")>();
  return { ...actual, deleteSessionFootage: vi.fn(actual.deleteSessionFootage) };
});

let drive: FakeDrive;
let folders: ReadyFolders;
/** The scene's Staff Administrator, signed in. */
let staffPerson: Person;

/** Bytes that sniff as an ISO-BMFF file of the given major brand: `isom` is an MP4. */
function isoBmff(brand: string, size = 4096) {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 0x18]);
  bytes.set(new TextEncoder().encode(`ftyp${brand}`), 4);
  return bytes;
}

/**
 * A Staff Administrator, a Pimpinan, a trip to Kelompok 18 with one offline Session on 14 Okt at
 * 08:00 at "SMAN 1/Bontang", a cancelled one, an online one, and Drive connected.
 */
async function scene(
  options: {
    connection?: "connected" | "broken" | "none";
    footage?: boolean;
  } = {},
) {
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  await addGrant(staff.id, "Administrator");
  const pimpinan = await addPerson({ fullName: "Fa", email: "fa@itb.ac.id", role: "Pimpinan" });
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "kelompok-18",
    name: "Kelompok 18",
    clusterId: cluster.id,
  });
  const school = await addSchool({
    slug: "sman-1-bontang",
    name: "SMAN 1/Bontang",
    clusterId: cluster.id,
    subClusterId: subCluster.id,
    provinceCode: "KT",
  });
  const trip = await addPerjadin({
    picPersonId: staff.id,
    subClusterId: subCluster.id,
    startsOn: "2026-10-12",
    endsOn: "2026-10-16",
  });
  const session = await addOfflineSession({
    schoolId: school.id,
    heldOn: "2026-10-14",
    startsAt: "08:00",
    perjadinId: trip.id,
  });
  const cancelled = await addOfflineSession({
    schoolId: school.id,
    heldOn: "2026-10-15",
    startsAt: "09:00",
    perjadinId: trip.id,
    status: "cancelled",
  });
  const online = await addSession({ schoolId: school.id, heldOn: "2026-10-20" });

  const connection = options.connection ?? "connected";
  if (connection !== "none") {
    folders = await connectDrive(drive, staff.id, connection, { footage: options.footage });
  }
  drive.calls = 0;
  const admin = { ...staff, grants: ["Administrator"] } as Person;
  staffPerson = admin;
  vi.mocked(requirePerson).mockResolvedValue(admin);
  return { staff: admin, pimpinan, trip, school, session, cancelled, online };
}

/** The upload as the browser does it: open, then send the bytes. Answers the landed file's id. */
async function upload(sessionId: string, bytes: Uint8Array, contentType = "image/jpeg") {
  const opened = await openFootageUploadAction(sessionId, { size: bytes.length, contentType });
  if (opened.outcome !== "ready") throw new Error(`Upload refused: ${opened.outcome}`);
  return drive.land(opened.sessionUri, bytes).id;
}

async function uploadAndRecord(sessionId: string, bytes = jpeg(), contentType = "image/jpeg") {
  const driveFileId = await upload(sessionId, bytes);
  const recorded = await recordFootageAction({
    sessionId,
    driveFileId,
    originalFilename: "IMG_0001.JPG",
    contentType,
  });
  if (recorded.outcome !== "recorded") throw new Error(`Record refused: ${recorded.outcome}`);
  return { driveFileId, footageId: recorded.footageId, synced: recorded.synced };
}

const footage = () => db.select().from(schema.sessionFootage);
const logged = () => db.select().from(schema.activityLog);

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("refused before Google is asked anything", () => {
  it("refuses a non-Staff caller with zero Drive calls", async () => {
    const { pimpinan, session } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(pimpinan as Person);

    await expect(
      digestOf(openFootageUploadAction(session.id, { size: 10, contentType: "image/jpeg" })),
    ).resolves.toBe(FORBIDDEN);
    expect(drive.calls).toBe(0);
  });

  it("refuses an online Session and a cancelled one", async () => {
    const { online, cancelled } = await scene();

    await expect(
      openFootageUploadAction(online.id, { size: 10, contentType: "image/jpeg" }),
    ).resolves.toEqual({ outcome: "session-online" });
    await expect(
      openFootageUploadAction(cancelled.id, { size: 10, contentType: "image/jpeg" }),
    ).resolves.toEqual({ outcome: "session-cancelled" });
    await expect(
      openFootageUploadAction("00000000-0000-0000-0000-000000000000", {
        size: 10,
        contentType: "image/jpeg",
      }),
    ).resolves.toEqual({ outcome: "no-such-session" });
    expect(drive.calls).toBe(0);
  });

  it("refuses a type that is not footage, and a file over its kind's cap", async () => {
    const { session } = await scene();
    const open = (size: number, contentType: string) =>
      openFootageUploadAction(session.id, { size, contentType });

    await expect(open(10, "application/pdf")).resolves.toEqual({ outcome: "unsupported-type" });
    await expect(open(10, "image/gif")).resolves.toEqual({ outcome: "unsupported-type" });
    await expect(open(MAX_FOOTAGE_PHOTO_BYTES + 1, "image/jpeg")).resolves.toEqual({
      outcome: "too-large",
      kind: "foto",
      limit: MAX_FOOTAGE_PHOTO_BYTES,
    });
    await expect(open(MAX_FOOTAGE_VIDEO_BYTES + 1, "video/mp4")).resolves.toEqual({
      outcome: "too-large",
      kind: "video",
      limit: MAX_FOOTAGE_VIDEO_BYTES,
    });
    await expect(open(0, "image/jpeg")).resolves.toEqual(
      expect.objectContaining({ outcome: "too-large" }),
    );
    expect(drive.calls).toBe(0);

    // A video may be far larger than a photo.
    await expect(open(MAX_FOOTAGE_PHOTO_BYTES + 1, "video/quicktime")).resolves.toEqual(
      expect.objectContaining({ outcome: "ready", kind: "video" }),
    );
  });

  it("refuses with the gate's reason while Drive is not connected", async () => {
    const { session } = await scene({ connection: "none" });

    await expect(
      openFootageUploadAction(session.id, { size: 10, contentType: "image/jpeg" }),
    ).resolves.toEqual(expect.objectContaining({ outcome: "drive-disconnected" }));
  });

  it("opens the session in _staging, sized and tagged with the trip and the Session", async () => {
    const { session, trip } = await scene();

    const opened = await openFootageUploadAction(session.id, {
      size: 4096,
      contentType: "video/mp4",
    });

    expect(opened).toEqual(expect.objectContaining({ outcome: "ready", kind: "video" }));
    const [open] = [...drive.sessions.values()];
    expect(open).toEqual(
      expect.objectContaining({
        parentId: folders.stagingFolderId,
        size: 4096,
        origin: "https://preview-42.sugt.test",
        appProperties: { sugtPerjadinId: trip.id, sugtSessionId: session.id },
      }),
    );
    expect(open?.name).toMatch(/^[0-9a-f-]{36}\.mp4$/);
  });
});

describe("verifying what landed", () => {
  it("refuses bytes that are no footage type, or the other kind than declared, recording nothing", async () => {
    const { session } = await scene();

    const notFootage = await upload(session.id, pdf(4096), "image/jpeg");
    await expect(
      recordFootageAction({
        sessionId: session.id,
        driveFileId: notFootage,
        originalFilename: "a.jpg",
        contentType: "image/jpeg",
      }),
    ).resolves.toEqual({ outcome: "unsupported-type" });

    const videoAsPhoto = await upload(session.id, isoBmff("isom"), "image/jpeg");
    await expect(
      recordFootageAction({
        sessionId: session.id,
        driveFileId: videoAsPhoto,
        originalFilename: "b.jpg",
        contentType: "image/jpeg",
      }),
    ).resolves.toEqual({ outcome: "type-mismatch" });

    await expect(footage()).resolves.toEqual([]);
    await expect(logged()).resolves.toEqual([]);
    // Both are left unnamed in private `_staging`.
    expect(drive.files.get(notFootage)?.parents).toEqual([folders.stagingFolderId]);
  });

  it("refuses a file uploaded for another trip", async () => {
    const { session } = await scene();
    const stray = await drive.createFile({
      name: "x.jpg",
      parentId: folders.stagingFolderId,
      mimeType: "image/jpeg",
      content: "\xff\xd8\xff",
    });

    await expect(
      recordFootageAction({
        sessionId: session.id,
        driveFileId: stray.id,
        originalFilename: "x.jpg",
        contentType: "image/jpeg",
      }),
    ).resolves.toEqual({ outcome: "file-unverified" });
  });

  it("refuses a file opened for another Session of the same trip", async () => {
    const { session, school, trip } = await scene();
    const other = await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-10-13",
      startsAt: "10:00",
      perjadinId: trip.id,
    });
    const driveFileId = await upload(other.id, jpeg());

    await expect(
      recordFootageAction({
        sessionId: session.id,
        driveFileId,
        originalFilename: "a.jpg",
        contentType: "image/jpeg",
      }),
    ).resolves.toEqual({ outcome: "file-unverified" });
  });

  it("waits for a cancellation in flight, and refuses once it commits", async () => {
    const { session, staff } = await scene();
    const driveFileId = await upload(session.id, jpeg());
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Another request cancelling the Session, its transaction still open while the footage commits.
    const cancelling = db.transaction(async (tx) => {
      await tx
        .update(schema.session)
        .set({ status: "cancelled", cancelledReason: "Hujan" })
        .where(eq(schema.session.id, session.id));
      locked();
      await held;
    });
    await lockTaken;

    const recording = recordSessionFootage(staff, {
      footageId: "00000000-0000-4000-8000-0000000000f1",
      sessionId: session.id,
      contentType: "image/jpeg",
      originalFilename: "a.jpg",
      driveFileId,
      byteSize: 4096,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await cancelling;

    await expect(recording).resolves.toEqual({ outcome: "session-cancelled" });
    await expect(footage()).resolves.toEqual([]);
  });

  it("refuses a Session cancelled after the upload opened", async () => {
    const { session } = await scene();
    const driveFileId = await upload(session.id, jpeg());
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Hujan" })
      .where(eq(schema.session.id, session.id));

    await expect(
      recordFootageAction({
        sessionId: session.id,
        driveFileId,
        originalFilename: "a.jpg",
        contentType: "image/jpeg",
      }),
    ).resolves.toEqual({ outcome: "session-cancelled" });
    await expect(footage()).resolves.toEqual([]);
  });
});

describe("an upload, recorded and reconciled", () => {
  it("names the Session folder and the file, shares the file only, and logs the upload", async () => {
    const { session, trip } = await scene();

    const { driveFileId, footageId, synced } = await uploadAndRecord(session.id);

    expect(synced).toBe(true);
    const file = drive.files.get(driveFileId)!;
    expect(file.name).toBe(`2026-10-14 · SMAN 1-Bontang · Foto · M-${footageId.slice(0, 8)}.jpg`);
    expect(file.appProperties).toEqual(
      expect.objectContaining({ sugtPerjadinId: trip.id, sugtFootageId: footageId }),
    );

    const sessionFolder = drive.files.get(file.parents[0]!)!;
    expect(sessionFolder.name).toBe(
      `2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`,
    );
    expect(sessionFolder.appProperties).toEqual({
      sugtPerjadinId: trip.id,
      sugtSessionId: session.id,
    });
    const tripFolder = drive.files.get(sessionFolder.parents[0]!)!;
    expect(tripFolder.name).toBe(
      `Kelompok 18 · 12–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`,
    );
    const pelaksanaan = drive.files.get(tripFolder.parents[0]!)!;
    expect(drive.files.get(pelaksanaan.parents[0]!)?.name).toBe(FOOTAGE_FOLDER_NAME);

    // The file is shared; no folder is.
    expect(await drive.listPermissions(driveFileId)).toEqual([
      expect.objectContaining({ type: "anyone", role: "reader" }),
    ]);
    for (const folder of [sessionFolder, tripFolder]) {
      await expect(drive.listPermissions(folder.id)).resolves.toEqual([]);
    }

    const [row] = await footage();
    expect(row).toEqual(
      expect.objectContaining({
        id: footageId,
        kind: "foto",
        contentType: "image/jpeg",
        originalFilename: "IMG_0001.JPG",
        byteSize: 4096,
      }),
    );
    expect(row?.driveSyncedAt).not.toBeNull();

    const [entry] = await logged();
    expect(entry).toEqual(
      expect.objectContaining({ action: "footage_uploaded", perjadinId: trip.id }),
    );
    expect(activityLogAksi("footage_uploaded", false)).toBe("Foto/Video diunggah");
    expect(
      activityLogRincian({ action: "footage_uploaded", details: entry!.details } as never),
    ).toBe("Foto · IMG_0001.JPG · 2026-10-14 · SMAN 1/Bontang");
  });

  it("stores a video under its sniffed type, and reuses the Session's folder", async () => {
    const { session } = await scene();
    const first = await uploadAndRecord(session.id);
    const second = await uploadAndRecord(session.id, isoBmff("qt  "), "video/quicktime");

    const [a, b] = [drive.files.get(first.driveFileId)!, drive.files.get(second.driveFileId)!];
    expect(b.parents).toEqual(a.parents);
    expect(b.name).toMatch(/ · Video · M-[0-9a-f]{8}\.mov$/);
    const rows = await sessionFootageList(staffPerson, session.id);
    // Newest first.
    expect(rows.map((row) => [row.kind, row.contentType])).toEqual([
      ["video", "video/quicktime"],
      ["foto", "image/jpeg"],
    ]);
  });

  it("commits the row and its Log entry together: the Log refused, the row undone", async () => {
    const { session } = await scene();
    const driveFileId = await upload(session.id, jpeg());
    // The Log entry is written after the row, inside the same transaction: refuse it, and the row
    // already inserted must go with it.
    vi.mocked(logActivity).mockRejectedValueOnce(new Error("log refused"));

    await expect(
      recordFootageAction({
        sessionId: session.id,
        driveFileId,
        originalFilename: "a.jpg",
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow("log refused");
    await expect(footage()).resolves.toEqual([]);
    await expect(logged()).resolves.toEqual([]);
  });

  it("records a Drive file once: a retry while it is unsynced answers the first row", async () => {
    const { session } = await scene();
    const driveFileId = await upload(session.id, jpeg());
    const record = () =>
      recordFootageAction({
        sessionId: session.id,
        driveFileId,
        originalFilename: "a.jpg",
        contentType: "image/jpeg",
      });

    // The first answer is lost and its reconcile failed, so the file is still in `_staging`: the
    // browser's retry passes verify again and reaches the commit.
    vi.spyOn(drive, "createFolder").mockRejectedValueOnce(
      new DriveRequestError("files.create", 503),
    );
    const first = await record();
    const second = await record();

    expect(second).toEqual(
      expect.objectContaining({
        outcome: "recorded",
        footageId: first.outcome === "recorded" ? first.footageId : "",
      }),
    );
    await expect(footage()).resolves.toHaveLength(1);
    await expect(logged()).resolves.toHaveLength(1);
  });

  it("keeps the footage, unsynced, when the reconcile fails; a second run finishes it, once", async () => {
    const { session, staff } = await scene();
    // The Session's folder will be made in a trip folder trashed by hand.
    const tripFolder = await drive.createFolder({ name: "x", parentId: folders.rootFolderId });
    await db
      .update(schema.perjadin)
      .set({ driveFootageFolderId: tripFolder.id })
      .where(eq(schema.perjadin.id, session.perjadinId!));
    drive.trash(tripFolder.id);

    const { driveFileId, footageId, synced } = await uploadAndRecord(session.id);

    expect(synced).toBe(false);
    const [row] = await footage();
    expect(row?.driveSyncedAt).toBeNull();
    expect(row?.driveSyncFailedAt).not.toBeNull();
    expect(drive.files.get(driveFileId)?.parents).toEqual([folders.stagingFolderId]);

    drive.restore(tripFolder.id);
    await expect(reconcileFootage(staff, drive, folders, footageId)).resolves.toEqual({
      outcome: "synced",
    });
    // Idempotent: again changes nothing and shares nothing twice.
    const before = drive.files.get(driveFileId)!.name;
    await expect(reconcileFootage(staff, drive, folders, footageId)).resolves.toEqual({
      outcome: "synced",
    });
    expect(drive.files.get(driveFileId)!.name).toBe(before);
    await expect(drive.listPermissions(driveFileId)).resolves.toHaveLength(1);
    expect(
      drive.named(`2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`),
    ).toHaveLength(1);
  });
});

describe("Hapus", () => {
  it("trashes the file first, then deletes the row and logs it", async () => {
    const { session } = await scene();
    const { driveFileId, footageId } = await uploadAndRecord(session.id);

    await expect(deleteFootageAction(footageId)).resolves.toEqual({ outcome: "deleted" });

    expect((await drive.getFile(driveFileId))?.trashed).toBe(true);
    await expect(footage()).resolves.toEqual([]);
    const actions = (await logged()).map((entry) => entry.action).toSorted();
    expect(actions).toEqual(["footage_deleted", "footage_uploaded"]);
    expect(activityLogAksi("footage_deleted", false)).toBe("Foto/Video dihapus");
  });

  it("keeps the row when trashing fails, and deletes nothing", async () => {
    const { session } = await scene();
    const { footageId } = await uploadAndRecord(session.id);
    vi.spyOn(drive, "trashFile").mockRejectedValueOnce(new DriveRequestError("files.update", 503));

    await expect(deleteFootageAction(footageId)).resolves.toEqual({
      outcome: "drive-unreachable",
    });
    await expect(footage()).resolves.toHaveLength(1);
    expect(vi.mocked(deleteSessionFootage)).not.toHaveBeenCalled();
  });

  it("completes when the file is already in the trash or gone, and refuses a Pimpinan", async () => {
    const { session, pimpinan } = await scene();
    const { driveFileId, footageId } = await uploadAndRecord(session.id);
    drive.remove(driveFileId);

    vi.mocked(requirePerson).mockResolvedValue(pimpinan as Person);
    await expect(digestOf(deleteFootageAction(footageId))).resolves.toBe(FORBIDDEN);

    vi.mocked(requirePerson).mockResolvedValue(staffPerson);
    await expect(deleteFootageAction(footageId)).resolves.toEqual({ outcome: "deleted" });
    await expect(deleteFootageAction(footageId)).resolves.toEqual({
      outcome: "no-such-footage",
    });
  });

  it("stays with a Session cancelled later", async () => {
    const { session } = await scene();
    await uploadAndRecord(session.id);
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Hujan" })
      .where(eq(schema.session.id, session.id));

    await expect(sessionFootageList(staffPerson, session.id)).resolves.toHaveLength(1);
  });
});

describe("renames", () => {
  it("renames the Session's folder and files when its date and time move", async () => {
    const { session } = await scene();
    const { driveFileId, footageId } = await uploadAndRecord(session.id);

    await expect(moveSessionDateAction(session.id, "2026-10-15", "13:30")).resolves.toEqual(
      expect.objectContaining({ outcome: "moved" }),
    );

    const file = drive.files.get(driveFileId)!;
    expect(file.name).toBe(`2026-10-15 · SMAN 1-Bontang · Foto · M-${footageId.slice(0, 8)}.jpg`);
    expect(drive.files.get(file.parents[0]!)?.name).toBe(
      `2026-10-15 · 13.30 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`,
    );
  });

  it("renames them after Ubah Sesi on the trip too", async () => {
    const { session, trip, school } = await scene();
    const { driveFileId } = await uploadAndRecord(session.id);

    await editPerjadinSessionAction(trip.id, session.id, {
      schoolId: school.id,
      heldOn: "2026-10-16",
      startsAt: "10:00",
      taughtByTeacherIds: [],
    });

    const file = drive.files.get(driveFileId)!;
    expect(file.name.startsWith("2026-10-16 · ")).toBe(true);
    expect(drive.files.get(file.parents[0]!)?.name.startsWith("2026-10-16 · 10.00 · ")).toBe(true);
  });
});

describe("the Perjadin's Foto & Video folder", () => {
  it("is renamed with the trip's other folders when its dates are corrected", async () => {
    const { session, trip } = await scene();
    await uploadAndRecord(session.id);
    const [before] = await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, trip.id));

    await expect(
      updatePerjadinDatesAction(trip.id, { startsOn: "2026-10-13", endsOn: "2026-10-16" }),
    ).resolves.toMatchObject({ outcome: "updated" });

    expect(drive.files.get(before!.driveFootageFolderId!)!.name).toBe(
      `Kelompok 18 · 13–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`,
    );
  });

  it("is brought back to its name by Periksa koneksi", async () => {
    const { session, trip } = await scene();
    await uploadAndRecord(session.id);
    const [row] = await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, trip.id));
    await drive.updateFile(row!.driveFootageFolderId!, { name: "lama" });

    await checkDriveConnectionAction();

    expect(drive.files.get(row!.driveFootageFolderId!)!.name).toBe(
      `Kelompok 18 · 12–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`,
    );
  });
});

describe("Periksa koneksi", () => {
  it("makes the Foto & Video folders for a connection made before them", async () => {
    await scene({ footage: false });

    const report = await checkDriveConnectionAction();

    if (report.token !== "ok") throw new Error(report.token);
    expect(report.footage).toBe("created");
    expect(describeDriveCheck(report).lines).toContain("Folder Foto & Video: dibuat.");
    const [ids] = await db
      .select({
        tree: schema.driveConnection.footageFolderId,
        pelaksanaan: schema.driveConnection.footagePelaksanaanOfflineFolderId,
      })
      .from(schema.driveConnection);
    expect(drive.files.get(ids!.tree!)?.name).toBe(FOOTAGE_FOLDER_NAME);
    expect(drive.files.get(ids!.pelaksanaan!)?.parents).toEqual([ids!.tree]);

    const again = await checkDriveConnectionAction();
    expect(again.token === "ok" && again.footage).toBe("ok");
  });

  it("sweeps unsynced footage and re-asserts the Session folder's and files' names", async () => {
    const { session } = await scene();
    const { driveFileId, footageId } = await uploadAndRecord(session.id);
    // Names gone stale by hand, and a second file whose reconcile failed.
    const sessionFolderId = drive.files.get(driveFileId)!.parents[0]!;
    await drive.updateFile(sessionFolderId, { name: "lama" });
    await drive.updateFile(driveFileId, { name: "lama.jpg" });
    const owed = await upload(session.id, jpeg());
    vi.spyOn(drive, "createPermission").mockRejectedValueOnce(
      new DriveRequestError("permissions.create", 503),
    );
    const second = await recordFootageAction({
      sessionId: session.id,
      driveFileId: owed,
      originalFilename: "b.jpg",
      contentType: "image/jpeg",
    });
    expect(second).toEqual(expect.objectContaining({ outcome: "recorded", synced: false }));

    const report = await checkDriveConnectionAction();

    if (report.token !== "ok") throw new Error(report.token);
    expect(report.sweep.ran && report.sweep.footage).toEqual({
      synced: 1,
      waiting: 0,
      failures: [],
    });
    expect(drive.files.get(sessionFolderId)?.name).toBe(
      `2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`,
    );
    expect(drive.files.get(driveFileId)?.name).toBe(
      `2026-10-14 · SMAN 1-Bontang · Foto · M-${footageId.slice(0, 8)}.jpg`,
    );
    expect(drive.files.get(owed)?.parents).toEqual([sessionFolderId]);
  });
});
