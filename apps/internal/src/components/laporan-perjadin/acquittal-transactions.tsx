"use client";

import type {
  OpenReceiptSessionsResult,
  UploadedReceipt,
  ViewableTransaction,
} from "-/app/(app)/perjadin/[id]/laporan/action-types";
import {
  deleteReceiptAction,
  deleteTransactionAction,
  finalizeReceiptsAction,
  openReceiptSessionsAction,
} from "-/app/(app)/perjadin/[id]/laporan/actions";
import {
  DEFAULT_TRANSACTION_LIST_CONTROLS,
  sortAndFilterTransactions,
  type CategoryFilter,
  type ParticipantFilter,
  type SortDirection,
} from "-/components/laporan-perjadin/acquittal-transactions-sort";
import {
  ONLY_RECEIPT,
  RECEIPT_DELETE_CONFIRM,
  receiptDeleteRefusalText,
} from "-/components/laporan-perjadin/receipt-delete-messages";
import { TRANSACTION_DELETE_CONFIRM } from "-/components/laporan-perjadin/transaction-delete-messages";
import { UnsyncedMarker } from "-/components/unsynced-marker";
import { UploadStatus, useLeaveWarning, type UploadProgress } from "-/components/upload-status";
import {
  prepareReceipt,
  putToDriveSession,
  RECEIPT_ACCEPT,
  UPLOAD_TOO_LARGE,
  UNSUPPORTED_RECEIPT,
  type PreparedReceipt,
} from "-/lib/drive/receipt-upload";
import type { UploadGate } from "-/lib/drive/upload-gate";
import {
  driveRefusalText,
  RECEIPTS_UNSYNCED_TOOLTIP,
  STALE_PAGE,
} from "-/lib/drive/upload-messages";
import {
  formatRupiah,
  MAX_RECEIPTS_PER_TRANSACTION,
  TRANSACTION_CATEGORIES,
  TRANSACTION_PARTICIPANT_TYPES,
} from "@sugt/domain";
import { Badge } from "@sugt/ui/components/badge";
import { Button } from "@sugt/ui/components/button";
import { Card, CardHeader } from "@sugt/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { useMemo, useRef, useState, useTransition } from "react";

/**
 * **The line items already recorded, and what a PIC does to them**: add receipts to one, take a
 * mistaken receipt off one (#462), and delete a mistaken one whole (#463). **Nothing records a new
 * line here or anywhere** (#541): Finance records trip spending outside the app. These controls stay
 * because without them, wrong lines and missing receipts would be permanent in the record the
 * external audit uses.
 *
 * A row's "Unggah bukti" adds receipts up to five in total, and serves a line from before ADR-0039
 * that has none. It already has a `transactionId`, so it attaches as it uploads.
 *
 * The five-receipt ceiling is held by the server (`attachTransactionEvidence`); the disabled buttons
 * here only keep the form from offering the mistake. A row with no receipt can still appear — a
 * grandfathered line — and is marked, so its writer can Unggah bukti onto it.
 *
 * **While Drive cannot take an upload** — not connected, broken, or its folders unresolved — every
 * row's Unggah bukti and Hapus render disabled, and the reason is said once above the rows. The Server
 * Actions refuse the same states themselves.
 */
