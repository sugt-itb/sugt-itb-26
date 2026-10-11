import { checkDriveConnectionAction } from "-/app/(app)/pengaturan/actions";
import LaporanPage from "-/app/(app)/perjadin/[id]/laporan/page";
import {
  RENAME_LIMIT,
  reassertPerjadinFolderNames,
  SWEEP_LIMIT,
  sweepUnsynced,
} from "-/lib/drive/check";
import { describeDriveCheck, exposureWarning } from "-/lib/drive/check-report";
import { completeDriveConnection } from "-/lib/drive/connect";
import { FakeDrive, MY_DRIVE } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DRIVE_FILE_SCOPE, openDrive } from "-/lib/drive/google";
import { uploadGate } from "-/lib/drive/upload-gate";
import { RECEIPTS_UNSYNCED } from "-/lib/drive/upload-messages";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectDrive, digestOf, FORBIDDEN, jpeg, upload } from "./support/drive";
import {
  addGrant,
  addPerjadin,
  addPerson,
  addTransaction,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Periksa koneksi, the sweep, the badge and the marker** (#375, ADR-0040) — against the real
 * database and the in-memory `FakeDrive`, faked as in `catat-transaksi-drive.test.ts`.
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

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Google's token endpoint: refreshes answer `refresh`, an authorization-code exchange `exchange`. */
function stubTokenEndpoint(
  replies: {
    refresh?: { status?: number; body: object };
    exchange?: object;
  } = {},
) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== TOKEN_ENDPOINT) throw new Error(`Unexpected outbound request: ${url}`);
    const grant = new URLSearchParams(String(init?.body)).get("grant_type");
    if (grant === "authorization_code") return Response.json(replies.exchange);
    const refresh = replies.refresh ?? { body: { access_token: "access" } };
    return Response.json(refresh.body, { status: refresh.status ?? 200 });
  });
}

let drive: FakeDrive;
let folders: ReadyFolders;

async function scene() {
  const admin = await addPerson({ fullName: "Admin", email: "admin@itb.ac.id", role: "Staff" });
  await addGrant(admin.id, "Administrator");
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  const pimpinan = await addPerson({ fullName: "Pim", email: "pim@itb.ac.id", role: "Pimpinan" });
  const trip = await addPerjadin({
    picPersonId: staff.id,
    subClusterName: "Kelompok 3",
    startsOn: "2026-10-12",
    endsOn: "2026-10-14",
  });
  folders = await connectDrive(drive, admin.id);
  const adminPerson = { ...admin, grants: ["Administrator"] } as Person;
  vi.mocked(requirePerson).mockResolvedValue(adminPerson);
  return { admin: adminPerson, staff, pimpinan, trip };
}

/**
 * A line whose Drive receipt is recorded but not yet put in place: the file waits in `_staging` and
 * the line has no folder — what a failed reconcile, or a broken connection, leaves behind.
 */
async function anUnsyncedLine(perjadinId: string, createdByPersonId: string, description: string) {
  const line = await addTransaction({
    perjadinId,
    amountIdr: 10_000,
    description,
    createdByPersonId,
  });
  const [fileId] = await upload(drive, perjadinId, [jpeg()]);
  await db.insert(schema.transactionEvidence).values({
    transactionId: line.id,
    driveFileId: fileId!,
    contentType: "image/jpeg",
    byteSize: 4096,
    uploadedByPersonId: createdByPersonId,
  });
  return line;
}

const lineRow = async (id: string) =>
  (await db.select().from(schema.transaction).where(eq(schema.transaction.id, id)))[0]!;

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("Periksa koneksi is Administrator only", () => {
  it("refuses a Staff member without the Grant and a Pimpinan", async () => {
    const { staff, pimpinan } = await scene();
    drive.calls = 0;

    for (const person of [staff, pimpinan]) {
      vi.mocked(requirePerson).mockResolvedValue(person as Person);
      await expect(digestOf(checkDriveConnectionAction())).resolves.toBe(FORBIDDEN);
    }
    expect(drive.calls).toBe(0);
  });
});

