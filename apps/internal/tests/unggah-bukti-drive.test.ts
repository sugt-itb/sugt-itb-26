import {
  finalizeReceiptsAction,
  openReceiptSessionsAction,
} from "-/app/(app)/perjadin/[id]/laporan/actions";
import { FakeDrive } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { reconcileTransaction } from "-/lib/drive/reconcile";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import { MAX_RECEIPTS_PER_TRANSACTION } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectDrive,
  digestOf,
  FORBIDDEN,
  jpeg,
  stubTokenEndpoint,
  upload as uploadTo,
} from "./support/drive";
import {
  addPerjadin,
  addPerson,
  addTransaction,
  addTransactionEvidence,
  resetDatabase,
} from "./support/fixtures";

/**
 * **A row's own Unggah bukti uploads to Google Drive** (#374, ADR-0040), against the real database
 * and the in-memory `FakeDrive` — faked as in `catat-transaksi-drive.test.ts`, and for the same
 * reasons.
 *
 * What only this path holds is its order: every check before Drive, then **commit first** — the
 * count under the line's lock — and only then the files move into a folder that is usually already
 * public. And partial success: a file that does not check out is reported, the rest attach.
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

/** A Staff PIC, a Pimpinan, a trip, and a line on it holding `held` receipts and no folder yet. */
async function scene(
  options: {
    connection?: "connected" | "broken" | "none";
    held?: number;
  } = {},
) {
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  const pimpinan = await addPerson({
    fullName: "Fatimah",
    email: "fa@itb.ac.id",
    role: "Pimpinan",
  });
  const trip = await addPerjadin({
    picPersonId: staff.id,
    subClusterName: "Kelompok 3",
    startsOn: "2026-10-12",
    endsOn: "2026-10-14",
  });
  const line = await addTransaction({
    perjadinId: trip.id,
    amountIdr: 75_000,
    category: "Konsumsi",
    spentOn: "2026-10-12",
    createdByPersonId: staff.id,
  });
  for (let held = 0; held < (options.held ?? 0); held += 1) {
    await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: staff.id });
  }

  const connection = options.connection ?? "connected";
  if (connection !== "none") folders = await connectDrive(drive, staff.id, connection);
  drive.calls = 0;
  vi.mocked(requirePerson).mockResolvedValue(staff);
  return { staff, pimpinan, trip, line };
}

/** The row's upload: sessions for the line, then the browser's `PUT` to each. */
const upload = (perjadinId: string, files: Uint8Array[], transactionId?: string) =>
  uploadTo(drive, perjadinId, files, { transactionId });

const asReceipts = (ids: string[]) => ids.map((driveFileId) => ({ driveFileId }));
const evidenceOf = (transactionId: string) =>
  db
    .select()
    .from(schema.transactionEvidence)
    .where(eq(schema.transactionEvidence.transactionId, transactionId));
const lineRow = async (transactionId: string) =>
  (await db.select().from(schema.transaction).where(eq(schema.transaction.id, transactionId)))[0]!;

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
  const oneFile = [{ size: 10, contentType: "image/jpeg" }];

  it("refuses a non-Staff caller with zero Drive calls", async () => {
    const { pimpinan, trip, line } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(pimpinan as Person);

    await expect(digestOf(openReceiptSessionsAction(trip.id, oneFile, line.id))).resolves.toBe(
      FORBIDDEN,
    );
    await expect(
      digestOf(finalizeReceiptsAction(trip.id, line.id, asReceipts(["x"]))),
    ).resolves.toBe(FORBIDDEN);
    expect(drive.calls).toBe(0);
  });

  it("refuses a line on another Perjadin with zero Drive calls", async () => {
    const { staff, line } = await scene();
    const other = await addPerjadin({ picPersonId: staff.id });

    await expect(openReceiptSessionsAction(other.id, oneFile, line.id)).resolves.toEqual({
      outcome: "no-such-transaction",
    });
    await expect(finalizeReceiptsAction(other.id, line.id, asReceipts(["x"]))).resolves.toEqual({
      outcome: "no-such-transaction",
    });
    expect(drive.calls).toBe(0);
  });

  it.each(["none", "broken"] as const)(
    "answers drive-disconnected with zero Drive calls when the connection is %s",
    async (connection) => {
      const { trip, line } = await scene({ connection });

      await expect(openReceiptSessionsAction(trip.id, oneFile, line.id)).resolves.toMatchObject({
        outcome: "drive-disconnected",
      });
      await expect(
        finalizeReceiptsAction(trip.id, line.id, asReceipts(["x"])),
      ).resolves.toMatchObject({ outcome: "drive-disconnected" });
      expect(drive.calls).toBe(0);
      await expect(evidenceOf(line.id)).resolves.toHaveLength(0);
    },
  );
});

