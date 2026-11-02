# A School may hold several online Sessions on one day

The database no longer limits how many online **Sessions** a School holds on one calendar day
([#531](https://github.com/sugt-itb/sugt-itb-26/issues/531)). The unique index
`session_one_online_per_school_per_day` is dropped, and with it the refusal on every screen that
records, edits or moves an online Session. Two online Sessions at one School may now share a date and
even an exact start time. This amends the uniqueness decision in
[ADR-0034](./0034-online-sessions-are-no-longer-single-stream.md); its decision on Stream stands.

## Why

A School can really hold more than one online Session on a day, for example an asynchronous Sesi daring
on the same date as another online Session. The index refused to record that, and a planned bulk entry
of asynchronous Sessions already hits it at 3 Schools in production.

## The alternative that was rejected

Narrowing the index to `(school_id, held_on, starts_at)`, the rule offline Sessions keep. It was
considered and rejected in favour of removing the rule completely.

## Consequences

- **Exact duplicates are the accepted cost.** Nothing stops an accidental one, and no guard, warning or
  confirmation step replaces the index. It counts as delivered until someone removes it with the existing
  hard delete, `deleteOnlineSession`.
- **The offline rule is unchanged.** `session_no_duplicate_offline_per_school` and its double-booking
  checks stay exactly as they were.
- **Six online Sessions stays a target, not a cap.** `SESSIONS_PER_SCHOOL` is unchanged, and extra
  Sessions can take the Daring figure past 100%, as they already could.
- **Sesi numbering is unchanged.** `bySesiRank` orders by `(held_on, starts_at, id)`, so same-day
  Sessions already have a stable order and get consecutive numbers.
- **Deploy order matters.** The index and the `on conflict` that named it had to change together.
  Postgres rejects an `on conflict` target that no index matches, so the old code on the new schema
  breaks every online save. Ship the code and migration together, or deploy the code first: new code on
  the old index works, except that a same-day duplicate is a server error until the migration runs.
