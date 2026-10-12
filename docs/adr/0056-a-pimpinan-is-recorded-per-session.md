# A Pimpinan is recorded per Session

A **Pimpinan** who joins a trip is now recorded on the **Sessions** they attended, not on the
**Perjadin** as a whole ([#492](https://github.com/sugt-itb/sugt-itb-26/issues/492)). Each offline
Session carries the set of Pimpinan who were there, picked from the Pimpinan roster, the same way
"Diajar oleh" records which Narasumber taught it. The trip-level `perjadin_pimpinan` table
([#181](https://github.com/mafiefa02/sugt/issues/181)) is gone. Settled with the product owner when
the ticket was written.

A Pimpinan stays **record-only**
([ADR-0020](./0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md),
[ADR-0025](./0025-pimpinan-is-a-second-signed-in-read-only-person-role.md)): not a working Group
member, filing no Perjadin Evaluation as a member, adding nothing to the Preparation Checklist. Only
_where_ they are recorded changes.

## Why

A trip covers several Schools over several days, and a Pimpinan often attends only some of them. A
trip-level record said "came on the trip" and nothing about where, so the Laporan named a leader for
visits they were not at.

## Considered options

- **Trip-level (the old model).** One list per Perjadin. Cheapest, and it cannot say where anyone
  was, which is the whole complaint.
- **Per School.** One list per School on the trip. Closer, but a School can hold several Sessions on
  different days, and a Pimpinan at the Monday Session is not at the Wednesday one. It would also
  need its own table keyed on a trip's School, which the schema does not otherwise have: a trip's
  Schools are derived from its Sessions (ADR-0044).
- **Per Session (chosen).** One set per Session, shaped like `session_teaching_team`. It says
  exactly who was where, and every reader that wants the coarser view derives it.

## The decision

- **`session_pimpinan (session_id, person_id, role)`** replaces `perjadin_pimpinan`. It keeps #181's
  guarantee: `role` is pinned to `'Pimpinan'` and the composite foreign key
  `session_pimpinan_is_pimpinan` into `person (id, role)` refuses anyone else. It cascades with its
  Session, like `session_teaching_team`.
- **The trip's Pimpinan are derived, never stored**: everyone recorded on at least one of its
  **non-cancelled** Sessions. A stored trip list could disagree with its Sessions'; a derived one
  cannot. One query (`tripPimpinan`) serves every reader — the Perjadin page, the Laporan and its
  CSV, the `/pendamping` card — so none can count a Session the others skip.
- **A cancelled Session keeps its Pimpinan but stops contributing.** Cancelling records an attempt
  that did not happen (ADR-0006); its row still shows who was meant to be there, but nobody came on
  the trip through it.
- **Set in the Session dialog and the Rencanakan form**, by the same people who edit a Session
  today (ADR-0048; Rencanakan stays a Perjadin Editor's, ADR-0047). The trip page's Pimpinan
  section becomes a read-only list, each name followed by the Schools they were recorded at.
- **A delivered Session's Pimpinan stay writable.** Its School, date and time are settled, so the
  Session dialog is offered only while it is arranged; but who attended is often recorded after the
  trip, and the backfill below leaves Pimpinan on Sessions they missed. So a delivered Session has
  its own **Ubah Pimpinan**, which changes the Pimpinan alone, for the same writers. A cancelled
  Session's are left as they were: it no longer counts.
- **A new pick must be on the roster; a recorded one may stay.** Every id is checked against the
  active Pimpinan roster, as before, except one already on that Session: a Pimpinan revoked since
  still attended, and re-saving the Session must not refuse them.
- **The migration copies each trip Pimpinan onto every live Session of that trip**, which keeps the
  old meaning ("came on the trip"); writers then remove them from the Sessions they missed. A trip
  whose Sessions are all cancelled copies onto all of them, so nothing is lost. A trip with no
  Session at all has nowhere to keep its Pimpinan; those rows are dropped with the table, and the
  migration test shows the query that counts them (expected: none on the live data). `0054` drops
  `perjadin_pimpinan` in the same migration.

## Consequences

- **The build and `0054` go live together.** The build before this one reads `perjadin_pimpinan` and
  this one reads `session_pimpinan`, so between the two the trip, Laporan and `/pendamping` pages
  fail. Apply `0054` straight after this build is live.
- **Past trips need narrowing by hand.** After the migration, a past trip's Pimpinan sit on every
  one of its delivered Sessions until someone removes them, Session by Session, through Ubah
  Pimpinan.
- **The Perjadin Evaluation is unaffected.** A Pimpinan who files one still self-declares the Role on
  the token link (ADR-0024); that string is unrelated to this record.
