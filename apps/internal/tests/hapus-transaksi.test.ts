import LogPage from "-/app/(app)/log/page";
import {
  deleteTransactionAction,
  finalizeReceiptsAction,
  recordTransactionAction,
} from "-/app/(app)/perjadin/[id]/laporan/actions";
import { csvOf } from "-/app/(app)/perjadin/[id]/laporan/ekspor/csv";
import LaporanPage from "-/app/(app)/perjadin/[id]/laporan/page";
import { TRANSACTION_DELETE_CONFIRM } from "-/components/laporan-perjadin/transaction-delete-messages";
import { sweepUnsynced } from "-/lib/drive/check";
import { FakeDrive } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { reconcileTransaction } from "-/lib/drive/reconcile";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import {
  activityLogPage,
  claimTransactionDriveFolder,
  deleteTransaction,
  isNotStaffError,
  markTransactionSynced,
  perjadinAcquittal,
  reconcileTarget,
  unsyncedTransactions,
  type Person,
} from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectDrive,
  digestOf,
  FORBIDDEN,
  jpeg,
  stubTokenEndpoint,
  upload,
} from "./support/drive";
import {
  addGrant,
  addPerjadin,
  addPerson,
  addTransaction,
  addTransactionEvidence,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Hapus transaksi** (#463, ADR-0050): one whole line off the Laporan. Its folder and any receipt
 * outside it go to the Drive trash first, then the line, its evidence rows and its
 * `transaction_deleted` Log entry go in one transaction. The fakes of `hapus-bukti.test.ts`, with
 * `deleteTransaction` and the reconcile's queries wrapped so a test can fail them or race them.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("@sugt/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sugt/db/queries")>();
  return {
    ...actual,
    deleteTransaction: vi.fn(actual.deleteTransaction),
    reconcileTarget: vi.fn(actual.reconcileTarget),
    claimTransactionDriveFolder: vi.fn(actual.claimTransactionDriveFolder),
    markTransactionSynced: vi.fn(actual.markTransactionSynced),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "https://preview-42.sugt.test" })),
}));

const real = await vi.importActual<typeof import("@sugt/db/queries")>("@sugt/db/queries");

let drive: FakeDrive;
let folders: ReadyFolders;

/**
 * A Staff PIC, an Administrator, a Pimpinan, a trip with Drive connected, and one line recorded
 * through Catat transaksi with `receipts` real files in Drive, synced — plus a second line, kept, so
 * the totals have something left to count.
 */
async function scene({ receipts = 2 }: { receipts?: number } = {}) {
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  const admin = {
    ...(await addPerson({ fullName: "Ani", email: "ani@itb.ac.id", role: "Staff" })),
    grants: ["Administrator" as const],
  };
  await addGrant(admin.id, "Administrator");
  const pimpinan = await addPerson({ fullName: "Fa", email: "fa@itb.ac.id", role: "Pimpinan" });
  const trip = await addPerjadin({
    picPersonId: staff.id,
    subClusterName: "Kelompok 3",
    startsOn: "2026-10-12",
    endsOn: "2026-10-14",
  });
  folders = await connectDrive(drive, staff.id);
  vi.mocked(requirePerson).mockResolvedValue(staff);
  const hotel = await addTransaction({
    perjadinId: trip.id,
    amountIdr: 300_000,
    description: "Hotel",
    category: "Akomodasi",
    participantType: "GTK-MS",
    createdByPersonId: staff.id,
  });
  await addTransactionEvidence({ transactionId: hotel.id, uploadedByPersonId: staff.id });
  // Synced, so the sweep owes only what a test leaves unsynced.
  await db
    .update(schema.transaction)
    .set({ driveSyncedAt: new Date() })
    .where(eq(schema.transaction.id, hotel.id));

  const recorded = await record(trip.id, receipts);
  if (!recorded.synced) throw new Error("not synced");
  drive.calls = 0;
  return { staff, admin, pimpinan, trip, ...recorded };
}

