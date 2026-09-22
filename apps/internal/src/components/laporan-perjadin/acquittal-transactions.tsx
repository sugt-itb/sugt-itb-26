"use client";

import {
  MAX_RECEIPT_BATCH,
  type ViewableTransaction,
} from "-/app/(app)/perjadin/[id]/laporan/action-types";
import {
  finalizeReceiptsAction,
  mintReceiptUploadsAction,
  recordTransactionAction,
} from "-/app/(app)/perjadin/[id]/laporan/actions";
import {
  DEFAULT_TRANSACTION_LIST_CONTROLS,
  sortAndFilterTransactions,
  type CategoryFilter,
  type ParticipantFilter,
  type SortDirection,
} from "-/components/laporan-perjadin/acquittal-transactions-sort";
import {
  formatIdr,
  TRANSACTION_CATEGORIES,
  TRANSACTION_PARTICIPANT_TYPES,
  type TransactionCategory,
  type TransactionParticipantType,
} from "@sugt/domain";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
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
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { type ReactElement, useId, useMemo, useRef, useState, useTransition } from "react";

/**
 * **The line items, and the two things a PIC does to them**: enter one, and attach the receipts
 * that evidence it.
 *
 * Receipts attach by two paths, both first-class. The row carries an "Unggah bukti" for evidence
 * that arrives after the line is logged — a fare photographed on the pavement, uploaded that
 * evening. The entry form carries the same control for evidence already in hand at the moment of
 * entry, so a PIC working through a folder of receipts after returning records the line and its
 * proof in one step. ADR-0007 rests on both post-trip and on-the-spot entry being equally easy;
 * ADR-0030 records that attaching at entry time is now a first-class path alongside the row one —
 * it serves that folder-of-receipts case — without weakening the row path, which stays exactly as
 * it was.
 *
 * The order is forced by the schema: a receipt's row FKs a `transaction` that does not exist until
 * the line is inserted, so the entry form *stages* its files and uploads them only after the record
 * lands. `Receipts` (the row path) already has a `transactionId`, so it uploads straight away.
 *
 * **Nothing here checks the evidence rule.** "Every transaction has at least one piece of evidence"
 * is checked when the Report is filed and nowhere else — a row with no receipt is an ordinary state
 * on this screen, marked but never refused.
 */
