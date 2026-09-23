# Perjadin Evaluation has a comment per Aspect, not shared Kendala and Saran

Perjadin Evaluation Rates four Aspects — **Lodging**, **Transport**, **Meals**, **Punctuality** —
and now carries one optional comment against each of them, in `lodging_comment`,
`transport_comment`, `meals_comment` and `punctuality_comment`. It began with two free-text boxes
shared across all four: `problems` (**Kendala**) and `suggestions` (**Saran**). This records why
that was reversed, what was deliberately lost with it, and the one thing this change adds that its
[#102](https://github.com/mafiefa02/sugt/issues/102) predecessor ([ADR-0017](./0017-participant-feedback-has-a-comment-per-aspect.md))
did not need.

## What the shared columns could not say

The one query the whole Rating design exists to serve is the concerns list: every Aspect anyone
Rated at or below the threshold, newest first, so a Cluster's problems are visible without opening
thirty Sessions ([`data-model.md`](../data-model.md), "The concerns list in full"). A concern is
one low Aspect with the prose written about it.

With a shared `problems`, a filer who Rated `transport` a 3 and wrote a Kendala about the hotel
produced a concern row on `transport` carrying prose about the accommodation. The prose and the
Rating it sat beside were about different subjects, and the list had no way to tell. A single
comment cannot say which of four Aspects it explains — exactly the problem #102 fixed for
Participant Feedback. One Komentar per Aspect makes each comment belong to the Rating it explains.

The concerns query expresses this the same way #102 did: it unpivots each Perjadin Evaluation row
into `(aspect, rating, said)` triples — `('transport', e.transport, e.transport_comment)`, and so
on — so a low Aspect shows the prose written about _that_ Aspect. It now shares the
`unpivotWithComment` helper with the Participant branch; the two are the sources whose prose is
per-Aspect.

## The per-Aspect elaboration rule

This is what Participant Feedback did not need. A Perjadin Evaluation is filed by a signed-in Group
member who _owes_ an explanation for a low score — the discipline `class_record` and
`session_record` also carry, and which #102 pointedly left off `participant_feedback`. That
discipline stays, but retargeted: `perjadin_evaluation_low_rating_needs_prose` is no longer the
trip-wide `least(...) > 7 or problems <> ''`. It is now a **per-Aspect conjunction** — each Aspect
is either not-low or carries its own non-blank comment, and all four must hold:

```sql
check (
  (lodging is null or lodging > 7 or btrim(coalesce(lodging_comment, '')) <> '')
  and (transport   > 7 or btrim(coalesce(transport_comment, ''))   <> '')
  and (meals       > 7 or btrim(coalesce(meals_comment, ''))       <> '')
  and (punctuality > 7 or btrim(coalesce(punctuality_comment, '')) <> '')
)
```

So a low `transport` can only be filed with prose _on `transport`_; a comment about the meals no
longer excuses it. The comment is always fillable on any Aspect, low or not — the rule only
_forces_ it when that Aspect is low. `lodging` is guarded by `is null` first, the same way
Postgres `least()` drops a skipped hotel out of the minimum: a day trip owes no lodging comment.
The rule holds in three places — the client form (for the message, per-Aspect), the query
(`filePerjadinEvaluation`), and the CHECK behind them.

## What is deliberately retired

**The trip-wide Saran box is gone, not moved.** `suggestions` / **Saran** ("what to do
differently") was forward-looking advice about the trip as a whole, with no per-Aspect home. There
is no `*_suggestion` column to receive it. This is an accepted loss: a suggestion now lives inside
the relevant Aspect's Komentar ("the car was late, book earlier next time"), or it is not recorded.
Keeping a shared Saran box beside four per-Aspect comments would reintroduce the very ambiguity this
change removes — a second place for prose that belongs to no Rating.

## What is deliberately unchanged

- **The four Ratings, `lodging` nullable, the "Tidak menginap" day-trip path, the one-per-filer
  unique, and Group-member-only filing** are untouched. `PERJADIN_ASPECTS` stays four Aspects; the
  domain constant does not change.
- **The concerns index and threshold** are unchanged — the index is over `least(ratings)`, which
  the new text columns do not touch.

## The cost, and why it is accepted

There is no backfill. The columns are nullable, `perjadin_evaluation` has no seed rows, and no
Perjadin has been evaluated yet, so no real prose is lost — but the migration does `drop column
problems, suggestions`, so any pre-existing free-text would be dropped rather than migrated. That
is correct precisely because of the problem above: an old shared Kendala cannot be honestly
attributed to one Aspect, so there is no right column to move it into. Dropping it is the honest
outcome of admitting it was never attributable — the same argument ADR-0017 made for the shared
`comment`.

The form grows from two boxes to four, one under each Aspect's rating row. That is more to fill,
but every box is optional unless its Aspect is low, and labelled by its subject ("Komentar
Penginapan"), so a filer explaining one low score writes one sentence and leaves the rest empty —
the common case, an overnight trip that went well, stays cheap.
