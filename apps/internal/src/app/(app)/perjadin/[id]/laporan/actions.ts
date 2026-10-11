"use server";

import { randomUUID } from "node:crypto";

import { driveAccessToken } from "-/lib/drive/access-token";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { type DriveClient, isDriveFailure, openDrive } from "-/lib/drive/google";
import {
  evidenceFileName,
  isReceiptContentType,
  receiptExtension,
  SNIFF_LENGTH,
  sniffReceiptType,
  transactionFolderName,
  type ReceiptContentType,
} from "-/lib/drive/receipt-files";
import { reconcileTransaction } from "-/lib/drive/reconcile";
import { trashIfLive, untrashIfPresent } from "-/lib/drive/trash-if-live";
import { driveRefusal, isStagedUploadFor, staffOnTrip } from "-/lib/drive/upload-guard";
import { requireEnv } from "-/lib/env";
import { requirePerson, type Person } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  attachTransactionEvidence,
  deleteTransactionEvidence,
  filePerjadinReport,
  receiptDeleteTarget,
  receiptsOnLine,
  recordTransaction,
  type FilePerjadinReportResult,
  type NewEvidence,
} from "@sugt/db/queries";
import { MAX_RECEIPTS_PER_TRANSACTION, MAX_UPLOAD_BYTES } from "@sugt/domain";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import type {
  DeleteReceiptActionResult,
  FinalizeReceiptsResult,
  OpenReceiptSessionsResult,
  ReceiptToOpen,
  RecordTransactionActionResult,
  TransactionToRecord,
  UploadedReceipt,
} from "./action-types";

/**
 * **The Perjadin Report's writes.**
 *
 * Each lives beside the page that offers it, which keeps `revalidatePath` honest — every one of
 * them rewrites the payload of the screen the user is looking at, so every one revalidates that
 * screen and nothing else.
 *
 * None opens a transaction. The boundary is the query layer's fifth convention and lives in
 * `@sugt/db`; `requireStaff` and `requirePerjadinWriter` (ADR-0048) inside each query are what
 * close the path, since a layout does not run before a Server Action. Every one that touches
 * Drive — opening upload sessions, recording a line, attaching receipts to one — also calls the
 * guard itself, first, through `staffOnTrip`
 * (`-/lib/drive/upload-guard`), because Google is reached before any query runs; deleting one runs
 * `receiptDeleteTarget` first for the same reason. Every refusal
 * comes back as a value.
 */

/**
 * Open a Drive resumable upload session per file a receipt control is about to send (ADR-0040) —
 * the Catat transaksi dialog, or with `transactionId` a row's own Unggah bukti. The browser `PUT`s
 * each file's bytes straight to its session, so no receipt passes through Vercel and its 4.5 MB
 * request limit never applies.
 *
 * **Every check runs before Google is asked anything**: Staff and the Perjadin (`staffOnTrip`), the
 * count — for a row, that the line is on this Perjadin and has a slot for each file — each file's
 * type and size, and only then the connection. No more sessions open than the line has slots.
 *
 * Each session opens in `_staging`, named `{uuid}.{ext}`, carrying `sugtPerjadinId`, declaring the
 * file's exact size — Drive refuses a longer body — and the uploading page's `Origin`, without which
 * the browser cannot read the file id back (#370). The origin is the request's own, since every
 * preview has its own URL.
 */
export async function openReceiptSessionsAction(
  perjadinId: string,
  files: ReceiptToOpen[],
  transactionId?: string,
): Promise<OpenReceiptSessionsResult> {
  const person = await requirePerson();

  if (!(await staffOnTrip(person, perjadinId))) return { outcome: "no-such-perjadin" };
  if (files.length === 0) return { outcome: "evidence-missing" };
  const existing =
    transactionId === undefined ? 0 : await receiptsOnLine(person, perjadinId, transactionId);
  if (existing === null) return { outcome: "no-such-transaction" };
  if (existing + files.length > MAX_RECEIPTS_PER_TRANSACTION) {
    return {
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
      count: existing + files.length,
    };
  }
  const typed = files.flatMap((file) =>
    isReceiptContentType(file.contentType) ? [{ ...file, contentType: file.contentType }] : [],
  );
  if (typed.length !== files.length) return { outcome: "unsupported-type" };
  if (files.some((file) => !(file.size > 0) || file.size > MAX_UPLOAD_BYTES)) {
    return { outcome: "too-large", limit: MAX_UPLOAD_BYTES };
  }

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);

  const origin = (await headers()).get("origin") ?? requireEnv("BETTER_AUTH_URL");
  const drive = openDrive(access.accessToken);
  try {
    const sessions = await Promise.all(
      typed.map((file) => {
        return drive.openResumableSession({
          name: `${randomUUID()}.${receiptExtension(file.contentType)}`,
          parentId: access.folders.stagingFolderId,
          mimeType: file.contentType,
          size: file.size,
          origin,
          appProperties: { sugtPerjadinId: perjadinId },
        });
      }),
    );
    return { outcome: "ready", sessionUris: sessions.map((session) => session.sessionUri) };
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }
}

