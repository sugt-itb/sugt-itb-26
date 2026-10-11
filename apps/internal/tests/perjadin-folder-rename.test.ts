import {
  addPerjadinSessionAction,
  cancelPerjadinSessionAction,
  editPerjadinSessionAction,
  updatePerjadinDatesAction,
} from "-/app/(app)/perjadin/[id]/actions";
import { cancelSessionAction } from "-/app/(app)/sesi/[id]/actions";
import { FakeDrive } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { reconcileTransaction } from "-/lib/drive/reconcile";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { PerjadinDatesInput } from "@sugt/db/queries";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectDrive, jpeg, upload } from "./support/drive";
import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSchoolOnTrip,
  addTransaction,
  resetDatabase,
} from "./support/fixtures";

/**
 * **A change to a Perjadin's name renames its Drive folders** (#376, #407, ADR-0040) — a correction to
 * either date, or a Session write that changes the trip's Schools — after the commit, best effort;
 * and the reconcile repairs a rename that did not happen. Against the real
 * database and the in-memory `FakeDrive`; Google's token endpoint is stubbed at the network boundary
 * and counted, so "no call to Google" is something a test can see.
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

let drive: FakeDrive;
let folders: ReadyFolders;
let tokenCalls: number;

function dates(startsOn: string, endsOn: string): PerjadinDatesInput {
  return { startsOn, endsOn };
}

/**
 * A Staff PIC and a Kelompok 3 trip from the 12th to the 16th — with Drive connected and the trip's
 * two folders made, receipts and Dokumen, under a name from before ADR-0044, unless told otherwise.
 */
async function scene(
  options: { connected?: boolean; folder?: boolean; status?: "connected" | "broken" } = {},
) {
  const pic = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  const trip = await addPerjadin({
    picPersonId: pic.id,
    subClusterName: "Kelompok 3",
    startsOn: "2026-10-12",
    endsOn: "2026-10-16",
  });
  if (options.connected ?? true) folders = await connectDrive(drive, pic.id, options.status);
  let folderId: string | null = null;
  let dokumenFolderId: string | null = null;
  if (options.folder ?? true) {
    const stale = "Kelompok 3 · Garut · 2026-10-12";
    folderId = (await drive.createFolder({ name: stale, parentId: folders?.rootFolderId })).id;
    dokumenFolderId = (await drive.createFolder({ name: stale, parentId: folders?.rootFolderId }))
      .id;
    await db
      .update(schema.perjadin)
      .set({ driveFolderId: folderId, driveDokumenFolderId: dokumenFolderId })
      .where(eq(schema.perjadin.id, trip.id));
  }
  drive.calls = 0;
  tokenCalls = 0;
  vi.mocked(requirePerson).mockResolvedValue(pic);
  return { pic, trip, folderId, dokumenFolderId };
}

/** Both of the trip's folders, by name. */
async function folderNames(...ids: (string | null)[]) {
  return Promise.all(ids.map(async (id) => (await drive.getFile(id!))?.name));
}

/** A Session's id, by its School — the fixture that made it does not return it. */
const sessionAt = async (schoolId: string) =>
  (
    await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(and(eq(schema.session.schoolId, schoolId), eq(schema.session.status, "arranged")))
  )[0]!.id;

const startsOnOf = async (id: string) =>
  (await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, id)))[0]!.startsOn;

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  drive = new FakeDrive();
  folders = undefined as unknown as ReadyFolders;
  vi.mocked(openDrive).mockReturnValue(drive);
  vi.stubGlobal("fetch", async () => {
    tokenCalls += 1;
    return Response.json({ access_token: "access" });
  });
});

