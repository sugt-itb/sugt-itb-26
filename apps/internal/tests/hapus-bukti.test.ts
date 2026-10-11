import {
  deleteReceiptAction,
  filePerjadinReportAction,
  finalizeReceiptsAction,
  openReceiptSessionsAction,
  recordTransactionAction,
} from "-/app/(app)/perjadin/[id]/laporan/actions";
import LaporanPage from "-/app/(app)/perjadin/[id]/laporan/page";
import {
  RECEIPT_DELETE_CONFIRM,
  receiptDeleteRefusalText,
} from "-/components/laporan-perjadin/receipt-delete-messages";
import { FakeDrive } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import {
  activityLogPage,
  deleteTransactionEvidence,
  isNotStaffError,
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
 * **Hapus bukti** (#462, ADR-0050): one receipt off its line. The file goes to the Drive trash
 * first, then the row and its `evidence_deleted` Log entry go in one transaction, counted under the
 * line's lock — a line keeps at least one receipt. The fakes of `dokumen-hapus.test.ts`, with
 * `deleteTransactionEvidence` wrapped so a test can fail it or race it.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("@sugt/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sugt/db/queries")>();
  return { ...actual, deleteTransactionEvidence: vi.fn(actual.deleteTransactionEvidence) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "https://preview-42.sugt.test" })),
}));

const { deleteTransactionEvidence: realDelete } =
  await vi.importActual<typeof import("@sugt/db/queries")>("@sugt/db/queries");

let drive: FakeDrive;
let folders: ReadyFolders;