describe("five receipts per line, in total", () => {
  it("takes a line from 3 to 5", async () => {
    const { trip, line } = await scene({ held: 3 });
    const ids = await upload(trip.id, [jpeg(), jpeg()], line.id);

    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts(ids))).resolves.toEqual({
      outcome: "attached",
      attached: 2,
      failed: 0,
      synced: true,
    });
    await expect(evidenceOf(line.id)).resolves.toHaveLength(5);
  });

  it("refuses 3 to 6, and anything from 5, before Drive", async () => {
    const { trip, line } = await scene({ held: 3 });
    const three = Array(3).fill({ size: 10, contentType: "image/jpeg" });

    await expect(openReceiptSessionsAction(trip.id, three, line.id)).resolves.toMatchObject({
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
    });
    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts(["a", "b", "c"])),
    ).resolves.toEqual({ outcome: "too-many-receipts", limit: MAX_RECEIPTS_PER_TRANSACTION });

    await addTransactionEvidence({
      transactionId: line.id,
      uploadedByPersonId: line.createdByPersonId,
    });
    await addTransactionEvidence({
      transactionId: line.id,
      uploadedByPersonId: line.createdByPersonId,
    });
    await expect(
      openReceiptSessionsAction(trip.id, [{ size: 10, contentType: "image/jpeg" }], line.id),
    ).resolves.toMatchObject({ outcome: "too-many-receipts" });
    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts(["a"]))).resolves.toEqual({
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
    });
    expect(drive.calls).toBe(0);
  });

  it("lets only one of two concurrent uploads pass the count", async () => {
    const { trip, line } = await scene({ held: 3 });
    // Both batches were opened while the line still had two slots — two tabs, say.
    const first = await upload(trip.id, [jpeg(), jpeg()], line.id);
    const second = await upload(trip.id, [jpeg(), jpeg()], line.id);

    const results = await Promise.all([
      finalizeReceiptsAction(trip.id, line.id, asReceipts(first)),
      finalizeReceiptsAction(trip.id, line.id, asReceipts(second)),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "attached",
      "too-many-receipts",
    ]);
    await expect(evidenceOf(line.id)).resolves.toHaveLength(5);
  });
});

describe("a line with no folder yet", () => {
  it("gets its Perjadin folder and its own, shared, the first time a receipt is added", async () => {
    const { trip, line } = await scene({ held: 0 });
    const [id] = await upload(trip.id, [jpeg()], line.id);

    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([id!])),
    ).resolves.toMatchObject({ outcome: "attached", attached: 1, synced: true });

    const [stored] = await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, trip.id));
    const perjadinFolder = (await drive.getFile(stored!.driveFolderId!))!;
    expect(perjadinFolder.name).toBe(`Kelompok 3 · 12–14 Okt 2026 · P-${trip.id.slice(0, 8)}`);
    expect(perjadinFolder.parents).toEqual([folders.pelaksanaanOfflineFolderId]);

    const after = await lineRow(line.id);
    expect(after.driveSyncedAt).toBeInstanceOf(Date);
    const folder = (await drive.getFile(after.driveFolderId!))!;
    expect(folder.parents).toEqual([perjadinFolder.id]);
    expect(folder.name).toBe(`2026-10-12 · Konsumsi · T-${line.id.slice(0, 8)}`);
    await expect(drive.listPermissions(folder.id)).resolves.toEqual([
      expect.objectContaining({ type: "anyone", role: "reader", inherited: false }),
    ]);
    // Only the transaction folder is shared; the Perjadin folder stays private.
    await expect(drive.listPermissions(perjadinFolder.id)).resolves.toEqual([]);

    const [row] = await evidenceOf(line.id);
    const file = (await drive.getFile(id!))!;
    expect(file.parents).toEqual([folder.id]);
    expect(file.name).toBe(`${folder.name} · ${row!.id.slice(0, 8)}.jpg`);
  });
});