describe("the check, in order", () => {
  it("reports a working token, the four folders, no exposure and the sweep", async () => {
    await scene();

    const report = await checkDriveConnectionAction();

    expect(report).toEqual({
      token: "ok",
      folders: [
        { folder: "root", state: "ok" },
        { folder: "staging", state: "ok" },
        { folder: "bukti-transaksi", state: "ok" },
        { folder: "pelaksanaan-offline", state: "ok" },
      ],
      exposed: [],
      dokumen: "ok",
      footage: "ok",
      sweep: {
        ran: true,
        synced: 0,
        waiting: 0,
        failures: [],
        documents: { synced: 0, waiting: 0, failures: [] },
        footage: { synced: 0, waiting: 0, failures: [] },
      },
      names: { ran: true, renamed: 0, remaining: 0, failures: [] },
    });
    expect(describeDriveCheck(report).warnings).toEqual([]);
    const [row] = await db.select().from(schema.driveConnection);
    expect(row!.lastUsedAt).toBeInstanceOf(Date);
  });

  it("marks the connection broken on invalid_grant, and stops", async () => {
    await scene();
    stubTokenEndpoint({ refresh: { status: 400, body: { error: "invalid_grant" } } });
    drive.calls = 0;

    await expect(checkDriveConnectionAction()).resolves.toEqual({ token: "broken" });

    const [row] = await db.select().from(schema.driveConnection);
    expect(row).toMatchObject({ status: "broken" });
    expect(row!.brokenAt).toBeInstanceOf(Date);
    expect(drive.calls).toBe(0);
  });

  it("answers already-broken, asking Google nothing, when the page was older than the break", async () => {
    await scene();
    await db.update(schema.driveConnection).set({ status: "broken", brokenAt: new Date() });
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    const report = await checkDriveConnectionAction();

    expect(report).toEqual({ token: "already-broken" });
    expect(fetched).not.toHaveBeenCalled();
    expect(describeDriveCheck(report).lines).toEqual(["Koneksi sudah terputus — Hubungkan ulang."]);
  });

  it("records a trashed root, closing the upload gate, and clears it once restored", async () => {
    const { admin } = await scene();
    drive.trash(folders.rootFolderId);

    await checkDriveConnectionAction();

    await expect(db.select().from(schema.driveConnection)).resolves.toMatchObject([
      { folderProblem: "root-trashed" },
    ]);
    await expect(uploadGate(admin)).resolves.toMatchObject({ open: false });

    drive.restore(folders.rootFolderId);
    await checkDriveConnectionAction();

    await expect(db.select().from(schema.driveConnection)).resolves.toMatchObject([
      { folderProblem: null },
    ]);
    await expect(uploadGate(admin)).resolves.toEqual({ open: true });
  });

  it("reports a trashed folder, and skips the sweep while the tree is not usable", async () => {
    const { admin, trip } = await scene();
    await anUnsyncedLine(trip.id, admin.id, "Konsumsi rapat");
    drive.trash(folders.buktiTransaksiFolderId);

    const report = await checkDriveConnectionAction();

    expect(report).toMatchObject({
      token: "ok",
      folders: expect.arrayContaining([{ folder: "bukti-transaksi", state: "trashed" }]),
      dokumen: "skipped",
      footage: "skipped",
      sweep: { ran: false, waiting: 1, documentsWaiting: 0, footageWaiting: 0 },
      names: { ran: false },
    });
    expect(describeDriveCheck(report).lines).toContain(
      "Sinkronisasi dilewati sampai folder di atas beres; 1 transaksi, 0 dokumen dan 0 foto/video masih menunggu.",
    );
  });
});