/** Catat transaksi with `receipts` fresh files: the line's id, its folder and its receipt files. */
async function record(perjadinId: string, receipts: number) {
  const ids = await upload(
    drive,
    perjadinId,
    Array.from({ length: receipts }, () => jpeg()),
  );
  const recorded = await recordTransactionAction({
    perjadinId,
    spentOn: "2026-10-13",
    description: "Makan siang",
    amountIdr: 150_000,
    category: "Konsumsi",
    participantType: "Siswa",
    receipts: ids.map((driveFileId) => ({ driveFileId })),
  });
  if (recorded.outcome !== "recorded") throw new Error(`not recorded: ${recorded.outcome}`);
  const [line] = await db
    .select()
    .from(schema.transaction)
    .where(eq(schema.transaction.id, recorded.transactionId));
  return {
    transactionId: recorded.transactionId,
    synced: recorded.synced,
    folderId: line!.driveFolderId!,
    fileIds: ids,
  };
}

const lineOf = async (transactionId: string) =>
  (await db.select().from(schema.transaction).where(eq(schema.transaction.id, transactionId)))[0] ??
  null;
const evidenceOf = (transactionId: string) =>
  db
    .select()
    .from(schema.transactionEvidence)
    .where(eq(schema.transactionEvidence.transactionId, transactionId));
const deletions = async () =>
  (await db.select().from(schema.activityLog)).filter(
    (entry) => entry.action === "transaction_deleted",
  );
