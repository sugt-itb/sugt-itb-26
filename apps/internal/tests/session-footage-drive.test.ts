import { checkDriveConnectionAction } from "-/app/(app)/pengaturan/actions";
import {
  editPerjadinSessionAction,
  updatePerjadinDatesAction,
} from "-/app/(app)/perjadin/[id]/actions";
import { moveSessionDateAction } from "-/app/(app)/sesi/[id]/actions";
import { GET as openFotoVideo } from "-/app/(app)/sesi/[id]/foto-video/buka/route";
import { describeDriveCheck } from "-/lib/drive/check-report";
import { FOOTAGE_FOLDER_NAME } from "-/lib/drive/dokumen-folders";
import { FakeDrive } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { reconcileFootage } from "-/lib/drive/reconcile-footage";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectDrive, stubTokenEndpoint } from "./support/drive";
import {
  addCluster,
  addGrant,
  addGroupMember,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  addSubCluster,
  resetDatabase,
  revokePerson,
} from "./support/fixtures";

/**
 * **Session Footage in the company Google Drive** (#424, #552; ADR-0046, ADR-0061), against the real
 * database and the in-memory `FakeDrive` — Google's token endpoint, Drive, the signed-in Person and
 * `next/cache` are faked; the route, the folders, the sharing, the sweep and the renames are the real
 * code.
 *
 * Since #552 nothing uploads through the app: the **Foto & Video** button opens the Session's folder,
 * making and sharing it on the way. What is left of the upload is the rows it recorded, which the
 * sweep and the renames still look after; `recorded` puts one in place as an upload once did.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let drive: FakeDrive;
let folders: ReadyFolders;
/** The scene's Staff Administrator, signed in. */
let staffPerson: Person;

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

/**
 * A file of footage as the upload left it before #552: a JPEG in `_staging`, tagged with the trip and
 * the Session, and its `session_footage` row. `placed` runs the reconcile, as the upload did.
 */
async function recorded(
  session: { id: string; perjadinId: string | null },
  options: { placed?: boolean } = {},
) {
  const file = await drive.createFile({
    name: "upload.jpg",
    parentId: folders.stagingFolderId,
    mimeType: "image/jpeg",
    content: "jpeg",
  });
  await drive.updateFile(file.id, {
    appProperties: { sugtPerjadinId: session.perjadinId!, sugtSessionId: session.id },
  });
  const [row] = await db
    .insert(schema.sessionFootage)
    .values({
      sessionId: session.id,
      kind: "foto",
      contentType: "image/jpeg",
      originalFilename: "IMG_0001.JPG",
      byteSize: 4,
      driveFileId: file.id,
      uploadedByPersonId: staffPerson.id,
    })
    .returning();
  if (options.placed ?? true) {
    const placed = await reconcileFootage(staffPerson, drive, folders, row!.id);
    if (placed.outcome !== "synced") throw new Error(`Not placed: ${JSON.stringify(placed)}`);
  }
  return { driveFileId: file.id, footageId: row!.id };
}

/** A click on Foto & Video, from `dari`: the route's answer. */
function click(sessionId: string, dari = "/pendamping") {
  return openFotoVideo(
    new Request(
      `http://localhost:3001/sesi/${sessionId}/foto-video/buka?dari=${encodeURIComponent(dari)}`,
    ),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

/** The Drive folder a 303 opens, or `null` when it sent the tab elsewhere. */
function openedFolder(response: Response): string | null {
  expect(response.status).toBe(303);
  const location = response.headers.get("location")!;
  const prefix = "https://drive.google.com/drive/folders/";
  return location.startsWith(prefix) ? location.slice(prefix.length) : null;
}

const footage = () => db.select().from(schema.sessionFootage);
const sessionFolderOf = async (sessionId: string) =>
  (
    await db
      .select({ id: schema.session.driveFootageFolderId })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId))
  )[0]!.id;
const perjadinFolderOf = async (perjadinId: string) =>
  (
    await db
      .select({ id: schema.perjadin.driveFootageFolderId })
      .from(schema.perjadin)
      .where(eq(schema.perjadin.id, perjadinId))
  )[0]!.id;

