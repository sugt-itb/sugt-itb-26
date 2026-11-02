# Programme-wide money is not in the app

The internal app no longer has a programme-wide money view, and that is intended. The **Penyerapan
Anggaran** card leaves the Dashboard
([#532](https://github.com/sugt-itb/sugt-itb-26/issues/532)), and `/keuangan` and the **Keuangan**
Grant go with it ([#533](https://github.com/sugt-itb/sugt-itb-26/issues/533)). This narrows the app's
money reads to each Perjadin's own: its **Perjadin Report** and CSV export, which stay.

## Why

Finance reconciles and reports outside the app, so programme-wide money views duplicate that work.

## Consequences

- **The Dashboard shows no budget, for any reader.** `PROGRAMME_BUDGET_IDR`, the budget sum and
  `monitoringData` are gone, and `/` reads `programmeDelivery` directly. Both of its readers now use the
  same money-free query, so ADR-0057's split between that query and a `Person`-only budget sum no longer
  exists. The Unified Dashboard summary's payload is unchanged.
- **The Dashboard's read gate stays.** [ADR-0037](./0037-dashboard-read-is-gated-by-a-grant.md)'s gate is
  not about money, so who can read `/` does not change.
- **Each Perjadin's money is untouched.** The trip page, its Laporan and CSV, and the `/pendamping` card
  still show **Uang Perjalanan Terpakai**, and [ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md)'s
  read and write rules still govern them.
- **Transactions are still recorded.** Only the programme-wide views of them go.
- **Until #533 lands, `/keuangan` still exists.** The two tickets ship separately, this one first.
