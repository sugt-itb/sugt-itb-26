# Receipts may attach at transaction entry, not only per row

Amends [ADR-0007](0007-the-tool-generates-the-acquittal.md).

The "Catat transaksi" entry form now carries an optional "Unggah bukti" control, so a PIC can attach
a line item's receipts at the moment they enter it. The per-row upload on the acquittal card stays,
unchanged. Both are first-class paths; neither is a fallback for the other.

## What it was

Receipts attached in exactly one place: the row. A transaction was entered, the card rendered, and
its "Unggah bukti" was where evidence went — always after the line existed. The entry form
deliberately held no upload control. The reading behind that was sound at the time: ADR-0007 rests on
post-trip entry and on-the-spot entry being equally easy, and putting the only upload on the row kept
a fare "photographed and logged on the pavement" — captured, then evidenced later — a first-class
path rather than a poor cousin of the desk-bound one.

## Why change it

The row-only rule served the on-the-spot case well and the desk-bound case badly. A PIC working
through a folder of receipts after returning has each line's proof _in hand as they type it_: making
them record the line, find its freshly rendered card, and upload against it is two motions where one
would do. ADR-0007's own words — both paths equally easy — argue for closing that gap, not against
it. Attaching at entry time is the on-the-spot case's natural shape; the row path remains the natural
shape for evidence that arrives afterwards. Serving one need never required starving the other.

## The decision

- **The entry form stages, then attaches after the insert.** A receipt row FKs a `transaction` that
  does not exist until the line is written, so the form cannot upload on pick the way the row does.
  It holds the file selection locally and, on submit, records the transaction **first**; only if that
  succeeds and returns the new `transactionId` does it run the existing mint → PUT-to-Storage →
  finalize flow against that id. `recordTransactionAction` already returns the id, so no seam widened.
- **Upload is optional and additive.** Recording with zero files behaves exactly as before. A failed
  insert uploads nothing — no orphan object in Storage, no evidence row against a line that was never
  written.
- **Nothing new in the storage layer.** The entry-time path reuses `mintReceiptUploadsAction`,
  `receipt-media.ts`'s client PUT, and `finalizeReceiptsAction` as-is — the same infrastructure, the
  same `MAX_RECEIPT_BATCH` cap, the same read-back-from-Storage discipline the row path uses.
- **The row path is untouched.** The `Receipts` component and its immediate upload keep their exact
  behaviour, for the evidence that still arrives after the line is logged.

## Consequences

- **A failure at entry time is a receipt problem, never a lost line.** Because the transaction is
  recorded before any byte is uploaded, an upload that fails leaves a real, recorded line item with no
  attached proof — an ordinary, visible state on this screen. The form says so out loud and points the
  PIC at the row's own "Unggah bukti", rather than pretending the receipts landed.
- **The evidence rule is unmoved.** "Every transaction carries at least one receipt" is still checked
  only when the Report is filed (ADR-0007). Entry-time upload is a convenience, not a gate: a line
  entered with no receipt is refused nowhere on this screen.
- **Money writes stay Staff-only.** Both the mint and the finalize re-check Staff server-side
  (ADR-0026); the entry dialog renders only where allowed, exactly as the row path already did.