/** Whether Drive reports the item trashed — by itself, or inside a trashed folder. */
const inTrash = async (id: string) => {
  const calls = drive.calls;
  const file = await drive.getFile(id);
  drive.calls = calls;
  return file?.trashed ?? null;
};
/** Every item in Drive tagged as this line's, that is not in the trash. */
const liveItemsOf = async (transactionId: string) => {
  const tagged = [...drive.files.values()].filter(
    (file) => file.appProperties.sugtTransactionId === transactionId,
  );
  const live = [];
  for (const file of tagged) if ((await inTrash(file.id)) === false) live.push(file.id);
  return live;
};

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("Hapus transaksi", () => {
  it("trashes the line's folder, then deletes the line and its receipts and logs a copy", async () => {
    const { staff, trip, transactionId, folderId, fileIds } = await scene();

    await expect(deleteTransactionAction(transactionId)).resolves.toEqual({ outcome: "deleted" });

    expect(drive.files.get(folderId)?.explicitlyTrashed).toBe(true);
    for (const id of fileIds) await expect(inTrash(id)).resolves.toBe(true);
    await expect(lineOf(transactionId)).resolves.toBeNull();
    await expect(evidenceOf(transactionId)).resolves.toEqual([]);
    const [entry] = await deletions();
    expect(entry).toMatchObject({
      actorPersonId: staff.id,
      perjadinId: trip.id,
      details: {
        transactionId,
        category: "Konsumsi",
        amountIdr: 150_000,
        participantType: "Siswa",
        spentOn: "2026-10-13",
        description: "Makan siang",
        receiptCount: 2,
      },
      searchText:
        "transaksi dihapus · konsumsi · rp150.000 · siswa · tgl 2026-10-13 · makan siang · 2 bukti",
    });
    expect(revalidatePath).toHaveBeenLastCalledWith(`/perjadin/${trip.id}/laporan`);
  });

  it("drops the line from the totals, the subtotals and the export", async () => {
    const { staff, trip, transactionId } = await scene();
    const before = await perjadinAcquittal(staff as Person, trip.id);
    expect(before).toMatchObject({
      spentIdr: 450_000,
      siswaSpentIdr: 150_000,
      gtkMsSpentIdr: 300_000,
    });
    expect(csvOf(before!)).toContain("Makan siang");

    await deleteTransactionAction(transactionId);

    const after = await perjadinAcquittal(staff as Person, trip.id);
    expect(after).toMatchObject({
      spentIdr: 300_000,
      siswaSpentIdr: 0,
      gtkMsSpentIdr: 300_000,
    });
    expect(after!.transactions.map((line) => line.description)).toEqual(["Hotel"]);
    expect(csvOf(after!)).not.toContain("Makan siang");
  });

  it("trashes an unsynced line from _staging — its folder, and a receipt outside it", async () => {
    const { staff, trip } = await scene();
    // The reconcile cannot make the Perjadin folder, so the line's folder stays in `_staging`.
    const createFolder = drive.createFolder.bind(drive);
    vi.spyOn(drive, "createFolder")
      .mockImplementationOnce(createFolder)
      .mockRejectedValueOnce(new DriveRequestError("files.create", 503));
    await db
      .update(schema.perjadin)
      .set({ driveFolderId: null })
      .where(eq(schema.perjadin.id, trip.id));
    const unsynced = await record(trip.id, 1);
    vi.mocked(drive.createFolder).mockRestore();
    expect(unsynced.synced).toBe(false);
    expect(drive.files.get(unsynced.folderId)?.parents).toEqual([folders.stagingFolderId]);
    // A receipt added by Unggah bukti that its reconcile could not move: in `_staging` itself.
    const [late] = await upload(drive, trip.id, [jpeg()], {
      transactionId: unsynced.transactionId,
    });
    vi.spyOn(drive, "updateFile").mockRejectedValue(new DriveRequestError("files.update", 500));
    await finalizeReceiptsAction(trip.id, unsynced.transactionId, [{ driveFileId: late! }]);
    vi.mocked(drive.updateFile).mockRestore();
    expect(drive.files.get(late!)?.parents).toEqual([folders.stagingFolderId]);

    await expect(deleteTransactionAction(unsynced.transactionId)).resolves.toEqual({
      outcome: "deleted",
    });

    expect(drive.files.get(unsynced.folderId)?.explicitlyTrashed).toBe(true);
    expect(drive.files.get(late!)?.explicitlyTrashed).toBe(true);
    await expect(liveItemsOf(unsynced.transactionId)).resolves.toEqual([]);
    await expect(lineOf(unsynced.transactionId)).resolves.toBeNull();
    // And the sweep owes nothing for it.
    await expect(unsyncedTransactions(staff as Person, 10)).resolves.toMatchObject({ total: 0 });
  });

  it.each([
    ["already in the Drive trash", (id: string) => drive.trash(id)],
    ["gone from Drive", (id: string) => drive.remove(id)],
  ])("completes when the folder and a receipt are %s", async (_case, spoil) => {
    const { transactionId, folderId, fileIds } = await scene();
    // A receipt a person moved out of the folder, then spoiled; the folder spoiled too.
    drive.files.get(fileIds[0]!)!.parents = [folders.stagingFolderId];
    spoil(fileIds[0]!);
    spoil(folderId);

    await expect(deleteTransactionAction(transactionId)).resolves.toEqual({ outcome: "deleted" });
    await expect(lineOf(transactionId)).resolves.toBeNull();
    await expect(deletions()).resolves.toHaveLength(1);
  });

  it("deletes nothing when the trash fails", async () => {
    const { transactionId, folderId } = await scene();
    vi.spyOn(drive, "trashFile").mockRejectedValueOnce(new DriveRequestError("files.update", 503));

    await expect(deleteTransactionAction(transactionId)).resolves.toEqual({
      outcome: "drive-unreachable",
    });
    expect(drive.files.get(folderId)?.explicitlyTrashed).toBe(false);
    await expect(lineOf(transactionId)).resolves.not.toBeNull();
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(2);
    await expect(deletions()).resolves.toHaveLength(0);
  });

  it("keeps the line listed when the database fails after the trash, and Hapus again finishes it", async () => {
    const { transactionId, folderId } = await scene();
    vi.mocked(deleteTransaction).mockRejectedValueOnce(new Error("connection lost"));

    await expect(deleteTransactionAction(transactionId)).rejects.toThrow("connection lost");
    expect(drive.files.get(folderId)?.explicitlyTrashed).toBe(true);
    await expect(lineOf(transactionId)).resolves.not.toBeNull();

    await expect(deleteTransactionAction(transactionId)).resolves.toEqual({ outcome: "deleted" });
    await expect(lineOf(transactionId)).resolves.toBeNull();
    await expect(deletions()).resolves.toHaveLength(1);
  });

  it("rolls the line back with the Log entry: one refused, neither written", async () => {
    const { staff, transactionId } = await scene();
    // A caller whose Person does not exist: the Log entry's foreign key refuses it, inside the
    // transaction, after the delete — so the delete must be undone with it.
    const ghost = {
      ...(staff as Person),
      grants: ["Perjadin Editor"],
      id: "00000000-0000-0000-0000-00000000dead",
    } as Person;

    await expect(real.deleteTransaction(ghost, transactionId)).rejects.toThrow();
    await expect(lineOf(transactionId)).resolves.not.toBeNull();
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(2);
    await expect(deletions()).resolves.toHaveLength(0);
  });

  it("trashes a receipt that joined the line between its read and the commit", async () => {
    // An Unggah bukti commits after this Hapus read the line and trashed what it held.
    const { staff, trip, transactionId } = await scene({ receipts: 1 });
    const [late] = await upload(drive, trip.id, [jpeg()], { transactionId });
    vi.mocked(deleteTransaction).mockImplementationOnce(async (caller, id) => {
      await addTransactionEvidence({
        transactionId,
        uploadedByPersonId: staff.id,
        driveFileId: late,
      });
      return real.deleteTransaction(caller, id);
    });

    await expect(deleteTransactionAction(transactionId)).resolves.toEqual({ outcome: "deleted" });
    expect(drive.files.get(late!)?.explicitlyTrashed).toBe(true);
    await expect(deletions()).resolves.toMatchObject([{ details: { receiptCount: 2 } }]);
  });

  it("reads what the line holds under its lock, so a receipt committed while it waited is answered", async () => {
    const { staff, trip, transactionId } = await scene({ receipts: 1 });
    const [late] = await upload(drive, trip.id, [jpeg()], { transactionId });
    // An Unggah bukti holding the line's lock, as `attachTransactionEvidence` does, commits its
    // receipt while the delete waits on that lock.
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const attach = db.transaction(async (tx) => {
      await tx
        .select({ id: schema.transaction.id })
        .from(schema.transaction)
        .where(eq(schema.transaction.id, transactionId))
        .for("update");
      locked();
      await released;
      await tx.insert(schema.transactionEvidence).values({
        transactionId,
        driveFileId: late!,
        contentType: "image/jpeg",
        byteSize: 4096,
        uploadedByPersonId: staff.id,
      });
    });
    await isLocked;

    const deleting = real.deleteTransaction(staff as Person, transactionId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await attach;

    await expect(deleting).resolves.toMatchObject({
      outcome: "deleted",
      driveFileIds: expect.arrayContaining([late]),
    });
    await expect(deletions()).resolves.toMatchObject([{ details: { receiptCount: 2 } }]);
  });

  it("trashes a folder a reconcile claimed between its read and the commit", async () => {
    // A line from before Drive, with no folder: a reconcile claims one after this Hapus read it.
    const { staff, trip } = await scene();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });
    const claimed = await drive.createFolder({
      name: "claimed",
      parentId: folders.stagingFolderId,
    });
    vi.mocked(deleteTransaction).mockImplementationOnce(async (caller, id) => {
      await real.claimTransactionDriveFolder(caller, line.id, claimed.id);
      return real.deleteTransaction(caller, id);
    });

    await expect(deleteTransactionAction(line.id)).resolves.toEqual({ outcome: "deleted" });
    expect(drive.files.get(claimed.id)?.explicitlyTrashed).toBe(true);
  });

  it.each([
    ["broken", /^Koneksi Google Drive terputus sejak/],
    ["never connected", /^Google Drive belum terhubung/],
  ] as const)(
    "is refused, with the reason, before any Drive call when Drive is %s",
    async (state, reason) => {
      const { transactionId } = await scene();
      if (state === "broken") {
        await db.update(schema.driveConnection).set({ status: "broken", brokenAt: new Date() });
      } else {
        await db.delete(schema.driveConnection);
      }
      drive.calls = 0;

      await expect(deleteTransactionAction(transactionId)).resolves.toEqual({
        outcome: "drive-disconnected",
        reason: expect.stringMatching(reason),
      });
      expect(drive.calls).toBe(0);
      await expect(lineOf(transactionId)).resolves.not.toBeNull();
    },
  );

  it("refuses a non-writer with a 403 and zero Drive calls", async () => {
    const { pimpinan, transactionId, folderId } = await scene();
    const outsider = await addPerson({ fullName: "Budi", email: "budi@itb.ac.id", role: "Staff" });

    for (const caller of [pimpinan, outsider]) {
      vi.mocked(requirePerson).mockResolvedValue(caller);
      await expect(digestOf(deleteTransactionAction(transactionId))).resolves.toBe(FORBIDDEN);
    }
    await expect(real.deleteTransaction(pimpinan as Person, transactionId)).rejects.toSatisfy(
      isNotStaffError,
    );
    expect(drive.calls).toBe(0);
    expect(drive.files.get(folderId)?.explicitlyTrashed).toBe(false);
    await expect(lineOf(transactionId)).resolves.not.toBeNull();
  });

  it("answers no-such-transaction for a line already deleted, and revalidates", async () => {
    const { transactionId } = await scene();
    await deleteTransactionAction(transactionId);
    drive.calls = 0;

    await expect(deleteTransactionAction(transactionId)).resolves.toEqual({
      outcome: "no-such-transaction",
    });
    expect(drive.calls).toBe(0);
    await expect(deletions()).resolves.toHaveLength(1);
    // A stale screen: the Laporan on it is revalidated, so the line drops off.
    expect(revalidatePath).toHaveBeenLastCalledWith("/perjadin/[id]/laporan", "page");
  });

  it("answers no-such-transaction for an id that is no uuid, without a database error", async () => {
    await scene();
    await expect(deleteTransactionAction("not-a-uuid")).resolves.toEqual({
      outcome: "no-such-transaction",
    });
  });

  it.each([0, 7])("deletes a grandfathered line with %i receipts", async (count) => {
    const { staff, trip } = await scene();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });
    const files =
      count > 0
        ? await upload(
            drive,
            trip.id,
            Array.from({ length: 5 }, () => jpeg()),
          )
        : [];
    for (let i = 0; i < count; i += 1) {
      await addTransactionEvidence({
        transactionId: line.id,
        uploadedByPersonId: staff.id,
        driveFileId: files[i],
      });
    }
    drive.calls = 0;

    await expect(deleteTransactionAction(line.id)).resolves.toEqual({ outcome: "deleted" });
    await expect(lineOf(line.id)).resolves.toBeNull();
    await expect(deletions()).resolves.toMatchObject([{ details: { receiptCount: count } }]);
    for (const id of files) expect(drive.files.get(id)?.explicitlyTrashed).toBe(true);
    // No folder and no receipt: nothing to trash, so Drive is not asked.
    if (count === 0) expect(drive.calls).toBe(0);
  });
});

