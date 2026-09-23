# Perjadin Evaluation is filed through an unauthenticated token link, not a signed-in Group member

A Perjadin Evaluation is now filed **without signing in**, through a short-lived token link shared
from the trip's page, by a filer who self-declares a **Role** (`Pengajar` / `Pendamping` /
`Pimpinan`) and a **Name**. This reverses two standing decisions: that _only the Group that
travelled may file one, at most one each_, and that a **Pimpinan** _files no Perjadin Evaluation_.
It records why, and what is deliberately given up with them.

## What it was

A Perjadin Evaluation began as a signed-in write. The `/perjadin/[id]` page offered a
`PerjadinEvaluationDialog` only to a Group member (`filed_by_person_id` referenced `person`), and
`filePerjadinEvaluation` re-checked membership of the trip's `group_member` and refused everyone
else with `not-a-group-member`. A `unique (perjadin_id, filed_by_person_id)` held one-per-filer, and
a second attempt came back `already-filed`. It was open to any signed-in caller — not Staff-only,
because it carries no money (ADR-0004) — but "signed in" was the floor.

## Why that was wrong

The people best placed to say how a trip went are not all signed in. Since T3 (ADR-0020, ADR-0022)
the **Teaching Team** are trip-scoped and session-scoped **free-text names** who never sign in, and
the **Pimpinan** are a fixed set of three **record-only** names, also with no login. The signed-in
Group gate admitted only the DITSAMA Staff who travelled (the **Pendamping**) and silently excluded
exactly the voices — the Pengajar who taught, the Pimpinan who came to monitor — the evaluation most
wants to hear from. A form that cannot reach two-thirds of the people it asks about is answering the
wrong question.

## The decision

Retarget Perjadin Evaluation onto the **Participant Feedback** token pattern
([ADR-0012](./0012-participants-write-through-a-short-lived-session-token.md)), which already solved
"a write by someone with no account":

- A new `perjadin_feedback_token` table mirrors `session_feedback_token`, keyed on `perjadin_id`
  (so a reissue **replaces** the row and the old link dies), with a 14-day lifetime —
  `PERJADIN_FEEDBACK_TOKEN_LIFETIME_HOURS`, far longer than the Session token's 24 hours because the
  link is shared by hand after the trip, not scanned in the room. Any signed-in Person may issue it
  (ADR-0004), and the trip page shows a QR/link dialog instead of the old form.
- `filePerjadinEvaluation` takes a `PerjadinToken` — the caller the app produces by resolving the
  token, one arm over from `ParticipantToken` — not a `Person`. The submit action re-resolves the
  token server-side, so a form held open past expiry or a reissue fails.
- Identity is **self-declared and untrusted**, exactly as `participant_feedback.name` is:
  `filed_by_role` is one of the three values a CHECK admits (`PERJADIN_EVALUATION_ROLES`), and
  `filed_by_name` is free text referenced by nothing. `filed_by_person_id` and its foreign key are
  dropped.
- The one-per-filer `unique` is **dropped**. With no account behind a submission there is nothing to
  dedup on, and — like Participant Feedback — there is deliberately no rate limiting: junk reaching
  the concerns list is the accepted cost (ADR-0012).

**Pimpinan and Pengajar may now file.** The glossary's _"a Pimpinan files no Perjadin Evaluation"_
and _"every member of a Group may file one… and nobody else may"_ are amended in `CONTEXT.md`.

## What is deliberately kept

- **#163's per-Aspect comment model is untouched** ([ADR-0023](./0023-perjadin-evaluation-has-a-comment-per-aspect.md)):
  the four `*_comment` columns, the per-Aspect elaboration CHECK (`perjadin_evaluation_low_rating_needs_prose`),
  the nullable `lodging` with its "Tidak menginap" day-trip path, and the concerns index all stand
  as they were. This ticket changes _identity and access_, not the Aspects or their comments.
- **`concerns.ts`'s rating and comment model is unchanged** — it unpivots the same four Aspects and
  per-Aspect `*_comment`s (`unpivotWithComment`) exactly as [ADR-0023](./0023-perjadin-evaluation-has-a-comment-per-aspect.md)
  left them. Its one edit follows the identity change: `who` moved from the filer's `person.full_name`
  (joined on the now-dropped `filed_by_person_id`) to the self-declared `filed_by_name`, mirroring how
  the Participant-Feedback branch already reads its `who` off `participant_feedback.name`.

## What is deliberately given up

- **Who filed is now a self-typed string, not a `person`.** The tool cannot prove a submission came
  from someone who was on the trip, or dedup two from one person. That is the same trade ADR-0012
  accepted for Participant Feedback: the evaluation is _indicative, not a census_. Validating the
  declared Role/Name against the Group or the `PIMPINAN` enum was considered and rejected — the
  identity is untrusted by design, and a Pengajar has no row to validate against anyway.
- **The link is unauthenticated and shared by hand.** Anyone holding it may file, as many times as
  they like. `/ep/{token}` is excluded from the proxy cookie-redirect matcher, the second such hole
  after `/f/{token}`, and both are the ones a reviewer should scrutinise.
