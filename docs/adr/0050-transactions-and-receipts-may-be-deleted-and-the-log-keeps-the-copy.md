# Transactions and receipts may be deleted, and the Log keeps the copy

A receipt uploaded to a line by mistake can now be taken off it, and a line entered by mistake can be
removed whole. On the Laporan each **Bukti n** link carries a **Hapus**
([#462](https://github.com/sugt-itb/sugt-itb-26/issues/462)), and so does each line
([#463](https://github.com/sugt-itb/sugt-itb-26/issues/463)). The file goes to the Drive trash, the
row is deleted, and an **Activity Log** entry holding a copy of what went is written in the same
database transaction.

This **partially supersedes [ADR-0039](./0039-every-transaction-is-recorded-with-its-evidence.md)**,
whose consequences said "No receipt deletion… a mistaken upload uses up one of the five slots —
accepted and out of scope." The one-to-five rule stands: a line still keeps at least one receipt.
Settled with the product owner when the two tickets were written, on 2026-10-11.

## Why

A wrong receipt used to stay on its line for good, filling one of five slots and sitting in the
folder the external audit opens. A line typed against the wrong trip, or entered twice, stayed in
the Laporan's totals and its export, and the only fix was by hand in the database. Both are ordinary
mistakes on a phone at the end of a long day. The tool is never stricter than the process it serves,
and the process lets a PIC strike out a wrong entry.

## The decision

- **Remove, not void.** The row is deleted, and the Laporan, its totals and its export simply no
  longer count it — they are derived, never stored. A void would be a new state on every line, which
  every money query, the CSV export and the filing check would then have to remember to exclude. The
  record of what was there is the Log entry instead.
- **The Log keeps the copy.** Each delete writes its entry inside the delete's own transaction, with
  enough in `details` to say what went once the row is gone:
  - `evidence_deleted`, labelled **Bukti dihapus**, in the **Unggah bukti** Aksi filter on `/log`.
    Its `details` are the line's `transactionId`, `category`, `amountIdr` and `spentOn`, the receipt's
    `evidenceId`, and `left`, what the line holds after it.
  - `transaction_deleted`, labelled **Transaksi dihapus**, in the **Catat transaksi** filter. Its
    `details` are the line's `transactionId`, `category`, `amountIdr`, `participantType`, `spentOn`
    and `description`, and its `receiptCount`.

  One migration (0049) added both to the Log's CHECK, so the two Hapus tickets do not each widen it.

- **Trash, not permanent delete**, as Dokumen and Foto & Video Hapus do
  ([ADR-0042](./0042-perjadin-documents-are-stored-in-the-company-google-drive.md),
  [ADR-0046](./0046-session-footage-is-stored-in-the-company-google-drive.md)). The Drive trash empties
  itself after 30 days, which is the window for undoing a mistake by hand.
- **Drive first, then the database.** A file already in the trash, or gone, counts as trashed, so a
  retry is safe. If the trash fails, nothing is deleted. If the database step fails after the trash,
  the row stays listed, pointing at a trashed file, and pressing Hapus again finishes it. The order
  never leaves a row pointing at a file it says is live, nor a link-shared file that no row records.
- **Still allowed after Laporkan.** Filing freezes nothing today: lines and receipts can still be
  added after it. The `report_filed` entry already keeps the totals as they were when filed.
- **Who:** the trip's Group, an Editor or an Administrator
  ([ADR-0048](./0048-a-perjadin-is-written-by-its-group.md)), as for every other write on the trip.
  The check runs before any Drive call, so a non-writer gets a 403 and causes none. Anyone who cannot
  write the trip sees no Hapus.
- **While Drive is not connected or is broken**, Hapus is disabled with the reason, as Unggah bukti
  is, and the Server Action refuses the same states before any Drive call.

## Deleting a receipt (#462)

- **Never a line's only receipt.** A line keeps one to five (ADR-0039). Deleting the last one is
  refused: _"Satu-satunya bukti tidak bisa dihapus. Unggah bukti yang benar dulu, atau hapus
  transaksinya."_ A single wrong receipt is replaced by uploading the right one first. A line
  grandfathered with more than five may have any of them deleted, down to one.
- **The count is checked on both sides of the trash.** Because the trash comes before the database,
  one check is not enough:
  1. **Before touching Drive**, `receiptDeleteTarget` counts the line's receipts. The line's only
     receipt is refused here, and nothing is trashed.
  2. **In the commit**, `deleteTransactionEvidence` locks the parent `transaction` row `for update` —
     the same lock `attachTransactionEvidence` counts under — and counts again. Two concurrent Hapus
     on a two-receipt line serialise there, and the second finds its receipt the only one left.
  3. **If that re-check refuses**, the action takes its file back out of the Drive trash, so the
     surviving receipt's link opens again, and then refuses.
- **The freed slot counts toward the five again**, so the line's own Unggah bukti can fill it. A
  receipt still unsynced, its file in `_staging`, is trashed from there the same way.

## Deleting a transaction (#463)

- **Any line may go**, with however many receipts it holds — none, one to five, or more than five on
  a grandfathered line. It asks first: _"Hapus transaksi ini? Folder buktinya akan dipindahkan ke
  Sampah Google Drive."_
- **The folder, then any receipt outside it.** `transactionDeleteTarget` reads the line's folder and
  its receipt files, after the writer check. The line's folder goes to the trash, which trashes
  every receipt inside it. Then each receipt is trashed by itself, which is a no-op for those
  already trashed with the folder. That catches files that never reached the folder: those of a line
  whose reconcile never finished, still in `_staging`, and any a person moved out by hand. A line
  with no folder and no receipt reaches Drive not at all.
- **The commit answers what it deleted.** `deleteTransaction` locks the row `for update`, reads the
  folder and receipts again, deletes the line (its evidence rows cascade) and writes
  `transaction_deleted`, in one transaction. Between the action's first read and that lock, an
  Unggah bukti may have added a receipt, or a reconcile may have claimed a folder for a line that
  had none; both wait on the same row. The action trashes whatever the commit reports that it had
  not seen. The line is gone by then, so if that trash fails the action logs the ids for a person,
  rather than asking for a retry that has nothing to retry.
- **The reconcile brings nothing back.** It never recreates a trashed folder, so a reconcile that
  read the line before the delete stops at the line's folder, reports it trashed, and its
  failure mark finds no row. One that made the line's folder itself finds no row to claim it on,
  trashes the folder, and answers `no-such-transaction`, as it does when the row is gone at its
  final mark. A receipt moved into a trashed folder is trashed with it. Once the line is gone, the
  sweep's `unsyncedTransactions` no longer lists it.
- **The line's past Log entries stay.** `/log` left-joins `transaction` for the **Buka folder** link
  of every entry that names the line's `transactionId`. Once the row is gone those entries render
  without it, as Dokumen and Foto & Video entries do once theirs are.

## Consequences

- **The Log is the only record of what was deleted.** Nothing in the app updates or deletes a Log
  row, so the copy outlives the row.
- **A file restored from the Drive trash by hand is not re-attached.** Its row is gone; restoring the
  file brings back a file that no row records. Undoing a Hapus means uploading the receipt again.
- **A rare double failure is left to a person.** If a Hapus loses the race in step 3 and Drive then
  fails to take its file back out of the trash, the surviving row points at a trashed file. The
  action logs which receipt, and restoring the file from the Drive trash by hand puts it right.
