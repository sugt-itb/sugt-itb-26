# The data model

What is stored, and which rules the database holds rather than the application.

This assumes the vocabulary in [`CONTEXT.md`](../CONTEXT.md) and the surfaces in
[`docs/product.md`](./product.md). Why the vendor and the boundaries are what they are is in
[ADR-0005](./adr/0005-postgres-for-the-invariants-not-the-scale.md) and
[ADR-0011](./adr/0011-supabase-and-better-auth.md).

Postgres and object storage are Supabase; both apps deploy to Vercel.

Every SQL block below was applied to a real Postgres, seeded with the actual forty-two Schools
from `packages/db/seed/reference-data.sql`, and then attacked with the case each constraint is
meant to reject — 54 checks, all behaving as claimed. Where this document says a rule is
enforced by the database, that was verified rather than assumed; where it says a rule is not,
that is in [what the database does not hold](#what-the-database-does-not-hold).

**Except where a section says otherwise.** Several changes are decided but **not yet applied**,
and each says so where it appears. Nothing else in this document describes a schema that does
not exist, and nothing in this list has been checked against a real Postgres the way the rest
was:

| Decided, not applied                            | Where                                       |
| ----------------------------------------------- | ------------------------------------------- |
| `perjadin_evaluation.lodging` becoming nullable | [Perjadin Evaluation](#perjadin-evaluation) |

One of these carries a claim worth verifying rather than assuming when the migration lands:
`least()` ignoring NULLs, which is what lets a nullable `lodging` leave the elaboration rule
intact.

**Five rows left this list.** `story` and `story_photo` are applied, by migration `0005`.
`transaction.category` and `transaction.incurred_by_person_id` are applied, by migration `0006`
— note that it adds `category` as `NOT NULL` with no default and no backfill, which is correct
only because no Perjadin has been filed and the table is empty everywhere; it fails loudly
rather than guessing a value if that ever stops being true.

The partial `person_email_key` and the four hand-declared
`better_auth` tables are applied, by migrations `0002` and `0003`. So is
`session_one_online_per_school_per_day`, by migration `0004`, which
[#27](https://github.com/mafiefa02/sugt/issues/27) wrote because Jadwalkan Sesi daring is the
screen that makes it necessary. The claim this list held against that index — _"the new partial
index actually rejecting a second online Session for one School on one day"_ — was checked
rather than assumed: `apps/internal/tests/arrange-online-session.test.ts` drives it at the
database, in both the ways it is partial and in both directions. All three were checked against
a real Postgres the way the rest of this document was.

The blocks are ordered for reading, by topic, **not** in dependency order — `session`
appears before the `perjadin` it references. Migrations need reordering: reference data,
then `person`, then `perjadin` and `group_member` (the deferred foreign key between them
last), then `session` and what hangs off it.

---

## The glossary is not the schema

`CONTEXT.md` defines around thirty terms. Far fewer are tables, and that is deliberate — the
list below exists so nobody later "completes" the schema by adding the rest.

| Term                                                         | Where it lives                                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Programme, Track, Kementerian Pendidikan Tinggi, DITSAMA ITB | Nowhere. There is one of each; naming them in a table says nothing.                                                                                        |
| Stream, Class kind, Session mode, Role                       | `@sugt/domain`, as `as const` arrays. Fixed sets, not rows.                                                                                                |
| Class                                                        | Not a table. A Class is `(school_id, class_kind)` — three per School, by construction.                                                                     |
| GTK Class, MS Class, Student Class                           | The three values of `class_kind`.                                                                                                                          |
| Perjadin Report                                              | Not a table. It is the acquittal state on `perjadin` — see [Money](#money).                                                                                |
| Participant                                                  | Not a table. Nobody enrols Participants; one exists in the records only as a name they typed on their own feedback.                                        |
| Project Team, Final Project                                  | Not stored at all. [ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md) is explicit; they reach the public as curated pieces, never as records. |
| Treasurer                                                    | Not a role. A Treasurer is Staff; what is stored is that an Advance was returned, not to whom.                                                             |
| Advance                                                      | A column on `perjadin`, not a row. It is fixed at planning and never exists independently.                                                                 |
| Report deadline                                              | Not a column. Two days after the Group returns, derived from `perjadin.ends_on` and a constant.                                                            |
| Aspect                                                       | Not a table and not a value. Every Aspect on all four evaluations is a **column**; `@sugt/domain` names each rubric.                                       |
| Rating                                                       | Not a table. A Rating is one Aspect column on one row of an evaluation.                                                                                    |
| Transaction category                                         | Not a table. A `text` column on `transaction`, CHECKed against a closed set — see [Money](#money).                                                         |
| Story kind                                                   | Not a table. A `text` column on `story`; field narrative or a Final Project piece, and nothing else differs between them.                                  |

Every CHECK constraint value list in this document is **character-for-character** an
`as const` array in `packages/domain/src/index.ts` — `STREAMS`, `CLASS_KINDS`,
`SESSION_MODES`, `SESSION_STATUSES` and `ROLES` — and the Rating bounds come from
`RATING_MIN`/`RATING_MAX` there too. That is the point: no mapping layer, and drift between
the two is visible by reading them side by side. A new fixed set belongs in both places or
neither.

A column CHECKed against a **whole** set is read back as that set's type rather than as
`string`. A column CHECKed against a **single member** of one — `perjadin.pic_role`,
`session.online_pic_role` and the two `filed_by_role` columns — now carries that member as a
literal type too: [#52](https://github.com/mafiefa02/sugt/issues/52) settled it, so each reads
back as `"Staff"` — or `"Teaching Team"` on the now-dead `class_record.filed_by_role` — via
`$type<"Staff">()` rather than `string`. (`session_teacher.person_role` was one of these until T3
dropped the table, [#153](https://github.com/mafiefa02/sugt/issues/153).) Neither is DDL, and the
header of `packages/db/src/schema/index.ts` carries the reasoning.

The four Aspect lists are the exception — `CLASS_RECORD_ASPECTS`, `SESSION_RECORD_ASPECTS`,
`PARTICIPANT_FEEDBACK_ASPECTS` and `PERJADIN_ASPECTS` name **columns** rather than stored
values, so each form and the concerns query are built from the same list the table is. Adding an
Aspect is a migration, which is the correct cost for a set that decides how teaching is judged.

---

## Two Postgres schemas

Better Auth's core tables are `user`, `session`, `account`, `verification`. **`session` is the
single most load-bearing word in this glossary** — a teaching occasion at one School — so the
library does not get to own it in `public`.

- `better_auth` — `user`, `session`, `account`, `verification`, declared **by hand** in
  `packages/db/src/schema/` like every other table, inside the `pgSchema("better_auth")` object
  and handed to `drizzleAdapter` through its `schema` option. Supabase's own `auth` schema is
  taken by GoTrue and owned by `supabase_auth_admin`, so this is a new schema rather than a
  shared one.
- `public` — the domain, including `public.session`, which means a Session.

**They are hand-written because the CLI cannot produce them.** This document previously said
"generated by the Better Auth CLI, never hand-edited", and that is not achievable: the
generator only ever emits `pgTable` — `pgSchema` appears nowhere in its bundle, and there is no
flag or config key that schema-qualifies a table — while `auth migrate` refuses the Drizzle
adapter outright (`if (db.id !== "kysely")`), telling you to run `auth generate` and apply with
drizzle-kit. Better Auth does understand a Postgres `search_path`, but only on the Kysely path,
which exits before doing anything here.

What makes the hand-written version work is that **the adapter never builds a table-name
string**: it looks each model up as a key in the schema object you pass, so a table built with
`pgSchema("better_auth").table("user", …)` emits `better_auth."user"` by itself. This is the
path Better Auth's own Drizzle documentation sanctions — _"modifying the Drizzle schema
directly"_. `auth generate` is run once for the column list and thereafter is a reference to
diff against on upgrade, not a step in any workflow. Its output is kept verbatim at
`packages/db/reference/better-auth-1.6.27.generated.ts` so there is something to diff against.
**The Drizzle property keys in the hand-written tables are the library's field names**, because
the adapter resolves a field by key lookup — renaming one breaks it at runtime and not at
typecheck.

Verified against `better-auth@1.6.27`; see
[`docs/research/better-auth-capabilities.md`](./research/better-auth-capabilities.md), which is
a version-pinned snapshot rather than durable documentation.

---

## Identity

Better Auth's `user` is a sign-in credential. **`person` is the human**, and every domain
foreign key in this document points at `person.id` and never at `user.id`.

The reason is concrete rather than architectural: a Group is assembled when a Perjadin is
planned, and a professor may be named to it months before they first sign in. A domain that
FKs into `user` cannot express that. It also means a Better Auth major version cannot ripple
into Perjadins, and the invite list is a list rather than a state ("user rows that have never
signed in").

```sql
create table person (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text not null,
  role        text not null check (role in ('Staff', 'Pimpinan')),  -- 'Teaching Team' retired (T3, #153); Pimpinan added #179
  active      boolean not null default true,
  created_at  timestamptz not null default now(),

  unique (id, role)                    -- not redundant; see below
);

create unique index person_email_key on person (lower(email)) where active;
```

**The email index is partial**, applied by migration `0002`. At most one _active_ Person per
email, any number of revoked ones — the same trick as
`session_one_per_school_per_perjadin`. It has to be partial because a wrong `role` is corrected
by revoking the row and creating a new Person
([ADR-0013](./adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md)),
which means the same email legitimately appears twice. It also makes the lookup all three
enforcement points share — `where lower(email) = $1 and active` — unambiguous by construction
rather than by convention.

**`active = false` does not by itself stop anyone signing in.** The hook below fires when a
`user` row is _created_, so it gates signup only; a returning sign-in creates a session and
never reaches it. Revocation is therefore **one write to `person.active`, read on every
request** — no second column, no ban, and nothing in `better_auth` to keep in step. Three points
enforce it and every one of them reads `person.active` and nothing else:
`databaseHooks.user.create.before` refuses a first account to somebody with no active Person;
`databaseHooks.session.create.before` refuses a new session to a revoked Person who already has
a `user` row; and `requirePerson()` refuses each request, including one made mid-session on a
cookie already issued. The third is what makes revocation immediate, and `@sugt/db`'s choke
point is where it binds for **writes**, because a layout does not run before a Server Action.
This document previously routed revocation through Better Auth's admin plugin and described
`banned` as `person.active`'s effect; both are gone. See the amendment to
[ADR-0013](./adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md).

**A Person is Staff or Pimpinan** ([#153](https://github.com/mafiefa02/sugt/issues/153),
[#179](https://github.com/mafiefa02/sugt/issues/179)). The `Teaching Team` role was retired in T3,
leaving Staff alone once online Sessions named their teachers as `session_teacher_name` (ADR-0022)
and `session_teacher` — its last user — was dropped; [#179](https://github.com/mafiefa02/sugt/issues/179)
then widened `role` to `check (role in ('Staff', 'Pimpinan'))` to admit a second signed-in principal.
**Only that CHECK widened.** Every composite `(id, role)` foreign key below still pins `role =
'Staff'`, so the widened role satisfies none of them — a Pimpinan is a login-only, **read-only**
Person, kept out of Group membership, the PIC seat, a Session Record and a Story authorship by
exactly those untouched keys ([ADR-0025](./adr/0025-pimpinan-is-a-second-signed-in-read-only-person-role.md)).

**`role` is write-once, and the database already enforces it.** Six composite foreign
keys point at `person (id, role)` — from `group_member`, `class_record`, `session_record`,
`story.written_by_person_id`, `perjadin.pic_person_id` and `session.online_pic_person_id` — and
none declares `on update`, so all default to `NO ACTION`. The moment a Person has been on a trip,
filed a record or authored a Story, Postgres refuses to change their role. (`session_teacher` was a
seventh until T3 dropped it.) `class_record`'s FK still pins `'Teaching Team'`, but that table is
dead — no Person can hold that role now, so nothing satisfies it. This is not a policy anyone
added; it falls out of the composite keys, and it is written here because an unwritten enforced
constraint reads as a bug the first time it fires.

`unique (id, role)` looks pointless next to a primary key on `id`. It is the target of
composite foreign keys elsewhere in this schema, and it is what lets "the PIC is Staff" and "only
Staff file a Session Record" be declarative constraints instead of triggers. Do not drop it.

`person` **is** the invite list from
[ADR-0003](./adr/0003-google-sign-in-with-an-invite-list.md). There is no separate invite
table: a row here is an invitation, and `active = false` is a revocation that preserves every
historical reference to that person.

### Linking a sign-in to a Person

`better_auth.user` carries one extra column:

```sql
alter table better_auth."user"
  add column person_id uuid unique references public.person (id);
```

**The column and the foreign key come from two different places, and that is not an
accident.** The column is declared on the Drizzle table beside the other four in
`packages/db/src/schema/auth.ts` — as a real `uuid`, because `user.additionalFields` has no
`uuid` in its vocabulary and would emit `text`, which cannot foreign-key to `person.id`. The
**foreign key** is the one piece still hand-written (`0003`), because drizzle-kit will not
write a cross-schema reference. `additionalFields` still carries a `personId` entry, doing a
third job: registering the field with the library, which builds its inserts from its own field
registry and silently drops anything not in it.

The single edge that crosses the library boundary sits on the library's side of it, so
`person` references nothing it does not own and a Better Auth major version cannot ripple into
the Perjadin foreign key graph.

A `databaseHooks.user.create.before` hook looks up `person` by lowercased email. No match
means it throws, so **an uninvited Google account cannot create a user row at all** — the
invite list gates signup, not merely authorisation.

**`person_id` records which Person the identity was created for; it is not what a request
resolves through.** The column is written once, when the `user` row is created. After a
revoke-and-re-add the correcting Person is a _new_ row with a new `id`, so `person_id` names
the dead one — which is why all three enforcement points join on `lower(email)` and `active`
instead. What the column carries is the invariant that a signed-in user maps to at most one
Person, and only ever to one that exists.

---

## Reference data

Seeded by migration. No admin screens — [`product.md`](./product.md) is explicit that Schools,
Clusters and Topics are fixed facts, not records with an editing lifecycle.

> **One row of this is now false: the Sub-Cluster.** It is seeded like everything else here, and
> it is also the one thing on this page with a Staff-facing editing screen. The rule is not
> weakened, it is stated more precisely than it used to be: what has no admin screen is
> reference data DITSAMA was _given_ — Schools, Clusters, Topics, Provinces are all allocated by
> someone else and the tool's job is to reflect them. A **Sub-Cluster** is DITSAMA's own
> judgement about which Schools are one journey, and a judgement is exactly the kind of fact
> that gets revised. See [ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md).

**`person` is not reference data and this rule does not reach it.** The roster grows and
revocations happen, so People are added through a Staff-only screen; only the founding
Staff rows are seeded, and only because the sign-in hook makes them a prerequisite for
anyone reaching that screen. Keep that seed separate from this file, which is re-run
freely.

```sql
create table province (
  code       text primary key,          -- 'JB', 'JI', 'SS', …
  name       text not null,
  time_zone  text not null check (time_zone in ('WIB', 'WITA', 'WIT'))
);

create table cluster (
  id       uuid primary key default gen_random_uuid(),
  slug     text not null unique,
  name     text not null,
  topic    text not null,
  problem  text not null
);

create table sub_cluster (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  cluster_id  uuid not null references cluster (id),

  unique (id, cluster_id)
);

create table school (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  cluster_id      uuid not null references cluster (id),
  sub_cluster_id  uuid not null references sub_cluster (id),
  province_code   text not null references province (code),
  kabupaten_kota  text not null,

  foreign key (sub_cluster_id, cluster_id) references sub_cluster (id, cluster_id)
);
```

There are four Clusters and forty-two Schools. Cluster sizes are lopsided — six, seventeen,
eleven, eight — which is worth knowing before anyone builds a screen assuming they are
comparable.

**Topic and Problem are columns, not tables.** Each Cluster carries exactly one of each and
each Cluster's is different, so there is nothing to share and nothing to join.

**`cluster_id` is NOT NULL.** Clusters and their Topics are already allocated, so "a School
with no Cluster" is not a state the coverage view — which groups Schools by Cluster — ever
has to render, and no Cluster join is ever an outer join.

**`sub_cluster_id` is NOT NULL for the same reason, and it is a stronger claim.** A Cluster is
given; a Sub-Cluster is invented, so "not yet grouped" is a genuinely tempting state to allow.
It is not allowed. Every School belongs to exactly one Sub-Cluster from the moment the seed
runs, which is what lets a Perjadin be planned by picking a Sub-Cluster and nothing else — an
unassigned School would be a School no trip could ever be planned for, and nothing on any
screen would say so.

**A School carries both `cluster_id` and `sub_cluster_id`, and they cannot disagree.** The
second is derivable from the first via `sub_cluster`, so this is a denormalisation, and it is
the same one `group_member.role` already makes: the composite foreign key
`(sub_cluster_id, cluster_id) → sub_cluster (id, cluster_id)` means a row can only exist if
the pair is true in `sub_cluster`. Carrying `cluster_id` keeps every existing Cluster join —
the coverage view's included — a single inner join rather than two hops, and carrying it
costs nothing precisely because the database will not let it drift. The `unique (id, cluster_id)`
on `sub_cluster` exists solely to be the target of that key.

**`province.time_zone` is on the Province, not the School.** Indonesia has three zones —
WIB, WITA, WIT — and **no Indonesian province straddles a boundary**, so a column on `school`
would let forty-two rows express something only the Province list can vary by, and would admit
a state that cannot exist: two Schools in one Province disagreeing about the hour. This is the
argument for Province being a table at all, applied again with more force — a wrong Province
misspells a line, a wrong Time Zone puts a Session on screen at the wrong time and nothing
looks broken.

It is the abbreviations rather than IANA names (`Asia/Jakarta` and friends) because that is
what goes on an Indonesian screen, because it matches how every other enum here is done —
`text` plus a hand-written CHECK, narrowed by `$type<>()` off a constant in `@sugt/domain` —
and because all three are **fixed offsets with no daylight saving**, so `Intl` would be doing
arithmetic that `+7/+8/+9` already does. IANA earns its keep in a country with DST; Indonesia
is not one.

**Province is a table rather than a text column** for one reason: _provinces covered_ is a
headline figure on the portfolio site, and a typo in a free-text column silently inflates the
number nobody would think to check. Thirty-eight rows to make that impossible is a fair trade.

**`kabupaten_kota` is plain text**, unlike Province — nothing counts it, so a typo costs a
misspelt line on a School page rather than a wrong headline figure. It is kept because six
Schools are in Jakarta and three in Banda Aceh, so the Province alone does not tell you where
one is.

The island grouping the source spreadsheet shows — Sumatera, Jawa, Kalimantan,
Sulawesi/Maluku/Papua — is **not** stored. It does not agree with the Clusters (Jawa splits
across two, Kalimantan merges with Sulawesi into one), nothing is organised by it, and it is
recoverable from Province if a screen ever wants it.

`slug` exists so the authored seed file is readable and re-runnable (`on conflict (slug) do
update`), and so public URLs are stable. Primary keys stay uuid throughout rather than mixing
key types.

---

## Delivery

```sql
create table session (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references school (id),
  perjadin_id       uuid references perjadin (id),
  mode              text not null check (mode in ('offline', 'online')),
  stream            text check (stream in ('STEM', 'Research')),
  held_on           date not null,
  starts_at         time not null,
  status            text not null default 'arranged'
                      check (status in ('arranged', 'delivered', 'cancelled')),
  cancelled_reason  text,

  online_pic_person_id  uuid,
  online_pic_role       text check (online_pic_role = 'Staff'),

  created_at        timestamptz not null default now(),

  check ((mode = 'offline') = (perjadin_id is not null)),
  check (stream is not null),
  check ((mode = 'online') = (online_pic_person_id is not null)),
  check ((online_pic_person_id is null) = (online_pic_role is null)),
  check ((status = 'cancelled') = (cancelled_reason is not null)),

  foreign key (online_pic_person_id, online_pic_role) references person (id, role)
);

create unique index session_one_online_per_school_per_day
  on session (school_id, held_on, stream)
  where perjadin_id is null and status <> 'cancelled';

create unique index session_no_duplicate_offline_per_school_per_perjadin
  on session (perjadin_id, school_id, held_on, starts_at, stream)
  where status <> 'cancelled';
```

**`stream` carries the STEM/Research division of a Session, whichever its mode**
([ADR-0019](./adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md),
[ADR-0022](./adr/0022-online-sessions-carry-a-stream-and-name-teachers-as-session-scoped-names.md)).
The split used to be a property of who taught — the two `session_teacher` rows, one per Stream —
but a Session now teaches _one_ Stream, so the Stream moved onto the Session itself. It went there
for the offline half first (ADR-0019); ADR-0022 made the online half single-Stream too. The second
CHECK is therefore a plain `stream is not null` for **both** modes — it replaced the old
`(mode = 'offline') = (stream is not null)` equivalence, which let online rows hold a null. Stream
no longer tells you the mode; `mode`/`perjadin_id` still do. The column type stays nullable and the
not-null rule is the CHECK, the same shape as the value-set CHECK beside it.

**The online index now keys on Stream too** (ADR-0022). Online Sessions are arranged one at a time,
so "the same School twice on the same day" is a mis-click away — but an online Session is
single-Stream now, so a School may legitimately hold a STEM _and_ a Research online Session on one
date. Widening the index to `(school_id, held_on, stream)` draws that line: those two do not
collide, and only a second Session of the _same_ Stream on that date does. It stays partial on
`perjadin_id is null`, so it touches online Sessions only; offline ones are untouched because their
`perjadin_id` is not null. Partial the usual way besides: cancelled rows accumulate and must not
collide with their replacements.

**Two offline-Session indexes were dropped, and this one replaces them
([ADR-0019](./adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md)).**
`session_one_per_school_per_perjadin` — "one Session per School on the trip" — is gone, because a
School now has _several_ offline Sessions per Perjadin, each single-Stream, on its own date and
time. `session_one_school_at_a_time_per_perjadin`, on `(perjadin_id, held_on, starts_at)`, forbade
_any_ two Sessions sharing a moment on one trip; but parallel rooms at one School run at the same
moment on purpose, so it was too strict and had to go. What survives at the database is only the
rejection of an _exact_ duplicate — the same School, date, time **and** Stream — while parallel
Streams, or split rooms in the same Stream, are allowed. The count of Sessions per School is an
app cap (`MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN`), not a DB rule. The rule that **two
_different_ Schools cannot share a date and time** on one trip — the Group is one travelling party
— cannot be a plain unique index, because it must ignore same-School rows; it moves to the
application (enforced when a trip is planned) and is listed in
[what the database does not hold](#what-the-database-does-not-hold).

**There is no `sub_cluster_id` on a Session, and the reason is worth stating because the column
is an obvious thing to reach for.** The rule it would enforce — every School a Perjadin teaches
at belongs to that Perjadin's Sub-Cluster — is real, and it is genuinely enforceable: denormalise
the Sub-Cluster onto the Session and make both sides composite foreign keys, exactly the
`person (id, role)` trick that already makes "the PIC is Staff" declarative.

**It was designed, and then rejected, because of what it does to the School.** That key pins
`session → school (id, sub_cluster_id)` and defaults to `NO ACTION`, so Postgres would refuse
to move a School between Sub-Clusters while **any** Session referenced the old pairing —
delivered and cancelled ones included. A School would be frozen into its Sub-Cluster by its
first completed trip, and with two offline Sessions each, that is every School early in the
Programme. `on update cascade` does not rescue it: it would rewrite history, making a past
Perjadin claim it travelled somewhere it did not, and it fails on its own terms anyway because
the trip's own `sub_cluster_id` does not move with the School, so the cascade would violate the
other half of the key. This is the same argument
[ADR-0013](./adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md) makes when
it rejects `on update cascade` on `person.role`.

**The rule compares a mutable grouping against history, so it cannot be a key.** A Sub-Cluster
is a judgement that gets revised ([ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md));
a delivered Session is a fact that does not. It is therefore enforced by the application at the
point a trip is planned, and listed with the others in
[what the database does not hold](#what-the-database-does-not-hold) — the same disposition, for
the same reason, as "an arranged offline Session falls inside its Perjadin".

The first CHECK is the sharpest rule in the delivery half of the domain, and it is an
equivalence rather than an implication in both directions: **an offline Session has a
Perjadin and an online Session has none.** Six of every eight Sessions are invisible to
anything trip-shaped, which is why counting Perjadins never tells you how much teaching has
happened.

**Every Session has a PIC, but they come from different places.** An offline Session's is its
Perjadin's; an online Session has no Perjadin, so it carries its own — which is what the next
two CHECKs enforce, in exact mirror of the first. The column is named `online_pic_person_id`
rather than `pic_person_id` precisely so nobody reads it as "the PIC of this Session" and
finds it null for every offline row — the PIC of a Session is
`coalesce(session.online_pic_person_id, perjadin.pic_person_id)`, a query rather than a
column.

This matters because the PIC is the one person whose Session Record is required rather than
optional. Without it, six of every eight Sessions would have nobody who owed anything.

The composite foreign key uses the default `MATCH SIMPLE`, under which a row with NULLs in
the referencing columns satisfies the constraint — so offline Sessions, which have neither
column set, pass without a special case.

`held_on` is the date the Session is arranged for, and the date it happened once delivered.
It is a `date`, not a `timestamptz` — Indonesia spans three time zones and a Session is a
calendar day, not an instant.

**`starts_at` is a `time`, and the pair is deliberately not a timestamp.** A Session now carries
a start time as well as a date, because a Perjadin reaching several Schools teaches at each at
a different hour and an online Session is held at a moment somebody has to be told. The reason
`held_on` is not a `timestamptz` survives that intact, and is why the time is stored beside the
date rather than folded into it: **`starts_at` is wall-clock time local to the School**, and the
zone that makes it meaningful is `province.time_zone`, reached through `school.province_code`.
A `timestamptz` would store an instant, which means every write converts on the way in and every
read converts on the way out, and any reader who forgets is silently wrong by up to two hours.
A bare `time` says 09:00 and means 09:00 to the people in the room.

**Both modes, and always the School's local time.** For an offline Session that is uncontentious
— the Group is standing in the building. For an online one it is a choice: the School is in WIT
and the professor is in Bandung on WIB, so the same Session is 09:00 to one and 07:00 to the
other. The stored number is the School's, so that `starts_at` means one thing regardless of
`mode` and nobody has to check a sibling column to know how to read it. **The conversion is a
rendering concern**: a Session's time is shown with its zone attached — "09:00 WIT" — and screens
read by Bandung-based Staff show the WIB equivalent alongside it when the School is not on WIB.
Nothing stores the second number.

`starts_at` is NOT NULL. It is affordable because no Session exists yet in any live database, and
it is worth spending that one-off affordance on: a nullable start time acquires a null on the
first row written and keeps it forever, and every screen then has to render "time unknown".

**An arranged offline Session's `held_on` lies inside its Perjadin's `starts_on`–`ends_on`.**
Nothing holds that — not this schema, and until now not any document either. It is scoped to
_arranged_ deliberately: a trip's range is correctable (it is the departure→return span now,
[ADR-0021](./adr/0021-perjadin-date-range-is-departure-and-return.md)), and a resize that would
strand an arranged Session is refused rather than allowed, while delivered and cancelled ones stay
where they are and may legitimately sit outside the window their Perjadin now claims. A CHECK cannot
carry it, because a CHECK sees only the row it is written on and the date range sits on `perjadin`;
the choice is a constraint trigger or the application, and it belongs wherever the date is written —
both at arrangement and when a trip's range is resized. Online Sessions have no Perjadin and are untouched. Listed with the
rest in [what the database does not hold](#what-the-database-does-not-hold).

A Session exists only once arranged
([ADR-0006](./adr/0006-sessions-are-created-when-arranged.md)), so there are no planned rows,
no target dates and nothing is ever overdue. Progress is `count(*) where status = 'delivered'`
against `TOTAL_SESSIONS_PER_SCHOOL`, a constant that already lives in `@sugt/domain`.

**Marking a Session delivered is status only, for both modes** (#140, #152, #153). It writes nothing
but `session.status = 'delivered'` and names nobody. An **online** Session's "Tandai terlaksana"
historically named a Teaching-Team Person per Stream and wrote `session_teacher` in the same act;
ADR-0022 made online Sessions single-Stream with their teachers named as session-scoped
`session_teacher_name`, and #152 retired the Person-per-Stream step from delivery — the online mirror
of #140's offline change. Online Pengajar are now edited anytime, one name at a time, on
`/sesi-daring/[id]` (add/rename/remove against `session_teacher_name`), which is also the correction
path that replaced the old post-delivery "Perbaiki pengajar" flow. An **offline** Session's
mark-delivered was already status only (#140): it carries its Stream, its teachers are trip-scoped
`session_teaching_team` names edited on the Perjadin, and it writes no per-Stream Person (ADR-0019,
ADR-0020). Consequences left **deferred** and not modelled here — see the open question in
`CONTEXT.md`: **Class Records** for a name-taught Session (their filer would be a name, not a Person
who can sign in, on both sides now) and the **offline progress metric** (the fixed
`delivered / TOTAL_SESSIONS_PER_SCHOOL` no longer holds for the offline half, whose Session count per
School is now variable — ADR-0019). Online progress — six per School — is untouched.

### Who taught

**`session_teacher` was dropped in T3** ([#153](https://github.com/mafiefa02/sugt/issues/153)). It
held one `person` row per Stream per Session — its composite foreign key into `person (id, role)`,
with `person_role` pinned to `'Teaching Team'`, making it impossible to record a Staff member as
having taught a Stream. But offline teaching went name-based first
([ADR-0019](./adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md),
[ADR-0020](./adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)) and ADR-0022 did
the same online, so by T3 nothing wrote or read the table and the `Teaching Team` Person role it
depended on had no purpose — so the table and the role were both dropped. Both modes now record who
taught as **free-text names**: online through `session_teacher_name`, offline through
`session_teaching_team` (below).

An online Session records who taught it as session-scoped free-text names:

```sql
create table session_teacher_name (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references session (id) on delete cascade,
  name        text not null
);
```

The online analogue of the offline `perjadin_teacher` + `session_teaching_team` pair, **collapsed
to one table** because an online Session has no Perjadin to scope names to: an offline name belongs
to the trip and is linked to the Sessions that used it, whereas an online name belongs to the one
Session and nothing else. No Stream (the Session carries its own now) and no Person, which is the
whole point of the name-based model. Cascade on delete: a name means nothing once its Session is
gone. The count is an app cap (`MAX_TEACHING_TEAM_PER_ONLINE_SESSION`), not a DB rule — the same
disposition as the offline caps.

Offline Sessions record who taught through a name-based link instead:

```sql
create table session_teaching_team (
  session_id           uuid not null references session (id) on delete cascade,
  perjadin_teacher_id  uuid not null references perjadin_teacher (id) on delete cascade,

  primary key (session_id, perjadin_teacher_id)
);
```

"Diajar oleh" — the _set_ of a Perjadin's trip-scoped teacher names who staffed one offline
Session's parallel rooms. A plain many-to-many with no Stream (the Session already carries it) and
no Person. Both sides cascade: a link means nothing once either the Session or the teacher name is
gone. It is the offline analogue of `session_teacher_name`, and touches no `person` row, which is the
whole point of the name-based model ([ADR-0020](./adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)).

**Offline Class Records fall out of scope** as a consequence: their filers would be the teachers,
and a name is not a Person who can sign in and file. See the open question in `CONTEXT.md`.

---

## The four evaluations

A Session is judged from three vantage points, and a Perjadin from a fourth. Each has its own
rubric, because each asks a question only that person can answer.

| Table                  | Filed by      | One per               | Aspects                                                                          |
| ---------------------- | ------------- | --------------------- | -------------------------------------------------------------------------------- |
| `class_record`         | Teaching Team | Class, per professor  | Comprehension, Participation, Readiness, Materials, Delivery, Facilities, Timing |
| `session_record`       | PIC / Staff   | Session               | Facilities, Turnout, School support, Timing, Coordination                        |
| `participant_feedback` | Participants  | Class, per respondent | Materials, Instructor, Relevance                                                 |
| `perjadin_evaluation`  | Token link    | Perjadin (no dedup)   | Lodging, Transport, Meals, Punctuality                                           |

They share a scale (1–10), a threshold (`CONCERN_AT_OR_BELOW`, 7), and one rule — **a Rating at
or below the threshold cannot be filed without saying what went wrong** — so all four feed one
concerns list. Everything else about them differs, and deliberately: the PIC did not teach and
cannot judge comprehension; a Participant cannot rate their own readiness without it becoming
self-assessment; nobody but the Group slept in the hotel.

---

## Class Records

What a Teaching Team member says about **one Class** they taught at one Session.

> **Deferred and dead for both modes** ([#153](https://github.com/mafiefa02/sugt/issues/153)). A
> Class Record is filed by a `Teaching Team` **Person** — the composite foreign key below pins
> `filed_by_role = 'Teaching Team'` — but that role was retired in T3: teachers are free-text names
> now, on both sides (ADR-0020, ADR-0022), who cannot sign in and file. So **no Person can satisfy
> the FK and no row can be inserted**. The table is **kept** as a now-dead surface — the DDL below is
> unchanged and still applied — while how name-taught teaching is evaluated is a later decision (the
> `CONTEXT.md` open question). Everything below describes the shape it had when it was written; read
> it as the record of a deferred design, not of a live one.

**Six per Session was the full set.** Two professors — one per Stream — each taught all three
Classes, so each filed three. The unit was (Class, filer) rather than (Class, Stream). This no
longer describes anything, because there are no signed-in professors to file (see the note above).

**Stream needs no column.** It was derivable from the filer's Stream assignment on the Group.
Two Records for the same Class from different professors was not duplication — it was STEM and
Research disagreeing about the same cohort.

```sql
create table class_record (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references session (id) on delete cascade,
  class_kind          text not null check (class_kind in ('GTK', 'MS', 'Student')),
  filed_by_person_id  uuid not null,
  filed_by_role       text not null default 'Teaching Team'
                        check (filed_by_role = 'Teaching Team'),

  comprehension  smallint not null check (comprehension between 1 and 10),
  participation  smallint not null check (participation between 1 and 10),
  readiness      smallint not null check (readiness     between 1 and 10),
  materials      smallint not null check (materials     between 1 and 10),
  delivery       smallint not null check (delivery      between 1 and 10),
  facilities     smallint not null check (facilities    between 1 and 10),
  timing         smallint not null check (timing        between 1 and 10),

  covered      text,
  problems     text,
  suggestions  text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (session_id, class_kind, filed_by_person_id),
  foreign key (filed_by_person_id, filed_by_role) references person (id, role),

  check (
    least(comprehension, participation, readiness,
          materials, delivery, facilities, timing) > 7
    or btrim(coalesce(problems, '')) <> ''
  )
);

create index class_record_concerns_idx
  on class_record (least(comprehension, participation, readiness,
                         materials, delivery, facilities, timing))
  where least(comprehension, participation, readiness,
              materials, delivery, facilities, timing) <= 7;
```

The composite foreign key into `person (id, role)`, with `filed_by_role` pinned, made **only a
Teaching Team member can file a Class Record** a fact rather than a convention — the same trick
that holds "the PIC is Staff". Since T3 that FK is unsatisfiable: no Person holds the `Teaching
Team` role any more, so the rule it enforces has become "nobody can file one".

The first three Aspects are the ones only the person at the front can judge: whether the cohort
followed it, took part, and arrived prepared. The last four are about what was brought and the
conditions it was brought into.

**Twenty-one Ratings per professor per Session** — three Classes at seven Aspects. That is a
deliberate number, not an accident of the schema, and it is the largest ask in the system by a
wide margin. [ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md) is where to look if
Records stop arriving.

---

## Session Records

What the PIC says about the **visit as a whole**. They organised it and taught nothing, so they
are asked only about what an organiser can see.

```sql
create table session_record (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references session (id) on delete cascade,
  filed_by_person_id  uuid not null,
  filed_by_role       text not null default 'Staff' check (filed_by_role = 'Staff'),

  facilities      smallint not null check (facilities     between 1 and 10),
  turnout         smallint not null check (turnout        between 1 and 10),
  school_support  smallint not null check (school_support between 1 and 10),
  timing          smallint not null check (timing         between 1 and 10),
  coordination    smallint not null check (coordination   between 1 and 10),

  problems     text,
  suggestions  text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (session_id, filed_by_person_id),
  foreign key (filed_by_person_id, filed_by_role) references person (id, role),

  check (
    least(facilities, turnout, school_support, timing, coordination) > 7
    or btrim(coalesce(problems, '')) <> ''
  )
);

create index session_record_concerns_idx
  on session_record (least(facilities, turnout, school_support, timing, coordination))
  where least(facilities, turnout, school_support, timing, coordination) <= 7;
```

Mirror of the Class Record's composite key: **only Staff can file one**. Any Staff member who
was there may, not just the PIC — but the PIC's is the one that gets chased.

`coordination` is the PIC rating their own planning, which people do generously. It is kept
because a low one is then very informative, and because nobody else was in a position to judge
it. There is no `covered` field; nothing was taught by the person filing.

This is distinct from a Perjadin Evaluation, which is about the journey rather than the school
visit. One trip may sit behind several Session Records and yields exactly one set of travel
Ratings.

---

## Participant Feedback

Kept in its own table, deliberately. [ADR-0001](./adr/0001-public-site-reads-aggregates-only.md)
rests on an internal record being written for colleagues — _"only worth capturing if it can say
'the school had no lab equipment and the students are three weeks behind'"_. Put a student's
submission in the same table and a professor can no longer be sure who else is in it.

```sql
create table session_feedback_token (
  session_id            uuid primary key references session (id) on delete cascade,
  token                 text not null unique,
  issued_at             timestamptz not null default now(),
  expires_at            timestamptz not null default now() + interval '24 hours',
  issued_by_person_id   uuid not null references person (id),

  check (expires_at > issued_at)
);

create table participant_feedback (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references session (id) on delete cascade,
  class_kind  text not null check (class_kind in ('GTK', 'MS', 'Student')),
  name        text not null,

  materials   smallint not null check (materials  between 1 and 10),
  instructor  smallint not null check (instructor between 1 and 10),
  relevance   smallint not null check (relevance  between 1 and 10),

  materials_comment   text,
  instructor_comment  text,
  relevance_comment   text,
  submitted_at        timestamptz not null default now()
);

create index participant_feedback_concerns_idx
  on participant_feedback (least(materials, instructor, relevance))
  where least(materials, instructor, relevance) <= 7;
```

**Three Aspects, and none of them ask a Participant to rate themselves.** Comprehension,
Participation and Readiness are on the Class Record precisely because they are judgements about
the room, and a room grading its own readiness is not evidence. Materials and Instructor overlap
deliberately with the Class Record's `materials` and `delivery` — that overlap is the point,
because it lets what the professor thought be set against what the room thought.

`class_kind` says which Class the respondent sat in. It is what makes their Rating comparable to
the Class Record for that same cohort.

**No elaboration rule applies to Participants.** The `CHECK` forcing prose on a low Rating is on
`class_record` and `session_record` only. A Participant owes nothing and is not signed in;
refusing their 3 because they did not justify it would simply lose the 3.

**One optional comment per Aspect**, `materials_comment` / `instructor_comment` /
`relevance_comment`, rather than one shared `comment`
([#102](https://github.com/mafiefa02/sugt/issues/102),
[ADR-0017](./adr/0017-participant-feedback-has-a-comment-per-aspect.md)). A single comment could
not say which of the three Aspects it was about, so the concerns list could show a low
`instructor` Rating beside prose that was really about the materials. Pairing each comment with its
Aspect lets the list show the comment for the Aspect that was actually Rated low — or none, when
that box was left blank. All three stay nullable; the no-elaboration rule above is unchanged.

**One token per Session, shared.** The primary key is `session_id`, so issuing a new one replaces
it. `expires_at` defaults 24 hours out and is stored rather than derived: the token is issued at
the end of the Session by construction — the link is the QR code shown in the room — so "24 hours
after the Session ended" needs no Session end time to exist.

`name` is typed by the Participant and referenced by nothing. No `person_id`, no enrolment, no
attendee list — [ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md) decided against
building one, which is also why per-Participant tokens were rejected: they need exactly the list
that does not exist. Nothing prevents one person submitting twice or a forwarded link being used
by somebody who was not there. **Participant Feedback is indicative, not a census.**

---

## Who still owes what

Nothing is required in the sense of being blocked, and nothing has a deadline. What the tool does
is name who has not filed, so they can be chased in the group chat.

**The only record it still chases is the PIC's Session Record**, on a delivered Session where no
`session_record` of theirs exists yet — a Staff Person who can sign in and file. It needs no new
columns.

**The online Class-Record expectation is gone** ([#153](https://github.com/mafiefa02/sugt/issues/153)).
This section used to compute "the six Class Records a Session expects" as `session_teacher` × the
three Class kinds, minus whatever was already in `class_record`. But `session_teacher` is dropped and
the two professors it named are free-text names now who cannot sign in and file — so nothing owes a
Class Record, on either side, and there is nothing to expect. Class Records are deferred for both
modes (the `CONTEXT.md` open question); the `class_record` table stands unused.

**Participants cannot be listed.** There is no attendee list, so there is no denominator: "4 of ?
responded". A count with no denominator reads as a system of record and is not one, which is
[ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md)'s objection exactly. Their form is
chased in the room, not by the tool.

---

## Perjadin Evaluation

How the trip went, as distinct from how the teaching went. Filed **without signing in**, through a
short-lived token link shared from the trip's page, by a filer who **self-declares** a Role and a
Name (ADR-0024).

```sql
create table perjadin_feedback_token (
  perjadin_id           uuid primary key references perjadin (id) on delete cascade,
  token                 text not null unique,
  issued_at             timestamptz not null default now(),
  expires_at            timestamptz not null default now() + interval '14 days',
  issued_by_person_id   uuid not null references person (id),

  check (expires_at > issued_at)
);

create table perjadin_evaluation (
  id             uuid primary key default gen_random_uuid(),
  perjadin_id    uuid not null references perjadin (id) on delete cascade,
  filed_by_role  text not null check (filed_by_role in ('Pengajar', 'Pendamping', 'Pimpinan')),
  filed_by_name  text not null,

  lodging      smallint          check (lodging     between 1 and 10),   -- nullable; see below
  transport    smallint not null check (transport   between 1 and 10),
  meals        smallint not null check (meals       between 1 and 10),
  punctuality  smallint not null check (punctuality between 1 and 10),

  lodging_comment      text,
  transport_comment    text,
  meals_comment        text,
  punctuality_comment  text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Per-Aspect elaboration (ADR-0023): each Aspect is not-low or carries its OWN comment, and all
  -- four must hold. `lodging` is guarded by `is null` first, so a skipped hotel owes no comment.
  check (
    (lodging is null or lodging > 7 or btrim(coalesce(lodging_comment, '')) <> '')
    and (transport   > 7 or btrim(coalesce(transport_comment, ''))   <> '')
    and (meals       > 7 or btrim(coalesce(meals_comment, ''))       <> '')
    and (punctuality > 7 or btrim(coalesce(punctuality_comment, '')) <> '')
  )
);

create index perjadin_evaluation_concerns_idx
  on perjadin_evaluation (least(lodging, transport, meals, punctuality))
  where least(lodging, transport, meals, punctuality) <= 7;
```

**`perjadin_feedback_token` mirrors `session_feedback_token`.** One token per Perjadin, keyed on
`perjadin_id`, so issuing a new one replaces it and every link already shared resolves to nothing.
`expires_at` defaults **14 days** out — far longer than the Session token's 24 hours, because the
link is shared by hand after the trip and filed when the recipient gets to it, not scanned in the
room. Any signed-in Person may issue it; a Perjadin is a real trip once it exists, so there is no
cancelled state to bar (as the Session token has).

**`filed_by_role` and `filed_by_name` are self-declared and untrusted.** There is no
`filed_by_person_id` and no foreign key: the filer may be a name-based Pengajar or a record-only
Pimpinan, neither of whom has a `person` row to point at, so identity is a Role from a fixed three
(CHECKed character for character, `PERJADIN_EVALUATION_ROLES`) plus a free-text name referenced by
nothing — exactly as `participant_feedback.name` is. The one-per-filer `unique` is gone with the
sign-in: with no account behind a submission there is nothing to dedup on, and duplicates are
allowed, the accepted cost of the token pattern ([ADR-0012](./adr/0012-participants-write-through-a-short-lived-session-token.md), [ADR-0024](./adr/0024-perjadin-evaluation-is-filed-through-an-unauthenticated-token-link.md)).

Close to a Session Record's shape — four Ratings, the same 1–10 scale and threshold — but the
prose is no longer a shared `problems`/`suggestions` pair. Each Aspect now
carries its **own** optional comment, and the elaboration rule is retargeted per-Aspect: a low
Aspect owes _its own_ comment, not one shared box (#163, [ADR-0023](adr/0023-perjadin-evaluation-has-a-comment-per-aspect.md)).
A comment about the hotel can no longer excuse a low transport score, and the concerns list shows
each low Aspect the prose written about that Aspect. The trip-wide "Saran / what to do differently"
box is retired outright — advice with no per-Aspect home now lives inside the relevant Komentar, or
nowhere. This mirrors the #102 reversal on `participant_feedback`, plus the per-Aspect CHECK that
Participant Feedback (which owes no prose) never needed.

**`lodging` is the one nullable Rating in the system, because a day-trip has no hotel.** Not
every Perjadin involves a night away — the programme budget carries at least one group visiting
two Schools and returning the same day, with accommodation, flights and airport transfer all at
zero. A `not null` column would require those travellers to rate a hotel they never saw, and
inventing a Rating to satisfy a constraint is worse than the missing row.

**Nothing constrains when it may be null**, deliberately. A Group that did stay somewhere and
skipped the Aspect is a filer being unhelpful, not a state worth preventing, and the CHECK that
would express it needs the trip's date range on a table that does not carry it.

The elaboration rule survives a NULL without any change, and the reason is worth knowing before
anyone "fixes" it: **Postgres's `least()` ignores NULLs**, returning NULL only when every
argument is one. So `least(null, 8, 9, 9)` is `8` — the CHECK still fires on a genuine low
Rating, the partial index below still selects the right rows, and `null <= 7` is never true, so
a skipped Aspect cannot reach the concerns list. That behaviour is load-bearing and belongs on
the invariant suite beside the other 54, not in a comment.

`transport` covers the ground transport generally rather than the shuttle specifically, and
`punctuality` is whether the schedule held. They are separate Aspects because they fail
independently — a good car that turned up an hour late is a different complaint from a bad car
that was prompt, and one is the vendor's fault while the other is the plan's.

There is no `covered` field. Nothing was taught on a journey.

### Why there is no filer foreign key

There is no `filed_by_person_id` and no key into the Group at all. That is a reversal (ADR-0024):
the Evaluation used to be a signed-in write gated on Group membership, and this section used to
explain why the gate lived in the application rather than in a composite foreign key to
`group_member (perjadin_id, person_id)` — a Group is [replaced wholesale](#the-group), so under
`no action` the delete failed once anyone had filed, and under `cascade` it destroyed every
evaluation on the trip. Both were tested and both were wrong.

That reasoning is now moot, because the filer is not a `person` any more. The people best placed
to judge a trip include the name-based **Pengajar** and the record-only **Pimpinan**, neither of
whom signs in — so the signed-in gate excluded exactly the voices the form wanted. Identity is now
**self-declared and untrusted** (ADR-0024): `filed_by_role` is one of three CHECKed values and
`filed_by_name` is free text, the same model as `participant_feedback.name`. There is nothing to
key to the Group, so the wholesale-replacement problem above simply does not arise, and the
Group-membership rule leaves the honest list in
[what the database does not hold](#what-the-database-does-not-hold) — it is no longer enforced
anywhere, because it is no longer a rule.

### The concerns list in full

The one query the whole rating design exists to serve. Four sources, four unpivots — each with
its own Aspect list — unioned, with the source kept so a professor's 3 and a student's 3 stay
distinguishable:

```text
select 'Class Record' as source, sch.name || ' · ' || c.class_kind as subject,
       r.aspect, r.rating, p.full_name as who, c.problems as said, c.created_at as when_
  from class_record c
  join session sn on sn.id = c.session_id
  join school sch on sch.id = sn.school_id
  join person p on p.id = c.filed_by_person_id
  cross join lateral (values ('comprehension', c.comprehension), ('participation', c.participation),
                             ('readiness',     c.readiness),     ('materials',     c.materials),
                             ('delivery',      c.delivery),      ('facilities',    c.facilities),
                             ('timing',        c.timing)) as r(aspect, rating)
 where r.rating <= 7

union all

select 'Session Record', sch.name, r.aspect, r.rating, p.full_name, s.problems, s.created_at
  from session_record s
  join session sn on sn.id = s.session_id
  join school sch on sch.id = sn.school_id
  join person p on p.id = s.filed_by_person_id
  cross join lateral (values ('facilities',     s.facilities), ('turnout',      s.turnout),
                             ('school_support', s.school_support), ('timing',   s.timing),
                             ('coordination',   s.coordination)) as r(aspect, rating)
 where r.rating <= 7

union all

select 'Participant', sch.name || ' · ' || f.class_kind, r.aspect, r.rating,
       f.name, r.said, f.submitted_at
  from participant_feedback f
  join session sn on sn.id = f.session_id
  join school sch on sch.id = sn.school_id
  cross join lateral (values ('materials',  f.materials,  f.materials_comment),
                             ('instructor', f.instructor, f.instructor_comment),
                             ('relevance',  f.relevance,  f.relevance_comment))
                     as r(aspect, rating, said)
 where r.rating <= 7

union all

select 'Perjadin Evaluation', pj.destination, r.aspect, r.rating,
       e.filed_by_name, r.said, e.created_at
  from perjadin_evaluation e
  join perjadin pj on pj.id = e.perjadin_id
  cross join lateral (values ('lodging',     e.lodging,     e.lodging_comment),
                             ('transport',   e.transport,   e.transport_comment),
                             ('meals',       e.meals,       e.meals_comment),
                             ('punctuality', e.punctuality, e.punctuality_comment))
                     as r(aspect, rating, said)
 where r.rating <= 7

 order by when_ desc;
```

Run against the seeded database, that returns rows like:

```text
 source              | subject                  | aspect        | rating | who  | said
---------------------+--------------------------+---------------+--------+------+----------------------------
 Participant         | SMAN 8 Jakarta · Student | instructor    |      3 | Rina |
 Class Record        | SMAN 8 Jakarta · Student | comprehension |      4 | Budi | Belum paham dasar sensor
 Session Record      | SMAN 8 Jakarta           | turnout       |      5 | Ani  | Hanya 12 dari 30 guru hadir
 Perjadin Evaluation | Jakarta                  | lodging       |      4 | Ani  | Hotel tidak ada air panas
```

Three things to read off that. **The subject column tells you which cohort** — Student Class at
SMAN 8, from two independent sources — which is the question the design lost when Ratings were
briefly attached to the Session as a whole, and has now recovered properly. **Only the internal
rows carry an explanation**, because the elaboration rule applies to signed-in filers alone.
And the four rubrics never collide: `comprehension` can only come from a professor,
`instructor` only from the room, `turnout` only from the PIC.

The `7` in each predicate is `CONCERN_AT_OR_BELOW`. It appears here four times and in four index
predicates, which is why moving it is a migration.

### Access

A Perjadin Evaluation carries **no money**, so it follows
[ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md)'s open-delivery rule and
the same open-to-read rule the Perjadin Report itself now follows (its money-read gate was opened by
[ADR-0026](./adr/0026-money-is-open-to-read-and-staff-only-to-write.md), #180). Anyone signed in can
read one; only that trip's Group can write one. This is worth stating because the table hangs off a
Perjadin, and the difference is not who reads — both are open — but who **writes**: an Evaluation is
written by the travellers, the Report's money by Staff. Teaching Team members file these — they are
the ones who slept in the hotel.

---

## Travel

```sql
create table perjadin (
  id                          uuid primary key default gen_random_uuid(),
  sub_cluster_id              uuid not null references sub_cluster (id),
  destination                 text not null,
  starts_on                   date not null,
  ends_on                     date not null,

  advance_idr                 bigint not null check (advance_idr >= 0),

  departure_at                timestamp,
  departure_zone              text check (departure_zone in ('WIB', 'WITA', 'WIT')),
  departure_mode              text check (departure_mode in ('Pesawat', 'Kereta', 'Travel', 'Mobil Dalam Kota')),
  return_at                   timestamp,
  return_zone                 text check (return_zone in ('WIB', 'WITA', 'WIT')),
  return_mode                 text check (return_mode in ('Pesawat', 'Kereta', 'Travel', 'Mobil Dalam Kota')),

  pic_person_id               uuid not null,
  pic_role                    text not null default 'Staff' check (pic_role = 'Staff'),

  returned_to_treasurer_idr   bigint,
  returned_at                 timestamptz,
  report_filed_at             timestamptz,
  created_at                  timestamptz not null default now(),

  check (ends_on >= starts_on),
  check ((returned_at is null) = (returned_to_treasurer_idr is null)),

  foreign key (pic_person_id, pic_role) references person (id, role)
);
```

**The six travel-logistics columns are nullable and store wall-clock, not instants**
([#106](https://github.com/mafiefa02/sugt/issues/106)). Nullable so the Perjadins that predate
them stay valid — no backfill, no invented travel — while the plan form requires all six on a new
trip. Each `*_at` is a `timestamp` **without** a time zone: a date and a wall-clock time, carrying
its zone in a separate `*_zone` tag exactly as `session.starts_at` does, because the Surat Tugas
says "07:30 WIB", not a UTC moment. `departure_zone` is always `WIB` (the origin is Bandung) and
`return_zone` is derived at insert from the Province of the last School visited — both snapshots
set server-side, never recomputed on read, so an edited Sub-Cluster cannot rewrite an issued Surat
Tugas. The zone columns still admit all three `TIME_ZONES` because the detail page's edit surface
can correct a return zone; `*_mode` CHECKs `TRANSPORT_MODES`. Both value lists live in
`@sugt/domain` and are written out character for character here, for the reason
`transaction_category_check` gives.

A Group also carries **extra Staff beyond the PIC** — a coordinator, a treasurer, a documentarian —
as ordinary `group_member` rows (`role = 'Staff'`, `stream = null`), the same shape the PIC's row
has. Under the new model
([ADR-0020](./adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)) the Group is
**Staff and only Staff** — the PIC plus up to ten others (`MAX_EXTRA_STAFF_PER_GROUP`, an app cap,
not a DB one) — and the Teaching Team have left it entirely for `perjadin_teacher` below. No new
table and no order: they are a set, each distinct from the PIC and each other, and a substitution
carries them rather than dropping them. Wiring the ten-Staff, name-based-teacher planning writes is
T2/T3 ([#137](https://github.com/mafiefa02/sugt/issues/137), [#138](https://github.com/mafiefa02/sugt/issues/138)).

`perjadin` and `group_member` reference each other, so the second half cannot be inline — it
is added once both tables exist:

```sql
alter table perjadin
  add constraint perjadin_pic_is_a_group_member
  foreign key (id, pic_person_id) references group_member (perjadin_id, person_id)
  deferrable initially deferred;
```

`advance_idr` is NOT NULL because the Advance is fixed at planning and transferred before
departure — a Perjadin is never in an unfunded state, so there is no nullable phase to model.

**There is no `report_deadline` column.** The Report is due two days after the Group gets back,
always, so the deadline is `ends_on + REPORT_DEADLINE_DAYS_AFTER_RETURN` and nothing stores it.
Storing it would let it be entered wrong, and would leave it stale when a trip's dates are
corrected — a derived deadline recomputes itself and a typed one does not. Nothing is gated on
it either way; it is shown as days remaining.

**Money is `bigint` in whole rupiah.** `numeric(_, 2)` would imply a subunit nobody uses. The
`_idr` suffix is on every money column so no reader has to guess the unit.

Two declarative constraints replace what would otherwise be trigger code:

- `(pic_person_id, pic_role) → person (id, role)` with `pic_role` pinned to `'Staff'` makes
  **the PIC is a Staff member** unbreakable, including from the Supabase SQL editor.
- The deferred self-referential foreign key makes **the PIC is a member of their own Group**
  hold at commit. It has to be deferred because `perjadin` and its `group_member` rows are
  inserted in the same transaction and neither can go first.

**`sub_cluster_id` is where a Perjadin goes, and `destination` is what the paperwork calls it.**
They are not redundant, and dropping either would cost something real. The Sub-Cluster is
structural: it decides which Schools may appear on the trip at all, and the composite key on
`session` makes that unbreakable. `destination` is the prose that ends up on a Surat Tugas —
`Kelompok 18: Samarinda dan Balikpapan` — the Sub-Cluster's own label followed by the distinct
Kabupaten/Kota of **all** its Schools, joined with `" dan "` before the last
([#105](https://github.com/mafiefa02/sugt/issues/105)). It is **derived server-side at insert**
by `planPerjadin`, from the Sub-Cluster and its Schools rather than typed, so a Surat Tugas cannot
disagree with the trip the form already shows. Once written it is a **snapshot** and is never
recomputed on read: Sub-Clusters are editable ([ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md)),
so a live read would silently rewrite an already-issued Surat Tugas when Schools are later
regrouped or the Sub-Cluster renamed. (The column began as free text; the earlier note here
rejected deriving it from `sub_cluster.name` _alone_ — naming the concrete places, prefixed by the
Kelompok label, is what a destination line is for.)

The Schools **actually** visited remain the structural truth and are still reached through
`session.perjadin_id`. A Perjadin covers several, but no longer an arbitrary several: the
Sub-Cluster fixes the eligible set and the plan chooses from within it. **It need not choose all
of them** — a School with exams that week is dropped from the trip, not a reason to abandon the
trip — which is why nothing here requires a Session per School of the Sub-Cluster.

**`sub_cluster_id` being NOT NULL is as far as the database goes.** That a trip's _Sessions_ are
at Schools of that Sub-Cluster is not a key; see
[Delivery](#delivery) for the version of this that was designed and rejected, and
[what the database does not hold](#what-the-database-does-not-hold) for where the rule actually
lives.

### The Group

```sql
create table group_member (
  perjadin_id          uuid not null references perjadin (id) on delete cascade,
  person_id            uuid not null,
  role                 text not null check (role = 'Staff'),   -- 'Teaching Team' retired, #153
  stream               text check (stream in ('STEM', 'Research')),

  primary key (perjadin_id, person_id),
  foreign key (person_id, role) references person (id, role),

  check (stream is null)   -- group_member_stream_null: a Group is Staff-only, so no Stream
);
```

`role` is denormalised from `person` — but it cannot drift, because the composite foreign key
into `person (id, role)` means a row can only exist if the pair is true there.

**The Group is Staff and only Staff** ([ADR-0020](./adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md),
and T3/[#153](https://github.com/mafiefa02/sugt/issues/153)): the teaching team who used to carry a
Stream assignment are trip-scoped names now, not Group members, and every Person is Staff. So
`role` CHECKs `'Staff'`, and `group_member.stream` is **always null** — enforced by
`group_member_stream_null` (`stream is null`), which replaced the old
`(role = 'Teaching Team') = (stream is not null)` equivalence once its Teaching-Team side became
unreachable. The `stream` column stays (with its value-set CHECK) so the table needs no column
migration. The professors themselves live in `perjadin_teacher`, which carries no Stream at all.

**A Group is replaced wholesale, never edited.** There is no "remove one member" operation.
Substituting a professor submits an entire replacement Group, and one transaction deletes
every member row and inserts the new set. The Perjadin keeps its id, so its Sessions, Advance
and transactions are untouched — only the membership is destroyed and rebuilt.

That is what makes the last Group rule cheap. See
[what the database does not hold](#what-the-database-does-not-hold).

### The Teaching Team and Pimpinan on a Perjadin

```sql
create table perjadin_teacher (
  id           uuid primary key default gen_random_uuid(),
  perjadin_id  uuid not null references perjadin (id) on delete cascade,
  name         text not null
);

create table perjadin_pimpinan (
  perjadin_id  uuid not null references perjadin (id) on delete cascade,
  person_id    uuid not null,
  role         text not null default 'Pimpinan' check (role = 'Pimpinan'),

  primary key (perjadin_id, person_id),
  constraint perjadin_pimpinan_is_pimpinan
    foreign key (person_id, role) references person (id, role)
);
```

**`perjadin_teacher` is a Perjadin's Teaching Team as trip-scoped names**
([ADR-0020](./adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)) — plain
strings entered on the trip, up to twenty (`MAX_TEACHING_TEAM_PER_PERJADIN`, an app cap), **not
`person` rows**. The professors who deliver offline Sessions are external to DITSAMA and will not
sign in; modelling them as People needed an email and implied they could authenticate and file
records, none of which is true. It is a table of its own, not a column on `perjadin`, because names
are added, renamed and removed one at a time (T3), and each row has an `id` so
`session_teaching_team` can link the ones who taught a given offline Session. It carries **no
Stream and no Person FK** — a name is not a Person and a Stream lives on the Session now. `on delete
cascade`: the names are the trip's and outlive nothing.

**`perjadin_pimpinan` records a Pimpinan on a Perjadin — record-only.** A leader of DITSAMA ITB who
rarely joins the Kelompok Perjalanan to monitor the offline Sessions is noted here and named on the
Laporan Perjadin, but is **not a working Group member**: they file no Perjadin Evaluation and add
nothing to the Preparation Checklist, which is exactly why they are not a `group_member` row. A row
references a **real `person` of role Pimpinan** ([#181](https://github.com/mafiefa02/sugt/issues/181)):
the Pimpinan roster is the single source of truth, so the old fixed-three `name` column with its CHECK
and the `PIMPINAN` constant in `@sugt/domain` are gone. `role` is pinned to `'Pimpinan'` and the
composite `(person_id, role)` foreign key into `person (id, role)` guarantees a non-Pimpinan can never
be recorded — the same PIC-is-Staff discipline as `perjadin_pic_is_staff` and `group_member`'s role
FK. The primary key `(perjadin_id, person_id)` makes a Pimpinan recordable at most once per trip.
Writing and rendering them is T3/T7
([#138](https://github.com/mafiefa02/sugt/issues/138), [#142](https://github.com/mafiefa02/sugt/issues/142)).

### The Preparation Checklist

```sql
create table perjadin_preparation_item (
  perjadin_id   uuid not null references perjadin (id) on delete cascade,
  item_key      text not null,
  checked_by    uuid not null references person (id),
  checked_at    timestamptz not null default now(),

  primary key (perjadin_id, item_key)
);
```

**Only the ticks are stored** ([#114](https://github.com/mafiefa02/sugt/issues/114)). The
Preparation Checklist is an internal-monitoring aid — Staff hand-tick a pre-departure to-do list,
and it gates nothing. The _set of items that exists_ is **not** a table: since the amendment to
[ADR-0018](./adr/0018-the-preparation-checklist-stores-ticks-and-derives-the-list.md) it is a **flat
fixed seven** — `sk_perjalanan`, `tiket_keberangkatan`, `tiket_kepulangan`, `booking_penginapan`,
`transportasi_lokal`, `staff`, and `pengajar_lengkap` ("Pengajar sudah lengkap") — assembled in the
query layer at read time with **no per-member part**, so it no longer reads the Group at all. A row
here means one of those is ticked; un-ticking is a `DELETE`, so there is no "unchecked" row to keep.

**`pengajar_lengkap` is the one box the tool clears by itself**, and the single exception to "nothing
ticks a box automatically". It replaced the old per-teacher `dosen:{person_id}` boxes when the
Teaching Team stopped being People (ADR-0020): with up to twenty trip-scoped names, per-name boxes
made no sense. It is ticked by hand like the rest, but **any Teaching-Team change — a name added,
renamed or removed — deletes its tick**, so each change forces a fresh manual confirmation that the
team is complete. That `DELETE` lives inside the teacher-mutation queries
(`queries/perjadin-teachers.ts`), which is what makes it impossible to change the team without
clearing the box. No other item is ever touched automatically. `dosen:` ticks the old model left in
the table are **orphans**: no item derives them, so they are silently ignored and never cleaned up.

The composite primary key `(perjadin_id, item_key)` is what makes a toggle idempotent — the write
upserts on it, so a second tick rewrites `checked_by`/`checked_at` rather than duplicating a row.
`checked_by` and `checked_at` record who and when for later use; nothing renders them yet. **`staff`
is a single box** — "confirmed with the Pendamping" (the on-Perjadin label for the DITSAMA role,
[#141](https://github.com/mafiefa02/sugt/issues/141)), not one row per member; the stored key stays
`staff`. `N` is therefore the
constant **7**, and the Perjadin list's `Persiapan: x/N` pill counts the ticks whose key is one of
the seven fixed items.

---

## Money

**There is no `perjadin_report` table.** A Perjadin yields exactly one Report, always, so the
acquittal is the state already on `perjadin`: `report_deadline`, `report_filed_at`,
`returned_to_treasurer_idr`, `returned_at`.

```sql
create table transaction (
  id                    uuid primary key default gen_random_uuid(),
  perjadin_id           uuid not null references perjadin (id) on delete cascade,
  spent_on              date not null,
  description           text not null,
  amount_idr            bigint not null check (amount_idr > 0),
  category              text not null check (category in (
                          'Tiket Pesawat/Kereta PP', 'Uang Harian',
                          'Honorarium Narasumber', 'Akomodasi',
                          'Transport Bandara/Stasiun', 'Transport Lokal Dalam Provinsi',
                          'Konsumsi', 'Modul', 'ATK',
                          'Alat dan Bahan Research Project', 'Seminar kit', 'Lainnya')),
  participant_type      text not null check (participant_type in ('Siswa', 'GTK-MS')),
  created_by_person_id  uuid not null references person (id),
  created_at            timestamptz not null default now()
);

create table transaction_evidence (
  id                    uuid primary key default gen_random_uuid(),
  transaction_id        uuid not null references transaction (id) on delete cascade,
  storage_path          text not null unique,
  content_type          text not null,
  byte_size             bigint not null,
  uploaded_by_person_id uuid not null references person (id),
  uploaded_at           timestamptz not null default now()
);
```

**The Advance is one pot and the acquittal reconciles the pot** — a transaction consumes the
Advance rather than a person's share of it. Worth knowing:
[ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md) justified hiding money
from Teaching Team by citing "per-diem amounts and personal travel claims" — but that money-read
gate is reversed by [ADR-0026](./adr/0026-money-is-open-to-read-and-staff-only-to-write.md) (#180):
money is now open to any signed-in Person to **read**, so a Pimpinan reads these lines; only
_writing_ them stays Staff-only.

**`incurred_by_person_id` is gone (#182).** The column shipped in migration `0006` as a nullable
"who a per-diem was paid to" and never earned its keep: naming that person said nothing about how
the pot reconciles, and the Laporan needed a different cut of the spend than it offered. It is
dropped, replaced by the required `participant_type` below. (ADR-0004 still names the column as a
point-in-time record; that is history and is left as written.)

**`category` is a closed set read off DITSAMA's own approved budget**, not invented for a
template nobody has read. The eleven named values are the line items the programme RAB repeats
across all twenty-three travel groups; `Lainnya` is the escape hatch. They are in Indonesian
because that is what goes on the paperwork, and they are character-for-character
`TRANSACTION_CATEGORIES` in `packages/domain/src/index.ts` — the same rule every other fixed
set in this document follows.

This narrows [ADR-0007's amendment](./adr/0007-the-tool-generates-the-acquittal.md), which said
the export gets "no category, no cost-centre, no account code, no payee". Its objection was
that **inventing** fields for an unread template produces fields that do not fit, and that
objection is answered rather than overridden: a list taken from the approved budget is
evidence, not a guess. The rest of the amendment stands — the export still invents nothing
beyond these columns, and it is still replaced rather than corrected when a completed SPJ
arrives. `Uang Harian` stays one category; the Narasumber/Asisten split in the RAB is a rate
difference, not a different kind of spend.

**`participant_type` is required, and it is an axis orthogonal to `category` (#182).** `category`
is _what kind of spend_ a line was; `participant_type` is _which cohort_ it served — `Siswa` (the
Student Class) or `GTK-MS` (the GTK and MS Classes together). The Laporan splits every acquittal's
Terpakai total into a Siswa and a GTK-MS subtotal, so the column is `NOT NULL`: there is no unset
state to carry and no third `Umum` value — a shared cost is attributed to whichever type it
predominantly served. It is character-for-character `TRANSACTION_PARTICIPANT_TYPES` in
`packages/domain/src/index.ts`, CHECKed the same way `category` is. **The Advance is still one pot
and the acquittal still reconciles the pot**, so
[ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md)'s reconciliation model is
untouched — though its money-_read_ gate is amended by
[ADR-0026](./adr/0026-money-is-open-to-read-and-staff-only-to-write.md) (money read opened to any
signed-in Person; writing money stays Staff-only).

Note what did **not** enter the table: no cost-centre, no account code, no payee, no
`Ref Standar Biaya` — the RAB carries the last of these on most lines (`PMK 32/2025 No.28.1`
and the like) and it stays out until a real form asks for it.

**The reconciliation is derived, never stored.** `advance_idr - sum(amount_idr)` is the
running remainder the acquittal screen shows, and it is a query. Only the fact that money was
returned is a stored event.

Evidence is many-per-transaction. `storage_path` is the object key in the private bucket, and
`unique` on it means an upload cannot be attached twice.

---

## Stories

The public narrative, authored in the internal app by Staff and read by `@sugt/public`
through the published-Stories routes. Decided, not yet written as Drizzle — the shape below
is the contract, and it is the largest thing on the critical path now that
[ADR-0008](./adr/0008-public-narrative-is-authored-in-the-internal-app.md)'s second
amendment puts the authoring UI in the first release.

```sql
create table story (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  school_id       uuid not null references school (id),
  stream          text check (stream in ('STEM', 'Research')),
  kind            text not null default 'field'
                    check (kind in ('field', 'final_project')),
  title           text not null,
  body            text not null,
  cover_photo_id  uuid,              -- references story_photo (id); added below
  published_at    timestamptz,

  written_by_person_id  uuid not null,
  written_by_role       text not null default 'Staff' check (written_by_role = 'Staff'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  foreign key (written_by_person_id, written_by_role) references person (id, role)
);

create table story_photo (
  id                     uuid primary key default gen_random_uuid(),
  story_id               uuid not null references story (id) on delete cascade,
  storage_path           text not null unique,
  content_type           text not null,
  byte_size              bigint not null,
  caption                text,
  uploaded_by_person_id  uuid not null references person (id),
  uploaded_at            timestamptz not null default now()
);
```

`story` and `story_photo` reference each other, so the cover cannot be inline — it is added
once both tables exist, the way the PIC-membership constraint on [Travel](#travel) is. Only the
placement is shared; this one needs no deferral, and why is below:

```sql
alter table story
  add constraint story_cover_photo_id_fkey
  foreign key (cover_photo_id) references story_photo (id) on delete set null;
```

**`school_id` is NOT NULL, and it is the only thing a Story attaches to.** The design's cards
carry a School, a Cluster and a Stream — but the Cluster is `school.cluster_id` reached
through the join, exactly as everywhere else, so it is not a second reference. There is no
`cluster_id` and no `perjadin_id`. A public Story hanging off the trip that carries the money
is a boundary [ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md) draws
deliberately, and the design never asks for one.

The cost is stated plainly: a Programme-wide piece belonging to no single School has nowhere
to live. That is a homepage-copy problem, not a feed entry.

**`stream` is nullable**, unlike everywhere else it appears. It is the badge on the card, and
a Story about a whole visit is about both.

**`kind` is how a Final Project reaches the public without becoming a record.**
[ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md) refuses to track Project Teams
and Final Projects, and it still does — nothing here enrols one, counts one or gives one a
state. A Final Project reaches a public page the only way any narrative does: somebody wrote a
piece about it. `kind` exists because the public site gives those pieces their own section
rather than a filter chip on the stories feed, so the payload has to say which is which.

It is a column rather than a table for the same reason Topic and Problem are: there is one
value per row, nothing joins to it, and the two kinds differ in where they are listed and in
nothing else. Same editor, same upload path, same payload. `STORY_KINDS` in
`packages/domain/src/index.ts` carries the pair.

**`body` is Markdown**, rendered on the public site through a strict allowlist — see
[ADR-0015](./adr/0015-story-bodies-are-markdown-and-the-editor-schema-is-the-allowlist.md),
which is also where the constraint binding the editor to that allowlist is argued. Nothing in
this table enforces the format; it is `text`, and the rule lives in the two pieces of code that
write and render it.

**`published_at` NULL is a draft.** No status enum — three states would owe three glossary
terms for a distinction the surface does not yet make. Setting it publishes; clearing it takes
the Story down, and the internal app calls a revalidation route on `@sugt/public` when either
happens. That route is the only write-shaped thing the public app will ever have, and it
writes nothing but its own cache. It exists because the public site serves its last good
payload indefinitely (see the endpoint contract in ADR-0008) — fine for a figure, not fine for
a photograph that has to come down now.

**Publishing is Staff-only, and that is a composite foreign key like every other role rule
here.** `written_by_role` is pinned to `'Staff'` and the pair references `person (id, role)`
— the seventh target of the `unique (id, role)` index, alongside the PIC, who taught, and who
filed each internal record. [ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md)
says publishing is Staff-only; without this it would be the one such rule held by convention.
It also means a Story's author inherits write-once `role`, which is the correct behaviour: the
person who wrote it was Staff when they wrote it.

**`story_photo` mirrors `transaction_evidence`** column for column, deliberately: same
`storage_path unique`, same `content_type`/`byte_size`, same uploader and timestamp. One
upload pattern to build and one to learn. `uploaded_by_person_id` references `person` alone
rather than the pair, exactly as `transaction_evidence` does — uploading is not a role-gated
act, and the Story it hangs off already carries the Staff constraint. Keys are
`story/{story_id}/{uuid}` in `public-media`, mirroring the `receipts` convention. **Dropping
`position` makes that mirror tighter**, and the mirror is worth keeping true: a caption is now
the only column one table has and the other does not.

**There is no ordering.** The gallery renders by `uploaded_at`, tie-broken by `id`, and Staff
cannot rearrange it without deleting and re-uploading — a cost named and accepted rather than
overlooked. The tie-break is not decoration: a bulk upload gives several rows the same default
timestamp, and without it the order is not stable between reads.

**The cover is its own field, not "whichever photograph is first".** `story.cover_photo_id` is
nullable and `on delete set null`, so deleting the photograph that happens to be the cover clears
the field rather than blocking the delete. Two consequences come with that choice and were taken
with it: the two tables now reference each other, so **the cover is set in a second statement**
once the photographs have landed rather than in the insert; and **no deferred constraint is
needed**, because the column is nullable — unlike the PIC-membership foreign key, which had to be
deferred precisely because neither side could go first.

**This document previously said `position` orders them and makes the first the cover.** That was
false in both halves, and the wholesale-rewrite pattern it argued for went with it: there is no
`unique (story_id, position)` left for an intermediate state to collide with, so nothing here
rewrites every row. [The Group](#the-group) is now the only place in this schema that pattern
lives.

**Publishing is blocked while photographs exist and none of them is the cover.** Not a warning —
the control is unavailable. A Story with **no** photographs at all is not gated, because there is
nothing to choose a cover from and nothing missing.

**It is the only gate in the product, and that is worth stating rather than burying.** The
standing rule is the opposite: `CONTEXT.md` says nothing is required and nothing is blocked, and
[`product.md`](./product.md) says _"Nothing is gated"_ of the one screen most tempted to gate
something. The approval regime an early design drew was refused outright, and so was gating the
acquittal's submission on evidence being attached. This exception is accepted for a reason that
does not generalise: the public site is the portfolio DITSAMA is judged by, and an imageless card
beside eight illustrated ones reads as broken rather than as a choice. It gates publishing and
nothing else. It is also not a precedent — a field a form insists on before it will submit is a
different thing, and the next rule that wants to withhold an action until some **other** record
is complete has to make its own case rather than cite this one.

The two buckets stay exactly as split below. A Story's photographs are public by intent, which
is the whole difference from a receipt.

## Object storage

Two buckets, and the split is doing real work:

| Bucket         | Visibility | Holds                                                            |
| -------------- | ---------- | ---------------------------------------------------------------- |
| `receipts`     | Private    | Transaction evidence. Keys: an opaque `{uuid}`, and nothing else |
| `public-media` | Public     | Published Story photographs. Keys: `story/{story_id}/{uuid}`     |

**A receipt key spells nothing out, and that is a change from what this table said.** It read
`perjadin/{perjadin_id}/{transaction_id}/{uuid}` until the acquittal was built. A private bucket
is read through a signed URL, and a signed URL carries its object path inside the JWT it is
signed with, so a structured key puts the trip's identifiers into every link the acquittal screen
renders. A bare UUID names nothing.

What that gives up is the prefix check `story_photo` relies on — a Story photograph is trusted
only under `story/{story_id}/`, which is what stops one Story's photograph being attached to
another. Here it costs nothing: `receipts` holds receipts only, every one is readable by every
Staff member already, and `storage_path` is `unique`, so there is no object a Staff caller could
reach by forging a key that they could not reach by asking honestly. The boundary that does the
work instead is the pair — a line item is checked against its Perjadin before evidence attaches
to it.

**`public-media` is needed at provisioning time, not at some later one.** This row read
_"Published photographs (a later release)"_ until
[ADR-0008](./adr/0008-public-narrative-is-authored-in-the-internal-app.md)'s second amendment put
Story authoring in the first iteration. The public site launches with real Stories in the
database, so the bucket has to exist before the first Story can be written — it is part of the
launch gate, not a follow-up.

Participant Feedback uploads nothing, and should not start. A file upload on an
unauthenticated route is a different risk from a text field on one.

This is [ADR-0001](./adr/0001-public-site-reads-aggregates-only.md) held at the storage layer,
the same way the package split holds it in code: a bucket boundary is not a policy anyone can
get wrong.

Because sign-in is Better Auth rather than Supabase Auth, storage policies cannot see who is
asking. Receipt access is therefore a signed URL minted by the internal app **after** it has
checked the caller is Staff. That check is the only thing standing between Teaching Team and a
receipt, so it belongs at one choke point, not at each call site.

---

## Where the code lives

`packages/db` (`@sugt/db`) holds the Drizzle schema, the migrations, the connection and
the queries — the last of these at `@sugt/db/queries`, a subpath of its own, where the
`Caller` union and the Staff-only choke point live —
a Just-in-Time package like `@sugt/domain` and `@sugt/ui`, with `exports` pointing straight
at `./src` and no build step. Its own README covers running it.

**`@sugt/public` must never declare it.** That is AGENTS.md rule 1 and the mechanism behind
[ADR-0002](./adr/0002-two-apps-in-a-pnpm-workspace.md) — pnpm's strict symlinked
`node_modules` makes the leak unbuildable rather than unlikely. `@sugt/public` holds no
Supabase client and no database credentials of any kind.

Drizzle rather than Prisma, for one reason that matters here: this schema leans on CHECK
constraints, composite and deferred foreign keys, four partial indexes and two Postgres
schemas. `schema.prisma` cannot express any of those, so Prisma would mean hand-written
migration SQL anyway — at which point the generated client is the only thing left to weigh.

Drizzle expresses all of it **except one thing**: `DEFERRABLE INITIALLY DEFERRED` on the
PIC-membership foreign key, since drizzle-orm has `deferrable` on transactions but not on
foreign keys. That stays a hand-written migration, and drizzle-kit leaves it alone because it
is not in the snapshot — verified by re-generating against an unchanged schema and getting no
statements.

**`better_auth.user.person_id` used to be the second exception and no longer is.** This
document previously said drizzle-kit ignores it "because it isn't in its snapshot", which
cannot hold: the Drizzle adapter resolves each model as a key in the schema object it is
given, so every column it touches — `person_id` included — has to be **in** that object, and
therefore in the snapshot. It is declared there as `uuid()` rather than through Better Auth's
`additionalFields`, which types it `text` and could never foreign-key to `person.id uuid`.

What survives as hand-written is only the **cross-schema foreign key**, which no generator
will write. Migration `0002` keeps its guard and its `ADD CONSTRAINT`; its `ADD COLUMN` is
redundant once the column is declared, and folding it in is a prerequisite to applying
anything, not a tidy-up.

**The Drizzle schema is the source of truth, and it was checked against this document
rather than assumed to match it.** Both were applied to a real Postgres and the catalogs
compared — every column, CHECK, foreign key, unique constraint and index. 239 entries each,
identical apart from the constraint names Drizzle auto-generates. The invariant suite then
ran against the Drizzle-built database.

The unauthenticated feedback route needs its own care. It is the only path in either app that
writes without a signed-in Person, so it belongs behind a single handler that resolves the
token, checks the expiry, and can insert into `participant_feedback` and nothing else. See
[ADR-0012](./adr/0012-participants-write-through-a-short-lived-session-token.md).

Connection strings, both IPv4:

- Runtime, from Vercel functions — Supavisor **transaction** mode, port `6543`. Prepared
  statements are unavailable in this mode; the driver must be configured accordingly.
- Migrations — Supavisor **session** mode, port `5432`.

`turbo.json` runs with `envMode: strict`, so `DATABASE_URL` has to be declared in the
consuming task's `env` or it is invisible at build time. Nothing reads env today, so this is
the first entry.

**The aggregates endpoints add four more, and the same trap applies to all of them.** The
public app's build now fetches — and fails the deploy when it cannot — so a variable missing
from a task's `env` surfaces as an undefined secret at build time, one layer removed from
the cause:

| Variable            | Read by          | Declared on    |
| ------------------- | ---------------- | -------------- |
| `INTERNAL_APP_URL`  | `@sugt/public`   | `build`, `dev` |
| `AGGREGATES_SECRET` | both apps        | `build`, `dev` |
| `PUBLIC_APP_URL`    | `@sugt/internal` | `build`, `dev` |
| `REVALIDATE_SECRET` | both apps        | `build`, `dev` |

The first pair is `@sugt/public` calling in; the second is `@sugt/internal` calling back to
revalidate after a Story is published or withdrawn. Both secrets are shared between the two
apps, so each is declared in both — a value present on one side and missing on the other
fails at request time rather than build time, which is the harder failure to read.

None is `NEXT_PUBLIC_*`, and none may become one. A secret in the client bundle is a secret
anyone can read, and `AGGREGATES_SECRET` is the only thing making the endpoints
non-browser-reachable.

---

## What the database does not hold

Stated plainly, because an absent constraint reads as an oversight otherwise.

**"At least one Teaching Team member assigned to each Stream."** This Group rule is **gone**
([ADR-0020](./adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)): the Group is
Staff-only and its minimum at planning is just the PIC, so there is no per-Stream teaching-team rule
left to hold. A Perjadin _should_ end with a teaching team, but nothing blocks it — completeness is
the hand-ticked "Pengajar sudah lengkap" box, not a constraint.

**"Two _different_ Schools cannot share a date and time on one Perjadin."** The Group is one
travelling party and cannot be in two places at once. This used to be the
`session_one_school_at_a_time_per_perjadin` index, but ADR-0019 dropped it — parallel Sessions at
one School run at the same moment on purpose, and a plain unique index cannot forbid two _different_
Schools while allowing two rows at the _same_ School. So it is now the application's, checked when a
trip is planned (`planPerjadin` groups the planned Sessions by `(date, time)` and refuses any slot
holding more than one distinct School, naming the pair). The database still rejects an _exact_
duplicate — same School, date, time and Stream — through `session_no_duplicate_offline_per_school_per_perjadin`.

**Three app caps on the new Perjadin model.** None is a DB constraint, all live in the application in
the same spirit as the Group rules: **ten** offline Sessions per School per Perjadin
(`MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN`, a safety ceiling never reached in practice),
**twenty** trip-scoped teacher names per Perjadin (`MAX_TEACHING_TEAM_PER_PERJADIN`), and **ten**
extra Staff beyond the PIC on a Group (`MAX_EXTRA_STAFF_PER_GROUP`). All three constants are in
`@sugt/domain`; the writes that enforce them are T2/T3.

**"Both Streams were taught."** **Gone** ([#153](https://github.com/mafiefa02/sugt/issues/153), and
ADR-0022). It was an online-only rule, checked at delivery against the two `session_teacher` rows —
but an online Session is single-Stream now (ADR-0022) and carries one `stream` like an offline one,
and `session_teacher` is dropped, so there is no both-Streams expectation left to hold on either
side. Marking delivered is status-only for both modes.

**That an arranged offline Session falls inside its Perjadin.** `session.held_on` and
`perjadin.starts_on`/`ends_on` are unrelated columns as far as the database is concerned. The
rule and why a CHECK cannot carry it are in [Delivery](#delivery). It is now held by the
application — `heldOnWithinPerjadin` in `@sugt/db`, exported rather than private because it
belongs _wherever the date is written_ and there is more than one such place. The constraint
trigger was the alternative and is still the upgrade if raw SQL ever produces a row this
refuses; it was not taken here for the reason the two rules above were not, which is that
every write path this schema has goes through one package.

**The rule now reaches all three write paths.** A Session's date is written in three
places:

1. **Moving one Session's date** — Detail Sesi calls the validator and refuses.
2. **Arranging an offline Session** — Rencanakan Perjadin calls it against every Session on
   the trip, before the transaction opens, and refuses the whole plan naming the Schools
   whose dates fall outside.
3. **Resizing the trip** — the trip's range is its departure and return dates now
   ([ADR-0021](./adr/0021-perjadin-date-range-is-departure-and-return.md)), so it is edited by
   editing the legs, and `updatePerjadinLogistics` in `@sugt/db` recomputes `starts_on`/`ends_on`
   from the new leg dates. It **clamps, never shifts**: if the new `[departure … return]` window
   would leave an **arranged** Session outside it, the whole edit is refused (`would-strand`) and no
   Session moves; delivered and cancelled ones may sit outside the window their trip now claims and
   do not block it. One transaction with the trip's own update. The retired `movePerjadinDates` and
   its offset-shift ([#55](https://github.com/mafiefa02/sugt/issues/55)) belonged to the standalone
   typed range and went with it. The edit surface is Detail Perjadin's Staff-only "Ubah perjalanan"
   dialog; the resize and its refusal are held by the query, with tests.

   **It never touches `starts_at`.** A leg-date correction changes which days a trip spans, not the
   hour a School is expecting somebody — and it does not move any Session's `held_on` at all, since
   it clamps rather than shifting.

So an arranged offline Session can no longer be born outside its trip, nor moved outside it, nor
stranded when the trip's range is resized — path 3 refuses the resize rather than moving Sessions.
Both halves of #28's invariant now hold, at the data layer and at the surface that drives it:
Detail Perjadin's Staff-only "Ubah perjalanan" dialog is what a person resizes a trip through, and
it reaches the guard in path 3.

**That a Perjadin's Sessions are at Schools of its Sub-Cluster.** `perjadin.sub_cluster_id` is
NOT NULL and `school.sub_cluster_id` is NOT NULL, but nothing joins them. The composite-key
version was designed and rejected — [Delivery](#delivery) has the argument — because it would
also freeze a School into its Sub-Cluster the moment it had one delivered Session, and the
whole point of [ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md)
is that a Sub-Cluster is a revisable judgement. So it is checked in the application at the one
point it can be violated: planning a trip, where the eligible Schools are read from the chosen
Sub-Cluster and a payload naming any other School is refused whole. There is no "add a School
to an existing Perjadin" write, so that is genuinely the only path.

**That a School is not moved out from under a Perjadin that is still going to visit it.** The
mirror of the rule above, and the reason the pair is application-held rather than declarative.
Moving a School between Sub-Clusters is refused while an **arranged** Session at that School
sits on a Perjadin against the Sub-Cluster it is leaving, and the refusal names those Perjadins
so somebody can cancel or re-plan them first. Delivered and cancelled Sessions never block a
move: they record where the Programme went, not where it is going, and a grouping that could
not be corrected after the first trip would be a grouping nobody could fix.

**That a Sub-Cluster still holding Schools is not deleted.** This one _is_ declarative and is
listed only so it is not looked for in the application: `school.sub_cluster_id` is NOT NULL and
references `sub_cluster (id)` with the default `NO ACTION`, so Postgres refuses the delete
while any School points at it. Emptying it first is the only route, which is what keeps "every
School belongs to exactly one Sub-Cluster" true without an unassigned limbo to represent.

**That `delivered` is terminal.** `session_status_check` permits all three values with no
regard to what a row already holds, so nothing in the database stops `delivered` being written
back to `arranged` or `cancelled`. The rule is real and the reason is sharp — a reversal leaves
filed Class Records describing a Session that claims not to have happened, with their Ratings
still on the concerns list — but it is held by the application alone: the Session screen offers
cancellation while a Session is `arranged` and never after, and offers no way back from
`delivered` at all.

**"Every transaction has at least one piece of evidence."** Also a cross-row count. Required
when the Report is filed, not when the transaction is entered — `product.md` is explicit that
a receipt can be attached later.

**The four-offline-six-online cap.** Deliberately unenforced. Ten is the denominator for
progress, not a limit on what may be recorded, and a cancelled Session counts for nothing
while staying visible — so the cap is not "four rows" but "four non-cancelled rows", and
cancelled rows accumulate without bound. Blocking a legitimate eleventh Session to defend a
number nobody is disputing is the kind of invented friction
[ADR-0007](./adr/0007-the-tool-generates-the-acquittal.md) warns has an escape route.

**Access control.** The rule — delivery and money open to everyone signed in to **read**, money
and delivery-arranging Staff-only to **write** — is application code, not RLS.
[ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md) drew the line at
delivery-vs-money; [ADR-0026](./adr/0026-money-is-open-to-read-and-staff-only-to-write.md) (#180)
redrew it as read-vs-write, so money reads are open now (a Pimpinan reads all money) and it is money
_writes_ that the guard closes. Better Auth means there is no `auth.uid()` in Postgres, so policies
would need `SET LOCAL` on every transaction plus a non-superuser role with `FORCE ROW LEVEL
SECURITY`: a great deal of machinery for one role rule. Every money-_writing_ query therefore takes
the authenticated Person and refuses a non-Staff caller, at a single choke point in `@sugt/db`. See
[ADR-0011](./adr/0011-supabase-and-better-auth.md).

Note what this is _not_: the public/internal boundary is still structural, held by the
dependency graph. It is only the Staff/non-Staff write line that is a runtime check.

**Who a caller is, is a type.** This document used to leave open whether the Staff-only choke
point needed a sibling for "no Person at all, but a valid secret". It does, and the sibling is
a type rather than a second guard. Three kinds of caller now reach `@sugt/db`, and they are
three named types rather than one with optional fields:

| Caller             | Is                                                      | May read                     | May write                              |
| ------------------ | ------------------------------------------------------- | ---------------------------- | -------------------------------------- |
| `Person`           | somebody signed in whose `person` row is still `active` | delivery and money           | their own records; money only if Staff |
| `ServiceCaller`    | `@sugt/public`, holding `AGGREGATES_SECRET`             | the three aggregate payloads | nothing                                |
| `ParticipantToken` | a live Session feedback token                           | nothing                      | `participant_feedback` only            |

Every query takes one, and the money queries accept only `Person`. A single type carrying
optional fields would turn "is this a Staff caller" into a runtime shape check — which is
precisely what the composite foreign keys avoid everywhere else in this schema, and the same
argument applies one layer up.

**A person on two overlapping Perjadins.** Genuinely preventable with `btree_gist` and an
exclusion constraint, and genuinely useful — but it would mean denormalising the date range
onto `group_member`. Not worth a duplicated range today.

**That a record belongs to a Session that actually happened.** Nothing stops a Class Record,
Session Record or Participant Feedback being filed against an `arranged` or `cancelled` Session.
Left to the application, which only offers the form on a delivered one.

**That any Class Record exists, or that a filer taught the Session.** These were rules about
`session_teacher` — who taught, whether the six expected Records had arrived, whether a filer was in
that room — and `session_teacher` is dropped ([#153](https://github.com/mafiefa02/sugt/issues/153)).
Class Records are deferred for both modes: teachers are free-text names now, on both sides, who
cannot sign in and file, so no Record can be filed and none is expected. The `class_record` table
stands unused; how name-taught teaching is evaluated is a later decision (the `CONTEXT.md` open
question). See [who still owes what](#who-still-owes-what).

**Who filed a Perjadin Evaluation.** There is no `filed_by_person_id` at all: the Evaluation is
filed through an unauthenticated token link now, and the filer self-declares a Role and a Name that
reference nothing (ADR-0024). The database cannot say whether a submission came from someone who was
on the trip — the identity is untrusted by design, as `participant_feedback.name` is. The old "only
the Group may file" rule is not enforced anywhere because it is no longer a rule. See
[why there is no filer foreign key](#why-there-is-no-filer-foreign-key).

**That the PIC filed theirs.** "The PIC's Record is required" is the one completeness rule in
the delivery half, and it is unenforceable in the database — the PIC is itself a `coalesce`
across two tables, and nothing can require a row to exist. It is a query the Session screen
runs, not a constraint.

**Anything about who submitted Participant Feedback.** No de-duplication, no rate limit, no
proof the submitter attended. The token's expiry is the only gate, and it is a weak one by
design — see [ADR-0012](./adr/0012-participants-write-through-a-short-lived-session-token.md).
Rate limiting belongs at the edge, not in a constraint.

**That the token was still live when feedback arrived.** `expires_at` is a column, not a
gate; nothing stops a direct insert after it has passed. The handler that resolves the token
is what enforces it.

**That a Story's cover is one of its own photographs.** `story.cover_photo_id` references
`story_photo (id)` alone, so nothing prevents one Story carrying another Story's photograph as
its cover. The device that would hold it is the one this schema reaches for everywhere else — a
`unique (id, story_id)` on `story_photo` and a composite foreign key into that pair — and it is
not added today because the editor only ever offers a Story the photographs uploaded to it. If
that proves optimistic, that is the upgrade: a `unique (id, story_id)` on `story_photo`, and
`story`'s single-column foreign key replaced by `(cover_photo_id, id)` referencing it. A null
cover still passes, under the same `MATCH SIMPLE` rule that lets offline Sessions carry no PIC
columns.

**That a Story with photographs has a cover before it is published.** This is the only gate in
the product and the database holds no part of it: `published_at` is a nullable timestamp and
nothing ties it to `cover_photo_id`. The editor withholds the control, so a direct `update`
would publish an uncovered Story without complaint. See [Stories](#stories) for why the gate
exists at all.

### What deleting a Perjadin does

`group_member` cascades. `transaction` cascades, and `transaction_evidence` cascades from
that — so deleting a Perjadin destroys its acquittal, objects in the `receipts` bucket
included, and nothing warns you. `perjadin_teacher` and `perjadin_pimpinan` cascade too — the
trip-scoped teacher names and the recorded Pimpinan are the trip's and outlive nothing — and
`session_teaching_team` cascades from `perjadin_teacher`, so an offline Session's "Diajar oleh"
links go with the names.

`session.perjadin_id` deliberately does **not** cascade and has no `on delete` action at all,
so an offline Session blocks the delete. A trip that produced teaching cannot be quietly
erased; its Sessions have to be dealt with first. Verified, along with the fact that the
cascade and the deferred PIC foreign key resolve against each other rather than deadlocking.

---

## Still open

- **Whether 7 is the right line.** It is a guess, and a wide one — roughly the bottom
  two-thirds of a ten-point scale surfaces, and the same number makes prose mandatory. It sits
  in three index predicates, so moving it is a migration. Worth reading the first month of the
  concerns list before it settles.
- **Whether the four rubrics are right.** Twenty Aspects across four forms, all proposed here
  rather than drawn from anything DITSAMA already uses. If a rubric exists on paper, it should
  win. The Class Record's seven is the one to scrutinise first, since it is filed six times a
  Session.
- **Whether `coordination` survives.** It asks the PIC to rate their own planning, which people
  do generously. Kept because a low one is then very informative and nobody else can judge it,
  but it is the Aspect most likely to be noise.
- **Whether a Perjadin Evaluation is required of anyone.** Nothing currently is — unlike a
  Session Record, where the PIC's is expected. The PIC is the obvious candidate.
- **What else the Participant form asks for.** Right now: Class, three Ratings, a comment on each Aspect, name.
  A role or year group would be a column, not a redesign.
- **The four Cluster Problems are placeholders.** Invented here to be plausible per Cluster and
  workable from both Streams; they are not DITSAMA's. Replace them by editing
  `packages/db/seed/reference-data.sql` and re-running, not by updating the rows — the seed
  overwrites that column like every other one.
- **The acquittal's real paperwork.** Still unobtainable until the first Perjadin is filed, so
  the export ships generic. **What a transaction is categorised by is no longer part of this
  question** — see [Money](#money); the categories came off the approved budget rather than off
  a form nobody has read. What remains open is the document those figures are eventually typed
  onto, and whether it wants anything `transaction` does not already hold.
- **The publishing tables are designed but not written.** [Stories](#stories) has the
  contract; it is not yet Drizzle, not yet migrated, and not yet checked against a real
  Postgres the way the rest of this document was.
- **The founding-Staff seed.** A separate artefact from `reference-data.sql`, holding the
  rows that break the sign-in bootstrap and nothing else. See
  [ADR-0013](./adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md).
- **The aggregates endpoints.** Four routes on `@sugt/internal` across three lifetimes — scope,
  delivery, the published-Stories list and Story detail — read server-side by `@sugt/public`
  with a shared secret, cached per
  [ADR-0014](./adr/0014-the-public-site-uses-the-pre-cache-components-caching-model.md) and
  versioned per [ADR-0008](./adr/0008-public-narrative-is-authored-in-the-internal-app.md).
  Whether the choke point needed a sibling is settled — it did, and it is a type; see
  [what the database does not hold](#what-the-database-does-not-hold). What remains open is the
  exact field shape of each payload.
