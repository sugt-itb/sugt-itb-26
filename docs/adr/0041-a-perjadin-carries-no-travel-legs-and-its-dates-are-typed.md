# A Perjadin carries no travel legs, and its dates are typed

A Perjadin no longer records a **Keberangkatan** or a **Kepulangan**: no departure or return date,
time, time zone or transport mode. The six leg columns on `perjadin` (`departure_at`,
`departure_zone`, `departure_mode`, `return_at`, `return_zone`, `return_mode`) are dropped with their
four CHECKs, and `TRANSPORT_MODES` leaves `@sugt/domain`. The trip's range is typed again, as two
required dates — **Tanggal mulai** and **Tanggal selesai** — written straight to `starts_on` and
`ends_on`, on the plan form and on the trip page's **Ubah tanggal** editor.

This **supersedes [ADR-0021](./0021-perjadin-date-range-is-departure-and-return.md)**, which made the
range the departure→return span.

## Why

Many trips are done **PP** (_pulang-pergi_): the Group goes to a nearby Sub-Cluster and comes back,
sometimes every day of the trip. One Keberangkatan and one Kepulangan, each with a time and a mode,
describe a journey that does not happen — the planner had to invent a departure and a return to get
past the form. The trip's real facts are when it starts and when it ends, so those are what the form
asks for.

## Considered options

- **Keep the leg columns, nullable and unused.** Rejected: dead columns invite resurrection. A reader
  sees a `departure_mode` and builds on it, and the schema says something about trips that is no
  longer true.
- **Derive the dates from the first and last Session.** Rejected: the range would move every time a
  Session is arranged, edited or cancelled. A Perjadin's dates are what the trip was planned and
  approved for; a Session falling outside them is the error, not a reason to stretch them.
- **Typed dates (chosen).** `starts_on`/`ends_on` were never dropped — ADR-0021 kept them as
  stored-but-derived — so they simply become the source again.

## Consequences

- **The legs' data is deleted.** The migration drops the columns outright; nothing is backfilled or
  archived. Accepted: no screen or report reads them after this change.
- **Resize and clamp survives unchanged.** `updatePerjadinLogistics` becomes
  `updatePerjadinDates({ startsOn, endsOn })`, with exactly ADR-0021's semantics: it locks the trip
  and its **arranged** Sessions and refuses the whole edit (`would-strand`) if any would fall outside
  the new range. No Session is ever moved. A moved `starts_on` still renames the trip's Drive folder
  (#376).
- **`return-before-departure` becomes `ends-before-starts`**, at planning and on the edit, same day
  allowed. `perjadin_dates_check` (`ends_on >= starts_on`) stays at the database.
- **The automatic return time zone (`deriveReturnZone`) is gone**, with nothing to replace it: there
  is no return time for a zone to qualify.
- **The Report deadline is unchanged**: still `ends_on + REPORT_DEADLINE_DAYS_AFTER_RETURN`.
  _Amended 2026-10-13: there is no Report deadline any more
  ([ADR-0055](./0055-the-perjadin-report-is-neither-filed-nor-due.md))._
- **The Preparation Checklist drops from seven boxes to six.** "Tiket keberangkatan" and "Tiket
  kepulangan" become one **"Tiket / transportasi PP"** (`tiket_pp`). Ticks stored on the two retired
  keys stay in `perjadin_preparation_item` as ignored orphans, exactly like the old `dosen:` ones
  ([ADR-0018](./0018-the-preparation-checklist-stores-ticks-and-derives-the-list.md)).
- **The `/pendamping` trip timeline shows Sessions only**, and the `/perjadin` list's Keberangkatan /
  Kepulangan columns become **Mulai** / **Selesai**.