/**
 * A Staff PIC, an Administrator, a Pimpinan, a trip with Drive connected, and one line recorded
 * through Catat transaksi with `receipts` real files in Drive, synced. Answers the receipts' rows in
 * upload order, each with its file.
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

  const ids = await upload(
    drive,
    trip.id,
    Array.from({ length: receipts }, () => jpeg()),
  );
  const recorded = await recordTransactionAction({
    perjadinId: trip.id,
    spentOn: "2026-10-13",
    description: "Makan siang",
    amountIdr: 150_000,
    category: "Konsumsi",
    participantType: "Siswa",
    receipts: ids.map((driveFileId) => ({ driveFileId })),
  });
  if (recorded.outcome !== "recorded" || !recorded.synced) throw new Error("not recorded");
  drive.calls = 0;
  return {
    staff,
    admin,
    pimpinan,
    trip,
    transactionId: recorded.transactionId,
    receipts: await evidenceOf(recorded.transactionId),
  };
}

const evidenceOf = (transactionId: string) =>
  db
    .select()
    .from(schema.transactionEvidence)
    .where(eq(schema.transactionEvidence.transactionId, transactionId))
    .orderBy(schema.transactionEvidence.uploadedAt, schema.transactionEvidence.id);
const deletions = async () =>
  (await db.select().from(schema.activityLog)).filter(
    (entry) => entry.action === "evidence_deleted",
  );
const trashed = (fileId: string) => drive.files.get(fileId)?.explicitlyTrashed;

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("Hapus bukti", () => {
  it("trashes the file, then deletes the row and logs a copy of what went", async () => {
    const { staff, trip, transactionId, receipts } = await scene();
    const [gone, kept] = receipts;

    await expect(deleteReceiptAction(gone!.id)).resolves.toEqual({ outcome: "deleted" });

    expect(trashed(gone!.driveFileId)).toBe(true);
    expect(trashed(kept!.driveFileId)).toBe(false);
    await expect(evidenceOf(transactionId)).resolves.toEqual([kept]);
    const [entry] = await deletions();
    expect(entry).toMatchObject({
      actorPersonId: staff.id,
      perjadinId: trip.id,
      details: {
        transactionId,
        evidenceId: gone!.id,
        category: "Konsumsi",
        amountIdr: 150_000,
        spentOn: "2026-10-13",
        left: 1,
      },
      searchText: "bukti dihapus · konsumsi · rp150.000 · tgl 2026-10-13 · -1 bukti (kini 1/5)",
    });
  });

  it("refuses the line's only receipt, with nothing trashed and no Drive call", async () => {
    const { transactionId, receipts } = await scene({ receipts: 1 });

    await expect(deleteReceiptAction(receipts[0]!.id)).resolves.toEqual({
      outcome: "only-receipt",
    });
    expect(drive.calls).toBe(0);
    expect(trashed(receipts[0]!.driveFileId)).toBe(false);
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(1);
    await expect(deletions()).resolves.toHaveLength(0);
  });

  it("leaves exactly one of two receipts when two Hapus race, its file out of the trash", async () => {
    const { transactionId, receipts } = await scene();
    const [a, b] = receipts;

    const outcomes = await Promise.all([deleteReceiptAction(a!.id), deleteReceiptAction(b!.id)]);

    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["deleted", "only-receipt"]);
    const left = await evidenceOf(transactionId);
    expect(left).toHaveLength(1);
    expect(trashed(left[0]!.driveFileId)).toBe(false);
    await expect(deletions()).resolves.toHaveLength(1);
  });

  it("takes the file back out of the trash when the commit's count refuses it", async () => {
    // The other Hapus commits after this one's early count and its trash, before its commit: the
    // race the lock settles, made deterministic.
    const { transactionId, receipts } = await scene();
    const [mine, theirs] = receipts;
    vi.mocked(deleteTransactionEvidence).mockImplementationOnce(async (caller, evidenceId) => {
      await realDelete(caller, theirs!.id);
      return realDelete(caller, evidenceId);
    });

    await expect(deleteReceiptAction(mine!.id)).resolves.toEqual({ outcome: "only-receipt" });

    await expect(evidenceOf(transactionId)).resolves.toEqual([mine]);
    expect(trashed(mine!.driveFileId)).toBe(false);
  });

  it("lets only one of two concurrent deletes pass the count under the line's lock", async () => {
    const { staff, transactionId, receipts } = await scene();

    const outcomes = await Promise.all(
      receipts.map((receipt) => realDelete(staff as Person, receipt.id)),
    );

    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["deleted", "only-receipt"]);
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(1);
  });

  it.each([
    ["already in the Drive trash", (id: string) => drive.trash(id)],
    ["gone from Drive", (id: string) => drive.remove(id)],
  ])("completes when the file is %s", async (_case, spoil) => {
    const { transactionId, receipts } = await scene();
    spoil(receipts[0]!.driveFileId);

    await expect(deleteReceiptAction(receipts[0]!.id)).resolves.toEqual({ outcome: "deleted" });
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(1);
    await expect(deletions()).resolves.toHaveLength(1);
  });

  it("deletes nothing when the trash fails", async () => {
    const { transactionId, receipts } = await scene();
    vi.spyOn(drive, "trashFile").mockRejectedValueOnce(new DriveRequestError("files.update", 503));

    await expect(deleteReceiptAction(receipts[0]!.id)).resolves.toEqual({
      outcome: "drive-unreachable",
    });
    expect(trashed(receipts[0]!.driveFileId)).toBe(false);
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(2);
    await expect(deletions()).resolves.toHaveLength(0);
  });

  it("keeps the receipt listed when the database fails after the trash, and Hapus again finishes it", async () => {
    const { transactionId, receipts } = await scene();
    vi.mocked(deleteTransactionEvidence).mockRejectedValueOnce(new Error("connection lost"));

    await expect(deleteReceiptAction(receipts[0]!.id)).rejects.toThrow("connection lost");
    expect(trashed(receipts[0]!.driveFileId)).toBe(true);
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(2);

    await expect(deleteReceiptAction(receipts[0]!.id)).resolves.toEqual({ outcome: "deleted" });
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(1);
    await expect(deletions()).resolves.toHaveLength(1);
  });

  it("rolls the row back with the Log entry: one refused, neither written", async () => {
    const { staff, transactionId, receipts } = await scene();
    // A caller whose Person does not exist: the Log entry's foreign key refuses it, inside the
    // transaction, after the row delete — so the delete must be undone with it.
    const ghost = {
      ...(staff as Person),
      grants: ["Editor"],
      id: "00000000-0000-0000-0000-00000000dead",
    } as Person;

    await expect(realDelete(ghost, receipts[0]!.id)).rejects.toThrow();
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(2);
    await expect(deletions()).resolves.toHaveLength(0);
  });

  it("trashes a receipt still unsynced from _staging, and deletes it", async () => {
    const { trip, transactionId } = await scene({ receipts: 1 });
    const [late] = await upload(drive, trip.id, [jpeg()], { transactionId });
    // The reconcile cannot move it, so it stays in private `_staging`.
    vi.spyOn(drive, "updateFile").mockRejectedValue(new DriveRequestError("files.update", 500));
    const attached = await finalizeReceiptsAction(trip.id, transactionId, [{ driveFileId: late! }]);
    expect(attached).toMatchObject({ outcome: "attached", attached: 1, synced: false });
    vi.mocked(drive.updateFile).mockRestore();
    expect(drive.files.get(late!)?.parents).toEqual([folders.stagingFolderId]);
    const unsynced = (await evidenceOf(transactionId)).find((row) => row.driveFileId === late);

    await expect(deleteReceiptAction(unsynced!.id)).resolves.toEqual({ outcome: "deleted" });
    expect(trashed(late!)).toBe(true);
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(1);
  });

  it.each([
    ["broken", /^Koneksi Google Drive terputus sejak/],
    ["never connected", /^Google Drive belum terhubung/],
  ] as const)(
    "is refused, with the reason, before any Drive call when Drive is %s",
    async (state, reason) => {
      const { transactionId, receipts } = await scene();
      if (state === "broken") {
        await db.update(schema.driveConnection).set({ status: "broken", brokenAt: new Date() });
      } else {
        await db.delete(schema.driveConnection);
      }
      drive.calls = 0;

      await expect(deleteReceiptAction(receipts[0]!.id)).resolves.toEqual({
        outcome: "drive-disconnected",
        reason: expect.stringMatching(reason),
      });
      expect(drive.calls).toBe(0);
      await expect(evidenceOf(transactionId)).resolves.toHaveLength(2);
    },
  );

  it("refuses a non-writer with a 403 and zero Drive calls", async () => {
    const { pimpinan, receipts } = await scene();
    const outsider = await addPerson({ fullName: "Budi", email: "budi@itb.ac.id", role: "Staff" });

    for (const caller of [pimpinan, outsider]) {
      vi.mocked(requirePerson).mockResolvedValue(caller);
      await expect(digestOf(deleteReceiptAction(receipts[0]!.id))).resolves.toBe(FORBIDDEN);
    }
    await expect(realDelete(pimpinan as Person, receipts[0]!.id)).rejects.toSatisfy(
      isNotStaffError,
    );
    expect(drive.calls).toBe(0);
    expect(trashed(receipts[0]!.driveFileId)).toBe(false);
  });

  it("answers no-such-receipt for a receipt already deleted, and revalidates", async () => {
    const { receipts } = await scene({ receipts: 3 });
    await deleteReceiptAction(receipts[0]!.id);

    await expect(deleteReceiptAction(receipts[0]!.id)).resolves.toEqual({
      outcome: "no-such-receipt",
    });
    await expect(deletions()).resolves.toHaveLength(1);
    // A stale screen: the Laporan on it is revalidated, so the receipt drops off.
    expect(revalidatePath).toHaveBeenLastCalledWith("/perjadin/[id]/laporan", "page");
  });

  it("still works after the Laporan has been filed", async () => {
    const { trip, transactionId, receipts } = await scene();
    await expect(filePerjadinReportAction(trip.id)).resolves.toMatchObject({ outcome: "filed" });

    await expect(deleteReceiptAction(receipts[0]!.id)).resolves.toEqual({ outcome: "deleted" });
    await expect(evidenceOf(transactionId)).resolves.toHaveLength(1);
  });

  it("frees a slot that Unggah bukti can fill, the cap still five", async () => {
    const { trip, transactionId, receipts } = await scene({ receipts: 5 });
    const one = [{ size: 10, contentType: "image/jpeg" }];
    await expect(openReceiptSessionsAction(trip.id, one, transactionId)).resolves.toMatchObject({
      outcome: "too-many-receipts",
    });

    await deleteReceiptAction(receipts[0]!.id);

    await expect(openReceiptSessionsAction(trip.id, one, transactionId)).resolves.toMatchObject({
      outcome: "ready",
    });
    await expect(
      openReceiptSessionsAction(trip.id, [...one, ...one], transactionId),
    ).resolves.toMatchObject({ outcome: "too-many-receipts", limit: 5 });
  });

  it("deletes a grandfathered line's receipts down to one, and no further", async () => {
    const { staff, trip } = await scene({ receipts: 1 });
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });
    for (let i = 0; i < 7; i += 1) {
      await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: staff.id });
    }
    const [last, ...rest] = await evidenceOf(line.id);

    for (const receipt of rest) {
      await expect(deleteReceiptAction(receipt.id)).resolves.toEqual({ outcome: "deleted" });
    }
    await expect(deleteReceiptAction(last!.id)).resolves.toEqual({ outcome: "only-receipt" });
    await expect(evidenceOf(line.id)).resolves.toEqual([last]);
  });
});

describe("on /log", () => {
  it("shows Bukti dihapus, found by the Unggah bukti filter and by search", async () => {
    const { admin, receipts } = await scene();
    await deleteReceiptAction(receipts[0]!.id);
    const filters = { q: "", aksi: null, dari: null, sampai: null, page: 1 };

    const unggah = await activityLogPage(admin as Person, { ...filters, aksi: "unggah-bukti" });
    expect(unggah.rows.map((row) => row.action).sort()).toEqual(["evidence_deleted"]);
    const found = await activityLogPage(admin as Person, { ...filters, q: "bukti dihapus" });
    expect(found.rows.map((row) => row.action)).toEqual(["evidence_deleted"]);
  });
});

describe("on the Laporan", () => {
  const render = async (viewer: Person, perjadinId: string) => {
    vi.mocked(requirePerson).mockResolvedValue(viewer);
    return renderToStaticMarkup(
      await LaporanPage({ params: Promise.resolve({ id: perjadinId }) } as never),
    );
  };

  it("shows Hapus beside each receipt to whoever writes the trip, and to no one else", async () => {
    const { staff, pimpinan, trip } = await scene();

    const forStaff = await render(staff as Person, trip.id);
    expect(forStaff).toContain('aria-label="Hapus Bukti 1"');
    expect(forStaff).toContain('aria-label="Hapus Bukti 2"');

    const forPimpinan = await render(pimpinan as Person, trip.id);
    expect(forPimpinan).toContain("Bukti 1");
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
    const hapus = html.match(/<button[^>]*aria-label="Hapus Bukti 1"[^>]*>/)?.[0];
    expect(hapus).toContain("disabled");
    expect(html).toMatch(reason);
  });
});

describe("what Hapus bukti says", () => {
  it("asks, and refuses the only receipt, in the ticket's words", () => {
    expect(RECEIPT_DELETE_CONFIRM).toBe(
      "Hapus bukti ini? File akan dipindahkan ke Sampah Google Drive.",
    );
    expect(receiptDeleteRefusalText({ outcome: "only-receipt" })).toBe(
      "Satu-satunya bukti tidak bisa dihapus. Unggah bukti yang benar dulu, atau hapus transaksinya.",
    );
    expect(receiptDeleteRefusalText({ outcome: "drive-disconnected", reason: "Terputus." })).toBe(
      "Terputus.",
    );
  });
});
