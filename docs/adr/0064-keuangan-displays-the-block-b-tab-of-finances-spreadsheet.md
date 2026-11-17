# `/keuangan` displays the Block B tab of Finance's spreadsheet

`/keuangan` comes back as a **read-only view of Finance's spreadsheet**, for Block B (_Pembelajaran
Luring_) only ([#548](https://github.com/sugt-itb/sugt-itb-26/issues/548),
[#549](https://github.com/sugt-itb/sugt-itb-26/issues/549),
[#550](https://github.com/sugt-itb/sugt-itb-26/issues/550),
[#571](https://github.com/sugt-itb/sugt-itb-26/issues/571)). It shows each Sub-Cluster's Budget Lines,
their Alokasi, Realisasi and Sisa, and the totals. It records nothing: no transaction entry returns
([ADR-0060](./0060-trip-spending-is-recorded-outside-the-app.md) stands), and Finance keeps working in
the sheet.

Who reads it: a Staff Person holding the **Keuangan** Grant (an Administrator implies it), or a
**Pimpinan** by Role, as with the Dashboard. The Grant comes back for this; the holders
[#533](https://github.com/sugt-itb/sugt-itb-26/issues/533) removed are not restored, and an
Administrator grants it again.

## Why

[ADR-0059](./0059-programme-wide-money-is-not-in-the-app.md) took programme-wide money out of the app
because Finance reconciles outside it. That reason still holds, and this view follows from it rather
than against it: Finance's spreadsheet **is** the reconciliation, so the app shows it instead of a
second, app-made figure. This reverses ADR-0059's "no programme-wide money view" for this one
read-only view, and for nothing else.

## Decisions

- **The spreadsheet is the source of truth.** Its Realisasi is unrelated to the `transaction` table:
  a trip's **Uang Perjalanan Terpakai** and the sheet can differ, and neither feeds the other.
- **It reads a link-shared copy's CSV export**, as [ADR-0033](./0033-kalender-schedule-is-a-link-shared-google-sheet.md)
  does for `/kalender`: a plain `fetch`, no credentials, the existing `parseCsv`, no new package and no
  environment variable. Rejected:
  - **the Sheets API**, with an API key or the company Drive connection: it needs a credential, and
    its storage and rotation;
  - **`.xlsx` parsers**, `exceljs` included, whose last release is old: a new dependency.
- **CSV loses two things, so the copy carries two helper columns** (prepared as in
  [#547](https://github.com/sugt-itb/sugt-itb-26/issues/547)). `Link_raw` holds each Link cell's URL
  as text, since CSV keeps only the label. `Alokasi_formula` (`=ISFORMULA`) separates a typed Alokasi
  (new money) from a formula (a carried balance). A rule based on values alone was tested on a real
  copy and misread three rows, so it was rejected.
- **Unlike ADR-0033, the source is data, not configuration.** Each fresh copy has a new URL, so an
  Administrator pastes it on `/pengaturan`, and it is stored in `keuangan_source`: one row or none,
  replaced and never deleted. It is saved only after the sheet reads and parses cleanly. The page says
  when it was set, because a copy is a snapshot.
- **The reader fails rather than guesses** when the layout moves: columns are found by header text,
  a drifted `Link_raw` is refused, and the kept rows' Realisasi must match Finance's own total row. A
  wrong money total, or a receipt link that opens the wrong file, is worse than none. `/keuangan` then
  shows a banner; `/pengaturan` shows the specific reason.

## Consequences

- **The accepted cost: each copy is link-shared.** Anyone holding its URL can read every figure, the
  names in it and the receipt links, without signing in. The Grant protects the page, not the sheet.
  The URL is shown only to Administrators, on `/pengaturan`; the page's readers get the sheet id, the
  gid and when it was set, and the page links to no spreadsheet.
- **Reading money is open except here and on the Dashboard** ([ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md),
  [ADR-0037](./0037-dashboard-read-is-gated-by-a-grant.md)). This read is gated because it is
  Finance's sheet, with names and receipts, not the app's own records.
- **Six Grants exist again.** Keuangan implies nothing, and only Administrator implies it.
- **A provisional Realisasi looks final**, since the page shows the sheet as it stands. Accepted.
- **Deploy order:** the migration runs before the code, the reverse of #533, because the new code
  offers a Grant the old CHECK refuses.
