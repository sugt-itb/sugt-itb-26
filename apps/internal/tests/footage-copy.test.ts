import { checkDriveConnectionAction } from "-/app/(app)/pengaturan/actions";
import { GET as cronFotoVideo } from "-/app/api/cron/foto-video/route";
import { describeDriveCheck } from "-/lib/drive/check-report";
import { copyFootageToArchive } from "-/lib/drive/copy-footage";
import { COMPANY_ACCOUNT, FakeDrive } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DRIVE_FILE_SCOPE, DRIVE_SCOPE, FOLDER_MIME_TYPE, openDrive } from "-/lib/drive/google";
import { openSessionFootageFolder } from "-/lib/drive/session-footage-folder";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectDrive, stubTokenEndpoint } from "./support/drive";
import {
  addCluster,
  addGrant,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The daily Foto & Video copy** (#562, ADR-0063), against the real database and the in-memory
 * `FakeDrive`, which models who owns what. Staff put files into a Session's upload folder through
 * Drive (`drive.upload`, owned by them); the pass copies each into the Session's archive as the
 * company account, and never touches an original.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const STAFF = "budi@gmail.com";
const CRON = { kind: "cron" } as const;
const FULL = `openid email ${DRIVE_SCOPE}`;

let drive: FakeDrive;
let folders: ReadyFolders;

/** An Administrator, a trip with two offline Sessions, Drive connected, and both Sessions' folders made. */
async function scene() {
  const rina = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  await addGrant(rina.id, "Administrator");
  const admin = { ...rina, grants: ["Administrator"] } as Person;
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "k18",
    name: "Kelompok 18",
    clusterId: cluster.id,
  });
  const school = await addSchool({
    slug: "sman-1",
    name: "SMAN 1 Bontang",
    clusterId: cluster.id,
    subClusterId: subCluster.id,
    provinceCode: "KT",
  });
  const trip = await addPerjadin({
    picPersonId: rina.id,
    subClusterId: subCluster.id,
    startsOn: "2026-10-12",
    endsOn: "2026-10-16",
  });
  const sessions = [
    await addOfflineSession({ schoolId: school.id, heldOn: "2026-10-13", perjadinId: trip.id }),
    await addOfflineSession({ schoolId: school.id, heldOn: "2026-10-14", perjadinId: trip.id }),
  ].sort((a, b) => a.id.localeCompare(b.id));
  folders = await connectDrive(drive, rina.id);
  vi.mocked(requirePerson).mockResolvedValue(admin);
  for (const session of sessions) {
    const opened = await openSessionFootageFolder(admin, session.id, "upload");
    if (opened.outcome !== "open") throw new Error(opened.outcome);
  }
  const ids = await Promise.all(sessions.map((session) => foldersOf(session.id)));
  return {
    admin,
    sessions,
    upload: ids.map((f) => f.upload!),
    archive: ids.map((f) => f.archive!),
  };
}

async function foldersOf(sessionId: string) {
  const [row] = await db
    .select({
      upload: schema.session.driveFootageUploadFolderId,
      archive: schema.session.driveFootageFolderId,
      checkedAt: schema.session.driveFootageUploadCheckedAt,
    })
    .from(schema.session)
    .where(eq(schema.session.id, sessionId));
  return row!;
}

/** Every live item under `folderId`, with its name, owner and source, as one sorted list. */
function tree(folderId: string, prefix = ""): string[] {
  return [...drive.files.values()]
    .filter((file) => file.parents.includes(folderId) && !file.explicitlyTrashed)
    .flatMap((file) => {
      const line = `${prefix}${file.name} [${file.owner}]${file.appProperties.sugtSourceFileId ? " copy" : ""}`;
      return file.mimeType === FOLDER_MIME_TYPE
        ? [line, ...tree(file.id, `${prefix}${file.name}/`)]
        : [line];
    })
    .sort();
}

/** Each stored item as it stands — what an original must still be after a pass. */
function snapshot(id: string) {
  const file = drive.files.get(id)!;
  return JSON.stringify({
    name: file.name,
    parents: file.parents,
    owner: file.owner,
    trashed: file.explicitlyTrashed,
    permissions: file.permissions,
    appProperties: file.appProperties,
  });
}