describe("against the reconcile", () => {
  it("is not picked up by Periksa koneksi's sweep once deleted", async () => {
    const { admin, transactionId } = await scene();
    await db
      .update(schema.transaction)
      .set({ driveSyncedAt: null })
      .where(eq(schema.transaction.id, transactionId));
    await expect(unsyncedTransactions(admin, 10)).resolves.toMatchObject({ total: 1 });

    await deleteTransactionAction(transactionId);

    await expect(sweepUnsynced(admin, drive, folders)).resolves.toMatchObject({
      synced: 0,
      waiting: 0,
      failures: [],
    });
  });

  it("neither recreates the folder nor errors when the line is deleted mid-reconcile", async () => {
    const { staff, transactionId } = await scene();
    vi.mocked(reconcileTarget).mockImplementationOnce(async (caller, id) => {
      const target = await real.reconcileTarget(caller, id);
      await deleteTransactionAction(transactionId);
      return target;
    });

    await expect(
      reconcileTransaction(staff as Person, drive, folders, transactionId),
    ).resolves.toEqual({ outcome: "unsynced", reason: "folder-trashed" });
    await expect(liveItemsOf(transactionId)).resolves.toEqual([]);
  });

  it("trashes the folder it made, and stops, when the line is deleted before its claim", async () => {
    // A line from before Drive, with a receipt and no folder: the reconcile makes one.
    const { staff, trip } = await scene();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });
    const [file] = await upload(drive, trip.id, [jpeg()]);
    await addTransactionEvidence({
      transactionId: line.id,
      uploadedByPersonId: staff.id,
      driveFileId: file,
    });
    vi.mocked(claimTransactionDriveFolder).mockImplementationOnce(async (caller, id, folderId) => {
      await deleteTransactionAction(line.id);
      return real.claimTransactionDriveFolder(caller, id, folderId);
    });

    await expect(reconcileTransaction(staff as Person, drive, folders, line.id)).resolves.toEqual({
      outcome: "no-such-transaction",
    });
    const made = [...drive.files.values()].filter(
      (item) => item.appProperties.sugtTransactionId === line.id,
    );
    expect(made).toHaveLength(1);
    expect(made[0]!.explicitlyTrashed).toBe(true);
    await expect(inTrash(file!)).resolves.toBe(true);
  });

  it("answers no-such-transaction when the line is deleted just before it marks it synced", async () => {
    const { staff, transactionId } = await scene();
    vi.mocked(markTransactionSynced).mockImplementationOnce(async (caller, id, handled) => {
      await deleteTransactionAction(transactionId);
      return real.markTransactionSynced(caller, id, handled);
    });

    await expect(
      reconcileTransaction(staff as Person, drive, folders, transactionId),
    ).resolves.toEqual({ outcome: "no-such-transaction" });
    await expect(liveItemsOf(transactionId)).resolves.toEqual([]);
  });
});

