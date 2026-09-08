# A Session's "Sesi" is its per-School date rank, not a stored ordinal or a calendar window

`/monitoring` shows Sessions grouped as "Sesi 1", "Sesi 2", and so on, and the coverage matrix reads a
School's progress one Sesi at a time. That labelling needed a precise meaning, because the glossary
had said a Session carries **no** ordinal and the "Sesi 1/2/…" labels were cosmetic. This settles
what a Sesi is: a Session's Sesi is its **per-School, per-mode date rank**, computed on the fly.

## What it was

`CONTEXT.md` stated that a Session has no ordinal — a School simply receives some Sessions of each
mode — and that any "Sesi N" label a screen showed was decorative, not a stored or derived fact. The
`/monitoring` scaffold (#178) rendered "Sesi 1/2" against mock data with a note flagging exactly this
gap: the labels meant nothing until the domain settled what they rank. Nothing in the schema carries
a Session ordinal, and this decision keeps it that way.

## The decision

**A Session's Sesi is its rank when a School's Sessions of one mode are ordered by `(held_on,
starts_at)`.** The earliest is Sesi 1, the next Sesi 2, and so on.

- **Per School and per mode.** Ranking is scoped to one School and one mode (offline / online); a
  School's Luring Sesi 1 is unrelated to another School's, and offline and online rank separately.
- **Computed on the fly, never stored.** The rank is derived from the ordered rows at read time.
  There is no ordinal column, so it cannot be typed wrong and it needs no backfill.
- **Cancelled Sessions are skipped.** Ordering counts only Sessions that still stand; a cancelled
  Session yields its rank, so a re-delivered replacement takes the earlier number rather than
  inheriting a gap. Ranking over the live Sessions is what makes "Sesi 1 not yet delivered" true
  again after a cancellation.
- **Window-independent.** The rank does not depend on when a Session was delivered relative to the
  planned Luring windows (`LURING_SESI_WINDOWS`). A Session delivered late is still ranked by its
  date; the windows drive the timeline and overdue warnings, not the numbering.

Offline is **2** Sessions per School now (down from 4; online stays 6), so the two Luring Sesi are
exactly the two offline ranks. That count is a programme fact carried in `SESSIONS_PER_SCHOOL`, and it
makes every "delivered / N" readout "/ 8" per School.

## Alternatives considered

- **A stored ordinal column on `session`.** Rejected. It would have to be assigned at arrange time and
  kept correct across cancellation, re-delivery and date edits — a maintained invariant the database
  cannot express, for a number that is fully derivable from the dates already stored. A derived rank
  cannot drift from the rows it ranks.
- **Bucketing Sessions by the planned Luring windows.** Rejected. Making "Sesi 1" mean "delivered
  inside the Sesi 1 window" conflates _which_ Sesi a Session is with _whether it was on time_: a
  Session delivered a week late would either fall into no Sesi or jump to the next one, and a School
  that ran both Sessions early would show two in one bucket and none in the other. Rank answers "which
  Session is this" from the dates; the windows answer "is it on time" separately, which is what the
  overdue warnings need.

## Consequences

- The glossary's "Sesi labels are cosmetic" line is retired: the labels are a real, derived rank, and
  `CONTEXT.md`'s Session entry and the `/monitoring` open question say so.
- `/monitoring`'s wiring ticket (#196) computes the rank in its queries and reconciles spend against
  `PROGRAMME_BUDGET_IDR`; it consumes `LURING_SESI_WINDOWS` for the timeline and overdue warnings, not
  for numbering Sessions.
- The offline count dropping to 2 is app-wide: every progress denominator that reads
  `TOTAL_SESSIONS_PER_SCHOOL` now reads 8, with no code change beyond the constant because every
  consumer references the symbol.
