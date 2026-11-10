import { assignGrantAction, revokePersonAction } from "-/app/(app)/orang/actions";
import { checkDriveConnectionAction } from "-/app/(app)/pengaturan/actions";
import { changePerjadinPicAction, setPerjadinStaffAction } from "-/app/(app)/perjadin/[id]/actions";
import { reapplyFootageSharing } from "-/lib/drive/check";
import { describeDriveCheck } from "-/lib/drive/check-report";
import { FakeDrive } from "-/lib/drive/fake-drive";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { openSessionFootageFolder } from "-/lib/drive/session-footage-folder";
import { touchesFootageAccess } from "-/lib/foto-video";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectDrive, stubTokenEndpoint } from "./support/drive";
import {
  addCluster,
  addGroupMember,
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
 * **A trip's Foto & Video folder follows who writes the trip** (#553, ADR-0061), against the real
 * database and the in-memory `FakeDrive`. A Group change or a revocation re-shares the affected
 * folders straight after its commit, best effort; a Grant change waits for Periksa koneksi's sharing
 * pass, which re-shares every footage folder within a per-press bound.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let drive: FakeDrive;

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

/** A School in Kelompok 18, ready for trips. */
async function place() {
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "kelompok-18",
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
  return { subClusterId: subCluster.id, schoolId: school.id };
}

/** A trip led by `picId`, with one offline Session. */
async function trip(where: Awaited<ReturnType<typeof place>>, picId: string, startsOn: string) {
  const perjadin = await addPerjadin({
    picPersonId: picId,
    subClusterId: where.subClusterId,
    startsOn,
    endsOn: startsOn,
  });
  const session = await addOfflineSession({
    schoolId: where.schoolId,
    heldOn: startsOn,
    startsAt: "08:00",
    perjadinId: perjadin.id,
  });
  return { id: perjadin.id, sessionId: session.id };
}

/**
 * Rina, a Staff Administrator, signed in, leads a trip whose Group also holds Budi; Citra is Staff on
 * no trip. Drive is connected.
 */
async function scene() {
  const rina = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  await addGrant(rina.id, "Administrator");
  const budi = await addPerson({ fullName: "Budi", email: "budi@itb.ac.id", role: "Staff" });
  const citra = await addPerson({ fullName: "Citra", email: "citra@itb.ac.id", role: "Staff" });
  const where = await place();
  const a = await trip(where, rina.id, "2026-10-14");
  await addGroupMember(a.id, budi.id);
  const admin = { ...rina, grants: ["Administrator"] } as Person;
  await connectDrive(drive, rina.id, "connected", {});
  vi.mocked(requirePerson).mockResolvedValue(admin);
  return { admin, budi, citra, where, a };
}

/** Make a trip's footage folder, as the first click on Foto & Video does; answers its id. */
async function clickFotoVideo(admin: Person, sessionId: string, perjadinId: string) {
  const opened = await openSessionFootageFolder(admin, sessionId);
  if (opened.outcome !== "open") throw new Error(opened.outcome);
  const [row] = await db
    .select({ id: schema.perjadin.driveFootageFolderId })
    .from(schema.perjadin)
    .where(eq(schema.perjadin.id, perjadinId));
  return row!.id!;
}

/** The emails a folder gives edit access to, sorted. */
async function editors(folderId: string) {
  return (await drive.listPermissions(folderId))
    .filter((p) => !p.inherited && p.type === "user" && p.role === "writer")
    .map((p) => p.emailAddress)
    .sort();
}

describe("a Group change, straight away", () => {
  it("takes a removed member off the folder and puts an added one on", async () => {
    const { admin, citra, a } = await scene();
    const folder = await clickFotoVideo(admin, a.sessionId, a.id);
    expect(await editors(folder)).toEqual(["budi@itb.ac.id", "rina@itb.ac.id"]);

    await expect(setPerjadinStaffAction(a.id, [citra.id])).resolves.toMatchObject({
      outcome: "set",
    });

    expect(await editors(folder)).toEqual(["citra@itb.ac.id", "rina@itb.ac.id"]);
    // The link share is left alone.
    const link = (await drive.listPermissions(folder)).filter((p) => p.type === "anyone");
    expect(link).toHaveLength(1);
  });

  it("puts a new PIC on the folder", async () => {
    const { admin, citra, a } = await scene();
    const folder = await clickFotoVideo(admin, a.sessionId, a.id);

    await expect(changePerjadinPicAction(a.id, citra.id)).resolves.toMatchObject({
      outcome: "changed",
    });

    expect(await editors(folder)).toContain("citra@itb.ac.id");
  });

  it("makes no Drive call for a trip with no footage folder yet", async () => {
    const { citra, a } = await scene();
    drive.calls = 0;

    await setPerjadinStaffAction(a.id, [citra.id]);

    expect(drive.calls).toBe(0);
  });

  it("keeps the Group change when Drive fails, logs it, and Periksa koneksi puts it right", async () => {
    const { admin, citra, a } = await scene();
    const folder = await clickFotoVideo(admin, a.sessionId, a.id);
    const listPermissions = vi
      .spyOn(drive, "listPermissions")
      .mockRejectedValueOnce(new DriveRequestError("permissions.list", 503));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(setPerjadinStaffAction(a.id, [citra.id])).resolves.toMatchObject({
      outcome: "set",
    });

    const members = await db
      .select({ id: schema.groupMember.personId })
      .from(schema.groupMember)
      .where(eq(schema.groupMember.perjadinId, a.id));
    expect(members.map((m) => m.id).sort()).toEqual([admin.id, citra.id].sort());
    expect(error).toHaveBeenCalled();
    listPermissions.mockRestore();
    expect(await editors(folder)).toEqual(["budi@itb.ac.id", "rina@itb.ac.id"]);

    await checkDriveConnectionAction();

    expect(await editors(folder)).toEqual(["citra@itb.ac.id", "rina@itb.ac.id"]);
  });
});

describe("a revocation, straight away", () => {
  it("takes the Person off the folders of every trip whose Group they were in", async () => {
    const { admin, budi, where, a } = await scene();
    const b = await trip(where, admin.id, "2026-10-21");
    await addGroupMember(b.id, budi.id);
    const folderA = await clickFotoVideo(admin, a.sessionId, a.id);
    const folderB = await clickFotoVideo(admin, b.sessionId, b.id);

    await expect(revokePersonAction(budi.id)).resolves.toEqual({ outcome: "revoked" });

    expect(await editors(folderA)).toEqual(["rina@itb.ac.id"]);
    expect(await editors(folderB)).toEqual(["rina@itb.ac.id"]);
  });
});

describe("Periksa koneksi's sharing pass", () => {
  it("brings every footage folder to a new Perjadin Editor once a press gets through them", async () => {
    const { admin, citra, where, a } = await scene();
    const b = await trip(where, admin.id, "2026-10-21");
    const folders = [
      await clickFotoVideo(admin, a.sessionId, a.id),
      await clickFotoVideo(admin, b.sessionId, b.id),
    ];
    const owner = drive.share(folders[0]!, {
      type: "user",
      role: "owner",
      emailAddress: "sugt@gmail.com",
    });

    await assignGrantAction(citra.id, "Perjadin Editor");
    // A Grant is never applied inline: it reaches every trip.
    for (const folder of folders) expect(await editors(folder)).not.toContain("citra@itb.ac.id");

    const report = await checkDriveConnectionAction();

    for (const folder of folders) expect(await editors(folder)).toContain("citra@itb.ac.id");
    if (report.token !== "ok") throw new Error(report.token);
    expect(describeDriveCheck(report).lines).toContain(
      "2 folder Foto & Video: akses diperbarui, 0 tersisa.",
    );
    // The owner is never touched.
    expect((await drive.listPermissions(folders[0]!)).map((p) => p.id)).toContain(owner);
  });

  it("stops at its bound, and the next press finishes the rest", async () => {
    const { admin, citra, where, a } = await scene();
    const b = await trip(where, admin.id, "2026-10-21");
    const c = await trip(where, admin.id, "2026-10-28");
    for (const t of [a, b, c]) await clickFotoVideo(admin, t.sessionId, t.id);
    await addGrant(citra.id, "Perjadin Editor");

    const first = await reapplyFootageSharing(admin, drive, { limit: 2 });
    expect(first).toMatchObject({ updated: 2, remaining: 1, failures: [] });

    const second = await reapplyFootageSharing(admin, drive, { limit: 2 });
    expect(second).toMatchObject({ updated: 1, remaining: 0, failures: [] });
  });

  it("reports a trashed folder and shares nothing in the trash", async () => {
    const { admin, citra, a } = await scene();
    const folder = await clickFotoVideo(admin, a.sessionId, a.id);
    drive.trash(folder);
    await addGrant(citra.id, "Perjadin Editor");

    const report = await reapplyFootageSharing(admin, drive);

    expect(report).toMatchObject({
      updated: 0,
      remaining: 0,
      failures: [{ perjadinId: a.id, reason: "folder-trashed" }],
    });
    expect(await editors(folder)).not.toContain("citra@itb.ac.id");
  });
});

describe("the Grant screen's note", () => {
  it("is for a change to Perjadin Editor or Administrator only", () => {
    expect(touchesFootageAccess(["Perjadin Editor"])).toBe(true);
    expect(touchesFootageAccess(["Daring Editor", "Administrator"])).toBe(true);
    expect(touchesFootageAccess(["Daring Editor", "Dashboard Viewer"])).toBe(false);
  });
});