function AcquittalTransactions({
  perjadinId,
  transactions,
  uploadGate,
  canWrite,
}: {
  perjadinId: string;
  transactions: ViewableTransaction[];
  uploadGate: UploadGate;
  /**
   * Whether the viewer writes this trip — its Group, a Perjadin Editor or an Administrator (ADR-0048). Every
   * Unggah bukti and Hapus is absent for anyone else, who reads the lines and their receipts; the
   * queries refuse them again.
   */
  canWrite: boolean;
}) {
  // Sort/filter is a lens on the rendered list only. The list is bounded and already fully loaded,
  // so this is in-memory (no server round-trip, unlike `/feedback`); the Laporan money figures and
  // the CSV export are computed from the full set upstream and are deliberately not routed through
  // `visible`.
  const [amountSort, setAmountSort] = useState<SortDirection>(
    DEFAULT_TRANSACTION_LIST_CONTROLS.amountSort,
  );
  const [dateSort, setDateSort] = useState<SortDirection>(
    DEFAULT_TRANSACTION_LIST_CONTROLS.dateSort,
  );
  const [participantFilter, setParticipantFilter] = useState<ParticipantFilter>(
    DEFAULT_TRANSACTION_LIST_CONTROLS.participantFilter,
  );
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(
    DEFAULT_TRANSACTION_LIST_CONTROLS.categoryFilter,
  );

  const visible = useMemo(
    () =>
      sortAndFilterTransactions(transactions, {
        amountSort,
        dateSort,
        participantFilter,
        categoryFilter,
      }),
    [transactions, amountSort, dateSort, participantFilter, categoryFilter],
  );

  return (
    <div className="border-b border-border px-4 py-5 sm:px-7">
      <h2 className="font-heading text-sm font-medium">Transaksi</h2>
      {/* It explains the rows' disabled controls, so with no row there is nothing for it to explain. */}
      {canWrite && !uploadGate.open && transactions.length > 0 && (
        <p className="mt-1.5 text-sm text-muted-foreground">{uploadGate.reason}</p>
      )}

      {transactions.length === 0 ? (
        <p className="mt-2.5 text-sm text-muted-foreground">
          Belum ada transaksi pada Perjadin ini.
        </p>
      ) : (
        <>
          {/* Two sort dropdowns — amount primary, date tiebreak — both always active, no "off" arm. */}
          <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ControlSelect
              ariaLabel="Urutkan jumlah"
              options={AMOUNT_SORT_OPTIONS}
              value={amountSort}
              onChange={setAmountSort}
            />
            <ControlSelect
              ariaLabel="Urutkan tanggal"
              options={DATE_SORT_OPTIONS}
              value={dateSort}
              onChange={setDateSort}
            />
          </div>

          {/* Two exact-match filters, ANDed; each defaults to "Semua" (no predicate on that axis). */}
          <div className="mt-3 mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ControlSelect
              ariaLabel="Saring tipe peserta"
              options={PARTICIPANT_FILTER_OPTIONS}
              value={participantFilter}
              onChange={setParticipantFilter}
            />
            <ControlSelect
              ariaLabel="Saring kategori"
              options={CATEGORY_FILTER_OPTIONS}
              value={categoryFilter}
              onChange={setCategoryFilter}
            />
          </div>

          {visible.length === 0 ? (
            // Distinct from the "no transactions at all" state above: the filters hid everything.
            <p className="text-sm text-muted-foreground">Tidak ada transaksi yang cocok</p>
          ) : (
            <ul className="space-y-3">
              {visible.map((line) => (
                <li key={line.id}>
                  <TransactionCard
                    perjadinId={perjadinId}
                    line={line}
                    uploadGate={uploadGate}
                    canWrite={canWrite}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One line item as a card, in the `/feedback` header style: date · description · category, a badge
 * for the cohort it served, and — pushed right — the amount and the existing receipts block. Nothing
 * the old row carried is dropped; there is no rating, so no `destructive` badge.
 */
function TransactionCard({
  perjadinId,
  line,
  uploadGate,
  canWrite,
}: {
  perjadinId: string;
  line: ViewableTransaction;
  uploadGate: UploadGate;
  canWrite: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground tabular-nums">{line.spentOn}</span>
          <span className="text-muted-foreground">·</span>
          <span>{line.description}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{line.category}</span>
          <Badge variant="secondary">{line.participantType}</Badge>
          {line.unsynced && <UnsyncedMarker explanation={RECEIPTS_UNSYNCED_TOOLTIP} />}
          {/* Wraps under the line on a phone rather than pushing the card sideways (#418). */}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="tabular-nums">{formatRupiah(line.amountIdr)}</span>
            <Receipts
              perjadinId={perjadinId}
              line={line}
              uploadGate={uploadGate}
              canWrite={canWrite}
            />
            {canWrite && (
              <DeleteTransaction
                transactionId={line.id}
                label={`${line.spentOn} · ${line.description}`}
                uploadGate={uploadGate}
              />
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

/**
 * **Hapus** on one line, behind a confirmation (#463, ADR-0050). Its folder and receipts go to the
 * Drive trash first, then the line, and the page revalidates.
 */
function DeleteTransaction({
  transactionId,
  label,
  uploadGate,
}: {
  transactionId: string;
  /** Which line, for a screen reader: every row's Hapus would otherwise read the same. */
  label: string;
  uploadGate: UploadGate;
}) {
  return (
    <ConfirmHapus
      ariaLabel={`Hapus transaksi ${label}`}
      size="sm"
      title="Hapus transaksi"
      description={TRANSACTION_DELETE_CONFIRM}
      uploadGate={uploadGate}
      run={async () => {
        const result = await deleteTransactionAction(transactionId);
        if (result.outcome === "deleted" || result.outcome === "no-such-transaction") return null;
        return driveRefusalText(result);
      }}
    />
  );
}

/** The label maps for the four controls. Sort keys are the direction; each filter carries "Semua". */
const AMOUNT_SORT_OPTIONS = { desc: "Termahal", asc: "Termurah" } satisfies Record<
  SortDirection,
  string
>;
const DATE_SORT_OPTIONS = { desc: "Terbaru", asc: "Terlama" } satisfies Record<
  SortDirection,
  string
>;

/** Self-labelled options for a closed value set — keeps the two filters in step with `@sugt/domain`. */
function labelSelf<T extends string>(values: readonly T[]): Record<T, string> {
  const options = {} as Record<T, string>;
  for (const value of values) options[value] = value;
  return options;
}

const PARTICIPANT_FILTER_OPTIONS: Record<ParticipantFilter, string> = {
  Semua: "Semua",
  ...labelSelf(TRANSACTION_PARTICIPANT_TYPES),
};
const CATEGORY_FILTER_OPTIONS: Record<CategoryFilter, string> = {
  Semua: "Semua",
  ...labelSelf(TRANSACTION_CATEGORIES),
};

/**
 * One control dropdown — the `/feedback` `SortSelect`/`FilterSelect` shape, unified because a sort
 * and a filter here are the same widget over an options map with a value that is always a valid key
 * (so no placeholder branch). No `disabled`: the work is in-memory, nothing is ever pending.
 */
function ControlSelect<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        onChange(next as T);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(options) as [T, string][]).map(([key, label]) => (
          <SelectItem
            key={key}
            value={key}
          >
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The receipts on one line item, and the upload that adds to them.
 *
 * Each receipt is a **Bukti n** link that opens it in Google Drive in a new tab (ADR-0040), and a
 * line with a Drive folder adds **Buka folder**, the link anyone can open once the folder is shared.
 *
 * The upload goes straight to Drive (ADR-0040): each file prepared in the
 * browser, a session opened per file, the bytes `PUT` straight to Drive. Then `finalizeReceiptsAction`
 * checks each file in Drive and records the ones that pass — **partial success is real here**, since
 * the line already stands — and moves them into the line's folder.
 *
 * A line holds at most `MAX_RECEIPTS_PER_TRANSACTION` in total, so a pick is cut to the slots left
 * and the button is disabled once there are none. A mistaken upload is taken off with the **Hapus**
 * beside its link (#462, ADR-0050), which frees its slot — but never the line's only receipt.
 */
function Receipts({
  perjadinId,
  line,
  uploadGate,
  canWrite,
}: {
  perjadinId: string;
  line: ViewableTransaction;
  uploadGate: UploadGate;
  /** Unggah bukti is offered only to whoever writes the trip (ADR-0048); the links are everyone's. */
  canWrite: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [uploading, startUploading] = useTransition();
  // What the upload is doing, said inline under the row while it runs (#420). Read only while
  // `uploading`, so a finished upload's last value never shows.
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // Negative for a line grandfathered with more than five; it gains nothing either way.
  const slotsLeft = MAX_RECEIPTS_PER_TRANSACTION - line.evidence.length;
  useLeaveWarning(uploading);

  function upload(files: File[]) {
    const batch = files.slice(0, Math.max(0, slotsLeft));
    // Set before the transition, not inside it: React holds an async transition's updates made
    // before its first `await` until the whole action ends, so the status would never show and the
    // last attempt's note would stay beside it.
    setProgress({ phase: "uploading", done: 0, total: batch.length });
    setNote(null);
    startUploading(async () => {
      const notes: string[] = [];
      if (batch.length < files.length) {
        notes.push(`${files.length - batch.length} berkas tidak diunggah: ${CAP_NOTE}`);
      }

      if (batch.length > 0) {
        const { prepared, unsupported, tooLarge } = await prepareAll(batch);
        if (unsupported > 0) notes.push(`${unsupported} berkas: ${UNSUPPORTED_RECEIPT}`);
        if (tooLarge > 0) notes.push(`${tooLarge} berkas: ${UPLOAD_TOO_LARGE}`);

        if (prepared.length > 0) {
          setProgress({ phase: "uploading", done: 0, total: prepared.length });
          const sent = await uploadToDrive(perjadinId, prepared, {
            transactionId: line.id,
            onFileDone: () => {
              setProgress(oneMoreDone);
            },
          });
          if ("refusal" in sent) {
            setNote([...notes, sent.refusal].join(" "));
            return;
          }
          let failed = sent.failed;

          if (sent.landed.length > 0) {
            setProgress({ phase: "saving" });
            const result = await finalizeReceiptsAction(perjadinId, line.id, sent.landed);
            // The write's refusals are answered rather than counted as upload failures: none of
            // them means a file did not reach Drive.
            // A refusal is said after anything already noted about the batch, not instead of it.
            if (result.outcome === "too-many-receipts") {
              setNote([...notes, CAP_NOTE].join(" "));
              return;
            }
            if (result.outcome === "no-such-perjadin" || result.outcome === "no-such-transaction") {
              setNote([...notes, STALE_PAGE].join(" "));
              return;
            }
            if (result.outcome !== "attached") {
              setNote([...notes, driveRefusalText(result)].join(" "));
              return;
            }
            failed += result.failed;
            if (!result.synced && result.attached > 0) notes.push(UNSYNCED_NOTE);
          }
          // Partial success is real — several files upload independently and one can fail while
          // the rest land — so it is reported rather than swallowed.
          if (failed > 0) notes.push(`${failed} berkas gagal diunggah.`);
        }
      }

      if (notes.length > 0) setNote(notes.join(" "));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {line.evidence.length === 0 ? (
        <span className="text-muted-foreground">Belum ada bukti</span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          {line.evidence.map((file, index) => (
            <span
              key={file.id}
              className="flex items-center gap-0.5"
            >
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                Bukti {index + 1}
              </a>
              {canWrite && (
                <DeleteReceipt
                  evidenceId={file.id}
                  label={`Bukti ${index + 1}`}
                  onlyReceipt={line.evidence.length <= 1}
                  uploadGate={uploadGate}
                />
              )}
            </span>
          ))}
        </span>
      )}
      {line.folderUrl !== null && (
        <a
          href={line.folderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:no-underline"
        >
          Buka folder
        </a>
      )}

      {canWrite && (
        <>
          <input
            ref={picker}
            type="file"
            accept={RECEIPT_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length > 0) upload(files);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading || slotsLeft <= 0 || !uploadGate.open}
            title={uploadGate.open ? undefined : uploadGate.reason}
            onClick={() => picker.current?.click()}
          >
            Unggah bukti
          </Button>
        </>
      )}

      {uploading && progress !== null && (
        <UploadStatus
          inline
          progress={progress}
          className="basis-full"
        />
      )}
      {note !== null && <span className="text-destructive">{note}</span>}
    </div>
  );
}

/**
 * **Hapus** beside one receipt, behind a confirmation (#462, ADR-0050). The file goes to the Drive
 * trash first, then the row, and the page revalidates. On a line's only receipt the dialog says why
 * it cannot go instead of asking — the server refuses it too.
 */
function DeleteReceipt({
  evidenceId,
  label,
  onlyReceipt,
  uploadGate,
}: {
  evidenceId: string;
  label: string;
  /** The line's only receipt: the dialog says why it cannot go instead of asking. */
  onlyReceipt: boolean;
  uploadGate: UploadGate;
}) {
  return (
    <ConfirmHapus
      ariaLabel={`Hapus ${label}`}
      size="xs"
      title="Hapus bukti"
      description={onlyReceipt ? ONLY_RECEIPT : RECEIPT_DELETE_CONFIRM}
      refused={onlyReceipt}
      uploadGate={uploadGate}
      run={async () => {
        const result = await deleteReceiptAction(evidenceId);
        if (result.outcome === "deleted" || result.outcome === "no-such-receipt") return null;
        return receiptDeleteRefusalText(result);
      }}
    />
  );
}

/**
 * The confirmation both Hapus on the Laporan open. Disabled with the gate's reason while Drive
 * cannot take it, as Unggah bukti is. `run` answers what to say when the server refuses, or `null`
 * to close — deleted, or already gone. `refused` is a delete known to be refused before it is
 * asked: the dialog only explains, with no Hapus to press.
 */
function ConfirmHapus({
  ariaLabel,
  size,
  title,
  description,
  refused = false,
  uploadGate,
  run,
}: {
  ariaLabel: string;
  size: "xs" | "sm";
  title: string;
  description: string;
  refused?: boolean;
  uploadGate: UploadGate;
  run: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();

  function submit() {
    startDeleting(async () => {
      setRefusal(null);
      const said = await run();
      if (said === null) setOpen(false);
      else setRefusal(said);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setRefusal(null);
      }}
    >
      <DialogTrigger
        disabled={!uploadGate.open}
        title={uploadGate.open ? undefined : uploadGate.reason}
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label={ariaLabel}
          >
            Hapus
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {refusal !== null && <p className="text-sm text-destructive">{refusal}</p>}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            {refused ? "Tutup" : "Batal"}
          </Button>
          {!refused && (
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={submit}
            >
              {deleting ? "Menghapus…" : "Hapus"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Get each picked file into shape for Drive (`prepareReceipt`): images re-encoded, EXIF stripped, the
 * cap applied. What could not be prepared is counted by reason; each caller decides what that means.
 */
async function prepareAll(
  files: File[],
): Promise<{ prepared: PreparedReceipt[]; unsupported: number; tooLarge: number }> {
  const results = await Promise.all(files.map(prepareReceipt));
  return {
    prepared: results.filter((result): result is PreparedReceipt => typeof result === "object"),
    unsupported: results.filter((result) => result === "unsupported-type").length,
    tooLarge: results.filter((result) => result === "too-large").length,
  };
}

/**
 * Send prepared receipts to Drive (ADR-0040). The server opens a session per file for
 * `transactionId`'s line, which also checks the line has a slot for each, then each file's bytes go
 * straight to its session. Answers the Drive ids that landed and how many did not, or the sentence for
 * why no session opened.
 *
 * It records nothing: the row hands `landed` to `finalizeReceiptsAction`. `onFileDone` fires as each
 * file's `PUT` settles, landed or not, so the upload status can count them (#420).
 */
async function uploadToDrive(
  perjadinId: string,
  prepared: PreparedReceipt[],
  { transactionId, onFileDone }: { transactionId: string; onFileDone: () => void },
): Promise<{ landed: UploadedReceipt[]; failed: number } | { refusal: string }> {
  const sessions = await openReceiptSessionsAction(
    perjadinId,
    prepared.map((file) => ({ size: file.blob.size, contentType: file.contentType })),
    transactionId,
  );
  if (sessions.outcome !== "ready") return { refusal: sessionRefusalFor(sessions) };

  const ids = await Promise.all(
    prepared.map((file, index) =>
      putToDriveSession(sessions.sessionUris[index]!, file.blob).finally(onFileDone),
    ),
  );
  const landed = ids.flatMap((driveFileId) => (driveFileId ? [{ driveFileId }] : []));
  return { landed, failed: ids.length - landed.length };
}

/** One more file finished, for a `setProgress` updater; anything but the upload phase is left alone. */
function oneMoreDone(progress: UploadProgress | null): UploadProgress | null {
  return progress?.phase === "uploading" ? { ...progress, done: progress.done + 1 } : progress;
}

/** The five-receipt ceiling, as each place that meets it says it. */
const CAP_NOTE = `Maksimal ${MAX_RECEIPTS_PER_TRANSACTION} bukti per transaksi.`;

/** The line stands, but the reconcile did not finish in Drive; the next one will. */
const UNSYNCED_NOTE =
  "Bukti belum tersinkron ke Google Drive. Sinkronisasi akan diselesaikan kemudian; tidak ada yang perlu diulang.";

/** What each refusal to open upload sessions says. Nothing has been uploaded yet. */
function sessionRefusalFor(result: Exclude<OpenReceiptSessionsResult, { outcome: "ready" }>) {
  switch (result.outcome) {
    case "no-such-perjadin":
    case "no-such-transaction":
      return STALE_PAGE;
    case "evidence-missing":
      return "Lampirkan setidaknya satu bukti.";
    case "too-many-receipts":
      return CAP_NOTE;
    case "too-large":
      return UPLOAD_TOO_LARGE;
    case "unsupported-type":
      return UNSUPPORTED_RECEIPT;
    default:
      return driveRefusalText(result);
  }
}

export { AcquittalTransactions };
