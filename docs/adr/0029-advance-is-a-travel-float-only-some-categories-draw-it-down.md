# The Advance is a travel float; only some categories draw it down

The Advance (`advanceIdr`, "uang muka") was modelled as a pot reconciled **in full**: a Perjadin's
remaining money was `advance − sum(every transaction)`, and the acquittal existed to account for all
of it. This changes what the Advance _is_: it is a **travel float** for direct on-trip purchases, and
only a named subset of transaction categories draws it down.

## What it was

Four places derived the remainder as `advance − sum(ALL transactions)` — `perjadinAcquittal`
(`perjadin-report.ts`), `myUpcomingPerjadin` (`my-perjadin.ts`), the Staff dashboard
(`dashboard.ts`), and their display sites (perjadin detail, Laporan, dashboard). Every category
counted equally against the Advance, and the acquittal's job was full reconciliation.

## Why

In practice most of a trip's cost is **not** paid out of the money handed to the PIC. Flights,
lodging, per-diems, honoraria and inter-city transport are pre-paid before departure or handled by
other Staff; what the PIC actually spends out of the float on the ground is consumables and
odds-and-ends — **Konsumsi** and **Lainnya**. Reconciling the float against _all_ recorded spend
therefore misstated what was left: a trip could show a large "overspend" that was really just
pre-paid airfare recorded against it. The remaining float should reflect only what the float paid
for.

At the same time, **`/monitoring`'s programme spend must not change**: "Anggaran terpakai" is how much
of the whole programme budget has been consumed, and every category is real spend there. So the two
figures diverge on purpose.

## The decision

- **A single source of truth** in `@sugt/domain`: `ADVANCE_DRAWDOWN_CATEGORIES = ["Konsumsi",
"Lainnya"]` — a narrower subset of `TRANSACTION_CATEGORIES` — plus `sumAdvanceDrawdownIdr(lines)`
  and `isAdvanceDrawdownCategory(category)`. Widening the float later is one edit here.
- **Every remainder becomes `advance − drawn-down`.** The JS site (`perjadinAcquittal`) reduces its
  loaded rows through `sumAdvanceDrawdownIdr`; the two SQL sites (`myUpcomingPerjadin`, the Staff
  dashboard) carry a `category in (…)` filter on the sum, built from the same constant so they cannot
  drift. `myUpcomingPerjadin`'s per-trip figure is renamed `spentIdr → drawnDownIdr` to say what it
  now is, since it only ever fed the remainder.
- **The full spend log is untouched.** `perjadinAcquittal.spentIdr` still sums **every** category —
  it is the "Terpakai" total and the CSV's spend line — and the per-cohort subtotals
  (`siswaSpentIdr`/`gtkMsSpentIdr`) stay full. Every transaction row remains visible in the acquittal
  and the CSV export. The acquittal is now "travel-float reconciled **plus** full spend log".
- **`/monitoring` is explicitly left alone.** `monitoringData`'s `budgetUsedIdr` still sums every
  transaction, programme-wide.

## Consequences

- **Two divergent "spend" numbers by design.** On one Perjadin card "Terpakai" (all spend) and
  "Sisa" (`advance − drawn-down`) no longer reconcile to the Advance, and that is intended — they
  answer two different questions. A reader who expects `Terpakai + Sisa = Diterima` will be surprised;
  the labels are clarified in the ticket that renames "Uang muka" → "Uang Perjalanan" (#226), which
  this unblocks. This ADR changes only the meaning and the math, not the display strings.
- **One remainder, every screen.** The perjadin detail, the Laporan, the CSV, the Staff dashboard and
  Perjalanan Saya all read the same `advance − drawn-down`, pinned equal by a query test, so no two
  screens show a different "tersisa" for one trip.
- **Extensible.** Adding a category to the float is a one-line change to
  `ADVANCE_DRAWDOWN_CATEGORIES`; the SQL filters and the JS sum both follow.