describe("the safety check", () => {
  /** A link-shared company folder, and `id` moved into it by hand. */
  async function moveUnderASharedFolder(id: string) {
    const company = await drive.createFolder({ name: "Arsip Perusahaan" });
    await drive.createPermission(company.id, { type: "anyone", role: "reader" });
    await drive.updateFile(id, { addParent: company.id, removeParent: MY_DRIVE });
  }

  it.each([
    ["root", () => folders.rootFolderId],
    ["staging", () => folders.stagingFolderId],
  ] as const)("warns when an inherited anyone permission reaches the %s", async (folder, idOf) => {
    await scene();
    await moveUnderASharedFolder(idOf());

    const report = await checkDriveConnectionAction();

    expect(report).toMatchObject({ token: "ok", exposed: [folder] });
    expect(describeDriveCheck(report).warnings).toEqual([exposureWarning(folder)]);
  });

  it("warns on a direct anyone permission too", async () => {
    await scene();
    await drive.createPermission(folders.rootFolderId, { type: "anyone", role: "reader" });

    await expect(checkDriveConnectionAction()).resolves.toMatchObject({ exposed: ["root"] });
  });

  it("says exactly the ticket's sentence for the root", () => {
    expect(exposureWarning("root")).toBe(
      "Folder utama dapat dibuka siapa saja yang punya link — pindahkan keluar dari folder yang dibagikan.",
    );
  });
});

describe("the sweep", () => {
  it("finishes unsynced transactions, oldest first, and stops at the bound", async () => {
    const { admin, trip } = await scene();
    const first = await anUnsyncedLine(trip.id, admin.id, "Pertama");
    const second = await anUnsyncedLine(trip.id, admin.id, "Kedua");
    const third = await anUnsyncedLine(trip.id, admin.id, "Ketiga");

    await expect(sweepUnsynced(admin, drive, folders, { limit: 2 })).resolves.toMatchObject({
      synced: 2,
      waiting: 1,
      failures: [],
    });
    expect((await lineRow(first.id)).driveSyncedAt).toBeInstanceOf(Date);
    expect((await lineRow(second.id)).driveSyncedAt).toBeInstanceOf(Date);
    expect((await lineRow(third.id)).driveSyncedAt).toBeNull();
    expect(SWEEP_LIMIT).toBe(25);
  });

  it("moves past a line that fails every time, so the lines behind it are reached", async () => {
    const { admin, trip } = await scene();
    const stuck = await anUnsyncedLine(trip.id, admin.id, "Macet");
    const trashed = await drive.createFolder({
      name: "dibuang",
      parentId: folders.stagingFolderId,
    });
    drive.trash(trashed.id);
    await db
      .update(schema.transaction)
      .set({ driveFolderId: trashed.id })
      .where(eq(schema.transaction.id, stuck.id));
    const healthy = await anUnsyncedLine(trip.id, admin.id, "Sehat");

    const first = await sweepUnsynced(admin, drive, folders, { limit: 1 });
    const second = await sweepUnsynced(admin, drive, folders, { limit: 1 });

    expect(first).toMatchObject({ synced: 0, failures: [{ transactionId: stuck.id }] });
    expect(second).toMatchObject({ synced: 1, waiting: 1, failures: [] });
    expect((await lineRow(healthy.id)).driveSyncedAt).toBeInstanceOf(Date);
  });

  it("starts no reconcile past its time budget, and counts what is left as waiting", async () => {
    const { admin, trip } = await scene();
    await anUnsyncedLine(trip.id, admin.id, "Satu");
    await anUnsyncedLine(trip.id, admin.id, "Dua");

    await expect(sweepUnsynced(admin, drive, folders, { budgetMs: -1 })).resolves.toMatchObject({
      synced: 0,
      waiting: 2,
      failures: [],
    });
  });

  it("never counts a synced or zero-receipt line as owed", async () => {
    const { admin, trip } = await scene();
    const synced = await anUnsyncedLine(trip.id, admin.id, "Sudah");
    await db
      .update(schema.transaction)
      .set({ driveSyncedAt: new Date() })
      .where(eq(schema.transaction.id, synced.id));
    await addTransaction({ perjadinId: trip.id, amountIdr: 5_000, createdByPersonId: admin.id });

    await expect(sweepUnsynced(admin, drive, folders)).resolves.toEqual({
      synced: 0,
      waiting: 0,
      failures: [],
      documents: { synced: 0, waiting: 0, failures: [] },
      footage: { synced: 0, waiting: 0, failures: [] },
    });
  });

  it("reports a trashed transaction folder, and does not recreate it", async () => {
    const { admin, trip } = await scene();
    const line = await anUnsyncedLine(trip.id, admin.id, "Taksi");
    const trashed = await drive.createFolder({
      name: "dibuang",
      parentId: folders.stagingFolderId,
    });
    drive.trash(trashed.id);
    await db
      .update(schema.transaction)
      .set({ driveFolderId: trashed.id })
      .where(eq(schema.transaction.id, line.id));
    const before = drive.files.size;

    const report = await checkDriveConnectionAction();

    expect(report).toMatchObject({
      sweep: {
        ran: true,
        synced: 0,
        waiting: 1,
        failures: [{ transactionId: line.id, description: "Taksi", reason: "folder-trashed" }],
      },
    });
    expect(describeDriveCheck(report).failures).toEqual([
      "2026-09-02 · Taksi: folder ada di Sampah Google Drive.",
    ]);
    // The Perjadin folder is the one new thing; the trashed transaction folder is not remade.
    expect(drive.files.size).toBe(before + 1);
    expect((await lineRow(line.id)).driveFolderId).toBe(trashed.id);
  });

  it("runs after a reconnect", async () => {
    const { admin, trip } = await scene();
    const line = await anUnsyncedLine(trip.id, admin.id, "Konsumsi");
    const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    stubTokenEndpoint({
      exchange: {
        access_token: "access",
        refresh_token: "again",
        scope: `openid email ${DRIVE_FILE_SCOPE}`,
        id_token: `${segment({ alg: "RS256" })}.${segment({ email: "bukti@perusahaan.test" })}.c2ln`,
      },
    });

    await expect(
      completeDriveConnection({
        params: new URLSearchParams({ state: "s", code: "c" }),
        stateCookie: "s",
        person: admin,
      }),
    ).resolves.toBe("connected");

    expect((await lineRow(line.id)).driveSyncedAt).toBeInstanceOf(Date);
  });
});

