# Reading money is open to any signed-in Person; writing it stays Staff-only

> **Receipts are widened further by [ADR-0040](./0040-transaction-evidence-is-stored-in-the-company-google-drive.md):**
> each transaction's receipts sit in a Google Drive folder that **anyone with the link** can view,
> signed in or not. The rest of money stays as below. Where this ADR describes the upload
> credential for the private `receipts` bucket and the service-role Storage read, those become a Drive
> upload session and a read from Drive; that each write calls `requireStaff` itself still stands.

The internal boundary was **delivery-vs-money**: [ADR-0004](./0004-delivery-data-is-open-internally-money-is-not.md)
opened delivery data to everyone signed in and kept the Perjadin Report and its financial detail to
Staff. This reverses that ADR's money-read half. The boundary is now **read (any signed-in Person)
vs write (Staff)**: a Pimpinan reads all money, and only Staff writes it.

## What it was

ADR-0004 held that "Perjadin Reports and their financial detail are visible to Staff only", enforced
at a single choke point — `requireStaff` in `@sugt/db` — that every money query opened with. While
`Staff` was the only role that made no observable difference: there was nobody for the gate to
refuse. [ADR-0025](./0025-pimpinan-is-a-second-signed-in-read-only-person-role.md) (#179) added the
first signed-in non-Staff principal, the record-only-reading `Pimpinan`, and stated that opening
money to them was decided but deferred — to this ticket.

## Why

Leadership sign in to **read** how a Programme is going, and money is a large part of that: the
Advance and its acquittal, the `/monitoring` budget card. Keeping the money read Staff-only would
leave a Pimpinan monitoring a Programme unable to see how much of the budget had been spent, which is
the very thing the role exists to watch. ADR-0004's stated reason for hiding money — that a Report
carries per-diems and personal travel claims a colleague has no delivery reason to read — was about a
peer Teaching Team member, not leadership. A Pimpinan reading money is not a colleague reading a
colleague's claim; it is oversight reading the thing it oversees.

Nothing about **writing** money changes. A Pimpinan writes nothing (ADR-0025), and the tool's money
writes — recording, attaching evidence to, settling and filing a transaction, planning a Perjadin,
recording the treasurer return — stay with Staff, each already guarded by its own `requireStaff`.

## The decision

Make the choke point guard **writes, not money reads**.

- **`perjadinAcquittal` loses its `requireStaff`.** It is the one money _read_ in the query layer,
  and it now opens to any signed-in `Person`. So a Pimpinan reads the Perjadin acquittal (the
  Laporan), its CSV export, and the trip's money strip on Detail Perjadin; and `/monitoring`'s
  `showBudget` gate opens to `Pimpinan` as well as `Staff`, so the budget card shows.
- **Every money write keeps its `requireStaff`.** `recordTransaction`, `attachTransactionEvidence`,
  `markReceiptsSettled` and `filePerjadinReport` are unchanged — each still refuses a non-Staff
  caller server-side, so a Pimpinan reading the Laporan is refused the moment they try to change it.
- **Two writes that had leaned on the read's guard now stand on their own.**
  `mintReceiptUploadsAction` and `finalizeReceiptsAction` had no `requireStaff` of their own — a
  Staff-checked read of the acquittal was the whole of their guard, protecting an upload credential
  for the private `receipts` bucket and a service-role Storage read. Opening the read would have
  opened those two writes to a Pimpinan, so each now calls `requireStaff` explicitly, ahead of the
  read. Opening the read did not open the writes.

The write UI on these surfaces is **not** hidden from a Pimpinan by this ticket. Enforcement is
server-side per the acceptance, and the Laporan and Detail Perjadin surfaces are reworked by #182 and
#183; threading a `canWrite` prop through them here would be work those tickets undo.

## The one documented exception

The **Staff Beranda dashboard** stays Staff-only: `staffDashboard` keeps its `requireStaff`. That is
not an inconsistency with "money reads are open" — the Beranda is a Staff working surface, and #179
redirects a Pimpinan to `/monitoring` before that read runs, so no Pimpinan Beranda is built and none
is asked for. A Pimpinan reads money on the money surfaces, not on the Staff home screen.

## Consequences

- The read/write boundary is now the one an outside reader would guess: you may look, and Staff may
  change. The two-reasons-one-guard shape of the choke point survives, but the reasons are now
  _writing_ money and _arranging_ delivery, and neither is "reading money".
- `NotStaffError` is still what a refused write throws, and `isNotStaffError` still discriminates it.
  What changed is only which surfaces reach it: money reads no longer do.
- ADR-0004's delivery-vs-money framing is amended, not discarded — publishing stays Staff-only,
  delivery-arranging stays Staff-only, and every composite-key role rule is untouched. Only the
  money-read gate moved.

## Amendment (2026-10-08): writing a trip's money is its Group's

"Staff may change" is now narrower for money on a trip. Recording a transaction, attaching a receipt,
filing the Laporan and correcting Uang Perjalanan are written by **the trip's Group** — its PIC and its
Staff members — or by an **Editor** or an **Administrator**, not by every Staff member
([ADR-0048](./0048-a-perjadin-is-written-by-its-group.md), #439). A Staff member off the trip is
refused with `NotOnPerjadinError`, a 403 like `NotStaffError`. Reading money is unchanged: open to
everyone signed in.

## Amendment (2026-10-12): the Advance is not tracked

Two of the money surfaces above are gone ([ADR-0051](./0051-the-advance-is-not-tracked.md), #464):
there is no Advance to read, and no Uang Perjalanan to correct. Settling, the treasurer return and
the Advance written at planning were never or are no longer written by any screen. What a Pimpinan
reads is the acquittal's spend — Uang Perjalanan Terpakai and its line items — and the `/monitoring`
budget card; the read/write split is unchanged.
