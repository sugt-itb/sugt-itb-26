# Pretest/Posttest completion is tracked as delivery, not outcomes

The tool is gaining a **Pretest/Posttest completion tracker** on `/monitoring` (plus a `/pretest`
editor). It records, per School, whether a Pretest — and later a Posttest — was **administered** to
each cohort. This is the first assessment-adjacent concept to acquire storage in a system whose
[ADR-0009](./0009-the-tool-tracks-delivery-not-outcomes.md) says the tool "tracks delivery, not
outcomes", so the modelling stance has to be written down before it drifts into an outcomes tracker.

## What existed before

"Pretest" and "Posttest" existed **only** as two hardcoded calendar bands in
`apps/internal/src/app/(app)/_calendar/calendar-derive.ts` (`PRETEST_POSTTEST_RANGES`) — decoration
on the calendar, no table, no domain term, no ADR. Nothing was stored, so nothing recorded whether an
assessment had actually happened at a School.

## The decision

A completion is tracked at the grain **(School × Stream × participant-type × kind)**, and **the
presence of a row _is_ "done"**.

- **`stream ∈ {STEM, Research}`** — the existing `STREAMS` const, reused, not redefined.
- **`participant_type ∈ {Siswa, GTK-MS}`** — a **dedicated** `PRETEST_PARTICIPANT_TYPES` const.
  `Siswa` is the Student Class; `GTK-MS` is the GTK and MS Classes taken together. Its values coincide
  with `TRANSACTION_PARTICIPANT_TYPES` today, but it is deliberately a separate const: the money axis
  and the assessment axis must be free to evolve independently, and a CHECK coupled to the other would
  ripple silently.
- **`kind ∈ {pretest, posttest}`** — added now. Only `pretest` is surfaced in the UI this iteration;
  the column and its CHECK carry `posttest` from the start so surfacing it later is a **UI-only
  change, not a migration**.
- **No `recorded_at` / `recorded_by`.** A completion is a bare tuple — no audit trail. Ticking a box
  inserts the row; un-ticking deletes it. A unique constraint on the four columns gives one row per
  box.
- **The denominator is always all 42 Schools**, derived from `schools.length` and **never stored** —
  the same "X / 42" pattern as `aggregates.ts` and `monitoring-derive.ts`.

### Why this is delivery, not outcomes

The tuple records **whether a Pretest was administered** to a cohort at a School — a yes/no about an
event happening — and never a score, a mark, or any measure of how the cohort _did_. That keeps it on
the delivery side of ADR-0009: the tool still tracks what was delivered, not what resulted. Storing a
score would be the line this ADR refuses to cross.

## The Kegiatan terlaksana denominator changes from ×8 to ×10

Folding Pretest and Posttest into the **Kegiatan terlaksana** progress metric changes its per-School
denominator from `schools × 8` to **`schools × 10`**: 2 offline + 6 online Sessions
([ADR-0027](./0027-a-sessions-sesi-is-its-per-school-date-rank.md)) + 1 pretest + 1 posttest. The
pretest and posttest units are **all-or-nothing per School**: a School's pretest counts as one done
unit only when all four of its pretest boxes (both Streams × both participant-types) are ticked,
likewise posttest. This ADR only records the intended denominator; the derivation change itself is a
separate ticket (#249).

## Alternatives considered

- **A `done` boolean column instead of presence-as-truth.** Rejected. With a bare tuple, "done" has
  exactly one representation — the row exists — so there is no "row present but `done = false`" state
  to reconcile. Un-ticking deletes, matching the checklist idiom already in the codebase.
- **Reusing `TRANSACTION_PARTICIPANT_TYPES`.** Rejected for the coupling reason above: two axes that
  happen to share values today are not one axis.
- **Storing the /42 denominator.** Rejected. Every existing progress readout derives it from
  `schools.length`; a stored copy is a second source of truth that can drift.

## Consequences

- New domain consts `PRETEST_PARTICIPANT_TYPES` and `ASSESSMENT_KINDS` in `@sugt/domain`; `STREAMS`
  reused.
- New `assessment_completion` table (`packages/db/src/schema/monitoring.ts`) with a unique constraint
  and three CHECKs mirroring the consts character for character.
- A read query open to any signed-in Person and a `Monitoring Editor`-guarded write
  ([ADR-0028](./0028-grants-are-a-second-additive-access-axis.md)), following the Monitoring
  Preparation exemplar.
- `CONTEXT.md` gains **Pretest** and **Posttest** glossary entries; `docs/data-model.md` documents the
  table.
- The `/pretest` editor (#247), the `/monitoring` tracker card (#248) and the Kegiatan terlaksana
  denominator change (#249) build on this foundation.