/** A receipt the server has checked in Drive, with what it really is. */
type VerifiedReceipt = { driveFileId: string; contentType: ReceiptContentType; byteSize: number };

/**
 * Check one uploaded file in Drive before it is recorded — the server never saw the bytes, and the
 * browser never had to tell the truth. It must sit in `_staging`, untrashed, carry this Perjadin's
 * `sugtPerjadinId`, and be no larger than the cap; then its first bytes must be a PDF or one of the
 * three images. The type is the sniff's and the size is Drive's.
 */
async function verifyReceipt(
  drive: DriveClient,
  stagingFolderId: string,
  perjadinId: string,
  driveFileId: string,
): Promise<VerifiedReceipt | "unverified" | "unsupported-type"> {
  const file = await drive.getFile(driveFileId);
  if (!isStagedUploadFor(file, stagingFolderId, perjadinId)) return "unverified";
  const contentType = sniffReceiptType(await drive.readRange(driveFileId, 0, SNIFF_LENGTH - 1));
  if (!contentType) return "unsupported-type";
  return { driveFileId, contentType, byteSize: file.size };
}

/**
 * Check a batch (`verifyReceipt` each). A file named twice counts once as verified and again as
 * unverified, so a batch can never attach one file twice. What a miss means is the caller's to
 * decide: a new line refuses on any, a row keeps what checked out.
 */
async function verifyBatch(
  drive: DriveClient,
  stagingFolderId: string,
  perjadinId: string,
  receipts: UploadedReceipt[],
): Promise<{ verified: VerifiedReceipt[]; unverified: number; unsupported: number }> {
  const ids = [...new Set(receipts.map((receipt) => receipt.driveFileId))];
  const checks = await Promise.all(
    ids.map((id) => verifyReceipt(drive, stagingFolderId, perjadinId, id)),
  );
  return {
    verified: checks.filter((check): check is VerifiedReceipt => typeof check === "object"),
    unverified:
      checks.filter((check) => check === "unverified").length + receipts.length - ids.length,
    unsupported: checks.filter((check) => check === "unsupported-type").length,
  };
}

/**
 * Reconcile a line whose rows are already written, and answer whether it synced. **Never throws**:
 * after the commit, a Drive failure the reconcile answers and a throw it does not are both "not yet
 * synced" — an error here would invite a retry that writes the receipts twice.
 */
async function reconcileAfterCommit(
  person: Person,
  drive: DriveClient,
  folders: ReadyFolders,
  transactionId: string,
): Promise<boolean> {
  return reconcileTransaction(person, drive, folders, transactionId).then(
    (reconciled) => reconciled.outcome === "synced",
    (error: unknown) => {
      console.error(`Reconcile of transaction ${transactionId} threw after its commit.`, error);
      return false;
    },
  );
}

/**
 * Record one line item against the Advance, **with the receipts the dialog has already uploaded to
 * Drive** (ADR-0039, ADR-0040). The write order is the ADR's:
 *
 * 1. **Check** — Staff, the Perjadin, the count, the amount, the connection — before any Drive call.
 *    The transaction's and each receipt's uuid are generated now, because the names need them.
 * 2. **Verify** each file (`verifyReceipt`). Any failure refuses the whole record.
 * 3. **Build** the transaction folder privately **inside `_staging`**, and rename and move each
 *    receipt into it.
 * 4. **Commit** the line, its evidence rows and its folder id in one write (`recordTransaction`).
 * 5. **Reconcile** — move the folder into the Perjadin's, share it, mark it synced. If that fails the
 *    line still stands: `synced: false`, never an error.
 *
 * A refusal before the commit leaves what it made in private `_staging`, unreferenced. ADR-0040
 * accepts that rather than build a cleanup, as ADR-0039 accepted orphans in the private bucket.
 */