const pass = (budgetMs?: number) =>
  copyFootageToArchive(CRON, drive, folders, { scope: FULL, ...(budgetMs ? { budgetMs } : {}) });

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("the copy", () => {
  it("copies each Staff file once, a subfolder's too, as the company's, and leaves the original as it was", async () => {
    const { sessions, upload, archive } = await scene();
    const photo = drive.upload(upload[0]!, { name: "IMG_0001.HEIC", owner: STAFF });
    const sub = drive.upload(upload[0]!, {
      name: "Hari 2",
      owner: STAFF,
      mimeType: FOLDER_MIME_TYPE,
    });
    const video = drive.upload(sub, {
      name: "VID_0002.MOV",
      owner: STAFF,
      mimeType: "video/quicktime",
    });
    const binned = drive.upload(upload[0]!, { name: "salah.jpg", owner: STAFF });
    drive.trash(binned);
    drive.shortcut(upload[0]!, photo, STAFF);
    const before = [photo, sub, video].map(snapshot);

    await expect(pass()).resolves.toEqual({
      ran: true,
      copied: 2,
      failed: 0,
      remaining: 0,
      failures: [],
    });

    expect(tree(archive[0]!)).toEqual([
      `Hari 2 [${COMPANY_ACCOUNT}]`,
      `Hari 2/VID_0002.MOV [${COMPANY_ACCOUNT}] copy`,
      `IMG_0001.HEIC [${COMPANY_ACCOUNT}] copy`,
    ]);
    const copy = [...drive.files.values()].find((f) => f.appProperties.sugtSourceFileId === photo)!;
    expect(copy.appProperties).toEqual({ sugtSourceFileId: photo, sugtSessionId: sessions[0]!.id });
    expect([photo, sub, video].map(snapshot)).toEqual(before);

    // A second pass finds both copies and makes nothing — a renamed original included.
    await drive.updateFile(photo, { name: "IMG_0001 (diganti).HEIC" });
    const count = drive.files.size;
    await expect(pass()).resolves.toMatchObject({ copied: 0, failed: 0 });
    expect(drive.files.size).toBe(count);
  });

  it("keeps the copy when the Staff member deletes the original", async () => {
    const { upload, archive } = await scene();
    const photo = drive.upload(upload[1]!, { name: "IMG_0003.JPG", owner: STAFF });
    await pass();

    drive.remove(photo);

    expect(tree(archive[1]!)).toEqual([`IMG_0003.JPG [${COMPANY_ACCOUNT}] copy`]);
    await expect(pass()).resolves.toMatchObject({ copied: 0, failed: 0 });
  });

  it("never deletes, trashes or moves anything in either tree", async () => {
    const { upload } = await scene();
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });
    drive.upload(upload[1]!, { name: "b.jpg", owner: STAFF });
    const trash = vi.spyOn(drive, "trashFile");
    const update = vi.spyOn(drive, "updateFile");
    const unshare = vi.spyOn(drive, "deletePermission");
    const before = [...drive.files.keys()].map(snapshot);

    await pass();

    expect(trash).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(unshare).not.toHaveBeenCalled();
    expect([...drive.files.keys()].slice(0, before.length).map(snapshot)).toEqual(before);
  });

  it("reports a file Google refuses for storage, and copies it on a later pass", async () => {
    const { sessions, upload } = await scene();
    const full = drive.upload(upload[0]!, { name: "IMG_0004.JPG", owner: STAFF });
    drive.refusedCopies.set(full, { status: 403, reason: "storageQuotaExceeded" });

    const first = await pass();

    expect(first).toMatchObject({ ran: true, copied: 0, failed: 1 });
    expect(first.ran && first.failures).toEqual([
      {
        sessionId: sessions[0]!.id,
        sessionName: expect.stringContaining(`S-${sessions[0]!.id.slice(0, 8)}`),
        fileName: "IMG_0004.JPG",
        uploader: STAFF,
        reason: "storage-full",
      },
    ]);
    // Gone through all the same, so it cannot hold the queue: it waits its turn like any other.
    expect((await foldersOf(sessions[0]!.id)).checkedAt).not.toBeNull();

    drive.refusedCopies.delete(full);
    await expect(pass()).resolves.toMatchObject({ copied: 1, failed: 0 });
  });

  it("stops the whole pass at a rate limit, and the next pass carries on", async () => {
    const { upload } = await scene();
    const limited = drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });
    drive.upload(upload[1]!, { name: "b.jpg", owner: STAFF });
    drive.refusedCopies.set(limited, { status: 403, reason: "userRateLimitExceeded" });
    const copy = vi.spyOn(drive, "copyFile");

    const first = await pass();

    expect(first).toMatchObject({ ran: true, copied: 0, remaining: 2 });
    expect(first.ran && first.failures.map((f) => f.reason)).toEqual(["rate-limited"]);
    expect(copy).toHaveBeenCalledTimes(1);

    drive.refusedCopies.delete(limited);
    await expect(pass()).resolves.toMatchObject({ copied: 2, remaining: 0 });
  });

  it("does not recreate a trashed archive folder, and reports it", async () => {
    const { upload, archive } = await scene();
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });
    drive.trash(archive[0]!);
    const size = drive.files.size;

    const report = await pass();

    expect(report.ran && report.failures.map((f) => [f.fileName, f.reason])).toEqual([
      [null, "folder-trashed"],
    ]);
    expect(drive.files.size).toBe(size);
  });

  it("never makes an archive folder for a cancelled Session that has none", async () => {
    const { sessions, upload } = await scene();
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Hujan", driveFootageFolderId: null })
      .where(eq(schema.session.id, sessions[0]!.id));
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });
    const size = drive.files.size;

    const report = await pass();

    expect(report.ran && report.failures.map((f) => [f.sessionId, f.reason])).toEqual([
      [sessions[0]!.id, "folder-missing"],
    ]);
    expect(drive.files.size).toBe(size);
    expect((await foldersOf(sessions[0]!.id)).archive).toBeNull();
  });

  it("does not remake an archive subfolder in the trash, nor copy into it", async () => {
    const { upload, archive } = await scene();
    const sub = drive.upload(upload[0]!, {
      name: "Hari 2",
      owner: STAFF,
      mimeType: FOLDER_MIME_TYPE,
    });
    drive.upload(sub, { name: "a.jpg", owner: STAFF });
    await pass();
    const archived = [...drive.files.values()].find(
      (f) => f.appProperties.sugtSourceFolderId === sub,
    )!;
    drive.trash(archived.id);
    drive.upload(sub, { name: "b.jpg", owner: STAFF });
    const size = drive.files.size;

    const report = await pass();

    expect(report.ran && report.failures.map((f) => [f.fileName, f.reason])).toEqual([
      ["Hari 2", "folder-trashed"],
    ]);
    expect(drive.files.size).toBe(size);
    expect(tree(archive[0]!)).toEqual([]);
  });

  it("goes through a cancelled Session's upload folder too", async () => {
    const { sessions, upload, archive } = await scene();
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Hujan" })
      .where(eq(schema.session.id, sessions[0]!.id));
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });

    await expect(pass()).resolves.toMatchObject({ copied: 1 });
    expect(tree(archive[0]!)).toEqual([`a.jpg [${COMPANY_ACCOUNT}] copy`]);
  });
});

