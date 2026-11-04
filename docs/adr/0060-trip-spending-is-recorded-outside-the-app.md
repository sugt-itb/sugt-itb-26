# Trip spending is recorded outside the app

Nothing in the app records a new transaction any more
([#541](https://github.com/sugt-itb/sugt-itb-26/issues/541)). Catat Transaksi is removed from both of
its entry points, the trip card on `/pendamping` and the Laporan at `/perjadin/[id]/laporan`, and the
code is deleted rather than hidden. Git history is the way back.

## Why

Finance now records and evidences trip spending outside the app, so PICs no longer enter it here. Two
places to enter one spend would only disagree. This reverses
[ADR-0059](./0059-programme-wide-money-is-not-in-the-app.md)'s "Transactions are still recorded" and
gives up [ADR-0007](./0007-the-tool-generates-the-acquittal.md)'s idea that a PIC enters transactions
once in the tool and exports the acquittal. It also amends
[ADR-0039](./0039-every-transaction-is-recorded-with-its-evidence.md) and
[ADR-0048](./0048-a-perjadin-is-written-by-its-group.md).

## The decision

- **Existing lines remain maintainable.** Unggah bukti, Hapus bukti and Hapus transaksi all stay, along
  with the Laporan, its CSV export, Buka folder links, the Drive sync and Periksa koneksi. Without them,
  wrong lines and missing receipts would become permanent in the record the external audit uses.
- **A trip with no lines shows no money.** "Rp0" would read as nothing spent, when the app has simply
  stopped tracking it. Uang Perjalanan Terpakai and the Laporan link appear only on trips with at least
  one line. The Laporan's URL keeps working on any trip and says there are no transactions.
- **The Log keeps its history.** Past `transaction_recorded` entries, their label and the `/log` "Catat
  transaksi" filter stay, because Hapus transaksi still logs under that filter. As with `report_filed`
  in [ADR-0055](./0055-the-perjadin-report-is-neither-filed-nor-due.md), the value stays in
  `ACTIVITY_LOG_ACTIONS` and the CHECK, and `logActivity` stops accepting it.
- **No in-app notice.** PICs are told outside the app.

## Consequences

- **No migration.** The `transaction` and `transaction_evidence` tables and all their rows stay.
- **The reconcile keeps its `_staging` handling.** An older line may still be unsynced with its folder
  there, and the sweep has to be able to finish it.
- **The one-to-five receipt rule now has one write to hold it.** `attachTransactionEvidence` still
  refuses a sixth receipt. Nothing refuses a line with none, because nothing creates a line.
- **Drive stays connected.** It still serves Unggah bukti, Dokumen and Foto & Video.
