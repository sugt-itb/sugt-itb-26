import { checkDriveConnectionAction } from "-/app/(app)/pengaturan/actions";
import { updatePerjadinDatesAction } from "-/app/(app)/perjadin/[id]/actions";
import { sweepUnsynced } from "-/lib/drive/check";
import { describeDriveCheck } from "-/lib/drive/check-report";
import { DOKUMEN_FOLDER_NAME } from "-/lib/drive/dokumen-folders";
import { FakeDrive } from "-/lib/drive/fake-drive";
import { PELAKSANAAN_OFFLINE_FOLDER_NAME, type ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import { claimDokumenFolder, type Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addDocumentLeftInStaging,
  addRecordedDocument,
  connectDrive,
  stubTokenEndpoint,
  type RecordedDocumentFields,
} from "./support/drive";
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
 * **Perjadin Documents already recorded still finish in the company Google Drive** (#397,
 * ADR-0042), though nothing uploads one any more (ADR-0061, #559): a document left unsynced is put
 * in place by Periksa koneksi's sweep, its Dokumen folders are still made, claimed and renamed.
 * Against the real database and the in-memory `FakeDrive` — the same fakes as the receipt tests:
 * Google's token endpoint, Drive itself, the signed-in Person and `next/cache`. The documents are
 * inserted directly (`addDocumentLeftInStaging`); the names, the write order and the reconcile are
 * the real code.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let drive: FakeDrive;
let folders: ReadyFolders;

/** The trip's Drive folder name (ADR-0044) for the dates given: name, its one School, `P-` id. */
const tripFolderName = (trip: { id: string }, dates = "12–16 Okt 2026") =>
  `Kelompok 18 · ${dates} · SMAN 1/Bontang · P-${trip.id.slice(0, 8)}`;

/**
 * A Staff Administrator, a trip to Kelompok 18 with one School in it, and Drive connected — with
 * its Dokumen folders, unless `dokumen` is false: a connection made before them.
 */
async function scene(options: { dokumen?: boolean } = {}) {
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  await addGrant(staff.id, "Administrator");
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

  folders = await connectDrive(drive, staff.id, "connected", { dokumen: options.dokumen });
  drive.calls = 0;
  const admin = { ...staff, grants: ["Administrator"] } as Person;
  vi.mocked(requirePerson).mockResolvedValue(admin);
  return { staff: admin, trip, school };
}

function pesertaSheet(perjadinId: string, schoolId: string): RecordedDocumentFields {
  return {
    perjadinId,
    kind: "Daftar Hadir Peserta",
    documentDate: "2026-10-14",
    schoolId,
    peserta: { participantType: "Siswa", startsAt: "08:00", endsAt: "11:30" },
  };
}

/** An SPPD for `schoolId` (#441): a School, no date. */
function sppd(perjadinId: string, schoolId: string): RecordedDocumentFields {
  return { perjadinId, kind: "SPPD", documentDate: null, schoolId };
}

const documents = () => db.select().from(schema.perjadinDocument);

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("an older document left unsynced, finished by the sweep", () => {
  it("names the file, files it under its kind, and shares the file only", async () => {
    const { staff, trip, school } = await scene();
    const { documentId, fileId } = await addDocumentLeftInStaging(
      drive,
      folders,
      staff,
      pesertaSheet(trip.id, school.id),
    );
    expect(drive.files.get(fileId)!.parents).toEqual([folders.stagingFolderId]);

    const report = await sweepUnsynced(staff, drive, folders);

    expect(report.documents).toEqual({ synced: 1, waiting: 0, failures: [] });
    const doc8 = documentId.replaceAll("-", "").slice(0, 8);

    // Dokumen/Pelaksanaan Offline/{name} · {Schools} · P-{trip8}/Daftar Hadir Peserta/{file}
    const file = drive.files.get(fileId)!;
    expect(file.name).toBe(
      `2026-10-14 · SMAN 1-Bontang · Siswa · Daftar Hadir Peserta · D-${doc8}.pdf`,
    );
    expect(file.appProperties).toEqual({ sugtPerjadinId: trip.id, sugtDocumentId: documentId });
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
    expect(row!.driveSyncedAt).toBeInstanceOf(Date);
    await expect(db.select().from(schema.perjadin)).resolves.toMatchObject([
      { driveDokumenFolderId: tripFolder.id },
    ]);
  });

  it("reuses the trip's folders for the next sheet, and makes a folder per kind", async () => {
    const { staff, trip, school } = await scene();
    await addRecordedDocument(drive, folders, staff, pesertaSheet(trip.id, school.id));
    await addRecordedDocument(drive, folders, staff, pesertaSheet(trip.id, school.id));
    await addRecordedDocument(drive, folders, staff, {
      perjadinId: trip.id,
      kind: "Daftar Hadir Narasumber",
      documentDate: "2026-10-13",
    });

    expect(drive.named(tripFolderName(trip))).toHaveLength(1);
    expect(drive.named("Daftar Hadir Peserta")).toHaveLength(1);
    expect(drive.named("Daftar Hadir Narasumber")).toHaveLength(1);
    await expect(db.select().from(schema.perjadinDocumentFolder)).resolves.toHaveLength(2);
  });

  it("finishes one whose last reconcile failed", async () => {
    const { staff, trip, school } = await scene();
    vi.spyOn(drive, "createPermission").mockRejectedValueOnce(
      new DriveRequestError("permissions.create", 500),
    );
    const { fileId, synced } = await addRecordedDocument(
      drive,
      folders,
      staff,
      pesertaSheet(trip.id, school.id),
    );
    expect(synced).toBe(false);
    const [unsynced] = await documents();
    expect(unsynced!.driveSyncedAt).toBeNull();
    expect(unsynced!.driveSyncFailedAt).toBeInstanceOf(Date);

    const report = await sweepUnsynced(staff, drive, folders);

    expect(report.documents).toEqual({ synced: 1, waiting: 0, failures: [] });
    const [finished] = await documents();
    expect(finished!.driveSyncedAt).toBeInstanceOf(Date);
    expect(drive.files.get(fileId)!.permissions).toHaveLength(1);
  });
});

describe("an older SPPD (#441)", () => {
  it("is finished by Periksa koneksi's sweep with no special case, and named by School if it fails", async () => {
    const { staff, trip, school } = await scene();
    const { fileId } = await addDocumentLeftInStaging(
      drive,
      folders,
      staff,
      sppd(trip.id, school.id),
    );

    // Periksa koneksi, failing, names the SPPD by its School: it has no date.
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
    const file = drive.files.get(fileId)!;
    expect(file.name).toMatch(/^SMAN 1-Bontang · SPPD · D-[0-9a-f]{8}\.pdf$/);
    const kindFolder = drive.files.get(file.parents[0]!)!;
    expect(kindFolder.name).toBe("SPPD");
    expect(drive.files.get(kindFolder.parents[0]!)!.name).toBe(tripFolderName(trip));
    expect(file.permissions).toHaveLength(1);
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

  it("are made by an older document's reconcile too, and remade by Periksa koneksi once trashed", async () => {
    const { staff, trip, school } = await scene({ dokumen: false });

    await addRecordedDocument(drive, folders, staff, pesertaSheet(trip.id, school.id));
    expect(drive.named(DOKUMEN_FOLDER_NAME)).toHaveLength(1);

    const [row] = await db.select().from(schema.driveConnection);
    drive.trash(row!.dokumenFolderId!);
    await db.update(schema.perjadin).set({ driveDokumenFolderId: null });
    await db.delete(schema.perjadinDocumentFolder);
    await addDocumentLeftInStaging(drive, folders, staff, pesertaSheet(trip.id, school.id));

    await expect(checkDriveConnectionAction()).resolves.toMatchObject({ dokumen: "created" });
    expect(drive.named(DOKUMEN_FOLDER_NAME).filter((folder) => !folder.trashed)).toHaveLength(1);
    const rows = await documents();
    expect(rows.every((document) => document.driveSyncedAt !== null)).toBe(true);
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
  it("renames the trip's existing Dokumen folder as well as its receipts folder", async () => {
    const { staff, trip, school } = await scene();
    await addRecordedDocument(drive, folders, staff, pesertaSheet(trip.id, school.id));
    const [before] = await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, trip.id));

    await expect(
      updatePerjadinDatesAction(trip.id, { startsOn: "2026-10-13", endsOn: "2026-10-16" }),
    ).resolves.toMatchObject({ outcome: "updated" });

    expect(drive.files.get(before!.driveDokumenFolderId!)!.name).toBe(
      tripFolderName(trip, "13–16 Okt 2026"),
    );
  });
});