describe("after the commit", () => {
  it("keeps the receipt when the reconcile fails, with the file in _staging, and finishes it later", async () => {
    const { staff, trip, line } = await scene();
    const [id] = await upload(trip.id, [jpeg()], line.id);
    vi.spyOn(drive, "updateFile").mockRejectedValue(new DriveRequestError("files.update", 503));

    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts([id!]))).resolves.toEqual({
      outcome: "attached",
      attached: 1,
      failed: 0,
      synced: false,
    });
    await expect(evidenceOf(line.id)).resolves.toMatchObject([{ driveFileId: id }]);
    expect((await drive.getFile(id!))!.parents).toEqual([folders.stagingFolderId]);
    expect((await lineRow(line.id)).driveSyncedAt).toBeNull();

    vi.mocked(drive.updateFile).mockRestore();
    await expect(reconcileTransaction(staff, drive, folders, line.id)).resolves.toEqual({
      outcome: "synced",
    });
    const after = await lineRow(line.id);
    expect(after.driveSyncedAt).toBeInstanceOf(Date);
    expect((await drive.getFile(id!))!.parents).toEqual([after.driveFolderId]);
  });

  it("keeps the line owed when an older reconcile finishes after a newer receipt", async () => {
    const { staff, trip, line } = await scene();
    await finalizeReceiptsAction(
      trip.id,
      line.id,
      asReceipts(await upload(trip.id, [jpeg()], line.id)),
    );
    // Reconcile A — another tab, or the sweep — reads the line, then stops just before it shares.
    let reachedShare!: () => void;
    const atShare = new Promise<void>((resolve) => (reachedShare = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const listPermissions = drive.listPermissions.bind(drive);
    vi.spyOn(drive, "listPermissions").mockImplementationOnce(async (id) => {
      reachedShare();
      await held;
      return listPermissions(id);
    });
    const older = reconcileTransaction(staff, drive, folders, line.id);
    await atShare;

    // Meanwhile B adds a receipt; it commits, and its own reconcile fails before moving the file.
    const [newer] = await upload(trip.id, [jpeg()], line.id);
    vi.spyOn(drive, "updateFile").mockRejectedValue(new DriveRequestError("files.update", 503));
    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([newer!])),
    ).resolves.toMatchObject({ outcome: "attached", synced: false });
    release();

    await expect(older).resolves.toEqual({ outcome: "unsynced", reason: "newer-receipts" });
    expect((await lineRow(line.id)).driveSyncedAt).toBeNull();
    expect((await drive.getFile(newer!))!.parents).toEqual([folders.stagingFolderId]);
  });

  it("makes a synced line unsynced again until its new receipt is in place", async () => {
    const { trip, line } = await scene();
    await finalizeReceiptsAction(
      trip.id,
      line.id,
      asReceipts(await upload(trip.id, [jpeg()], line.id)),
    );
    expect((await lineRow(line.id)).driveSyncedAt).toBeInstanceOf(Date);
    const [id] = await upload(trip.id, [jpeg()], line.id);
    vi.spyOn(drive, "listPermissions").mockRejectedValueOnce(
      new DriveRequestError("permissions.list", 503),
    );

    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([id!])),
    ).resolves.toMatchObject({ outcome: "attached", synced: false });
    expect((await lineRow(line.id)).driveSyncedAt).toBeNull();
  });
});

describe("a file that does not check out", () => {
  it("counts a file named twice in one batch once, and the repeat as failed", async () => {
    const { trip, line } = await scene();
    const [id] = await upload(trip.id, [jpeg()], line.id);

    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts([id!, id!]))).resolves.toEqual(
      { outcome: "attached", attached: 1, failed: 1, synced: true },
    );
    await expect(evidenceOf(line.id)).resolves.toHaveLength(1);
  });

  it("is reported as failed and not attached, while the rest attach", async () => {
    const { staff, trip, line } = await scene();
    const other = await addPerjadin({ picPersonId: staff.id });
    const [good] = await upload(trip.id, [jpeg()], line.id);
    const [wrongBytes] = await upload(
      trip.id,
      [new TextEncoder().encode("MZ executable!")],
      line.id,
    );
    const [theirs] = await uploadTo(drive, other.id, [jpeg()]);

    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([good!, wrongBytes!, theirs!])),
    ).resolves.toEqual({ outcome: "attached", attached: 1, failed: 2, synced: true });

    await expect(evidenceOf(line.id)).resolves.toMatchObject([{ driveFileId: good }]);
    expect((await drive.getFile(wrongBytes!))!.parents).toEqual([folders.stagingFolderId]);
  });
});