export async function recordTransactionAction(
  input: TransactionToRecord,
): Promise<RecordTransactionActionResult> {
  const person = await requirePerson();

  if (!(await staffOnTrip(person, input.perjadinId))) return { outcome: "no-such-perjadin" };

  const { receipts, ...line } = input;
  if (receipts.length === 0) return { outcome: "evidence-missing" };
  if (receipts.length > MAX_RECEIPTS_PER_TRANSACTION) {
    return {
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
      count: receipts.length,
    };
  }
  // Refused here as well as in `recordTransaction`, so a zero amount never leaves a folder behind.
  if (!(line.amountIdr > 0)) return { outcome: "amount-not-positive" };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);
  const drive = openDrive(access.accessToken);
  const staging = access.folders.stagingFolderId;

  const transactionId = randomUUID();
  let evidence: (NewEvidence & VerifiedReceipt & { id: string })[];
  let driveFolderId: string;
  try {
    const checked = await verifyBatch(drive, staging, input.perjadinId, receipts);
    if (checked.unverified > 0)
      return { outcome: "receipt-unverified", failed: checked.unverified };
    if (checked.unsupported > 0) return { outcome: "unsupported-type" };
    evidence = checked.verified.map((receipt) => ({ ...receipt, id: randomUUID() }));

    const folderName = transactionFolderName(line.spentOn, line.category, transactionId);
    driveFolderId = (
      await drive.createFolder({
        name: folderName,
        parentId: staging,
        appProperties: { sugtPerjadinId: input.perjadinId, sugtTransactionId: transactionId },
      })
    ).id;
    await Promise.all(
      evidence.map((receipt) =>
        drive.updateFile(receipt.driveFileId, {
          name: evidenceFileName(
            line.spentOn,
            line.category,
            transactionId,
            receipt.id,
            receipt.contentType,
          ),
          addParent: driveFolderId,
          removeParent: staging,
          appProperties: { sugtTransactionId: transactionId },
        }),
      ),
    );
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }

  const result = await staffSurface(() =>
    recordTransaction(person, { ...line, transactionId, driveFolderId, evidence }),
  );
  if (result.outcome !== "recorded") return result;

  const synced = await reconcileAfterCommit(person, drive, access.folders, transactionId);
  revalidatePath(`/perjadin/${input.perjadinId}/laporan`);
  return { outcome: "recorded", transactionId, synced };
}

/**
 * Record receipts the browser has uploaded to Drive against a line that already exists — its row's
 * own **Unggah bukti** (ADR-0040, #374). The write order is the reverse of Catat transaksi's:
 *
 * 1. **Check** — Staff and the Perjadin (`staffOnTrip`), that the line is on it, that it has a slot
 *    for each file, and the connection — before any Drive call.
 * 2. **Verify** each file (`verifyBatch`). One that fails is counted and dropped; the rest go on —
 *    the line already stands, so a receipt that checks out is worth keeping.
 * 3. **Commit first**: `attachTransactionEvidence` locks the line `for update`, counts again, writes
 *    the rows and marks the line unsynced, in one transaction.
 * 4. **Then reconcile**: create the line's folders if it has none, move and name the new files out
 *    of `_staging`, share the folder if it is not yet, mark it synced.
 *
 * **Why the database goes first here.** The line's folder is usually **already public**. A file
 * moved in before the count was settled could become a sixth receipt anyone can open that no row
 * records. So the count and the rows come first, under the lock, and the files move after. If the
 * reconcile fails, the receipts **are** recorded and wait in private `_staging` for the next one.
 */
