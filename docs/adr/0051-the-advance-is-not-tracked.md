# The Advance is not tracked

The app no longer records how much **Uang Perjalanan** (the **Advance**, `advance_idr`) a Perjadin
received ([#464](https://github.com/sugt-itb/sugt-itb-26/issues/464)). The plan form's optional field
goes, and so do the trip page's Isi/Ubah Uang Perjalanan dialog and the figures built on the amount:
**Diterima**, **Sisa**, the `/pendamping` card's **Tersisa** and its progress bar. What is left is
one figure, **Uang Perjalanan Terpakai**, the sum of every transaction on the trip.

This **supersedes [ADR-0029](./0029-advance-is-a-travel-float-only-some-categories-draw-it-down.md)**:
with no Advance there is no float to draw down. Settled with the product owner when the ticket was
written, on 2026-10-11.

## Why

How much Uang Perjalanan a Perjadin received is usually unknown unless someone asks the trip's
members. [#437](https://github.com/sugt-itb/sugt-itb-26/issues/437) already made the field optional
because a trip is planned before anyone knows the figure. A field nobody can fill in reliably is
impractical. Its one hard consequence was blocking Laporkan, so a
trip that had spent and evidenced everything could not be filed for want of a number nobody had.

What matters is that every transaction is recorded (_tercatat_) and counts: toward the trip's spend,
and toward **Penyerapan Anggaran** on the Dashboard. Neither needs the Advance.

## The decision

- **Nothing asks for, shows or edits an Advance.** The plan form, `/perjadin/[id]`, the Laporan, its
  CSV and the `/pendamping` card carry no Diterima, Sisa, Tersisa, "belum diisi" or progress bar.
  `planPerjadin` takes no Advance, and `updatePerjadinAdvance` is gone with its dialog.
- **The remainder goes**, and with it ADR-0029's draw-down categories: `ADVANCE_DRAWDOWN_CATEGORIES`,
  its two helpers and the SQL list built from it. Nothing would use them.
- **Laporkan no longer waits for it.** The `advance-missing` refusal (#437) is gone. Laporkan's other
  rules stand: every line needs a receipt, and a Laporan is filed once. _Amended 2026-10-13:
  Laporkan itself is gone ([ADR-0055](./0055-the-perjadin-report-is-neither-filed-nor-due.md))._
- **Uang Perjalanan Terpakai is all spend.** The sum of every transaction on the Perjadin, all
  categories, and the same number on every screen: the trip page, the Laporan, the CSV, and the
  `/pendamping` card, which until now showed only the draw-down share under the old "Terpakai" label.
  A query test pins them equal. Total Siswa and Total GTK-MS stay on the Laporan and in the CSV.
  Penyerapan Anggaran never read the Advance and is unchanged.
- **The Perjadin Report is every transaction on the trip, each with its receipts**, reconciled
  against nothing.
- **The Log's history is kept.** The Activity Log is append-only. Existing `advance_set` and
  `advance_changed` entries keep their labels, their Rincian and the `/log` **Uang Perjalanan** Aksi
  filter, and both values stay in `ACTIVITY_LOG_ACTIONS` and the Log's CHECK. Nothing writes them any
  more: `logActivity`'s type no longer accepts them.
- **The columns go in a follow-up.** #464 added no migration: `advance_idr`,
  `returned_to_treasurer_idr` and `returned_at`, with their CHECKs, stayed in the schema, unread and
  unwritten by app code, until [#465](https://github.com/sugt-itb/sugt-itb-26/issues/465) dropped
  them in migration 0050 once that had shipped — so a deployed app never reads a column that is
  already gone.

## Consequences

- **The tool no longer tells anyone what is left to hand back.** If DITSAMA needs that figure, it is
  worked out outside the tool from what the trip's members received. The Laporan still gives the
  other half — everything spent, evidenced line by line.
- **The Treasurer is no longer a term here.** Nothing in the app records a return to the Treasurer;
  the `returned_*` columns were never written by any screen.
- **ADR-0007's bet narrows.** It promised "running reconciliation against the Advance". The acquittal
  is now an itemised, evidenced record of spend, which is the part a PIC actually assembles; see the
  amendment there.