describe("on /log", () => {
  it("shows Transaksi dihapus, found by the Catat transaksi filter and by search", async () => {
    const { admin, transactionId } = await scene();
    await deleteTransactionAction(transactionId);
    const filters = { q: "", aksi: null, dari: null, sampai: null, page: 1 };

    const catat = await activityLogPage(admin as Person, { ...filters, aksi: "catat-transaksi" });
    expect(catat.rows.map((row) => row.action).sort()).toEqual([
      "transaction_deleted",
      "transaction_recorded",
    ]);
    const found = await activityLogPage(admin as Person, { ...filters, q: "transaksi dihapus" });
    expect(found.rows.map((row) => row.action)).toEqual(["transaction_deleted"]);
  });

  it("still renders the line's earlier entries, without a Buka folder link", async () => {
    const { admin, transactionId } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(admin);
    const render = async () =>
      renderToStaticMarkup(await LogPage({ searchParams: Promise.resolve({}) } as never));
    expect(await render()).toContain("Buka folder");

    await deleteTransactionAction(transactionId);

    const html = await render();
    expect(html).toContain("Transaksi dihapus");
    expect(html).not.toContain("Buka folder");
    const { rows } = await activityLogPage(admin as Person, {
      q: "",
      aksi: "catat-transaksi",
      dari: null,
      sampai: null,
      page: 1,
    });
    expect(rows.find((row) => row.action === "transaction_recorded")).toMatchObject({
      driveFolderId: null,
    });
  });
});

