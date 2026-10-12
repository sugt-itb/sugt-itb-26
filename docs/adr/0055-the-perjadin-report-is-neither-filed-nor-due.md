# The Perjadin Report is neither filed nor due

The **Perjadin Report** (Laporan Perjadin) is no longer something a PIC **files** against a
**deadline** ([#489](https://github.com/sugt-itb/sugt-itb-26/issues/489)). It is the trip's running
acquittal and nothing more: every transaction on the trip, each with its receipts, summed as **Uang
Perjalanan Terpakai**. The Laporkan button, its write and the "Dilaporkan" line go, and so do the
"Jatuh tempo … · sisa N hari / terlambat N hari" line on the Laporan and "Laporan jatuh tempo" on
`/perjadin/[id]`. Settled with the product owner when the ticket was written, on 2026-10-12.

## Why

**Filing gated nothing.** A filed Laporan froze nothing: lines and receipts could still be recorded,
and since [ADR-0050](./0050-transactions-and-receipts-may-be-deleted-and-the-log-keeps-the-copy.md)
deleted, after Laporkan. Apart from refusing a second filing, the only thing that read
`report_filed_at` was the screen saying when it had been pressed. Once
[ADR-0051](./0051-the-advance-is-not-tracked.md) took the Advance away, a filing reconciled against
nothing either. It was a button that recorded that someone had pressed it.

**The deadline was DITSAMA's own and gated nothing.** Two days after the Group got back
(`ends_on + 2`), set by DITSAMA for itself; the tool showed it and enforced nothing, because the
tool is never stricter than the process it serves. A date that changes nothing, on a Report that is
never closed, is noise on the two screens a PIC opens most.

## The decision

- **No deadline is computed or shown.** `REPORT_DEADLINE_DAYS_AFTER_RETURN`, the acquittal's
  `reportDueOn` and `daysRemaining`, and the SQL helper behind them are gone. The shared "today in
  Asia/Jakarta" fragment stays, renamed `todayInWib` in `@sugt/db`'s `queries/today.ts`: the
  `/pendamping` current-trip check and the Preparation checklist's dated changes still use it.
- **Nothing is filed.** `filePerjadinReport`, its Server Action and the Laporkan control are gone.
  The backstop it carried — refusing a grandfathered line with no receipt — goes with it; such a line
  is fixed through its own Unggah bukti, as before, and nothing waits for it.
- **The column is dropped, not left unused.** Migration `0053` drops `perjadin.report_filed_at`. A
  column nothing reads or writes is a question every future reader has to answer, and nothing
  replaces it, since filing never controlled anything.
- **The Activity Log keeps past filings.** The Log is append-only history. Existing `report_filed`
  entries keep their label (**Laporan dikirim**), their totals and the `/log` Aksi filter, and the
  value stays in `ACTIVITY_LOG_ACTIONS` and the Log's CHECK. Nothing writes it any more:
  `logActivity`'s type no longer accepts it, as with `advance_*` under ADR-0051.
- **Who writes a trip is unchanged.** [ADR-0048](./0048-a-perjadin-is-written-by-its-group.md)'s
  rule — the trip's Group, a Perjadin Editor or an Administrator — still covers Catat transaksi,
  Unggah bukti and Hapus. Laporkan had no plumbing of its own to remove.

## Consequences

- **The tool no longer says when a Laporan was handed in, or that one is late.** If DITSAMA wants a
  handed-in mark or a reminder, that is a new decision, made against what it would gate.
- **The Laporan is never "done" in the tool.** It reads the same before, during and long after a
  trip; the export is whatever the trip holds when it is taken.
- **The filings already made survive only in the Log**: who pressed Laporkan and when, with the line
  count and total at that moment.
