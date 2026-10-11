import type { DriveRefusal } from "-/lib/drive/upload-messages";
import type {
  AcquittalEvidence,
  AcquittalTransaction,
  NewTransaction,
  RecordTransactionResult,
} from "@sugt/db/queries";

/**
 * The shapes the Perjadin Report's Server Actions pass to and from the client. They live here
 * rather than in `actions.ts` because that file is `"use server"`: every one of its exports is a
 * callable Server Action, and a type is not one.
 */

/**
 * One receipt the browser has `PUT` to its Drive session, waiting to be verified and recorded as a
 * `transaction_evidence` row (ADR-0040): the id Drive answered the upload with.
 */
export type UploadedReceipt = { driveFileId: string };

/**
 * One file a receipt control is about to upload to Drive (ADR-0040): its size and type
 * **after** the browser compressed it. The server opens a session that declares exactly this size,
 * so Drive refuses anything longer, and re-checks both on the file Drive ends up holding.
 */
export type ReceiptToOpen = { size: number; contentType: string };

/** What `openReceiptSessionsAction` did: a session URI per file, in order, or why none. */
export type OpenReceiptSessionsResult =
  | { outcome: "ready"; sessionUris: string[] }
  | { outcome: "no-such-perjadin" }
  /** The row's upload named a line that is not on this Perjadin — a stale screen. */
  | { outcome: "no-such-transaction" }
  | { outcome: "evidence-missing" }
  | { outcome: "too-many-receipts"; limit: number; count: number }
  | { outcome: "too-large"; limit: number }
  | { outcome: "unsupported-type" }
  | DriveRefusal;

/**
 * What the Catat transaksi dialog sends once every receipt has landed in Drive: the line's fields,
 * and the Drive file id each upload came back with. The action verifies each file in Drive and hands
 * the line and its evidence to `recordTransaction` together (ADR-0039, ADR-0040).
 */
export type TransactionToRecord = Omit<
  NewTransaction,
  "evidence" | "transactionId" | "driveFolderId"
> & {
  receipts: UploadedReceipt[];
};

/**
 * What `recordTransactionAction` did. The query's refusals, plus the ones only the action can see:
 * a receipt that is not what it claims (`receipt-unverified`: not this Perjadin's, not in `_staging`,
 * trashed, over the cap; `unsupported-type`: its first bytes are no PDF or image) and Drive itself
 * being unusable. **Every one of those records nothing.**
 *
 * `recorded` carries `synced`: false when the line and its receipts are written but the reconcile
 * could not finish putting them in place — never an error, since the line stands.
 */
export type RecordTransactionActionResult =
  | { outcome: "recorded"; transactionId: string; synced: boolean }
  | Exclude<RecordTransactionResult, { outcome: "recorded" }>
  | { outcome: "receipt-unverified"; failed: number }
  | { outcome: "unsupported-type" }
  | DriveRefusal;

/**
 * What `finalizeReceiptsAction` recorded — the row's own Unggah bukti (ADR-0040, #374).
 *
 * `failed` counts the files that did not pass the check in Drive — not this Perjadin's, not in
 * `_staging`, trashed, over the cap, or no PDF or image by their first bytes. **Partial success is
 * real here**: the line already stands, so a receipt that checks out is worth keeping, and the
 * failures are reported, not swallowed. (Recording a new line is the opposite: any failure refuses
 * it.) `synced` is false when the receipts are recorded but the reconcile could not yet move them
 * into the line's folder — never an error.
 *
 * The refusals are the query layer's own, passed through rather than swallowed. The two stale
 * screens are reachable, and so is a batch that would take the line past five receipts (ADR-0039)
 * — a second tab, or a line grandfathered with more — so all come back as values by the rule the
 * query layer settled.
 */
export type FinalizeReceiptsResult =
  | { outcome: "attached"; attached: number; failed: number; synced: boolean }
  | { outcome: "no-such-transaction" }
  | { outcome: "no-such-perjadin" }
  /** The batch would take the line past `limit` receipts, or is larger than one line may carry. */
  | { outcome: "too-many-receipts"; limit: number }
  | DriveRefusal;

/**
 * What `deleteReceiptAction` did (#462, ADR-0050): the file trashed and the row gone, or why not.
 * Every refusal leaves the receipt listed and, but for one rare double failure, its file where it
 * was: a Hapus that lost the race to the line's last receipt, and whose file Drive then would not
 * take back out of the trash, answers `drive-unreachable` with that file still trashed.
 */
export type DeleteReceiptActionResult =
  | { outcome: "deleted" }
  /** Already deleted — a second Hapus, or a stale screen. */
  | { outcome: "no-such-receipt" }
  /** The line's only receipt (ADR-0039): a line keeps at least one. */
  | { outcome: "only-receipt" }
  | DriveRefusal;

/**
 * One receipt as the screen renders it: the row, minus its Drive id, plus the link to the file in
 * Drive (ADR-0040), opened in a new tab — the app renders nothing of the file. The link opens for
 * anyone once its transaction folder is shared.
 *
 * The acquittal is an open money read (ADR-0026, #180), so any signed-in Person who reads it gets
 * these links. Reading is open; the money *writes* on this surface stay Staff-only in their own
 * Server Actions.
 */
export type ReceiptLink = Omit<AcquittalEvidence, "driveFileId" | "uploadedAt"> & {
  url: string;
};

/**
 * One line item as the screen renders it, with its Drive folder as a link when it has one, and
 * `unsynced` when a receipt on it is still waiting to be put in place (ADR-0040) — never for a
 * zero-receipt line.
 */
export type ViewableTransaction = Omit<
  AcquittalTransaction,
  "evidence" | "driveFolderId" | "driveSyncedAt"
> & {
  evidence: ReceiptLink[];
  folderUrl: string | null;
  unsynced: boolean;
};
