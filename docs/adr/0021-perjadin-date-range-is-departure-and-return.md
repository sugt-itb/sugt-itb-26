# A Perjadin's date range is its departure and return dates

A Perjadin's stored range **is** its travel legs: `starts_on = date(departure_at)` and
`ends_on = date(return_at)`. The range is no longer a pair of hand-typed fields. It is derived from
the departure and return dates at every write — planning (`/perjadin/baru`) and the logistics
edit (`/perjadin/[id]`) alike — and the "Mulai"/"Selesai" date inputs are gone from both surfaces.

This is scoped to the **stored range's source**, not its storage. `starts_on`/`ends_on` stay as
`date` columns on `perjadin`; only where their value comes from changes. Every reader and guard — the
Perjadin list, detail and laporan, the report-deadline, the Session-in-window invariant, the Session
date-picker bounds — reads the same two columns as before.

## Why

A trip already carries its departure and return dates as travel logistics
([#106](https://github.com/mafiefa02/sugt/issues/106)), and those _are_ when the trip starts and
ends. A separate typed range was a second source of truth for the same fact: it could drift from the
legs, and the planner had to enter the span twice — once as Mulai/Selesai, once as the departure and
return dates. Deriving the range from the legs removes the drift and the double entry.

## Considered options

- **Drop `starts_on`/`ends_on` and compute the range from the legs on read.** Rejected here: every
  reader and guard already reads the two columns, and old rows predating the logistics columns have
  null legs but a real stored range. Keeping the columns as **stored-but-derived** leaves all of that
  untouched and migrates no data.
- **Auto-shift Sessions when a leg date moves**, the way the retired `movePerjadinDates` did — offset
  each arranged Session by the days the start moved. Rejected: a leg-date correction is a resize, not
  a translation, and silently moving a School's Session to a new day is the opposite of what a
  correction means. The edit **clamps** instead (below).
- **Range is the departure→return span, kept as stored-but-derived columns, edited by the legs
  (chosen).**

## Consequences

- **`starts_on`/`ends_on` are stored-but-derived**, not dropped and not migrated. They are written
  from `departure.date`/`return.date` at plan time and at every logistics edit; `perjadin_dates_check`
  still holds `ends_on >= starts_on` at the database.
- **Leg-date edits are resize + clamp, never auto-shift.** `updatePerjadinLogistics` recomputes the
  range from the new leg dates and, if the new `[departure … return]` window would leave an
  **arranged** Session outside it, refuses the whole edit (`would-strand`) — no Session is moved.
  Delivered and cancelled Sessions may sit outside the window their trip now claims and do not block
  the edit, the same arranged-only scope the invariant has always had (`docs/data-model.md`,
  Delivery). The standalone "move dates" editor and its `daysBetween` shift retire with the typed
  range.
- **A return date before the departure date is refused** (`return-before-departure`), same-day
  allowed, both at planning and on the logistics edit — the guard that used to read
  `ends_on < starts_on`.
- **Pre-legs Perjadins are unchanged on read.** A row with null `departure_at`/`return_at` keeps its
  stored range and displays as before; editing it requires the (already-mandatory) leg fields, which
  then set the range.
