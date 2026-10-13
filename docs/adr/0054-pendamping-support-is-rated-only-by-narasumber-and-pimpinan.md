# Pendamping Support is Rated only by Narasumber and Pimpinan

The Perjadin Evaluation gains a fifth Aspect, **Pendamping Support**
([#481](https://github.com/sugt-itb/sugt-itb-26/issues/481)): whether the Pendamping — the DITSAMA
Staff who accompany the trip — helped while the activity was under way. The form asks it as a
statement, _"Pendamping membantu selama keberjalanan kegiatan."_, with a 1–10 Rating and an optional
Komentar, last, after Ketepatan waktu. Its short name elsewhere is **Bantuan Pendamping**.

**Only a filer who declares themselves Narasumber or Pimpinan is asked it**, and for them it is
required. A Pendamping is not shown it, and their evaluation stores neither a Rating nor a Komentar
for it. Settled with the product owner when the ticket was written.

## Why not everyone

The filer's Role is self-declared ([ADR-0024](./0024-perjadin-evaluation-is-filed-through-an-unauthenticated-token-link.md)),
and a Pendamping who Rates Pendamping Support is Rating themselves. That is the principle the four
evaluations already follow — a Participant is not asked their own readiness, the PIC is not asked
the teaching ([`data-model.md`](../data-model.md), _The four evaluations_). The Aspect exists to hear
how the accompaniment looked to the people accompanied; a Pendamping's own score of it would sit in
the same average and dilute exactly that.

Three shapes were weighed:

- **Everyone Rates it.** Simplest, and one form for all. Rejected for the reason above: self-Rating
  in the same column as the Rating it is meant to be judged by.
- **Narasumber and Pimpinan only** — chosen. The Role the filer has already picked decides it, so
  there is no extra control and nothing for a Pendamping to misread.
- **Everyone is shown it, with a _Tidak berlaku_ opt-out**, as lodging has _Tidak menginap_.
  Rejected: it leaves the choice to the filer, so a Pendamping could still Rate themselves, and a
  Narasumber could skip the one question the Aspect was added to ask. Lodging's opt-out answers a
  fact about the trip (there was no hotel); this one would answer nothing but willingness.

## Nothing is backfilled

`pendamping_support` and `pendamping_support_comment` are **nullable with no backfill**. Every
evaluation filed before the migration was filed through a form that never asked, so its honest value
is "not asked", which is NULL. Inventing a Rating for those rows — a 10, a mean — would put scores
nobody gave into the averages and the concerns list. A NULL behaves as `lodging`'s already does and
as `participant_feedback.hands_on_rbl`'s does: Postgres `least()` ignores it, so it never trips the
elaboration CHECK, never reaches the concerns index, and an average leaves it out.

Links already issued keep working and show the new question, with no new link: a link points at the
form and is never replaced ([ADR-0049](./0049-feedback-links-never-expire-and-are-never-replaced.md)).

## Where the rule lives

Three places, holding different amounts of it:

- **The form** hides the question until a Role is picked, shows and requires it for Narasumber and
  Pimpinan, and drops a Rating and Komentar already given on a switch to Pendamping.
- **The write** (`filePerjadinEvaluation`) holds both directions: it refuses a Pendamping Support
  Rating from a Pendamping filer and a missing one from a Narasumber or Pimpinan, as
  `ratings-mismatch`, the outcome `submitParticipantFeedback` gives Hands-on RBL. The list it reads,
  `PERJADIN_ASPECTS_BY_ROLE`, is in `@sugt/domain`.
- **The database** holds only the half it can: `perjadin_evaluation_pendamping_support_rater_check`,
  that a Pendamping filer's row carries neither the Rating nor its Komentar. It **cannot require**
  the Rating from Narasumber or Pimpinan, because their rows filed before #481 are legitimately null
  and a CHECK cannot tell them from a new row that skipped it. That half is recorded in
  [what the database does not hold](../data-model.md#what-the-database-does-not-hold).

The low-Rating rule is unchanged ([ADR-0023](./0023-perjadin-evaluation-has-a-comment-per-aspect.md)):
a Pendamping Support of 7 or below owes its own Komentar, and prose on another Aspect does not
satisfy it. `perjadin_evaluation_low_rating_needs_prose` gains a fifth conjunct, guarded by `is null`
as lodging's is, and `perjadin_evaluation_concerns_idx` is rebuilt over five Ratings.
