# Online Sessions are no longer single-Stream

An **online Session** no longer carries a **Stream**. The `stream` column stays on `session`, but it
is now **required for offline only** — an online row leaves it null — and the online uniqueness index
`session_one_online_per_school_per_day` **drops `stream` from its key**, so the rule is the plain one:
**one online Session per School per day**, whatever else. Stream (STEM/Research) is unchanged for
**offline** Sessions.

This **supersedes the single-Stream half of [ADR-0022](./0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md)**.
The session-scoped free-text `session_teacher_name` teachers that ADR-0022 also introduced are
unaffected and stay.

## Why

Online delivery is now run by a **third-party LMS provider**, and the schedule is a single Zoom-hosted
occasion per School per day rather than a STEM/Research split the tool arranges. Modelling an online
Session as single-Stream — and keying its uniqueness index on `(school_id, held_on, stream)` so a
School could hold a STEM _and_ a Research online Session on one date — described a distinction the tool
no longer makes online. The STEM/Research split remains real **offline**, where DITSAMA still arranges
the teaching, so `stream` and its offline index are untouched.

## The decision

- **`stream` is required for offline only.** The unconditional `session_stream_not_null` CHECK
  (ADR-0022) becomes `session_offline_stream_not_null`: `mode <> 'offline' or stream is not null`. An
  online row may hold a null `stream`; `session_stream_check` still pins the value set for the rows
  that carry one.
- **The online index keys on `(school_id, held_on)`.** `session_one_online_per_school_per_day` drops
  `stream`, staying partial on `perjadin_id is null and status <> 'cancelled'`. A second still-standing
  online Session for a School on a date is refused, whatever the hour or (absent) Stream.
- **The write and edit paths drop Stream.** `arrangeOnlineSession` and `updateOnlineSession` no longer
  take or set a Stream; the arrange form and the `/sesi-daring/[id]` edit dialog drop the **Aliran**
  control; the collision surfaces to the user as "already a Session that day".
- **Offline is untouched.** `session_no_duplicate_offline_per_school_per_perjadin` still keys on
  `stream`, and an offline Session still must carry one.

## Consequences

- Existing online rows keep whatever `stream` value ADR-0022 gave them; nothing reads it, and the
  offline-only CHECK does not constrain them. New online rows have a null `stream`. Nulling the old
  values was judged not worth a data migration.
- **The narrowed unique index needs the data to already be unique.** ADR-0022 permitted a school to
  hold a STEM _and_ a Research still-standing online Session on one day, so a populated database may
  carry a same-day pair that `CREATE UNIQUE INDEX (school_id, held_on)` would reject. Migration 0028
  therefore runs a **pre-index dedupe first**: it cancels the redundant still-standing _arranged_
  online Sessions per (school, day) — keeping a delivered one, else the earliest — so at most one
  still stands, then builds the index. Cancelled rows carry a reason and fall out of the partial
  index; **delivered** rows are never auto-cancelled, so two delivered online Sessions on one
  school-day (a genuine history conflict) surface as a duplicate-key error for a human rather than
  the migration rewriting a delivered record. This is what makes the migration apply against
  populated data, not only from empty.
- This ships with [ADR-0035](./0035-online-sessions-track-no-pic-and-file-no-session-record.md) (online
  Sessions track no PIC and file no Session Record) as the two halves of the same #284 change; it is
  the **subtractive** follow-up to the additive #283 (Peserta, Jam Selesai, WIB, Pengajar cap).
- It is **hard to reverse**: it drops a column's not-null guarantee and an index key. Reinstating a
  per-Stream online model would need the data backfilled and the index widened again.
