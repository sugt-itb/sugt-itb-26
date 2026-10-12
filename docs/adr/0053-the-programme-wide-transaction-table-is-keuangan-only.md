# The programme-wide transaction table is Keuangan only

`/keuangan` ([#472](https://github.com/sugt-itb/sugt-itb-26/issues/472)) lists every money
Transaction across every Perjadin in one table, with filters, sorting and a CSV export. It is readable
only by a Staff Person holding the **Keuangan** Grant or **Administrator**
([ADR-0052](./0052-editor-splits-into-perjadin-daring-and-dashboard-editor.md)). Everyone else, a
Pimpinan included, gets a 403 from the page and from the export, and sees no sidebar link.

This **narrows [ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md)** — "money is open to
read" — for this one view, as [ADR-0037](./0037-dashboard-read-is-gated-by-a-grant.md) did for the
Dashboard and the programme budget it shows. Each Perjadin's Laporan and its CSV export stay readable
by any signed-in Person, as before. Settled with the product owner when the ticket was written, on 2026-10-11.

## Why

A Laporan answers one trip's question: what this Group spent, with the receipts. The table answers the
programme's: every line, across every trip, filtered and exported for whoever reconciles the money.
That is a finance job, not a delivery one, and the people who do it are the ones the Keuangan Grant was
reserved for. Opening the whole set to every reader would put every trip's spend in one download for
people with no job to do with it. A trip's own Laporan stays open, because reading one trip is how its
Group and leadership follow it.

## The decision

- **The page and its export** check the Keuangan Grant, which an Administrator satisfies. The page
  and the export call `forbidden()`; every query (`keuanganPage`, `keuanganExport`,
  `keuanganPerjadinOptions`) checks the Grant again.
- **Everything is in the URL** — the Perjadin, a range on the Perjadin's start date, the sort and the
  page — so a view can be bookmarked, and the export reuses its filter exactly.
- **The export shares one CSV writer** with the Laporan export. That writer now guards a text cell
  starting with `=`, `+`, `-`, `@`, a tab or a carriage return with a leading `'`, so a spreadsheet
  shows it as text rather than running it. Both exports gain the guard.
- **Each receipt links straight to its file in Drive**, as ADR-0040 anticipated when it chose to
  link-share each transaction's folder.

## Consequences

- Reading money is open except here and on the Dashboard (ADR-0037). A future programme-wide money
  view should follow this ADR rather than ADR-0026.
- The export carries no Perjadin column, by decision: it is a line-by-line ledger, and a reader who
  needs the trip filters by it first.