/** The Perjadin folder's own permissions, as `type role email` strings, sorted. */
async function sharesOn(folderId: string) {
  return (await drive.listPermissions(folderId))
    .filter((permission) => !permission.inherited)
    .map((p) => [p.type, p.role, p.emailAddress].filter(Boolean).join(" "))
    .sort();
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("the Foto & Video button", () => {
  it("makes both folders on the first click and opens the Session's; later clicks reuse them", async () => {
    const { session, trip } = await scene();

    const first = openedFolder(await click(session.id));

    const sessionFolder = await sessionFolderOf(session.id);
    expect(first).toBe(sessionFolder);
    const tripFolder = await perjadinFolderOf(trip.id);
    expect(drive.files.get(sessionFolder!)).toMatchObject({
      name: `2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`,
      parents: [tripFolder],
    });
    expect(drive.files.get(tripFolder!)?.name).toBe(
      `Kelompok 18 · 12–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`,
    );

    const folderCount = [...drive.files.values()].filter((f) =>
      f.mimeType.endsWith("folder"),
    ).length;
    expect(openedFolder(await click(session.id))).toBe(sessionFolder);
    expect([...drive.files.values()].filter((f) => f.mimeType.endsWith("folder"))).toHaveLength(
      folderCount,
    );
    // Nothing is recorded and nothing logged: the app cannot see what goes in the folder.
    await expect(footage()).resolves.toEqual([]);
    await expect(db.select().from(schema.activityLog)).resolves.toEqual([]);
  });

  it("keeps one folder when two clicks race: the loser trashes its own", async () => {
    const { session, trip } = await scene();

    const [a, b] = await Promise.all([click(session.id), click(session.id)]);

    const sessionFolder = await sessionFolderOf(session.id);
    expect(openedFolder(a)).toBe(sessionFolder);
    expect(openedFolder(b)).toBe(sessionFolder);
    const live = (name: string) => drive.named(name).filter((file) => !file.trashed);
    expect(live(`2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`)).toHaveLength(
      1,
    );
    expect(
      live(`Kelompok 18 · 12–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`),
    ).toHaveLength(1);
  });

  it("opens for a Pimpinan too", async () => {
    const { session, pimpinan } = await scene();
    vi.mocked(requirePerson).mockResolvedValue({ ...pimpinan, grants: [] } as Person);

    expect(openedFolder(await click(session.id))).toBe(await sessionFolderOf(session.id));
  });

  it("answers 404 for an online Session and for no Session, asking Drive nothing", async () => {
    const { online } = await scene();

    expect((await click(online.id)).status).toBe(404);
    expect((await click("bukan-sesi")).status).toBe(404);
    expect(drive.calls).toBe(0);
  });

  it("never makes a folder for a cancelled Session, and opens the one it already has", async () => {
    const { cancelled } = await scene();

    expect((await click(cancelled.id)).status).toBe(404);
    expect(await sessionFolderOf(cancelled.id)).toBeNull();
    expect(drive.calls).toBe(0);

    await db
      .update(schema.session)
      .set({ driveFootageFolderId: "folder-made-before" })
      .where(eq(schema.session.id, cancelled.id));
    expect(openedFolder(await click(cancelled.id))).toBe("folder-made-before");
  });

  it("opens an existing folder while Drive is not usable, and sends a new one back", async () => {
    const { session } = await scene({ connection: "broken" });

    const back = await click(session.id, "/pendamping");
    expect(openedFolder(back)).toBeNull();
    expect(back.headers.get("location")).toBe(
      "http://localhost:3001/pendamping?foto-video=drive-unavailable",
    );

    await db
      .update(schema.session)
      .set({ driveFootageFolderId: "folder-made-before" })
      .where(eq(schema.session.id, session.id));
    expect(openedFolder(await click(session.id))).toBe("folder-made-before");
  });

  it("does not remake a trashed folder, and says an Administrator must restore it", async () => {
    const { session, trip } = await scene();
    openedFolder(await click(session.id));
    const tripFolder = (await perjadinFolderOf(trip.id))!;
    drive.trash(tripFolder);
    const before = drive.files.size;

    const back = await click(session.id, `/sesi/${session.id}`);

    expect(back.headers.get("location")).toBe(
      `http://localhost:3001/sesi/${session.id}?foto-video=folder-gone`,
    );
    expect(drive.files.size).toBe(before);
    expect(await perjadinFolderOf(trip.id)).toBe(tripFolder);
  });

  it("goes back to the Session's page when `dari` points off the app", async () => {
    const { session } = await scene({ connection: "broken" });

    for (const offsite of ["//evil.example/x", "/\t/evil.example/x"]) {
      const back = await click(session.id, offsite);
      expect(back.headers.get("location")).toBe(
        `http://localhost:3001/sesi/${session.id}?foto-video=drive-unavailable`,
      );
    }
  });
});

describe("the Perjadin folder's sharing", () => {
  it("is link-viewable and editable by exactly the trip's active writers, nothing else touched", async () => {
    const { session, trip, staff, pimpinan } = await scene();
    const member = await addPerson({ fullName: "Budi", email: "Budi@itb.ac.id", role: "Staff" });
    await addGroupMember(trip.id, member.id);
    const editor = await addPerson({ fullName: "Citra", email: "citra@itb.ac.id", role: "Staff" });
    await addGrant(editor.id, "Perjadin Editor");
    const admin = await addPerson({ fullName: "Dodi", email: "dodi@itb.ac.id", role: "Staff" });
    await addGrant(admin.id, "Administrator");
    // Neither of these may write the trip: another trip's Staff, and a revoked Group member.
    await addPerson({ fullName: "Eka", email: "eka@itb.ac.id", role: "Staff" });
    const gone = await addPerson({ fullName: "Gita", email: "gita@itb.ac.id", role: "Staff" });
    await addGroupMember(trip.id, gone.id);
    await revokePerson(gone.id);
    // A first click makes the folder; then hands in Drive add an editor, a commenter and the owner.
    openedFolder(await click(session.id));
    const tripFolder = (await perjadinFolderOf(trip.id))!;
    drive.share(tripFolder, { type: "user", role: "writer", emailAddress: "lama@itb.ac.id" });
    drive.share(tripFolder, { type: "user", role: "owner", emailAddress: "sugt@gmail.com" });
    drive.share(tripFolder, { type: "user", role: "commenter", emailAddress: "tamu@gmail.com" });
    const createPermission = vi.spyOn(drive, "createPermission");

    openedFolder(await click(session.id));

    expect(await sharesOn(tripFolder)).toEqual(
      [
        "anyone reader",
        "user commenter tamu@gmail.com",
        "user owner sugt@gmail.com",
        "user writer budi@itb.ac.id",
        "user writer citra@itb.ac.id",
        "user writer dodi@itb.ac.id",
        `user writer ${staff.email}`,
      ].sort(),
    );
    expect(await sharesOn(tripFolder)).not.toContain(`user writer ${pimpinan.email}`);
    // Re-applied: only what was missing is added, and the link share is not made twice.
    expect(createPermission).not.toHaveBeenCalled();
    // The Session's folder inherits all of it and carries nothing of its own.
    const sessionFolder = (await sessionFolderOf(session.id))!;
    const own = (await drive.listPermissions(sessionFolder)).filter((p) => !p.inherited);
    expect(own).toEqual([]);
  });

  it("skips an email Drive refuses, and shares with the rest", async () => {
    const { session, trip, staff } = await scene();
    const member = await addPerson({ fullName: "Budi", email: "budi@yahoo.com", role: "Staff" });
    await addGroupMember(trip.id, member.id);
    drive.refusedEmails.add("budi@yahoo.com");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(openedFolder(await click(session.id))).toBe(await sessionFolderOf(session.id));

    const tripFolder = (await perjadinFolderOf(trip.id))!;
    expect(await sharesOn(tripFolder)).toEqual(["anyone reader", `user writer ${staff.email}`]);
    expect(error).toHaveBeenCalled();
  });

  it("still opens the folder when sharing fails", async () => {
    const { session } = await scene();
    vi.spyOn(drive, "listPermissions").mockRejectedValue(
      new DriveRequestError("permissions.list", 503),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(openedFolder(await click(session.id))).toBe(await sessionFolderOf(session.id));
    expect(error).toHaveBeenCalled();
  });

  it("does not set off Periksa koneksi's warning about link-shared folders", async () => {
    const { session } = await scene();
    openedFolder(await click(session.id));

    const report = await checkDriveConnectionAction();

    if (report.token !== "ok") throw new Error(report.token);
    expect(report.exposed).toEqual([]);
  });
});

describe("footage recorded before #552", () => {
  it("keeps old footage unsynced while its folder is trashed; a later run finishes it, once", async () => {
    const { session, staff } = await scene();
    // The Session's folder will be made in a trip folder trashed by hand.
    const tripFolder = await drive.createFolder({ name: "x", parentId: folders.rootFolderId });
    await db
      .update(schema.perjadin)
      .set({ driveFootageFolderId: tripFolder.id })
      .where(eq(schema.perjadin.id, session.perjadinId!));
    drive.trash(tripFolder.id);

    const { driveFileId, footageId } = await recorded(session, { placed: false });

    await expect(reconcileFootage(staff, drive, folders, footageId)).resolves.toEqual({
      outcome: "unsynced",
      reason: "folder-trashed",
    });
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

describe("renames", () => {
  it("renames the Session's folder and files when its date and time move", async () => {
    const { session } = await scene();
    const { driveFileId, footageId } = await recorded(session);

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
    const { driveFileId } = await recorded(session);

    await editPerjadinSessionAction(trip.id, session.id, {
      schoolId: school.id,
      heldOn: "2026-10-16",
      startsAt: "10:00",
      taughtByTeacherIds: [],
      pimpinanPersonIds: [],
    });

    const file = drive.files.get(driveFileId)!;
    expect(file.name.startsWith("2026-10-16 · ")).toBe(true);
    expect(drive.files.get(file.parents[0]!)?.name.startsWith("2026-10-16 · 10.00 · ")).toBe(true);
  });
});

describe("the Perjadin's Foto & Video folder", () => {
  it("is renamed with the trip's other folders when its dates are corrected", async () => {
    const { session, trip } = await scene();
    await recorded(session);
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
    await recorded(session);
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
    const { driveFileId, footageId } = await recorded(session);
    // Names gone stale by hand, and a second file an upload left in `_staging` before #552.
    const sessionFolderId = drive.files.get(driveFileId)!.parents[0]!;
    await drive.updateFile(sessionFolderId, { name: "lama" });
    await drive.updateFile(driveFileId, { name: "lama.jpg" });
    const { driveFileId: owed } = await recorded(session, { placed: false });

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