describe("a date correction", () => {
  it("renames both of the Perjadin's Drive folders when the start date moves", async () => {
    const { trip, folderId, dokumenFolderId } = await scene();

    await expect(
      updatePerjadinDatesAction(trip.id, dates("2026-10-13", "2026-10-16")),
    ).resolves.toEqual({ outcome: "updated", datesMoved: true });

    const name = `Kelompok 3 · 13–16 Okt 2026 · P-${trip.id.slice(0, 8)}`;
    await expect(folderNames(folderId, dokumenFolderId)).resolves.toEqual([name, name]);
  });

  it("renames both folders when only the end date moves", async () => {
    const { trip, folderId, dokumenFolderId } = await scene();

    await expect(
      updatePerjadinDatesAction(trip.id, dates("2026-10-12", "2026-10-15")),
    ).resolves.toEqual({ outcome: "updated", datesMoved: true });

    const name = `Kelompok 3 · 12–15 Okt 2026 · P-${trip.id.slice(0, 8)}`;
    await expect(folderNames(folderId, dokumenFolderId)).resolves.toEqual([name, name]);
  });

  it("makes no Drive call when neither date moves", async () => {
    const { trip } = await scene();

    await expect(
      updatePerjadinDatesAction(trip.id, dates("2026-10-12", "2026-10-16")),
    ).resolves.toEqual({ outcome: "updated", datesMoved: false });

    expect(drive.calls).toBe(0);
    expect(tokenCalls).toBe(0);
  });

  it.each([
    ["no Drive folder yet", { folder: false }],
    ["no connection", { connected: false, folder: true }],
    ["a broken connection", { status: "broken", folder: true }],
  ] as const)("does nothing with %s, and the correction still succeeds", async (_, options) => {
    const { trip } = await scene(options);

    await expect(
      updatePerjadinDatesAction(trip.id, dates("2026-10-13", "2026-10-16")),
    ).resolves.toMatchObject({ outcome: "updated" });

    expect(drive.calls).toBe(0);
    expect(tokenCalls).toBe(0);
    await expect(startsOnOf(trip.id)).resolves.toBe("2026-10-13");
  });

  it("renames while connected even when the fixed folders are unresolved", async () => {
    const { trip, folderId } = await scene();
    await db.update(schema.driveConnection).set({ folderProblem: "root-trashed" });

    await updatePerjadinDatesAction(trip.id, dates("2026-10-13", "2026-10-16"));

    await expect(drive.getFile(folderId!)).resolves.toMatchObject({
      name: `Kelompok 3 · 13–16 Okt 2026 · P-${trip.id.slice(0, 8)}`,
    });
  });

  it("keeps the correction when the rename fails", async () => {
    const { trip } = await scene();
    vi.spyOn(drive, "updateFile").mockRejectedValue(new DriveRequestError("files.update", 503));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      updatePerjadinDatesAction(trip.id, dates("2026-10-13", "2026-10-16")),
    ).resolves.toEqual({ outcome: "updated", datesMoved: true });

    await expect(startsOnOf(trip.id)).resolves.toBe("2026-10-13");
  });

  it("makes no Drive call when the correction is refused", async () => {
    const { trip } = await scene();
    await addProvince("JB", "Jawa Barat");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const school = await addSchool({
      slug: "sman-1-garut",
      name: "SMAN 1 Garut",
      clusterId: cluster.id,
      provinceCode: "JB",
    });
    await addOfflineSession({ schoolId: school.id, heldOn: "2026-10-12", perjadinId: trip.id });

    await expect(
      updatePerjadinDatesAction(trip.id, dates("2026-10-13", "2026-10-16")),
    ).resolves.toMatchObject({ outcome: "would-strand" });

    expect(drive.calls).toBe(0);
    expect(tokenCalls).toBe(0);
    await expect(startsOnOf(trip.id)).resolves.toBe("2026-10-12");
  });
});