function AcquittalTransactions({
  perjadinId,
  transactions,
}: {
  perjadinId: string;
  transactions: ViewableTransaction[];
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
    <div className="border-b border-border px-7 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-medium">Transaksi</h2>
        <RecordTransaction perjadinId={perjadinId} />
      </div>

      {transactions.length === 0 ? (
        <p className="mt-2.5 text-sm text-muted-foreground">
          Belum ada transaksi terhadap Uang Perjalanan ini.
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
function TransactionCard({ perjadinId, line }: { perjadinId: string; line: ViewableTransaction }) {
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
          <div className="ml-auto flex items-center gap-4">
            <span className="tabular-nums">Rp {formatIdr(line.amountIdr)}</span>
            <Receipts
              perjadinId={perjadinId}
              line={line}
            />
          </div>
        </div>
      </CardHeader>
    </Card>
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
 * The bytes go straight from the browser to Storage through a signed URL the server mints, so a
 * photograph taken on a phone is not bound by the platform's function body limit. Each landed
 * object is then recorded by a second call, which reads its real content type and size back from
 * Storage rather than believing what this component said about them.
 */
function Receipts({ perjadinId, line }: { perjadinId: string; line: ViewableTransaction }) {
  const [note, setNote] = useState<string | null>(null);
  const [uploading, startUploading] = useTransition();
  const picker = useRef<HTMLInputElement>(null);

  function upload(files: File[]) {
    startUploading(async () => {
      setNote(null);
      const batch = files.slice(0, MAX_RECEIPT_BATCH);

      // The mint throws when the trip is gone, which is a page left open while somebody
      // deleted it in another tab. Caught here rather than left to become an unhandled
      // rejection: the component already knows how to say "muat ulang halaman".
      let targets;
      try {
        targets = await mintReceiptUploadsAction(perjadinId, batch.length);
      } catch {
        setNote(STALE_PAGE);
        return;
      }

      const landed: { path: string }[] = [];
      let failed = 0;
      await Promise.all(
        batch.map(async (file, index) => {
          const target = targets[index];
          if (!target) {
            failed += 1;
            return;
          }
          try {
            const response = await fetch(target.signedUrl, {
              method: "PUT",
              headers: { "content-type": file.type || "application/octet-stream" },
              body: file,
            });
            if (!response.ok) throw new Error(`PUT ${response.status}`);
            landed.push({ path: target.path });
          } catch {
            failed += 1;
          }
        }),
      );

      if (landed.length > 0) {
        const result = await finalizeReceiptsAction(perjadinId, line.id, landed);
        // The write's refusals are answered rather than counted as upload failures. Both
        // mean the page is stale, and neither means a file did not reach Storage.
        if (result.outcome !== "attached") {
          setNote(STALE_PAGE);
          return;
        }
        failed += result.failed;
      }
      // Partial success is real — several files upload independently and one can fail while
      // the rest land — so it is reported rather than swallowed.
      if (failed > 0) setNote(`${failed} berkas gagal diunggah.`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {line.evidence.length === 0 ? (
        <span className="text-muted-foreground">Belum ada bukti</span>
      ) : (
        <span className="flex items-center gap-2">
          {line.evidence.map((file, index) =>
            file.url === null ? (
              // The row exists and its object does not. Said out loud, because a silently
              // missing receipt is what the filing check will refuse without explaining.
              <span
                key={file.id}
                className="text-destructive"
              >
                Bukti {index + 1} hilang
              </span>
            ) : (
              <a
                key={file.id}
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="underline hover:no-underline"
              >
                Bukti {index + 1}
              </a>
            ),
          )}
        </span>
      )}

      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf"
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
        disabled={uploading}
        onClick={() => picker.current?.click()}
      >
        {uploading ? "Mengunggah…" : "Unggah bukti"}
      </Button>

      {note !== null && <span className="text-destructive">{note}</span>}
    </div>
  );
}

/** The entry form. One line item at a time, which is how a PIC has them. */
function RecordTransaction({
  perjadinId,
  trigger,
}: {
  perjadinId: string;
  // An optional custom trigger so a card elsewhere can open this exact entry form from its own
  // control. Omitted, the default "Catat transaksi" button renders and `AcquittalTransactions`
  // behaves exactly as before — it still mounts `<RecordTransaction perjadinId={perjadinId} />`.
  trigger?: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [spentOn, setSpentOn] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<TransactionCategory | "">("");
  const [participantType, setParticipantType] = useState<TransactionParticipantType | "">("");
  // Files chosen but not yet uploaded — the entry form has no `transactionId` to attach them to
  // until its own insert lands, so they wait here until `submit` has one.
  const [staged, setStaged] = useState<File[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Distinct from `refusal`: the transaction was recorded and it is the receipts that did not land.
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const picker = useRef<HTMLInputElement>(null);
  const fields = useId();

  const complete =
    spentOn !== "" &&
    description.trim() !== "" &&
    amount !== "" &&
    category !== "" &&
    participantType !== "";

  function reset() {
    setSpentOn("");
    setDescription("");
    setAmount("");
    setCategory("");
    setParticipantType("");
    setStaged([]);
  }

  function submit() {
    startSaving(async () => {
      setRefusal(null);
      setUploadNote(null);
      const result = await recordTransactionAction({
        perjadinId,
        spentOn,
        description: description.trim(),
        // Whole rupiah, which is what the column holds. `amount` holds raw digits (the mask
        // strips everything else on change), so `Number` is finite or `NaN`, and `NaN` fails the
        // positivity check.
        amountIdr: Math.trunc(Number(amount)),
        category: category as TransactionCategory,
        participantType: participantType as TransactionParticipantType,
      });

      // The insert failed, so nothing is uploaded — staged files stay staged, and there is no
      // orphan object in Storage or evidence row against a line that was never written.
      if (result.outcome !== "recorded") {
        setRefusal(REFUSALS[result.outcome]);
        return;
      }

      // The line is in. Only now, and only if any were staged, do the receipts — recording with
      // none is unchanged. Errors past this point are not refusals: the transaction stands.
      if (staged.length > 0) {
        const note = await attachStagedReceipts(perjadinId, result.transactionId, staged);
        if (note !== null) {
          // Said out loud rather than swallowed: the line is recorded (the page behind will show
          // it) but its proof did not attach. The form is cleared so a second "Catat" cannot log
          // the same line again; the row's own "Unggah bukti" is where the receipts go from here.
          setUploadNote(note);
          reset();
          return;
        }
      }

      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Clear stale alerts when the form is reopened, so a prior refusal or upload note does not
        // greet the next entry.
        if (next) {
          setRefusal(null);
          setUploadNote(null);
        }
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button
              variant="outline"
              size="sm"
            >
              Catat transaksi
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat transaksi</DialogTitle>
          <DialogDescription>
            Satu pengeluaran terhadap Uang Perjalanan. Bukti bisa dilampirkan menyusul.
          </DialogDescription>
        </DialogHeader>

        {refusal !== null && (
          <Alert variant="destructive">
            <AlertTitle>Transaksi belum tercatat.</AlertTitle>
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}

        {uploadNote !== null && (
          <Alert variant="destructive">
            <AlertTitle>Transaksi tercatat, bukti belum terlampir.</AlertTitle>
            <AlertDescription>
              {uploadNote} Muat ulang halaman, lalu lampirkan lewat baris transaksinya.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor={`${fields}-spent-on`}>Tanggal</Label>
            <Input
              id={`${fields}-spent-on`}
              type="date"
              value={spentOn}
              onChange={(event) => {
                setSpentOn(event.target.value);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${fields}-description`}>Keterangan</Label>
            <Input
              id={`${fields}-description`}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${fields}-amount`}>Jumlah (Rp)</Label>
            {/*
              A masked text input, not `type="number"`: it groups the thousands as they type so a
              large amount's magnitude is legible at the point of entry — the same pattern the plan
              form's Uang Perjalanan uses. `amount` stays a plain digit string in state; every non-digit
              is stripped back out on change, so submit's `Number(...)` and the `complete` guard are
              unchanged.
            */}
            <Input
              id={`${fields}-amount`}
              type="text"
              inputMode="numeric"
              value={amount === "" ? "" : `Rp ${formatIdr(Number(amount))}`}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
                setAmount(digits);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${fields}-category`}>Kategori</Label>
            {/*
              The twelve come from `@sugt/domain`, which is the same list `transaction_category_check`
              pins in the database. There is no "other" beyond `Lainnya`, which is in the list.
            */}
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value as TransactionCategory);
              }}
            >
              <SelectTrigger id={`${fields}-category`}>
                <SelectValue placeholder="Pilih kategori" />
              </SelectTrigger>
              <SelectContent>
                {TRANSACTION_CATEGORIES.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}
                  >
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${fields}-participant-type`}>Tipe Peserta</Label>
            {/*
              An axis orthogonal to Kategori — which cohort the spend served. The two values come
              from `@sugt/domain`, the same list `transaction_participant_type_check` pins in the
              database. Required, so there is no empty option: a shared cost is attributed to
              whichever type it predominantly served.
            */}
            <Select
              value={participantType}
              onValueChange={(value) => {
                setParticipantType(value as TransactionParticipantType);
              }}
            >
              <SelectTrigger id={`${fields}-participant-type`}>
                <SelectValue placeholder="Pilih tipe peserta" />
              </SelectTrigger>
              <SelectContent>
                {TRANSACTION_PARTICIPANT_TYPES.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}
                  >
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Bukti (opsional)</Label>
            {/*
              Optional and staged, not uploaded on pick: `submit` inserts the transaction first and
              only then pushes these against the id it gets back (a receipt row FKs a transaction
              that does not exist yet). Same picker as the row's `Receipts` — image or PDF, many at
              once, capped at `MAX_RECEIPT_BATCH`.
            */}
            <input
              ref={picker}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(event) => {
                const chosen = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (chosen.length > 0)
                  setStaged((current) => [...current, ...chosen].slice(0, MAX_RECEIPT_BATCH));
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || staged.length >= MAX_RECEIPT_BATCH}
              onClick={() => picker.current?.click()}
            >
              Unggah bukti
            </Button>

            {staged.length > 0 && (
              <ul className="grid gap-1">
                {staged.map((file, index) => (
                  <li
                    key={`${index}-${file.name}`}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate text-muted-foreground">{file.name}</span>
                    <button
                      type="button"
                      className="text-muted-foreground underline hover:no-underline"
                      disabled={saving}
                      onClick={() => {
                        setStaged((current) => current.filter((_, at) => at !== index));
                      }}
                    >
                      Hapus
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Batal
          </Button>
          <Button
            disabled={saving || !complete}
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Catat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Push the entry form's staged receipts to Storage and record them against a line item that has
 * just been inserted.
 *
 * The steps are `Receipts`' exactly — mint → PUT straight to Storage → finalize — but run after the
 * transaction exists rather than against a row that already had one, which is the only order the
 * evidence FK allows. Returns a note to show when something did not land, or `null` when every file
 * did. The transaction is already recorded by the time this runs, so a failure here is a receipt
 * problem, never a lost line item.
 */
async function attachStagedReceipts(
  perjadinId: string,
  transactionId: string,
  files: File[],
): Promise<string | null> {
  const batch = files.slice(0, MAX_RECEIPT_BATCH);

  // The mint throws when the trip is gone — a page left open while somebody deleted it in another
  // tab — and is caught here for the same reason `Receipts` catches it.
  let targets;
  try {
    targets = await mintReceiptUploadsAction(perjadinId, batch.length);
  } catch {
    return STALE_PAGE;
  }

  const landed: { path: string }[] = [];
  let failed = 0;
  await Promise.all(
    batch.map(async (file, index) => {
      const target = targets[index];
      if (!target) {
        failed += 1;
        return;
      }
      try {
        const response = await fetch(target.signedUrl, {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) throw new Error(`PUT ${response.status}`);
        landed.push({ path: target.path });
      } catch {
        failed += 1;
      }
    }),
  );

  if (landed.length > 0) {
    const result = await finalizeReceiptsAction(perjadinId, transactionId, landed);
    // A refused write means the same as a stale mint: what is on screen is no longer stored.
    if (result.outcome !== "attached") return STALE_PAGE;
    failed += result.failed;
  }
  // Partial success is real — files upload independently and one can fail while the rest land — so
  // it is reported rather than swallowed.
  if (failed > 0) return `${failed} berkas gagal diunggah.`;
  return null;
}

/**
 * What a page that has gone stale under the reader says. Reached from three places — a mint
 * against a deleted trip, a write that finds no such trip, and one that finds no such line item
 * — because all three mean the same thing to a PIC: what is on screen is no longer what is
 * stored, and no field they could edit will fix it.
 */
const STALE_PAGE = "Halaman ini sudah tidak sesuai. Muat ulang untuk melihat keadaannya.";

/**
 * What each refusal says. `no-such-perjadin` is the only one the form cannot have predicted —
 * somebody deleted the trip while this page was open — so it says to reload rather than which
 * field to fix.
 */
const REFUSALS = {
  "amount-not-positive": "Jumlah harus lebih besar dari nol.",
  "no-such-perjadin": STALE_PAGE,
} as const;

export { AcquittalTransactions, RecordTransaction };