describe("on the Laporan", () => {
  const render = async (viewer: Person, perjadinId: string) => {
    vi.mocked(requirePerson).mockResolvedValue(viewer);
    return renderToStaticMarkup(
      await LaporanPage({ params: Promise.resolve({ id: perjadinId }) } as never),
    );
  };

  it("shows Hapus on each line to whoever writes the trip, and to no one else", async () => {
    const { staff, pimpinan, trip } = await scene();

    const forStaff = await render(staff as Person, trip.id);
    expect(forStaff).toContain('aria-label="Hapus transaksi 2026-10-13 · Makan siang"');
    expect(forStaff).toContain('aria-label="Hapus transaksi 2026-09-02 · Hotel"');

    const forPimpinan = await render(pimpinan as Person, trip.id);
    expect(forPimpinan).toContain("Makan siang");
    expect(forPimpinan).not.toContain("Hapus");
  });

  it.each([
    ["broken", /Koneksi Google Drive terputus sejak/],
    ["never connected", /Google Drive belum terhubung/],
  ] as const)("disables Hapus, with the reason, while Drive is %s", async (state, reason) => {
    const { staff, trip } = await scene();
    if (state === "broken") {
      await db.update(schema.driveConnection).set({ status: "broken", brokenAt: new Date() });
    } else {
      await db.delete(schema.driveConnection);
    }

    const html = await render(staff as Person, trip.id);
    const hapus = html.match(/<button[^>]*aria-label="Hapus transaksi 2026-10-13[^"]*"[^>]*>/)?.[0];
    expect(hapus).toContain("disabled");
    // On the button itself, as well as once beside Catat transaksi.
    expect(hapus).toMatch(reason);
    expect(html).toMatch(reason);
  });
});

describe("what Hapus transaksi says", () => {
  it("asks in the ticket's words", () => {
    expect(TRANSACTION_DELETE_CONFIRM).toBe(
      "Hapus transaksi ini? Folder buktinya akan dipindahkan ke Sampah Google Drive.",
    );
  });
});