describe("a change to the trip's Schools", () => {
  /**
   * The trip from `scene`, already at SMAN 1 Garut, with SMAN 2 Garut in its Sub-Cluster but not on
   * it — its one Session there was cancelled. The fixtures write straight to the database, so
   * nothing is renamed until a test calls an action.
   */
  async function onTrip() {
    const found = await scene();
    const garut1 = await addSchoolOnTrip({ perjadin: found.trip, name: "SMAN 1 Garut" });
    const garut2 = await addSchoolOnTrip({
      perjadin: found.trip,
      name: "SMAN 2 Garut",
      status: "cancelled",
    });
    drive.calls = 0;
    tokenCalls = 0;
    return { ...found, garut1, garut2 };
  }

  const at = (schoolId: string, heldOn = "2026-10-14") => ({
    schoolId,
    heldOn,
    startsAt: "13:00",
    taughtByTeacherIds: [],
  });

  it("renames both folders when a Session is added at a School not yet on the trip", async () => {
    const { trip, garut2, folderId, dokumenFolderId } = await onTrip();

    await expect(addPerjadinSessionAction(trip.id, at(garut2.id))).resolves.toMatchObject({
      outcome: "added",
      schoolsChanged: true,
    });

    const name = `Kelompok 3 · 12–16 Okt 2026 · SMAN 1 Garut, SMAN 2 Garut · P-${trip.id.slice(0, 8)}`;
    await expect(folderNames(folderId, dokumenFolderId)).resolves.toEqual([name, name]);
  });

  it("makes no Drive call when a second Session is added at a School already on it", async () => {
    const { trip, garut1 } = await onTrip();

    await expect(addPerjadinSessionAction(trip.id, at(garut1.id))).resolves.toMatchObject({
      outcome: "added",
      schoolsChanged: false,
    });

    expect(drive.calls).toBe(0);
    expect(tokenCalls).toBe(0);
  });

  it("renames both folders when a Session moves to another School", async () => {
    const { trip, garut1, garut2, folderId, dokumenFolderId } = await onTrip();

    await expect(
      editPerjadinSessionAction(trip.id, await sessionAt(garut1.id), at(garut2.id)),
    ).resolves.toEqual({ outcome: "edited", schoolsChanged: true });

    const name = `Kelompok 3 · 12–16 Okt 2026 · SMAN 2 Garut · P-${trip.id.slice(0, 8)}`;
    await expect(folderNames(folderId, dokumenFolderId)).resolves.toEqual([name, name]);
  });

  it("makes no Drive call when a Session keeps its School and only its time moves", async () => {
    const { trip, garut1 } = await onTrip();

    await expect(
      editPerjadinSessionAction(trip.id, await sessionAt(garut1.id), at(garut1.id)),
    ).resolves.toEqual({ outcome: "edited", schoolsChanged: false });

    expect(drive.calls).toBe(0);
    expect(tokenCalls).toBe(0);
  });

  it.each([
    [
      "on the Perjadin",
      (perjadinId: string, sessionId: string) =>
        cancelPerjadinSessionAction(perjadinId, sessionId, "Sekolah libur"),
    ],
    [
      "on Detail Sesi",
      (_: string, sessionId: string) => cancelSessionAction(sessionId, "Sekolah libur"),
    ],
  ])(
    "renames both folders when a School's last live Session is cancelled %s",
    async (_, cancel) => {
      const { trip, garut1, folderId, dokumenFolderId } = await onTrip();

      await expect(cancel(trip.id, await sessionAt(garut1.id))).resolves.toEqual({
        outcome: "cancelled",
        perjadinId: trip.id,
        schoolsChanged: true,
      });

      const name = `Kelompok 3 · 12–16 Okt 2026 · P-${trip.id.slice(0, 8)}`;
      await expect(folderNames(folderId, dokumenFolderId)).resolves.toEqual([name, name]);
    },
  );

  it("makes no Drive call when the cancelled Session's School has another live one", async () => {
    const { trip, garut1 } = await onTrip();
    await addPerjadinSessionAction(trip.id, at(garut1.id));
    drive.calls = 0;
    tokenCalls = 0;

    await expect(
      cancelPerjadinSessionAction(trip.id, await sessionAt(garut1.id), "Sekolah libur"),
    ).resolves.toMatchObject({ outcome: "cancelled", schoolsChanged: false });

    expect(drive.calls).toBe(0);
    expect(tokenCalls).toBe(0);
  });

  it("keeps the Session when the rename fails", async () => {
    const { trip, garut2 } = await onTrip();
    vi.spyOn(drive, "updateFile").mockRejectedValue(new DriveRequestError("files.update", 503));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(addPerjadinSessionAction(trip.id, at(garut2.id))).resolves.toMatchObject({
      outcome: "added",
      schoolsChanged: true,
    });

    await expect(sessionAt(garut2.id)).resolves.toEqual(expect.any(String));
  });
});

describe("the reconcile", () => {
  it("re-asserts a stale Perjadin folder name", async () => {
    const { pic, trip, folderId } = await scene();
    await db
      .update(schema.perjadin)
      .set({ startsOn: "2026-10-13" })
      .where(eq(schema.perjadin.id, trip.id));
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 10_000,
      createdByPersonId: pic.id,
    });
    const [fileId] = await upload(drive, trip.id, [jpeg()]);
    await db.insert(schema.transactionEvidence).values({
      transactionId: line.id,
      driveFileId: fileId!,
      contentType: "image/jpeg",
      byteSize: 4096,
      uploadedByPersonId: pic.id,
    });

    await expect(reconcileTransaction(pic, drive, folders, line.id)).resolves.toEqual({
      outcome: "synced",
    });

    await expect(drive.getFile(folderId!)).resolves.toMatchObject({
      name: `Kelompok 3 · 13–16 Okt 2026 · P-${trip.id.slice(0, 8)}`,
    });
  });

  it("does not undo a correction committed while it ran", async () => {
    const { pic, trip, folderId } = await scene();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 10_000,
      createdByPersonId: pic.id,
    });
    const [fileId] = await upload(drive, trip.id, [jpeg()]);
    await db.insert(schema.transactionEvidence).values({
      transactionId: line.id,
      driveFileId: fileId!,
      contentType: "image/jpeg",
      byteSize: 4096,
      uploadedByPersonId: pic.id,
    });
    // The reconcile has read the trip (12th); the start date is corrected to the 13th, and renamed,
    // just as it fetches the folder.
    const getFile = drive.getFile.bind(drive);
    vi.spyOn(drive, "getFile").mockImplementation(async (id) => {
      if (id === folderId) {
        vi.mocked(drive.getFile).mockImplementation(getFile);
        await updatePerjadinDatesAction(trip.id, dates("2026-10-13", "2026-10-16"));
      }
      return getFile(id);
    });

    await reconcileTransaction(pic, drive, folders, line.id);

    await expect(getFile(folderId!)).resolves.toMatchObject({
      name: `Kelompok 3 · 13–16 Okt 2026 · P-${trip.id.slice(0, 8)}`,
    });
  });
});
