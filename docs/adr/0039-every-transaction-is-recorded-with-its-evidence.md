# Every transaction is recorded with its evidence (1–5 receipts)

> **Partially superseded by [ADR-0050](./0050-transactions-and-receipts-may-be-deleted-and-the-log-keeps-the-copy.md).**
> The "No receipt deletion" consequence below no longer holds: a receipt may be deleted with its
> row's Hapus, trashed in Drive and logged, and its slot counts toward the five again. A line still
> keeps at least one receipt, so the one-to-five rule stands.

> **Partially superseded by [ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md).**
> Receipts are stored in the company's Google Drive, not the Supabase `receipts` bucket. The upload
> URLs minted against Storage, the read-back from Storage, and the argument that orphan objects are
> harmless because the bucket is private no longer describe the system: files land in a private Drive
> `_staging` folder and are verified from their first bytes there. The one-to-five rule,
> all-or-nothing and the row lock on "Unggah bukti" stand.

A line item on the acquittal is now recorded **with its receipts or not at all**. The "Catat
transaksi" dialog requires one to five files. On Catat it uploads every one of them first, and only
when all have landed does **one** write record the transaction and its evidence rows, in one database
transaction. A line never carries more than **five** receipts in total: the ones recorded with it plus
any added later from its row.

This **supersedes two points of [ADR-0030](./0030-receipts-may-attach-at-transaction-entry-not-only-per-row.md)**:
that upload at entry is optional, and that the evidence rule is unmoved. It **amends the timing
[ADR-0007](./0007-the-tool-generates-the-acquittal.md) left implicit**, under which a line could be
logged first and evidenced later. ADR-0030's entry-time upload control stays, and so does the row's
own "Unggah bukti". What changes is that entering a line without a receipt is no longer possible.

## Why

"Log a taxi fare now, attach the receipt later" was a first-class path, and it produced exactly the
state the acquittal exists to prevent: a line on the Report with no proof behind it. The only thing
that noticed was the filing check, at the end, when the receipt was hardest to find. It was decided
deliberately to give that path up. A spend is not recorded until the PIC has its receipt file.
Photographing the receipt is the moment of capture, and the line is entered with it.

ADR-0007's promise survives the change. Entering a line on the spot and entering it after returning
are still equally easy, because both now mean "with the receipt in hand". A PIC who cannot upload at
the gate still enters the whole line that evening and loses nothing.

## The decision

- **All or nothing, upload first.** The dialog mints upload URLs against the Perjadin alone and PUTs
  every staged file. If **any** PUT fails, nothing is recorded. The form keeps every value and every
  staged file and says how many failed, and Catat retries the whole of it against fresh URLs. If all
  landed, `recordTransactionAction` reads each object's facts back from Storage. It keeps
  `finalizeReceiptsAction`'s load-bearing order: `requireStaff` and the Perjadin read come **before**
  any service-role read-back. If any read-back fails, the record is refused. Otherwise
  `recordTransaction` writes the line and its evidence rows in one transaction.
- **The server holds the count, as returned values.** `recordTransaction` refuses zero receipts
  (`evidence-missing`) and more than five (`too-many-receipts`). The dialog's disabled button is a
  convenience, not the guarantee.
- **Five per transaction, in total.** `MAX_RECEIPTS_PER_TRANSACTION = 5` is one product-rule constant
  in `@sugt/domain`, read by the client and the server alike. It is not a per-pick batch size.
  `attachTransactionEvidence` counts what the line already carries plus the new batch. It locks the
  parent `transaction` row `for update` before counting, so two concurrent uploads on one line
  serialise and cannot both pass the count. The mint hands out no more URLs than that cap.
  `MAX_RECEIPT_BATCH`, documented as "a guard on the array size, not a product rule", is retired;
  the product rule now bounds the array too.
- **The stage-then-attach flow is deleted.** `attachStagedReceipts` and the dialog's "Transaksi
  tercatat, bukti belum terlampir" state described a line recorded without its proof. That state can
  no longer happen, so nothing is left behind to render it.

## Consequences

- **Orphan objects are accepted.** A refused record can leave the files that did land in the private
  `receipts` bucket, unreferenced by any row. The keys are opaque UUIDs and the bucket is private, so
  such an object names nothing and nobody can read it without a signed URL minted from a row.
  Cleaning them up would couple the write to Storage deletion for no reader's benefit. This project
  already leaves orphans rather than build their cleanup
  ([ADR-0018](./0018-the-preparation-checklist-stores-ticks-and-derives-the-list.md)).
- **Existing data is grandfathered.** The shared database may already hold lines with zero receipts
  or with more than five. There is no migration and no CHECK: a constraint would trip over those
  rows, and a cross-row count is not a CHECK anyway. The rule lives in the one write path.
  - A zero-receipt line is fixed through its row's "Unggah bukti".
  - A line with more than five keeps what it has and gains nothing.
  - `filePerjadinReport`'s evidence check stays as the backstop that still catches the first kind.
- **No receipt deletion.** There is still no way to remove a receipt, so a mistaken upload uses up
  one of the five slots. That is accepted and out of scope.
- **This is a field the form insists on, not a new gate.** `data-model.md` separates two kinds of
  rule. One withholds an action until some _other_ record is complete; the other is a field a form
  insists on before it will submit. This is the second kind: the receipts are part of the line being
  written. Filing gains no new condition — its evidence check is unchanged, and now only ever fires
  on a grandfathered line.