export async function finalizeReceiptsAction(
  perjadinId: string,
  transactionId: string,
  landed: UploadedReceipt[],
): Promise<FinalizeReceiptsResult> {
  const person = await requirePerson();

  if (!(await staffOnTrip(person, perjadinId))) return { outcome: "no-such-perjadin" };
  const existing = await receiptsOnLine(person, perjadinId, transactionId);
  if (existing === null) return { outcome: "no-such-transaction" };
  if (existing + landed.length > MAX_RECEIPTS_PER_TRANSACTION) {
    return { outcome: "too-many-receipts", limit: MAX_RECEIPTS_PER_TRANSACTION };
  }
  if (landed.length === 0) return { outcome: "attached", attached: 0, failed: 0, synced: true };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);
  const drive = openDrive(access.accessToken);

  let checked;
  try {
    checked = await verifyBatch(drive, access.folders.stagingFolderId, perjadinId, landed);
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }
  const failed = checked.unverified + checked.unsupported;
  if (checked.verified.length === 0)
    return { outcome: "attached", attached: 0, failed, synced: true };

  // The write's own refusals are returned rather than discarded. `no-such-transaction` is a stale
  // screen and `too-many-receipts` a line that would pass five — a second tab got there first under
  // the lock; both are reachable, and swallowing either would tell the PIC that receipts attached
  // when none did.
  const evidence = checked.verified.map((receipt) => ({ ...receipt, id: randomUUID() }));
  const result = await staffSurface(() =>
    attachTransactionEvidence(person, perjadinId, transactionId, evidence),
  );
  if (result.outcome === "no-such-transaction") return result;
  if (result.outcome === "too-many-receipts") {
    return { outcome: result.outcome, limit: result.limit };
  }

  const synced = await reconcileAfterCommit(person, drive, access.folders, transactionId);
  revalidatePath(`/perjadin/${perjadinId}/laporan`);
  return { outcome: "attached", attached: result.count, failed, synced };
}

/**
 * **Hapus bukti — delete one receipt from its line** (#462, ADR-0050). **The file is trashed first,
 * then the row**, as Dokumen Hapus does (ADR-0042), so a row never vanishes while its link-shared
 * file stays live:
 *
 * 1. **Guard** — Staff, the receipt and its trip's writer (ADR-0048) — then **the count**: a line's
 *    only receipt is refused here, with nothing trashed. Then the connection. All before any Drive
 *    call.
 * 2. **Trash the file.** One already in the trash, or gone, counts as done: a retry is safe. A
 *    receipt still unsynced is trashed from `_staging` the same way.
 * 3. **Delete the row and log `evidence_deleted`**, in one transaction, counting again under the
 *    line's lock (`deleteTransactionEvidence`). If that fails after the trash, the row stays,
 *    pointing at a trashed file; Hapus again ends it.
 * 4. **If the commit refuses the count** — a concurrent Hapus on the line won the race and this
 *    receipt is now its only one — **take the file back out of the trash**, so the surviving
 *    receipt's link opens, and refuse.
 */
export async function deleteReceiptAction(evidenceId: string): Promise<DeleteReceiptActionResult> {
  const person = await requirePerson();

  const target = await staffSurface(() => receiptDeleteTarget(person, evidenceId));
  if (!target) return { outcome: "no-such-receipt" };
  if (target.held <= 1) return { outcome: "only-receipt" };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);
  const drive = openDrive(access.accessToken);

  try {
    await trashIfLive(drive, target.driveFileId);
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }

  const result = await staffSurface(() => deleteTransactionEvidence(person, evidenceId));
  if (result.outcome === "only-receipt") {
    try {
      await untrashIfPresent(drive, target.driveFileId);
    } catch (error) {
      // The row stands with its file in the trash, which only restoring it by hand from the Drive
      // trash puts right — so say which file, for whoever does.
      console.error(`Receipt ${evidenceId} kept its row, but its file stayed in the trash.`, error);
      if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
      throw error;
    }
    return result;
  }
  if (result.outcome === "no-such-evidence") return { outcome: "no-such-receipt" };
  revalidatePath(`/perjadin/${result.perjadinId}/laporan`);
  return { outcome: "deleted" };
}

/**
 * File the Report.
 *
 * The evidence rule — every transaction carries at least one receipt — is held at entry since
 * ADR-0039, by `recordTransaction`. `filePerjadinReport` still checks it, as the backstop for lines
 * recorded before that rule, which no migration touched.
 */
export async function filePerjadinReportAction(
  perjadinId: string,
): Promise<FilePerjadinReportResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => filePerjadinReport(person, perjadinId));
  if (result.outcome === "filed") revalidatePath(`/perjadin/${perjadinId}/laporan`);
  return result;
}