describe("bounded and resumable", () => {
  it("stops at its budget, and resumes with the Sessions it had not finished", async () => {
    const { sessions, upload } = await scene();
    for (const folder of upload) {
      drive.upload(folder, { name: "1.jpg", owner: STAFF });
      drive.upload(folder, { name: "2.jpg", owner: STAFF });
    }
    // Each copy takes ten seconds of the clock; a 25-second budget fits three.
    const real = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => real() + offset);
    const copyFile = drive.copyFile.bind(drive);
    vi.spyOn(drive, "copyFile").mockImplementation(async (...args) => {
      offset += 10_000;
      return copyFile(...args);
    });

    await expect(pass(25_000)).resolves.toMatchObject({ copied: 3, remaining: 1 });
    expect((await foldersOf(sessions[0]!.id)).checkedAt).not.toBeNull();
    expect((await foldersOf(sessions[1]!.id)).checkedAt).toBeNull();

    // The unfinished Session goes first now, ahead of the one just checked.
    const order: string[] = [];
    const list = drive.listChildren.bind(drive);
    vi.spyOn(drive, "listChildren").mockImplementation(async (id) => {
      order.push(id);
      return list(id);
    });
    await expect(pass(25_000)).resolves.toMatchObject({ copied: 1, remaining: 0 });
    expect(order.find((id) => upload.includes(id))).toBe(upload[1]);
  });

  it("lets only one of two passes at once copy, and a lease left by a crashed pass expires", async () => {
    const { upload } = await scene();
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });

    const [a, b] = await Promise.all([pass(), pass()]);

    expect([a, b].filter((report) => !report.ran)).toEqual([{ ran: false, reason: "busy" }]);
    expect([a, b].filter((report) => report.ran)).toMatchObject([{ copied: 1 }]);
    expect(drive.named("a.jpg")).toHaveLength(2);

    // A pass that died holding the lease: once it has run out, the next pass takes it.
    await db
      .update(schema.driveConnection)
      .set({ footageCopyLeaseUntil: new Date(real() + 60_000) });
    await expect(pass()).resolves.toEqual({ ran: false, reason: "busy" });
    await db
      .update(schema.driveConnection)
      .set({ footageCopyLeaseUntil: new Date(real() - 1_000) });
    await expect(pass()).resolves.toMatchObject({ ran: true });
  });
});

