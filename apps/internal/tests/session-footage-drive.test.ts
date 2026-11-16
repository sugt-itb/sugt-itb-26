import { checkDriveConnectionAction } from "-/app/(app)/pengaturan/actions";
import {
  editPerjadinSessionAction,
  updatePerjadinDatesAction,
} from "-/app/(app)/perjadin/[id]/actions";
import { moveSessionDateAction } from "-/app/(app)/sesi/[id]/actions";
import { GET as openArchive } from "-/app/(app)/sesi/[id]/foto-video/arsip/route";
import { GET as openUpload } from "-/app/(app)/sesi/[id]/foto-video/unggah/route";
import { describeDriveCheck } from "-/lib/drive/check-report";
import { FOOTAGE_FOLDER_NAME, FOOTAGE_UPLOAD_FOLDER_NAME } from "-/lib/drive/dokumen-folders";
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
 * **Session Footage in the company Google Drive** (#424, #561; ADR-0046, ADR-0063), against the real
 * database and the in-memory `FakeDrive` — Google's token endpoint, Drive, the signed-in Person and
 * `next/cache` are faked; the routes, the folders, the sharing, the sweep and the renames are the
 * real code.
 *
 * Nothing uploads through the app: **Foto & Video** opens the Session's upload folder, and **Lihat
 * arsip** its archive folder, each making and sharing folders on the way. What is left of the old
 * upload is the rows it recorded, which the sweep and the renames still look after; `recorded` puts
 * one in place as an upload once did.
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
 * A Staff Administrator, a Pimpinan, a Staff member on no Group, a trip to Kelompok 18 with one
 * offline Session on 14 Okt at 08:00 at "SMAN 1/Bontang", a cancelled one, an online one, and Drive
 * connected.
 */
async function scene(
  options: {
    connection?: "connected" | "broken" | "none";
    footage?: boolean;
    footageUpload?: boolean;
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
  const outsider = await addPerson({ fullName: "Eka", email: "eka@itb.ac.id", role: "Staff" });

  const connection = options.connection ?? "connected";
  if (connection !== "none") {
    folders = await connectDrive(drive, staff.id, connection, {
      footage: options.footage,
      footageUpload: options.footageUpload,
    });
  }
  drive.calls = 0;
  const admin = { ...staff, grants: ["Administrator"] } as Person;
  staffPerson = admin;
  vi.mocked(requirePerson).mockResolvedValue(admin);
  return {
    staff: admin,
    pimpinan: { ...pimpinan, grants: [] } as Person,
    outsider: { ...outsider, grants: [] } as Person,
    trip,
    school,
    session,
    cancelled,
    online,
  };
}

/**
 * A file of footage as the upload left it before #561: a JPEG in `_staging`, tagged with the trip and
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

/** A click on Foto & Video (`upload`) or Lihat arsip (`archive`), from `dari`: the route's answer. */
function click(sessionId: string, folder: "upload" | "archive" = "upload", dari = "/pendamping") {
  const [route, segment] = folder === "upload" ? [openUpload, "unggah"] : [openArchive, "arsip"];
  return route(
    new Request(
      `http://localhost:3001/sesi/${sessionId}/foto-video/${segment}?dari=${encodeURIComponent(dari)}`,
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
/** The Session's folder ids in each tree. */
const sessionFoldersOf = async (sessionId: string) =>
  (
    await db
      .select({
        archive: schema.session.driveFootageFolderId,
        upload: schema.session.driveFootageUploadFolderId,
      })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId))
  )[0]!;
/** The Perjadin's folder ids in each tree. */
const perjadinFoldersOf = async (perjadinId: string) =>
  (
    await db
      .select({
        archive: schema.perjadin.driveFootageFolderId,
        upload: schema.perjadin.driveFootageUploadFolderId,
      })
      .from(schema.perjadin)
      .where(eq(schema.perjadin.id, perjadinId))
  )[0]!;
const allFolders = () => [...drive.files.values()].filter((f) => f.mimeType.endsWith("folder"));

/** A folder's own permissions, as `type role email` strings, sorted. */
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

describe("Foto & Video: the Session's upload folder", () => {
  it("makes both trees' folders on the first click, named alike, and opens the upload one; later clicks reuse them", async () => {
    const { session, trip } = await scene();

    const first = openedFolder(await click(session.id));

    const sessionFolders = await sessionFoldersOf(session.id);
    const tripFolders = await perjadinFoldersOf(trip.id);
    expect(first).toBe(sessionFolders.upload);
    const sessionName = `2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`;
    const tripName = `Kelompok 18 · 12–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`;
    for (const tree of ["archive", "upload"] as const) {
      expect(drive.files.get(sessionFolders[tree]!)).toMatchObject({
        name: sessionName,
        parents: [tripFolders[tree]],
      });
      expect(drive.files.get(tripFolders[tree]!)?.name).toBe(tripName);
    }
    // The upload tree sits under its own fixed folders, beside the archive's.
    const uploadPelaksanaan = drive.files.get(tripFolders.upload!)!.parents[0]!;
    const uploadRoot = drive.files.get(uploadPelaksanaan)!.parents[0]!;
    expect(drive.files.get(uploadRoot)).toMatchObject({
      name: FOOTAGE_UPLOAD_FOLDER_NAME,
      parents: [folders.rootFolderId],
    });

    const folderCount = allFolders().length;
    expect(openedFolder(await click(session.id))).toBe(sessionFolders.upload);
    expect(allFolders()).toHaveLength(folderCount);
    // Nothing is recorded and nothing logged: the app cannot see what goes in the folder.
    await expect(footage()).resolves.toEqual([]);
    await expect(db.select().from(schema.activityLog)).resolves.toEqual([]);
  });

  it("keeps one folder of each when two clicks race: the loser trashes its own", async () => {
    const { session, trip } = await scene();

    const [a, b] = await Promise.all([click(session.id), click(session.id)]);

    const { upload } = await sessionFoldersOf(session.id);
    expect(openedFolder(a)).toBe(upload);
    expect(openedFolder(b)).toBe(upload);
    const live = (name: string) => drive.named(name).filter((file) => !file.trashed);
    // One in each tree.
    expect(live(`2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`)).toHaveLength(
      2,
    );
    expect(
      live(`Kelompok 18 · 12–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`),
    ).toHaveLength(2);
  });

  it("refuses anyone who does not write the trip, a Pimpinan included, asking Drive nothing", async () => {
    const { session, pimpinan, outsider } = await scene();

    for (const who of [pimpinan, outsider]) {
      vi.mocked(requirePerson).mockResolvedValue(who);
      expect((await click(session.id)).status).toBe(404);
    }
    expect(drive.calls).toBe(0);
    expect(await sessionFoldersOf(session.id)).toEqual({ archive: null, upload: null });
  });

  it("opens for a member of the trip's Group who holds no Grant", async () => {
    const { session, trip } = await scene();
    const member = await addPerson({ fullName: "Budi", email: "budi@itb.ac.id", role: "Staff" });
    await addGroupMember(trip.id, member.id);
    vi.mocked(requirePerson).mockResolvedValue({ ...member, grants: [] } as Person);

    expect(openedFolder(await click(session.id))).toBe((await sessionFoldersOf(session.id)).upload);
  });

  it("answers 404 for an online Session and for no Session, asking Drive nothing", async () => {
    const { online } = await scene();

    for (const folder of ["upload", "archive"] as const) {
      expect((await click(online.id, folder)).status).toBe(404);
      expect((await click("bukan-sesi", folder)).status).toBe(404);
    }
    expect(drive.calls).toBe(0);
  });

  it("never makes a folder for a cancelled Session, and opens the one it already has", async () => {
    const { cancelled } = await scene();

    for (const folder of ["upload", "archive"] as const) {
      expect((await click(cancelled.id, folder)).status).toBe(404);
    }
    expect(await sessionFoldersOf(cancelled.id)).toEqual({ archive: null, upload: null });
    expect(drive.calls).toBe(0);

    await db
      .update(schema.session)
      .set({ driveFootageFolderId: "archive-before", driveFootageUploadFolderId: "upload-before" })
      .where(eq(schema.session.id, cancelled.id));
    expect(openedFolder(await click(cancelled.id, "upload"))).toBe("upload-before");
    expect(openedFolder(await click(cancelled.id, "archive"))).toBe("archive-before");
  });

  it("still re-applies the sharing on a cancelled Session's existing folders", async () => {
    const { session, trip, staff } = await scene();
    openedFolder(await click(session.id));
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Hujan" })
      .where(eq(schema.session.id, session.id));
    const { archive, upload } = await sessionFoldersOf(session.id);
    const tripUpload = (await perjadinFoldersOf(trip.id)).upload!;
    for (const id of [archive!, tripUpload]) {
      for (const permission of await drive.listPermissions(id)) {
        if (!permission.inherited) await drive.deletePermission(id, permission.id);
      }
    }
    const before = allFolders().length;

    expect(openedFolder(await click(session.id, "archive"))).toBe(archive);
    expect(openedFolder(await click(session.id, "upload"))).toBe(upload);

    expect(await sharesOn(archive!)).toEqual(["anyone reader"]);
    expect(await sharesOn(tripUpload)).toEqual([`user writer ${staff.email}`]);
    expect(allFolders()).toHaveLength(before);
  });

  it("opens an existing folder while Drive is not usable, and sends a new one back", async () => {
    const { session } = await scene({ connection: "broken" });

    const back = await click(session.id, "upload", "/pendamping");
    expect(openedFolder(back)).toBeNull();
    expect(back.headers.get("location")).toBe(
      "http://localhost:3001/pendamping?foto-video=drive-unavailable",
    );

    await db
      .update(schema.session)
      .set({ driveFootageUploadFolderId: "folder-made-before" })
      .where(eq(schema.session.id, session.id));
    expect(openedFolder(await click(session.id))).toBe("folder-made-before");
  });

  it.each(["archive", "upload"] as const)(
    "does not remake a trashed %s Perjadin folder, and says an Administrator must restore it",
    async (tree) => {
      const { session, trip } = await scene();
      openedFolder(await click(session.id));
      const tripFolder = (await perjadinFoldersOf(trip.id))[tree]!;
      drive.trash(tripFolder);
      const before = drive.files.size;

      const back = await click(session.id, "upload", `/sesi/${session.id}`);

      expect(back.headers.get("location")).toBe(
        `http://localhost:3001/sesi/${session.id}?foto-video=folder-gone`,
      );
      expect(drive.files.size).toBe(before);
      expect((await perjadinFoldersOf(trip.id))[tree]).toBe(tripFolder);
    },
  );

  it("goes back to the Session's page when `dari` points off the app", async () => {
    const { session } = await scene({ connection: "broken" });

    for (const offsite of ["//evil.example/x", "/\t/evil.example/x"]) {
      const back = await click(session.id, "upload", offsite);
      expect(back.headers.get("location")).toBe(
        `http://localhost:3001/sesi/${session.id}?foto-video=drive-unavailable`,
      );
    }
  });
});

describe("Lihat arsip: the Session's archive folder", () => {
  it("opens for anyone signed in, a Pimpinan included, and makes the archive tree only", async () => {
    const { session, trip, pimpinan, outsider } = await scene();

    for (const who of [pimpinan, outsider]) {
      vi.mocked(requirePerson).mockResolvedValue(who);
      expect(openedFolder(await click(session.id, "archive"))).toBe(
        (await sessionFoldersOf(session.id)).archive,
      );
    }
    expect((await sessionFoldersOf(session.id)).upload).toBeNull();
    expect((await perjadinFoldersOf(trip.id)).upload).toBeNull();
  });

  it("is viewable by anyone with its link; the Perjadin archive folder and above are not", async () => {
    const { session, trip } = await scene();
    openedFolder(await click(session.id, "archive"));
    const sessionFolder = (await sessionFoldersOf(session.id)).archive!;
    const tripFolder = (await perjadinFoldersOf(trip.id)).archive!;

    expect(await sharesOn(sessionFolder)).toEqual(["anyone reader"]);
    for (const folder of [
      tripFolder,
      drive.files.get(tripFolder)!.parents[0]!,
      folders.rootFolderId,
    ]) {
      expect(await drive.listPermissions(folder)).toEqual([]);
    }

    // Removed by hand, it comes back on the next click — once.
    const [link] = await drive.listPermissions(sessionFolder);
    await drive.deletePermission(sessionFolder, link!.id);
    openedFolder(await click(session.id, "archive"));
    openedFolder(await click(session.id, "archive"));
    expect(await sharesOn(sessionFolder)).toEqual(["anyone reader"]);
  });

  it("is link-shared by Foto & Video's click too, which makes it", async () => {
    const { session } = await scene();
    openedFolder(await click(session.id, "upload"));

    expect(await sharesOn((await sessionFoldersOf(session.id)).archive!)).toEqual([
      "anyone reader",
    ]);
  });
});

describe("the upload folder's sharing", () => {
  it("gives edit access to exactly the trip's active writers, with no link share and nothing else touched", async () => {
    const { session, trip, staff, pimpinan } = await scene();
    const member = await addPerson({ fullName: "Budi", email: "Budi@itb.ac.id", role: "Staff" });
    await addGroupMember(trip.id, member.id);
    const editor = await addPerson({ fullName: "Citra", email: "citra@itb.ac.id", role: "Staff" });
    await addGrant(editor.id, "Perjadin Editor");
    const admin = await addPerson({ fullName: "Dodi", email: "dodi@itb.ac.id", role: "Staff" });
    await addGrant(admin.id, "Administrator");
    // Not a writer: a revoked Group member (and the scene's Eka, on no Group).
    const gone = await addPerson({ fullName: "Gita", email: "gita@itb.ac.id", role: "Staff" });
    await addGroupMember(trip.id, gone.id);
    await revokePerson(gone.id);
    // A first click makes the folder; then hands in Drive add an editor, a commenter and the owner.
    openedFolder(await click(session.id));
    const tripFolder = (await perjadinFoldersOf(trip.id)).upload!;
    drive.share(tripFolder, { type: "user", role: "writer", emailAddress: "lama@itb.ac.id" });
    drive.share(tripFolder, { type: "user", role: "owner", emailAddress: "sugt@gmail.com" });
    drive.share(tripFolder, { type: "user", role: "commenter", emailAddress: "tamu@gmail.com" });
    const createPermission = vi.spyOn(drive, "createPermission");

    openedFolder(await click(session.id));

    expect(await sharesOn(tripFolder)).toEqual(
      [
        "user commenter tamu@gmail.com",
        "user owner sugt@gmail.com",
        "user writer budi@itb.ac.id",
        "user writer citra@itb.ac.id",
        "user writer dodi@itb.ac.id",
        `user writer ${staff.email}`,
      ].sort(),
    );
    expect(await sharesOn(tripFolder)).not.toContain(`user writer ${pimpinan.email}`);
    // Re-applied: only what was missing is added — nothing was.
    expect(createPermission).not.toHaveBeenCalled();
    // The Session's upload folder inherits it and carries nothing of its own; no link share anywhere
    // in the upload tree.
    const sessionFolder = (await sessionFoldersOf(session.id)).upload!;
    const permissions = await drive.listPermissions(sessionFolder);
    expect(permissions.filter((p) => !p.inherited)).toEqual([]);
    expect(permissions.some((p) => p.type === "anyone")).toBe(false);
  });

  it("skips an email Drive refuses, and shares with the rest", async () => {
    const { session, trip, staff } = await scene();
    const member = await addPerson({ fullName: "Budi", email: "budi@yahoo.com", role: "Staff" });
    await addGroupMember(trip.id, member.id);
    drive.refusedEmails.add("budi@yahoo.com");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(openedFolder(await click(session.id))).toBe((await sessionFoldersOf(session.id)).upload);

    expect(await sharesOn((await perjadinFoldersOf(trip.id)).upload!)).toEqual([
      `user writer ${staff.email}`,
    ]);
    expect(error).toHaveBeenCalled();
  });

  it("still opens the folder when sharing fails", async () => {
    const { session } = await scene();
    vi.spyOn(drive, "listPermissions").mockRejectedValue(
      new DriveRequestError("permissions.list", 503),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(openedFolder(await click(session.id))).toBe((await sessionFoldersOf(session.id)).upload);
    expect(error).toHaveBeenCalled();
  });

  it("neither it nor the archive's link share sets off Periksa koneksi's warning", async () => {
    const { session } = await scene();
    openedFolder(await click(session.id, "upload"));
    openedFolder(await click(session.id, "archive"));
    const { archive, upload } = await sessionFoldersOf(session.id);
    expect(await sharesOn(archive!)).toEqual(["anyone reader"]);
    expect((await drive.listPermissions(upload!)).length).toBeGreaterThan(0);

    const report = await checkDriveConnectionAction();

    if (report.token !== "ok") throw new Error(report.token);
    expect(report.exposed).toEqual([]);
  });
});

describe("footage recorded before #561", () => {
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
    // The file's own link share, once; the archive Session folder's reaches it by inheritance.
    expect(await sharesOn(driveFileId)).toEqual(["anyone reader"]);
    expect(
      drive.named(`2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`),
    ).toHaveLength(1);
  });
});

describe("renames", () => {
  it("renames the Session's folders and archived files when its date and time move, never a Staff upload", async () => {
    const { session } = await scene();
    const { driveFileId, footageId } = await recorded(session);
    openedFolder(await click(session.id));
    const { upload } = await sessionFoldersOf(session.id);
    const staffUpload = await drive.createFile({
      name: "IMG_2001.JPG",
      parentId: upload!,
      mimeType: "image/jpeg",
      content: "jpeg",
    });

    await expect(moveSessionDateAction(session.id, "2026-10-15", "13:30")).resolves.toEqual(
      expect.objectContaining({ outcome: "moved" }),
    );

    const file = drive.files.get(driveFileId)!;
    const name = `2026-10-15 · 13.30 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`;
    expect(file.name).toBe(`2026-10-15 · SMAN 1-Bontang · Foto · M-${footageId.slice(0, 8)}.jpg`);
    expect(drive.files.get(file.parents[0]!)?.name).toBe(name);
    expect(drive.files.get(upload!)?.name).toBe(name);
    expect(drive.files.get(staffUpload.id)?.name).toBe("IMG_2001.JPG");
  });

  it("renames them after Ubah Sesi on the trip too", async () => {
    const { session, trip, school } = await scene();
    const { driveFileId } = await recorded(session);
    openedFolder(await click(session.id));
    const { upload } = await sessionFoldersOf(session.id);

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
    expect(drive.files.get(upload!)?.name.startsWith("2026-10-16 · 10.00 · ")).toBe(true);
  });
});

describe("the Perjadin's Foto & Video folders", () => {
  it("are renamed with the trip's other folders when its dates are corrected", async () => {
    const { session, trip } = await scene();
    openedFolder(await click(session.id));
    const tripFolders = await perjadinFoldersOf(trip.id);

    await expect(
      updatePerjadinDatesAction(trip.id, { startsOn: "2026-10-13", endsOn: "2026-10-16" }),
    ).resolves.toMatchObject({ outcome: "updated" });

    for (const id of [tripFolders.archive!, tripFolders.upload!]) {
      expect(drive.files.get(id)!.name).toBe(
        `Kelompok 18 · 13–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`,
      );
    }
  });

  it("are brought back to their names by Periksa koneksi, the upload Session folder too", async () => {
    const { session, trip } = await scene();
    openedFolder(await click(session.id));
    const tripFolders = await perjadinFoldersOf(trip.id);
    const { upload } = await sessionFoldersOf(session.id);
    for (const id of [tripFolders.archive!, tripFolders.upload!, upload!]) {
      await drive.updateFile(id, { name: "lama" });
    }

    const report = await checkDriveConnectionAction();

    for (const id of [tripFolders.archive!, tripFolders.upload!]) {
      expect(drive.files.get(id)!.name).toBe(
        `Kelompok 18 · 12–16 Okt 2026 · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`,
      );
    }
    expect(drive.files.get(upload!)!.name).toBe(
      `2026-10-14 · 08.00 · SMAN 1-Bontang · S-${session.id.slice(0, 8)}`,
    );
    expect(report.token === "ok" && report.names.ran && report.names.renamed).toBe(3);
  });

  it("reports a trashed upload Session folder in Periksa koneksi and leaves it in the trash", async () => {
    const { session } = await scene();
    openedFolder(await click(session.id));
    const { upload } = await sessionFoldersOf(session.id);
    drive.trash(upload!);

    const report = await checkDriveConnectionAction();

    if (report.token !== "ok" || !report.names.ran) throw new Error("no names pass");
    expect(report.names.failures).toEqual([
      expect.objectContaining({ folder: "sesi-foto-video-unggah", reason: "folder-trashed" }),
    ]);
    expect((await drive.getFile(upload!))?.trashed).toBe(true);
  });
});

describe("Periksa koneksi", () => {
  it("makes both trees' fixed Foto & Video folders for a connection made before them", async () => {
    await scene({ footage: false, footageUpload: false });

    const report = await checkDriveConnectionAction();

    if (report.token !== "ok") throw new Error(report.token);
    expect(report.footage).toBe("created");
    expect(report.footageUpload).toBe("created");
    expect(describeDriveCheck(report).lines).toEqual(
      expect.arrayContaining([
        "Folder Foto & Video: dibuat.",
        "Folder Foto & Video — Unggahan: dibuat.",
      ]),
    );
    const [ids] = await db
      .select({
        tree: schema.driveConnection.footageFolderId,
        pelaksanaan: schema.driveConnection.footagePelaksanaanOfflineFolderId,
        uploadTree: schema.driveConnection.footageUploadFolderId,
        uploadPelaksanaan: schema.driveConnection.footageUploadPelaksanaanOfflineFolderId,
      })
      .from(schema.driveConnection);
    expect(drive.files.get(ids!.tree!)?.name).toBe(FOOTAGE_FOLDER_NAME);
    expect(drive.files.get(ids!.pelaksanaan!)?.parents).toEqual([ids!.tree]);
    expect(drive.files.get(ids!.uploadTree!)).toMatchObject({
      name: FOOTAGE_UPLOAD_FOLDER_NAME,
      parents: [folders.rootFolderId],
    });
    expect(drive.files.get(ids!.uploadPelaksanaan!)?.parents).toEqual([ids!.uploadTree]);

    const again = await checkDriveConnectionAction();
    if (again.token !== "ok") throw new Error(again.token);
    expect([again.footage, again.footageUpload]).toEqual(["ok", "ok"]);
    expect(describeDriveCheck(again).lines).toContain("Folder Foto & Video — Unggahan: ada.");
  });

  it("sweeps unsynced footage and re-asserts the Session folder's and files' names", async () => {
    const { session } = await scene();
    const { driveFileId, footageId } = await recorded(session);
    // Names gone stale by hand, and a second file an upload left in `_staging` before #561.
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
