import { checkDriveConnectionAction } from "-/app/(app)/pengaturan/actions";
import { updatePerjadinDatesAction } from "-/app/(app)/perjadin/[id]/actions";
import type { DocumentToRecord } from "-/app/(app)/perjadin/[id]/dokumen/action-types";
import {
  openDocumentSessionAction,
  recordDocumentAction,
} from "-/app/(app)/perjadin/[id]/dokumen/actions";
import { sweepUnsynced } from "-/lib/drive/check";
import { describeDriveCheck } from "-/lib/drive/check-report";
import { DOKUMEN_FOLDER_NAME } from "-/lib/drive/dokumen-folders";
import { FakeDrive } from "-/lib/drive/fake-drive";
import { PELAKSANAAN_OFFLINE_FOLDER_NAME, type ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import { claimDokumenFolder, type DocumentFields, type Person } from "@sugt/db/queries";
import { MAX_UPLOAD_BYTES } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectDrive, digestOf, FORBIDDEN, jpeg, pdf, stubTokenEndpoint } from "./support/drive";
import {
  addCluster,
  addOfflineSession,
  addGrant,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Perjadin Documents go to the company Google Drive** (#397, ADR-0042), against the real database
 * and the in-memory `FakeDrive` — the same fakes as the receipt tests: Google's token endpoint,
 * Drive itself, the browser's `PUT` (`land`), the signed-in Person, the request's `Origin` and
 * `next/cache`. The checks, the names, the write order and the reconcile are the real code.
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

/** The trip's Drive folder name (ADR-0044) for the dates given: name, its one School, `P-` id. */
const tripFolderName = (trip: { id: string }, dates = "12–16 Okt 2026") =>
  `Kelompok 18 · ${dates} · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`;

/**
 * A Staff Administrator, a Pimpinan, a trip to Kelompok 18 with one School in it, and Drive
 * connected — with its Dokumen folders, unless `dokumen` is false: a connection made before them.
 */
async function scene(
  options: {
    connection?: "connected" | "broken" | "none";
    dokumen?: boolean;
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
  await addOfflineSession({ schoolId: school.id, heldOn: "2026-10-14", perjadinId: trip.id });

  const connection = options.connection ?? "connected";
  if (connection !== "none") {
    folders = await connectDrive(drive, staff.id, connection, { dokumen: options.dokumen });
  }
  drive.calls = 0;
  const admin = { ...staff, grants: ["Administrator"] } as Person;
  vi.mocked(requirePerson).mockResolvedValue(admin);
  return { staff: admin, pimpinan, trip, school };
}

/** A Narasumber sheet's fields: valid on every trip here, whatever the file is then recorded as. */
const NARASUMBER: DocumentFields = { kind: "Daftar Hadir Narasumber", documentDate: "2026-10-13" };

/**
 * The dialog's upload: open the session for the document's fields, then the browser's `PUT`.
 * Answers the file's id.
 */
async function upload(perjadinId: string, bytes: Uint8Array, fields = NARASUMBER) {
  const opened = await openDocumentSessionAction(
    perjadinId,
    { size: bytes.length, contentType: "application/pdf" },
    fields,
  );
  if (opened.outcome !== "ready") throw new Error(`Session refused: ${opened.outcome}`);
  return drive.land(opened.sessionUri, bytes).id;
}

/** An SPPD for `schoolId` (#441): a School, no date. */
function sppd(perjadinId: string, schoolId: string, driveFileId: string): DocumentToRecord {
  return {
    perjadinId,
    driveFileId,
    kind: "SPPD",
    documentDate: null,
    sppd: { schoolId },
  };
}

function pesertaSheet(perjadinId: string, schoolId: string, driveFileId: string): DocumentToRecord {
  return {
    perjadinId,
    driveFileId,
    kind: "Daftar Hadir Peserta",
    documentDate: "2026-10-14",
    peserta: { schoolId, participantType: "Siswa", startsAt: "08:00", endsAt: "11:30" },
  };
}

const documents = () => db.select().from(schema.perjadinDocument);
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

describe("no Drive call before the guard", () => {
  it("refuses a non-Staff caller with zero Drive calls", async () => {
    const { pimpinan, trip } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(pimpinan as Person);

    await expect(
      digestOf(
        openDocumentSessionAction(
          trip.id,
          { size: 10, contentType: "application/pdf" },
          NARASUMBER,
        ),
      ),
    ).resolves.toBe(FORBIDDEN);
    await expect(
      digestOf(
        recordDocumentAction({
          perjadinId: trip.id,
          driveFileId: "x",
          kind: "Daftar Hadir Narasumber",
          documentDate: "2026-10-13",
        }),
      ),
    ).resolves.toBe(FORBIDDEN);
    expect(drive.calls).toBe(0);
  });

  it("refuses anything but one PDF within the cap before opening a session", async () => {
    const { trip } = await scene();

    await expect(
      openDocumentSessionAction(trip.id, { size: 10, contentType: "image/jpeg" }, NARASUMBER),
    ).resolves.toEqual({ outcome: "not-pdf" });
    await expect(
      openDocumentSessionAction(
        trip.id,
        { size: MAX_UPLOAD_BYTES + 1, contentType: "application/pdf" },
        NARASUMBER,
      ),
    ).resolves.toEqual({ outcome: "too-large", limit: MAX_UPLOAD_BYTES });
    expect(drive.calls).toBe(0);
  });

  it("answers drive-disconnected, with the gate's reason, when Drive is not connected", async () => {
    const { trip } = await scene({ connection: "none" });

    await expect(
      openDocumentSessionAction(trip.id, { size: 10, contentType: "application/pdf" }, NARASUMBER),
    ).resolves.toEqual({
      outcome: "drive-disconnected",
      reason: expect.stringMatching(/^Google Drive belum terhubung/),
    });
  });
});

describe("an upload, recorded and reconciled", () => {
  it("names the file, files it under its kind, shares the file only, and logs the upload", async () => {
    const { staff, trip, school } = await scene();
    const fileId = await upload(trip.id, pdf());

    const result = await recordDocumentAction(pesertaSheet(trip.id, school.id, fileId));

    expect(result).toEqual({ outcome: "recorded", documentId: expect.any(String), synced: true });
    if (result.outcome !== "recorded") return;
    const doc8 = result.documentId.replaceAll("-", "").slice(0, 8);

    // Dokumen/Pelaksanaan Offline/{name} · {Schools} · P-{trip8}/Daftar Hadir Peserta/{file}
    const file = drive.files.get(fileId)!;
    expect(file.name).toBe(
      `2026-10-14 · SMAN 1-Bontang · Siswa · Daftar Hadir Peserta · D-${doc8}.pdf`,
    );
    expect(file.appProperties).toEqual({
      sugtPerjadinId: trip.id,
      sugtDocumentId: result.documentId,
    });
    const kindFolder = drive.files.get(file.parents[0]!)!;
    expect(kindFolder.name).toBe("Daftar Hadir Peserta");
    const tripFolder = drive.files.get(kindFolder.parents[0]!)!;
    expect(tripFolder.name).toBe(tripFolderName(trip));
    const offline = drive.files.get(tripFolder.parents[0]!)!;
    expect(offline.name).toBe(PELAKSANAAN_OFFLINE_FOLDER_NAME);
    expect(drive.files.get(offline.parents[0]!)!.name).toBe(DOKUMEN_FOLDER_NAME);

    // Shared: the file, anyone with the link. Private: every folder above it.
    expect(file.permissions).toEqual([expect.objectContaining({ type: "anyone", role: "reader" })]);
    for (const folder of [kindFolder, tripFolder, offline]) expect(folder.permissions).toEqual([]);

    const [row] = await documents();
    expect(row).toMatchObject({ id: result.documentId, driveFileId: fileId, byteSize: 2048 });
    expect(row!.driveSyncedAt).toBeInstanceOf(Date);
    await expect(db.select().from(schema.perjadin)).resolves.toMatchObject([
      { driveDokumenFolderId: tripFolder.id },
    ]);
    const [entry] = await logged();
    expect(entry).toMatchObject({
      actorPersonId: staff.id,
      action: "document_uploaded",
      details: { documentId: result.documentId, schoolName: "SMAN 1/Bontang", timeZone: "WITA" },
    });
  });

  it("reuses the trip's folders for the next sheet, and makes a folder per kind", async () => {
    const { trip, school } = await scene();
    await recordDocumentAction(pesertaSheet(trip.id, school.id, await upload(trip.id, pdf())));
    await recordDocumentAction(pesertaSheet(trip.id, school.id, await upload(trip.id, pdf())));
    await recordDocumentAction({
      perjadinId: trip.id,
      driveFileId: await upload(trip.id, pdf()),
      kind: "Daftar Hadir Narasumber",
      documentDate: "2026-10-13",
    });

    expect(drive.named(tripFolderName(trip))).toHaveLength(1);
    expect(drive.named("Daftar Hadir Peserta")).toHaveLength(1);
    expect(drive.named("Daftar Hadir Narasumber")).toHaveLength(1);
    await expect(db.select().from(schema.perjadinDocumentFolder)).resolves.toHaveLength(2);
  });

  it.each([
    ["not a PDF by its first bytes", "not-pdf", (id: string) => id],
    [
      "over the cap in Drive",
      "file-unverified",
      (id: string) => {
        drive.files.get(id)!.size = MAX_UPLOAD_BYTES + 1;
        return id;
      },
    ],
  ] as const)("refuses a file %s, and records and logs nothing", async (_case, outcome, spoil) => {
    const { trip, school } = await scene();
    const bytes = outcome === "not-pdf" ? jpeg() : pdf();
    const fileId = spoil(await upload(trip.id, bytes));

    await expect(recordDocumentAction(pesertaSheet(trip.id, school.id, fileId))).resolves.toEqual({
      outcome,
    });
    await expect(documents()).resolves.toHaveLength(0);
    await expect(logged()).resolves.toHaveLength(0);
  });

  it("refuses a file uploaded for another Perjadin", async () => {
    const { staff, trip, school } = await scene();
    const other = await addPerjadin({
      picPersonId: staff.id,
      subClusterId: (await db.select().from(schema.perjadin))[0]!.subClusterId,
      startsOn: "2026-10-12",
      endsOn: "2026-10-16",
    });
    const fileId = await upload(other.id, pdf());

    await expect(recordDocumentAction(pesertaSheet(trip.id, school.id, fileId))).resolves.toEqual({
      outcome: "file-unverified",
    });
    await expect(documents()).resolves.toHaveLength(0);
  });

  it("refuses a date outside the trip, leaving the file unnamed in _staging", async () => {
    const { trip, school } = await scene();
    const fileId = await upload(trip.id, pdf());

    await expect(
      recordDocumentAction({
        ...pesertaSheet(trip.id, school.id, fileId),
        documentDate: "2026-10-20",
      }),
    ).resolves.toEqual({
      outcome: "date-outside-perjadin",
      startsOn: "2026-10-12",
      endsOn: "2026-10-16",
    });
    expect(drive.files.get(fileId)!.parents).toEqual([folders.stagingFolderId]);
    await expect(logged()).resolves.toHaveLength(0);
  });

  it("records the sheet when the reconcile fails, unsynced, and the sweep finishes it", async () => {
    const { staff, trip, school } = await scene();
    const fileId = await upload(trip.id, pdf());
    vi.spyOn(drive, "createPermission").mockRejectedValueOnce(
      new DriveRequestError("permissions.create", 500),
    );

    const result = await recordDocumentAction(pesertaSheet(trip.id, school.id, fileId));

    expect(result).toMatchObject({ outcome: "recorded", synced: false });
    const [unsynced] = await documents();
    expect(unsynced!.driveSyncedAt).toBeNull();
    expect(unsynced!.driveSyncFailedAt).toBeInstanceOf(Date);

    const report = await sweepUnsynced(staff, drive, folders);

    expect(report.documents).toEqual({ synced: 1, waiting: 0, failures: [] });
    const [synced] = await documents();
    expect(synced!.driveSyncedAt).toBeInstanceOf(Date);
    expect(drive.files.get(fileId)!.permissions).toHaveLength(1);
  });
});

describe("an SPPD (#441)", () => {
  it("is filed as {school} · SPPD · D-{doc8}.pdf in its own SPPD folder, the file shared and logged", async () => {
    const { staff, trip, school } = await scene();
    const fields = sppd(trip.id, school.id, "");
    const fileId = await upload(trip.id, pdf(), fields);

    const result = await recordDocumentAction({ ...fields, driveFileId: fileId });

    expect(result).toEqual({ outcome: "recorded", documentId: expect.any(String), synced: true });
    if (result.outcome !== "recorded") return;
    const doc8 = result.documentId.replaceAll("-", "").slice(0, 8);
    const file = drive.files.get(fileId)!;
    expect(file.name).toBe(`SMAN 1-Bontang · SPPD · D-${doc8}.pdf`);
    const kindFolder = drive.files.get(file.parents[0]!)!;
    expect(kindFolder.name).toBe("SPPD");
    const tripFolder = drive.files.get(kindFolder.parents[0]!)!;
    expect(tripFolder.name).toBe(tripFolderName(trip));
    expect(file.permissions).toEqual([expect.objectContaining({ type: "anyone", role: "reader" })]);
    for (const folder of [kindFolder, tripFolder]) expect(folder.permissions).toEqual([]);

    await expect(documents()).resolves.toMatchObject([
      { kind: "SPPD", schoolId: school.id, documentDate: null, participantType: null },
    ]);
    const [entry] = await logged();
    expect(entry).toMatchObject({
      actorPersonId: staff.id,
      action: "document_uploaded",
      details: { kind: "SPPD", documentDate: null, schoolName: "SMAN 1/Bontang" },
      searchText: "dokumen diunggah · sppd · sman 1/bontang",
    });
  });

  it("refuses a second one for the same School on this trip before the upload opens", async () => {
    const { trip, school } = await scene();
    const fields = sppd(trip.id, school.id, "");
    await recordDocumentAction({ ...fields, driveFileId: await upload(trip.id, pdf(), fields) });
    drive.calls = 0;

    await expect(
      openDocumentSessionAction(
        trip.id,
        { size: 40 * 1024 * 1024, contentType: "application/pdf" },
        fields,
      ),
    ).resolves.toEqual({ outcome: "sppd-exists", schoolName: "SMAN 1/Bontang" });
    // No session opened: nothing was asked of Drive at all.
    expect(drive.calls).toBe(0);
  });

  it("is refused at the record too, leaving the loser's file unnamed in _staging", async () => {
    const { trip, school } = await scene();
    const fields = sppd(trip.id, school.id, "");
    // Both opened before either recorded: the open's early answer could not refuse the second.
    const first = await upload(trip.id, pdf(), fields);
    const second = await upload(trip.id, pdf(), fields);
    await recordDocumentAction({ ...fields, driveFileId: first });

    await expect(recordDocumentAction({ ...fields, driveFileId: second })).resolves.toEqual({
      outcome: "sppd-exists",
      schoolName: "SMAN 1/Bontang",
    });
    expect(drive.files.get(second)!.parents).toEqual([folders.stagingFolderId]);
    expect(drive.files.get(second)!.permissions).toEqual([]);
    await expect(documents()).resolves.toHaveLength(1);
    await expect(logged()).resolves.toHaveLength(1);
  });

  it("is finished by Periksa koneksi's sweep with no special case, and named by School if it fails", async () => {
    const { staff, trip, school } = await scene();
    const fields = sppd(trip.id, school.id, "");
    const fileId = await upload(trip.id, pdf(), fields);
    vi.spyOn(drive, "createPermission").mockRejectedValueOnce(
      new DriveRequestError("permissions.create", 500),
    );
    await expect(recordDocumentAction({ ...fields, driveFileId: fileId })).resolves.toMatchObject({
      outcome: "recorded",
      synced: false,
    });

    // Periksa koneksi, failing again, names the SPPD by its School: it has no date.
    vi.spyOn(drive, "createPermission").mockRejectedValueOnce(
      new DriveRequestError("permissions.create", 500),
    );
    const check = await checkDriveConnectionAction();
    expect(describeDriveCheck(check).failures).toEqual([
      expect.stringMatching(/^SPPD · SMAN 1\/Bontang: /),
    ]);

    const report = await sweepUnsynced(staff, drive, folders);
    expect(report.documents).toEqual({ synced: 1, waiting: 0, failures: [] });
    const [row] = await documents();
    expect(row!.driveSyncedAt).toBeInstanceOf(Date);
    expect(drive.files.get(fileId)!.name).toMatch(/^SMAN 1-Bontang · SPPD · D-[0-9a-f]{8}\.pdf$/);
    expect(drive.files.get(fileId)!.permissions).toHaveLength(1);
  });
});

describe("the Dokumen folders, for a connection made before them", () => {
  it("are made by Periksa koneksi, without reconnecting", async () => {
    await scene({ dokumen: false });
    expect(drive.named(DOKUMEN_FOLDER_NAME)).toHaveLength(0);

    const report = await checkDriveConnectionAction();

    expect(report).toMatchObject({ token: "ok", dokumen: "created" });
    expect(describeDriveCheck(report).lines).toContain("Folder Dokumen: dibuat.");
    const [dokumen] = drive.named(DOKUMEN_FOLDER_NAME);
    expect(dokumen!.parents).toEqual([folders.rootFolderId]);
    const [row] = await db.select().from(schema.driveConnection);
    expect(row!.dokumenFolderId).toBe(dokumen!.id);
    expect(drive.files.get(row!.dokumenPelaksanaanOfflineFolderId!)!.parents).toEqual([
      dokumen!.id,
    ]);

    // A second press finds them and makes nothing.
    await expect(checkDriveConnectionAction()).resolves.toMatchObject({ dokumen: "ok" });
    expect(drive.named(DOKUMEN_FOLDER_NAME)).toHaveLength(1);
  });

  it("are made by the first upload's reconcile too, and remade once trashed", async () => {
    const { trip, school } = await scene({ dokumen: false });

    await recordDocumentAction(pesertaSheet(trip.id, school.id, await upload(trip.id, pdf())));
    expect(drive.named(DOKUMEN_FOLDER_NAME)).toHaveLength(1);

    const [row] = await db.select().from(schema.driveConnection);
    drive.trash(row!.dokumenFolderId!);
    await db.update(schema.perjadin).set({ driveDokumenFolderId: null });
    await db.delete(schema.perjadinDocumentFolder);

    const again = await recordDocumentAction(
      pesertaSheet(trip.id, school.id, await upload(trip.id, pdf())),
    );
    expect(again).toMatchObject({ outcome: "recorded", synced: true });
    expect(drive.named(DOKUMEN_FOLDER_NAME).filter((folder) => !folder.trashed)).toHaveLength(1);
  });
});

describe("claiming a Dokumen folder", () => {
  it("lands only over the id the caller read, and a Pelaksanaan Offline only under its Dokumen", async () => {
    const { staff } = await scene({ dokumen: false });

    await expect(
      claimDokumenFolder(staff, { folder: "dokumenFolderId", expected: null, next: "dok-1" }),
    ).resolves.toBe(true);
    // A second caller that also read "none" has lost: the stored id is no longer what it read.
    await expect(
      claimDokumenFolder(staff, { folder: "dokumenFolderId", expected: null, next: "dok-2" }),
    ).resolves.toBe(false);
    // A Pelaksanaan Offline made inside a Dokumen/ that is no longer the stored one does not land.
    await expect(
      claimDokumenFolder(staff, {
        folder: "dokumenPelaksanaanOfflineFolderId",
        expected: null,
        next: "po-2",
        parentId: "dok-2",
      }),
    ).resolves.toBe(false);
    await expect(
      claimDokumenFolder(staff, {
        folder: "dokumenPelaksanaanOfflineFolderId",
        expected: null,
        next: "po-1",
        parentId: "dok-1",
      }),
    ).resolves.toBe(true);

    await expect(db.select().from(schema.driveConnection)).resolves.toMatchObject([
      { dokumenFolderId: "dok-1", dokumenPelaksanaanOfflineFolderId: "po-1" },
    ]);
  });
});

describe("a start-date correction", () => {
  it("renames the trip's Dokumen folder as well as its receipts folder", async () => {
    const { trip, school } = await scene();
    await recordDocumentAction(pesertaSheet(trip.id, school.id, await upload(trip.id, pdf())));
    const [before] = await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, trip.id));

    await expect(
      updatePerjadinDatesAction(trip.id, { startsOn: "2026-10-13", endsOn: "2026-10-16" }),
    ).resolves.toMatchObject({ outcome: "updated" });

    expect(drive.files.get(before!.driveDokumenFolderId!)!.name).toBe(
      tripFolderName(trip, "13–16 Okt 2026"),
    );
  });
});