describe("the folder names (#407)", () => {
  /** A Drive folder named as before ADR-0044, recorded as `column` of the trip. */
  async function staleFolder(
    perjadinId: string,
    column: "driveFolderId" | "driveDokumenFolderId" = "driveFolderId",
  ) {
    const { id } = await drive.createFolder({
      name: "Kelompok 3: Kota Bandung",
      parentId: folders.pelaksanaanOfflineFolderId,
    });
    await db
      .update(schema.perjadin)
      .set({ [column]: id })
      .where(eq(schema.perjadin.id, perjadinId));
    return id;
  }

  const nameOf = async (id: string) => (await drive.getFile(id))!.name;

  /** A second trip, in another Kelompok, a week later. */
  async function anotherTrip(staffId: string) {
    return addPerjadin({
      picPersonId: staffId,
      subClusterName: "Kelompok 4",
      startsOn: "2026-10-19",
      endsOn: "2026-10-20",
    });
  }

  it("renames both of a trip's out-of-date folders, and says so", async () => {
    const { trip } = await scene();
    const receipts = await staleFolder(trip.id);
    const dokumen = await staleFolder(trip.id, "driveDokumenFolderId");

    const report = await checkDriveConnectionAction();

    expect(report).toMatchObject({ names: { ran: true, renamed: 2, remaining: 0, failures: [] } });
    const name = `Kelompok 3 · 12–14 Okt 2026 · P-${trip.id.slice(0, 8)}`;
    await expect(nameOf(receipts)).resolves.toBe(name);
    await expect(nameOf(dokumen)).resolves.toBe(name);
    expect(describeDriveCheck(report).lines).toContain(
      "2 nama folder dan berkas diganti, 0 folder tersisa.",
    );
  });

  it("reads a folder already right and writes nothing, so a second press is safe", async () => {
    const { admin, trip } = await scene();
    await staleFolder(trip.id);
    await reassertPerjadinFolderNames(admin, drive);
    const updateFile = vi.spyOn(drive, "updateFile");

    await expect(reassertPerjadinFolderNames(admin, drive)).resolves.toEqual({
      renamed: 0,
      remaining: 0,
      failures: [],
    });
    expect(updateFile).not.toHaveBeenCalled();
  });

  it("stops at the bound, and the next press carries on past what it put right", async () => {
    const { admin, staff, trip } = await scene();
    const other = await anotherTrip(staff.id);
    const first = await staleFolder(trip.id);
    const second = await staleFolder(other.id);
    const [earlier, later] = trip.id < other.id ? [first, second] : [second, first];

    await expect(reassertPerjadinFolderNames(admin, drive, { limit: 1 })).resolves.toEqual({
      renamed: 1,
      remaining: 1,
      failures: [],
    });
    await expect(nameOf(later)).resolves.toBe("Kelompok 3: Kota Bandung");

    await expect(reassertPerjadinFolderNames(admin, drive, { limit: 1 })).resolves.toEqual({
      renamed: 1,
      remaining: 0,
      failures: [],
    });
    await expect(nameOf(earlier)).resolves.not.toBe("Kelompok 3: Kota Bandung");
    await expect(nameOf(later)).resolves.not.toBe("Kelompok 3: Kota Bandung");
    expect(RENAME_LIMIT).toBe(25);
  });

  it("reads nothing past its time budget, and counts what it did not reach", async () => {
    const { admin, trip } = await scene();
    await staleFolder(trip.id);
    await staleFolder(trip.id, "driveDokumenFolderId");

    await expect(reassertPerjadinFolderNames(admin, drive, { budgetMs: -1 })).resolves.toEqual({
      renamed: 0,
      remaining: 2,
      failures: [],
    });
  });

  it("reports a trashed or deleted folder, and neither renames nor recreates it", async () => {
    const { trip, staff } = await scene();
    const trashed = await staleFolder(trip.id);
    drive.trash(trashed);
    const other = await anotherTrip(staff.id);
    const deleted = await staleFolder(other.id, "driveDokumenFolderId");
    drive.remove(deleted);
    const before = drive.files.size;

    const report = await checkDriveConnectionAction();

    expect(report).toMatchObject({ names: { ran: true, renamed: 0, remaining: 0 } });
    const failures = report.token === "ok" && report.names.ran ? report.names.failures : [];
    expect(failures).toEqual(
      expect.arrayContaining([
        {
          perjadinId: trip.id,
          name: `Kelompok 3 · 12–14 Okt 2026 · P-${trip.id.slice(0, 8)}`,
          folder: "bukti-transaksi",
          reason: "folder-trashed",
        },
        {
          perjadinId: other.id,
          name: `Kelompok 4 · 19–20 Okt 2026 · P-${other.id.slice(0, 8)}`,
          folder: "dokumen",
          reason: "folder-missing",
        },
      ]),
    );
    expect(describeDriveCheck(report).failures).toEqual(
      expect.arrayContaining([
        `Kelompok 3 · 12–14 Okt 2026 · P-${trip.id.slice(0, 8)} (Bukti Transaksi): folder ada di Sampah Google Drive.`,
        `Kelompok 4 · 19–20 Okt 2026 · P-${other.id.slice(0, 8)} (Dokumen): folder tidak ditemukan.`,
      ]),
    );
    expect(drive.files.size).toBe(before);
    await expect(nameOf(trashed)).resolves.toBe("Kelompok 3: Kota Bandung");
  });
});

describe("the belum tersinkron marker", () => {
  it("shows only on a line whose Drive receipt is still owed", async () => {
    const { admin, trip } = await scene();
    await anUnsyncedLine(trip.id, admin.id, "Belum");
    const synced = await anUnsyncedLine(trip.id, admin.id, "Sudah");
    await db
      .update(schema.transaction)
      .set({ driveSyncedAt: new Date() })
      .where(eq(schema.transaction.id, synced.id));
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 5_000,
      description: "Kosong",
      createdByPersonId: admin.id,
    });

    const html = renderToStaticMarkup(
      await LaporanPage({ params: Promise.resolve({ id: trip.id }) } as never),
    );

    const cards = html.split('data-slot="card"').slice(1);
    const marked = cards
      .filter((card) => card.includes(RECEIPTS_UNSYNCED))
      .map((card) => /(Belum|Sudah|Kosong)/.exec(card)?.[1]);
    expect(marked).toEqual(["Belum"]);
  });
});