const real = () => Date.now();

describe("the daily cron", () => {
  const call = (authorization?: string) =>
    cronFotoVideo(
      new Request("http://localhost:3001/api/cron/foto-video", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("refuses a missing or wrong CRON_SECRET, touching nothing, and runs the pass with the right one", async () => {
    const { upload } = await scene();
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });
    vi.stubEnv("CRON_SECRET", "rahasia-cron");
    const calls = drive.calls;

    for (const wrong of [undefined, "Bearer salah", "rahasia-cron", "Bearer rahasia-cron2"]) {
      expect((await call(wrong)).status).toBe(401);
    }
    expect(drive.calls).toBe(calls);

    const response = await call("Bearer rahasia-cron");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ran: true, copied: 1 });
  });

  it("copies nothing on a connection without the full drive scope, and says so", async () => {
    const { upload } = await scene();
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });
    vi.stubEnv("CRON_SECRET", "rahasia-cron");
    stubTokenEndpoint({ scope: `openid email ${DRIVE_FILE_SCOPE}` });

    const response = await call("Bearer rahasia-cron");

    await expect(response.json()).resolves.toEqual({ ran: false, reason: "scope-missing" });
    expect(drive.named("a.jpg")).toHaveLength(1);
  });
});

describe("Periksa koneksi", () => {
  it("runs the pass and reports copied, failed and remaining, with each failure's reason", async () => {
    const { sessions, upload } = await scene();
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });
    const refused = drive.upload(upload[1]!, { name: "b.jpg", owner: STAFF });
    drive.refusedCopies.set(refused, { status: 403, reason: "storageQuotaExceeded" });

    const report = await checkDriveConnectionAction();

    if (report.token !== "ok") throw new Error(report.token);
    const said = describeDriveCheck(report);
    expect(said.lines).toContain(
      "1 berkas Foto & Video disalin ke arsip, 1 gagal, 0 sesi belum diperiksa.",
    );
    expect(said.failures).toEqual([
      expect.stringMatching(
        new RegExp(
          `^2026-10-1[34] · .* · SMAN 1 Bontang · S-${sessions[1]!.id.slice(0, 8)} · b\\.jpg \\(budi@gmail\\.com\\): Penyimpanan Google Drive pengunggah penuh\\.$`,
        ),
      ),
    ]);
  });

  it("skips the copy without the full drive scope, and says to reconnect", async () => {
    const { upload } = await scene();
    drive.upload(upload[0]!, { name: "a.jpg", owner: STAFF });
    stubTokenEndpoint({ scope: `openid email ${DRIVE_FILE_SCOPE}` });

    const report = await checkDriveConnectionAction();

    if (report.token !== "ok") throw new Error(report.token);
    expect(report.footageCopy).toEqual({ ran: false, reason: "scope-missing" });
    expect(describeDriveCheck(report).lines).toContain(
      "Akses Drive perlu diperluas untuk menyalin Foto & Video — hubungkan ulang.",
    );
    expect(drive.named("a.jpg")).toHaveLength(1);
  });
});
