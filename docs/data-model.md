# The data model

What is stored, and which rules the database holds rather than the application.

This assumes the vocabulary in [`CONTEXT.md`](../CONTEXT.md) and the surfaces in
[`docs/product.md`](./product.md). Why the vendor and the boundaries are what they are is in
[ADR-0005](./adr/0005-postgres-for-the-invariants-not-the-scale.md) and
[ADR-0011](./adr/0011-supabase-and-better-auth.md).

Postgres and object storage are Supabase; both apps deploy to Vercel.

Every SQL block below was applied to a real Postgres, seeded with the actual forty-seven Schools
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
| Advance                                                      | Not stored (ADR-0051). Its column was dropped in migration 0050 (#465).                                                                                    |
| Uang Perjalanan Terpakai                                     | Not a column. The sum of a Perjadin's transactions, all categories, derived on every read.                                                                 |
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
`string`. A column CHECKed against a **single member** of one — `perjadin.pic_role`
and the two `filed_by_role` columns — now carries that member as a
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
leaving Staff alone once online Sessions named their teachers as free-text names (ADR-0022; since #318
the two `pengajar_*` columns) and `session_teacher` — its last user — was dropped;
[#179](https://github.com/mafiefa02/sugt/issues/179)
then widened `role` to `check (role in ('Staff', 'Pimpinan'))` to admit a second signed-in principal.
**Only that CHECK widened.** Every composite `(id, role)` foreign key below still pins `role =
'Staff'`, so the widened role satisfies none of them — a Pimpinan is a login-only, **read-only**
Person, kept out of Group membership, the PIC seat, a Session Record and a Story authorship by
exactly those untouched keys ([ADR-0025](./adr/0025-pimpinan-is-a-second-signed-in-read-only-person-role.md)).

**`role` is write-once, and the database already enforces it.** Five composite foreign
keys point at `person (id, role)` — from `group_member`, `class_record`, `session_record`,
`story.written_by_person_id` and `perjadin.pic_person_id` — and
none declares `on update`, so all default to `NO ACTION`. The moment a Person has been on a trip,
filed a record or authored a Story, Postgres refuses to change their role. (`session_teacher` was a
sixth until T3 dropped it, [#153](https://github.com/mafiefa02/sugt/issues/153); `session.online_pic`
another until #284 dropped the online PIC.) `class_record`'s FK still pins `'Teaching Team'`, but that table is
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

**Grants live in `person_grant`, a second access axis** ([ADR-0028](./adr/0028-grants-are-a-second-additive-access-axis.md)):
a row is a capability a Staff Person holds, its `grant` column CHECKed against the closed set
`in ('Administrator', 'Keuangan', 'Perjadin Editor', 'Daring Editor', 'Dashboard Editor', 'Dashboard Viewer')`,
character-for-character `GRANTS` in `@sugt/domain`. Migration `0051`
([#469](https://github.com/sugt-itb/sugt-itb-26/issues/469),
[ADR-0052](./adr/0052-editor-splits-into-perjadin-daring-and-dashboard-editor.md)) split `'Editor'`
into the three Editors, giving every Editor all three, and added `'Keuangan'`, by the drop-and-re-add
CHECK pattern `0018`/`0025`/`0031` use with the rows moved between the drop and the add. No Grant
implies another except `Administrator` (all of them) and `Dashboard Editor` (`Dashboard Viewer`), a
rule `hasGrant` holds, not the database. The
`Dashboard Viewer` grant is what [#322](https://github.com/sugt-itb/sugt-itb-26/issues/322)/[ADR-0037](./adr/0037-dashboard-read-is-gated-by-a-grant.md)
check to gate the Dashboard read. The rest of `person_grant` (its columns, its `unique (person_id, grant)`,
its Staff-only rule) is otherwise undocumented here — a pre-existing gap from ADR-0028, out of scope to
close in full now.

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

There are four Clusters and forty-seven Schools. Cluster sizes are lopsided — seven, eighteen,
twelve, ten — which is worth knowing before anyone builds a screen assuming they are
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
screen would say so. A Sub-Cluster bounds which Schools one Perjadin may combine; it may be
covered by several Perjadins, and nothing makes `perjadin.sub_cluster_id` unique
([ADR-0043](./adr/0043-a-sub-cluster-may-be-covered-by-several-perjadins.md)). `sub_cluster.name`
is the first half of every trip's name
([ADR-0044](./adr/0044-a-perjadin-is-named-by-its-kelompok-and-dates.md)), so renaming a
Sub-Cluster relabels its trips.

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
would let forty-seven rows express something only the Province list can vary by, and would admit
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
  held_on           date not null,
  starts_at         time not null,
  ends_at           time,
  status            text not null default 'arranged'
                      check (status in ('arranged', 'delivered', 'cancelled')),
  cancelled_reason  text,
  pengajar_siswa_name   text,
  pengajar_gtk_ms_name  text,

  created_at        timestamptz not null default now(),

  check ((mode = 'offline') = (perjadin_id is not null)),
  check ((status = 'cancelled') = (cancelled_reason is not null)),
  check (mode <> 'online'
         or (pengajar_siswa_name is not null and pengajar_gtk_ms_name is not null)),
  check (ends_at is null or ends_at > starts_at)
);

create unique index session_one_online_per_school_per_day
  on session (school_id, held_on)
  where perjadin_id is null and status <> 'cancelled';

create unique index session_no_duplicate_offline_per_school
  on session (school_id, held_on, starts_at)
  where status <> 'cancelled' and perjadin_id is not null;
```

**No Session carries a Stream.** The STEM/Research split used to be a property of who taught — the
two `session_teacher` rows, one per Stream — then ADR-0019 moved it onto the offline Session as a
`stream` column, and ADR-0022 briefly did the same online.
[ADR-0034](./adr/0034-online-sessions-are-no-longer-single-stream.md) took it off online Sessions,
and [ADR-0038](./adr/0038-offline-sessions-carry-no-stream-and-parallel-rooms-are-one-session.md) took
it off offline ones: the material taught in a Session is a combination of both Streams, not one, so
there is nothing to record. Migration `0032` drops `stream` with `session_stream_check` and
`session_offline_stream_not_null`, discarding the values. Stream survives where it does describe
something — `group_member`, `assessment_completion`, `story` — just not on `session`.

**The online index keys on `(school_id, held_on)`**
([ADR-0034](./adr/0034-online-sessions-are-no-longer-single-stream.md), superseding ADR-0022). Online
Sessions are arranged one at a time, so "the same School twice on the same day" is a mis-click away;
the index makes the rule the plain one — **one online Session per School per day**, whatever the hour.
It dropped `stream` from the key when Stream was dropped from online delivery. It stays partial on
`perjadin_id is null`, so it touches online Sessions only; offline ones are untouched because their
`perjadin_id` is not null. Partial the usual way besides: cancelled rows accumulate and must not
collide with their replacements.

**Two offline-Session indexes were dropped, and a per-trip one replaced them — itself replaced by
the cross-trip index below since #408
([ADR-0019](./adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md),
narrowed by [ADR-0038](./adr/0038-offline-sessions-carry-no-stream-and-parallel-rooms-are-one-session.md)).**
`session_one_per_school_per_perjadin` — "one Session per School on the trip" — is gone, because a
School now has _several_ offline Sessions per Perjadin, each on its own date and time.
`session_one_school_at_a_time_per_perjadin`, on `(perjadin_id, held_on, starts_at)`, forbade _any_
two Sessions sharing a moment on one trip, same School included, and had to go. What the database
held then was **one live offline Session per School per date and start time on a trip** (since
#408, on any trip — see below): parallel rooms
are recorded as one Session whose Teaching Team lists everyone who taught, so two live rows at the
same School and moment are refused. ADR-0019 had allowed that pair when the key also carried
`stream` (a STEM and a Research room at one hour); ADR-0038 dropped `stream` and reversed it.
Migration `0032` narrows the index only after checking for live pairs it would refuse, and **aborts
listing them** rather than merging or cancelling a real Session itself. Partial on
`status <> 'cancelled'`, so a cancelled Session never blocks its slot. The count of Sessions per
School is an app cap (`MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN`), not a DB rule. The rule that
**two _different_ Schools cannot share a date and time** on one trip — the Group is one travelling
party — stays the application's (enforced when a trip is planned, and when a Session is added or
edited) and is listed in [what the database does not hold](#what-the-database-does-not-hold). Under
ADR-0019 it could not be a plain unique index, because same-School pairs had to pass. Since
ADR-0038 they no longer do, so the two rules together are one live offline Session per trip per
moment on one trip, and the trip-wide `(perjadin_id, held_on, starts_at)` index could hold both
within a trip. #342 kept the per-School key it specified; restoring the trip-wide index would be its
own change.

**The per-School rule holds across trips
([#408](https://github.com/sugt-itb/sugt-itb-26/issues/408),
[ADR-0043](./adr/0043-a-sub-cluster-may-be-covered-by-several-perjadins.md)).** One Sub-Cluster may
be covered by several Perjadins and the same School may sit on several, so a second live offline
Session at one School, date and start time is a double-booking **whichever trip carries it**.
Migration `0042` replaced `session_no_duplicate_offline_per_school_per_perjadin`, on
`(perjadin_id, school_id, held_on, starts_at)`, with `session_no_duplicate_offline_per_school`, on
`(school_id, held_on, starts_at)` — strictly wider, so the old one was dropped. It is partial on
`status <> 'cancelled' and perjadin_id is not null`: a cancelled Session never blocks its slot, and
online Sessions stay out, as the `perjadin_id` column in the old key kept them. Only an exact match
on date and start time collides; overlapping start times do not, across trips as within one. The
writes read the slot first (`slotHolder`), so a double-booking on another trip comes back as
`school-booked-on-another-perjadin`, naming and linking that trip, and a race past the read is read
again and named the same way. Like `0032`, migration `0042` first looks for live pairs the wider
index would refuse and **aborts listing them**; nothing cancels a Session to make it fit. The different-Schools rule stays
**per trip** — two Groups can be in two places at once.

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

**Only an offline Session has a PIC now ([ADR-0035](./adr/0035-online-sessions-track-no-pic-and-file-no-session-record.md)).**
An offline Session's PIC is its **Perjadin's** (`perjadin.pic_person_id`); an **online** Session has
none — a third-party LMS runs online delivery, so DITSAMA staffs no PIC. The old
`online_pic_person_id`/`online_pic_role` columns, their CHECKs (`session_online_iff_pic` and the
PIC-role pair) and the composite foreign key `session_online_pic_is_staff` are **dropped**. "The PIC
of a Session" is therefore simply `perjadin.pic_person_id` reached through the Session's `perjadin_id`
— a plain left join (null for an online Session), not the old
`coalesce(online_pic_person_id, perjadin.pic_person_id)`. `session_offline_iff_perjadin` is now the
whole of "which Sessions have a PIC".

This is why an **online Session produces no Session Record**: the Session Record is the PIC's account
of the visit, and online Sessions have no PIC. Only offline Sessions owe one. The `session_record`
table itself is unchanged — offline Sessions file records exactly as before, filed by the Perjadin's
Staff PIC.

**The load-bearing consequence:** the offline `/sesi/[id]` detail read must resolve an online
Session's row (with a null PIC) rather than drop it, so the page can redirect the online id to
`/sesi-daring/[id]`. Before this change its `coalesce(...)` inner join would have gone null for an
online row and 404'd every online Session; the left join on `perjadin.pic_person_id` is what makes
dropping the columns safe.

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

**`ends_at` is nullable and online-required at the application layer (#283).** It was added after
online Sessions existed in a populated database, so unlike `starts_at` the one-off NOT-NULL
affordance is spent — a strict column would fail the migration against rows with no value and no
backfill. So it is nullable with only a range CHECK (`ends_at is null or ends_at > starts_at`), and
"required for an online Session" is enforced on the write path (`arrangeOnlineSession` /
`updateOnlineSession` and the form guard). It is a wall-clock `time` local to the School exactly like
`starts_at`. Offline rows leave it null and pass the CHECK.

**The two `pengajar_*` columns are online-required, enforced both ways (#318).** An online Session
carries `pengajar_siswa_name` and `pengajar_gtk_ms_name` — one Narasumber for the Siswa cohort and one
for GTK-MS, one free-text name each ([ADR-0036](./adr/0036-online-sessions-carry-two-cohort-named-pengajar-and-are-recorded-delivered.md),
superseding ADR-0022's `session_teacher_name` list). They are nullable in the column type so an
_offline_ row leaves them null, but — unlike `ends_at` — the presence rule is a **NOT-NULL-for-online
CHECK**, `mode <> 'online' or (pengajar_siswa_name is not null and pengajar_gtk_ms_name is not null)`,
because #318 wiped the (empty) online data, so the clean implication holds with nothing to migrate
against. The old `participant_type` column and its `session_participant_type_check` are **dropped**:
an online Session no longer carries a single-cohort "Peserta" — both cohorts are always taught, one
Narasumber each. (`transaction` and `assessment_completion` keep their own `participant_type`; only the
Session's is gone.)

**An online Session is recorded `delivered` in one step (#318).** A third-party LMS runs online
delivery, so `arrangeOnlineSession` logs a Session that already happened — `status: 'delivered'`, with
`held_on` refused if it is in the future — rather than arranging one and marking it later. The
arrange→deliver two-step survives only for offline Sessions and any online Session arranged before
#318 (of which there are none). This is a superseding gloss on
[ADR-0006](./adr/0006-sessions-are-created-when-arranged.md) for the online half — a Session still
_exists only once written_, it is simply written already delivered.

**An online Session's time is always WIB (#283), and this is a rendering choice, not a column.**
`starts_at`/`ends_at` are still stored as a bare wall-clock `time`, but for an _online_ Session the
number is a WIB wall-clock time nationally — the Zoom host is in WIB — so the online surfaces label
and render it "(WIB)" unconditionally rather than deriving the zone from `province.time_zone` through
the School the way offline Sessions do. Nothing about the storage changed; the online reads simply
stopped joining `province` for the zone and treat it as the constant WIB.

**An arranged offline Session's `held_on` lies inside its Perjadin's `starts_on`–`ends_on`.**
Nothing holds that — not this schema, and until now not any document either. It is scoped to
_arranged_ deliberately: a trip's range is correctable (two typed dates,
[ADR-0041](./adr/0041-a-perjadin-carries-no-travel-legs-and-its-dates-are-typed.md)), and a resize that would
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

**Marking a Session delivered is status only, for both modes** (#140, #152, #153) — and for online it
is now **legacy** (#318). An online Session is born `delivered` (above), so it never passes through
"Tandai terlaksana"; that path survives for offline Sessions and any pre-#318 online row. When it does
run it writes nothing but `session.status = 'delivered'` and names nobody. Online Narasumber are the two
cohort-named columns on the Session, edited through the Session's own field dialog on
`/sesi-daring/[id]`, and a mis-recorded online Session is **hard-deleted** (`deleteOnlineSession`)
rather than corrected name by name or cancelled — the correction path that replaced the old
post-delivery "Perbaiki pengajar" flow and, for born-`delivered` rows, cancellation. An **offline**
Session's mark-delivered was already status only (#140): its teachers are trip-scoped
`session_teaching_team` names edited on the Perjadin, and it writes no per-Stream Person (ADR-0019,
ADR-0020) — nor carries a Stream at all since ADR-0038. Consequences left **deferred** and not modelled here — see the open question in
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
taught as **free-text names**: online through the two `pengajar_*` columns on `session` itself,
offline through `session_teaching_team` (below).

**`session_teacher_name` was in turn dropped in #318.** ADR-0022's online model was a variable-length
side table of session-scoped names; [ADR-0036](./adr/0036-online-sessions-carry-two-cohort-named-pengajar-and-are-recorded-delivered.md)
replaced it with **two cohort-named columns on the `session` row** — `pengajar_siswa_name` and
`pengajar_gtk_ms_name`, one Narasumber for the Siswa cohort and one for GTK-MS, one free-text name each,
both required for an online row (the NOT-NULL-for-online CHECK above). An online Session is taught by
exactly one professor per cohort, so the row-per-name shape held nothing the columns do not, and the
app-layer `MAX_TEACHING_TEAM_PER_ONLINE_SESSION` cap that bounded the list is **gone** — the number is
fixed by the schema now. No Stream and no Person, the whole point of the name-based model.

Offline Sessions record who taught through a name-based link instead:

```sql
create table session_teaching_team (
  session_id           uuid not null references session (id) on delete cascade,
  perjadin_teacher_id  uuid not null references perjadin_teacher (id) on delete cascade,

  primary key (session_id, perjadin_teacher_id)
);
```

"Diajar oleh" — the _set_ of a Perjadin's trip-scoped teacher names who staffed one offline
Session's parallel rooms — one Session, not one per room (ADR-0038). A plain many-to-many with no
Stream (no Session carries one) and no Person. Both sides cascade: a link means nothing once either the Session or the teacher name is
gone. It is the offline analogue of an online Session's two `pengajar_*` columns, and touches no
`person` row, which is the whole point of the name-based model ([ADR-0020](./adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)).

**Offline Class Records fall out of scope** as a consequence: their filers would be the teachers,
and a name is not a Person who can sign in and file. See the open question in `CONTEXT.md`.

### Pretest/Posttest completion

Whether a **Pretest** — and later a **Posttest** — was **administered** to a cohort at a School,
tracked as a bare tuple whose _presence_ means "done"
([ADR-0031](./adr/0031-pretest-posttest-completion-is-tracked-as-delivery-not-outcomes.md)). This is
**delivery, not outcome** ([ADR-0009](./adr/0009-the-tool-tracks-delivery-not-outcomes.md)): the row
records that the assessment happened, never a score.

```sql
create table assessment_completion (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references school (id) on delete cascade,
  stream            text not null,
  participant_type  text not null,
  kind              text not null,

  constraint assessment_completion_box_key
    unique (school_id, stream, participant_type, kind),
  constraint assessment_completion_stream_check
    check (stream in ('STEM', 'Research')),
  constraint assessment_completion_participant_type_check
    check (participant_type in ('Siswa', 'GTK-MS')),
  constraint assessment_completion_kind_check
    check (kind in ('pretest', 'posttest'))
);
```

The grain is **(School × Stream × participant-type × kind)**: one row per box on the **Dashboard** (`/`)
Pretest tracker. Ticking a box inserts the row, un-ticking deletes it — there is **no `done` column
and no `recorded_at`/`recorded_by`**, because a completion needs no audit trail and "done" has one
representation. The unique constraint gives one row per box; the three CHECKs mirror the domain
consts `STREAMS`, `PRETEST_PARTICIPANT_TYPES` and `ASSESSMENT_KINDS` character for character, the
same discipline as every other set-valued column (see _the glossary is not the schema_). `posttest`
is a legal `kind` from the start though no UI surfaces it this iteration, so surfacing it is a
UI-only change rather than a migration.

`participant_type`'s `Siswa`/`GTK-MS` values coincide with `transaction.participant_type` today but
sit on a **dedicated** const on purpose — the money axis and the assessment axis evolve
independently.

**The /47 denominator is never stored.** Any progress reading ("X / 47") derives its denominator
from `schools.length` at read time, matching every existing "X / 47" pattern (`aggregates.ts`,
`dashboard-derive.ts`) — a stored copy would be a second source of truth that could drift. Reads are
open to any signed-in Person; the one write (tick/un-tick) opens with `requireGrant(caller,
"Daring Editor")` (ADR-0028, ADR-0052).

---

## The four evaluations

A Session is judged from three vantage points, and a Perjadin from a fourth. Each has its own
rubric, because each asks a question only that person can answer.

| Table                  | Filed by      | One per               | Aspects                                                                          |
| ---------------------- | ------------- | --------------------- | -------------------------------------------------------------------------------- |
| `class_record`         | Teaching Team | Class, per professor  | Comprehension, Participation, Readiness, Materials, Delivery, Facilities, Timing |
| `session_record`       | PIC / Staff   | Session               | Facilities, Turnout, School support, Timing, Coordination                        |
| `participant_feedback` | Participants  | Class, per respondent | Materials, Instructor, Relevance; Hands-on RBL for the Student Class only        |
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
  token                 text primary key,
  session_id            uuid not null references session (id) on delete cascade,
  issued_at             timestamptz not null default now(),
  issued_by_person_id   uuid not null references person (id)
);

create index session_feedback_token_session_id_idx on session_feedback_token (session_id);

create table participant_feedback (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references session (id) on delete cascade,
  class_kind  text not null check (class_kind in ('GTK', 'MS', 'Student')),
  name        text not null,

  hands_on_rbl smallint        check (hands_on_rbl between 1 and 10),   -- Student Class only (#446)
  materials   smallint not null check (materials  between 1 and 10),
  instructor  smallint not null check (instructor between 1 and 10),
  relevance   smallint not null check (relevance  between 1 and 10),

  hands_on_rbl_comment text,
  materials_comment    text,
  instructor_comment   text,
  relevance_comment    text,
  knowledge_gain       text,                                         -- written answers (#446),
  suggestions          text,                                         -- not Aspects
  submitted_at         timestamptz not null default now(),

  check (class_kind = 'Student' or (hands_on_rbl is null and hands_on_rbl_comment is null))
);

create index participant_feedback_concerns_idx
  on participant_feedback (least(hands_on_rbl, materials, instructor, relevance))
  where least(hands_on_rbl, materials, instructor, relevance) <= 7;
```

**Three Aspects for every Class — four for the Student Class, with Hands-on RBL — and none of them
ask a Participant to rate themselves.** Comprehension, Participation and Readiness are on the
Class Record precisely because they are judgements about the room, and a room grading its own
readiness is not evidence. Materials and Instructor overlap deliberately with the Class Record's
`materials` and `delivery` — that overlap is the point, because it lets what the professor thought
be set against what the room thought.

`class_kind` says which Class the respondent sat in. It is what makes their Rating comparable to
the Class Record for that same cohort.

**Hands-on RBL is the Student Class's alone** ([#446](https://github.com/sugt-itb/sugt-itb-26/issues/446)):
`hands_on_rbl` and its `hands_on_rbl_comment`. A CHECK holds both null on every GTK and MS row.
The column is nullable, and **"required for Siswa" is the application's rule**
(`submitParticipantFeedback`, which refuses a Siswa submission without one as `ratings-mismatch`),
not a constraint: Student feedback filed before the column existed has none, and is not
backfilled. `least()` ignores a null, so the rebuilt concerns index still covers GTK, MS and those
older rows, and a Hands-on RBL Rating of 7 or below reaches the concerns list like any other.
Where a row's Ratings are averaged (the `/feedback` row average), it is over the Ratings present.

**Two written answers that are not Aspects**, `knowledge_gain` and `suggestions`: optional, no
Rating, never counted, never on the concerns list.

**No elaboration rule applies to Participants.** The `CHECK` forcing prose on a low Rating is on
`class_record` and `session_record` only. A Participant owes nothing and is not signed in;
refusing their 3 because they did not justify it would simply lose the 3.

**One optional comment per Aspect**, `materials_comment` / `instructor_comment` /
`relevance_comment` / `hands_on_rbl_comment`, rather than one shared `comment`
([#102](https://github.com/mafiefa02/sugt/issues/102),
[ADR-0017](./adr/0017-participant-feedback-has-a-comment-per-aspect.md)). A single comment could
not say which Aspect it was about, so the concerns list could show a low
`instructor` Rating beside prose that was really about the materials. Pairing each comment with its
Aspect lets the list show the comment for the Aspect that was actually Rated low — or none, when
that box was left blank. All of them stay nullable; the no-elaboration rule above is unchanged.

**A Session's links never expire and are never replaced**
([ADR-0049](./adr/0049-feedback-links-never-expire-and-are-never-replaced.md)). Staff print the QR
the day before and shorten the link, so a row has no `expires_at`, and nothing in the app updates or
deletes one: `issueFeedbackToken` locks the Session row, returns the link it has, and inserts only
when it has none. **The token is the key** and `session_id` a plain indexed foreign key, so a
Session may hold several links. Only `db:reattach-links` adds a second, putting back a link that an
earlier reissue overwrote (the old design upserted on `session_id`). Issuing returns the original,
which is the earliest `issued_at`, then `token`. Every link resolves to its Session, and a cancelled
Session's links resolve to `gone`. Migration `0048` changed the key in place and dropped
`expires_at`, keeping every row and its token string.

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
token link shared from the trip's page, by a filer who **self-declares** a Role and a
Name (ADR-0024).

```sql
create table perjadin_feedback_token (
  token                 text primary key,
  perjadin_id           uuid not null references perjadin (id) on delete cascade,
  issued_at             timestamptz not null default now(),
  issued_by_person_id   uuid not null references person (id)
);

create index perjadin_feedback_token_perjadin_id_idx on perjadin_feedback_token (perjadin_id);

create table perjadin_evaluation (
  id             uuid primary key default gen_random_uuid(),
  perjadin_id    uuid not null references perjadin (id) on delete cascade,
  filed_by_role  text not null check (filed_by_role in ('Narasumber', 'Pendamping', 'Pimpinan')),
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

**`perjadin_feedback_token` mirrors `session_feedback_token`.** Keyed on the token, with
`perjadin_id` an indexed foreign key. A link never expires and is never replaced (ADR-0049):
`issuePerjadinFeedbackToken` locks the Perjadin row, returns the trip's original link, and inserts
only when it has none. Several links per trip arise only from `db:reattach-links`. Any signed-in
Person may issue it. A Perjadin is a real trip once it exists, so there is no cancelled state to bar
(as the Session token has).

**`filed_by_role` and `filed_by_name` are self-declared and untrusted.** There is no
`filed_by_person_id` and no foreign key: the filer may be a name-based Narasumber or a record-only
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

**`lodging` is nullable, because a day-trip has no hotel** — one of two nullable Ratings, with
`participant_feedback.hands_on_rbl` (#446). Not every Perjadin involves a night away — the
programme budget carries at least one group visiting two Schools and returning the same day, with
accommodation, flights and airport transfer all at zero. A `not null` column would require those
travellers to rate a hotel they never saw, and inventing a Rating to satisfy a constraint is worse
than the missing row.

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
to judge a trip include the name-based **Narasumber** and the record-only **Pimpinan**, neither of
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
  cross join lateral (values ('hands_on_rbl', f.hands_on_rbl, f.hands_on_rbl_comment),
                             ('materials',    f.materials,    f.materials_comment),
                             ('instructor',   f.instructor,   f.instructor_comment),
                             ('relevance',    f.relevance,    f.relevance_comment))
                     as r(aspect, rating, said)   -- a null hands_on_rbl fails `<= 7` and drops out
 where r.rating <= 7

union all

select 'Perjadin Evaluation',
       sc.name || ' · ' || pj.starts_on || ' – ' || pj.ends_on,   -- the trip's name (ADR-0044)
       r.aspect, r.rating,
       e.filed_by_name, r.said, e.created_at
  from perjadin_evaluation e
  join perjadin pj on pj.id = e.perjadin_id
  join sub_cluster sc on sc.id = pj.sub_cluster_id
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
  starts_on                   date not null,
  ends_on                     date not null,

  pic_person_id               uuid not null,
  pic_role                    text not null default 'Staff' check (pic_role = 'Staff'),

  report_filed_at             timestamptz,
  drive_folder_id             text,
  created_at                  timestamptz not null default now(),

  check (ends_on >= starts_on),

  foreign key (pic_person_id, pic_role) references person (id, role)
);
```

**`starts_on` and `ends_on` are typed — Tanggal mulai and Tanggal selesai — and a Perjadin carries
no travel legs** ([ADR-0041](./adr/0041-a-perjadin-carries-no-travel-legs-and-its-dates-are-typed.md),
superseding [ADR-0021](./adr/0021-perjadin-date-range-is-departure-and-return.md)). The six leg
columns (`departure_at`/`_zone`/`_mode`, `return_at`/`_zone`/`_mode`) and their four CHECKs were
dropped, with their data: many trips are done PP, out to a nearby Sub-Cluster and back, sometimes
daily, so one departure and one return with a time and a mode described a journey that did not
happen. The plan form writes both dates directly; `ends_on >= starts_on` is the one rule the
database holds about them, and planning and the date edit both refuse an inverted range
(`ends-before-starts`) before it gets that far, same day allowed.

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

**There is no Advance column.** The Advance is not tracked
([ADR-0051](./adr/0051-the-advance-is-not-tracked.md)): #464 stopped the app reading or writing
`advance_idr`, `returned_to_treasurer_idr` and `returned_at`, and migration 0050
([#465](https://github.com/sugt-itb/sugt-itb-26/issues/465)) dropped the three with their two CHECKs.
Any amounts they held went with them; the Activity Log's `advance_set` / `advance_changed` entries
keep the history.

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

**`sub_cluster_id` is where a Perjadin goes, and there is no `destination`.** The Sub-Cluster is
structural: it bounds which Schools may appear on the trip at all — checked in the application,
not by a key ([what the database does not hold](#what-the-database-does-not-hold)). It is not
unique: one Sub-Cluster may be covered by several Perjadins, on the same dates or different ones
([ADR-0043](./adr/0043-a-sub-cluster-may-be-covered-by-several-perjadins.md)).

**A Perjadin's name is derived, never stored**
([ADR-0044](./adr/0044-a-perjadin-is-named-by-its-kelompok-and-dates.md)): `{sub_cluster.name} ·
{dates}`, read live — `Kelompok 10 · 12–13 Okt 2026`. Renaming a Sub-Cluster relabels its trips,
past ones included. **The trip's Schools** — the distinct Schools with a non-cancelled Session on
it, by name — are its second line where trips are listed, and part of its Drive folder and CSV
names; one query-side definition (`tripSchoolNames` in `@sugt/db`) serves every read. The
`destination` column this replaced was a Surat Tugas line —
`Kelompok 18: Samarinda dan Balikpapan`, the Sub-Cluster's label and every Kabupaten/Kota of its
Schools — derived at insert and frozen as a snapshot
([#105](https://github.com/mafiefa02/sugt/issues/105)). Migration 0041 dropped it: no Surat Tugas
generator exists, and a whole-Sub-Cluster line misnamed a trip to only some of its Schools.

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
every member row and inserts the new set. The Perjadin keeps its id, so its Sessions and
transactions are untouched — only the membership is destroyed and rebuilt.

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
Stream and no Person FK** — a name is not a Person, and no Session carries a Stream (ADR-0038). `on delete
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
create table preparation_item (
  id                              uuid primary key default gen_random_uuid(),
  level                           text not null check (level in ('semua', 'cluster', 'perjadin')),
  cluster_id                      uuid references cluster (id),
  perjadin_id                     uuid references perjadin (id) on delete cascade,
  label                           text not null check (length(trim(label)) > 0),
  position                        integer not null,
  added_on                        date,   -- semua / cluster only: the WIB day it was added
  removed_on                      date,   -- semua / cluster only: the WIB day it was removed
  clears_on_teaching_team_change  boolean not null default false,
  created_at                      timestamptz not null default now(),

  constraint preparation_item_scope_matches_level check (
       (level = 'semua'    and cluster_id is null     and perjadin_id is null)
    or (level = 'cluster'  and cluster_id is not null and perjadin_id is null)
    or (level = 'perjadin' and perjadin_id is not null and cluster_id is null)),
  constraint preparation_item_dated_iff_wide check (
       (level = 'perjadin' and added_on is null and removed_on is null)
    or (level <> 'perjadin' and added_on is not null)),
  constraint preparation_item_removed_after_added check (removed_on is null or removed_on >= added_on),
  constraint preparation_item_system_item_kept check (
    not clears_on_teaching_team_change or (level = 'semua' and removed_on is null))
);
create unique index preparation_item_one_system_item on preparation_item (clears_on_teaching_team_change)
  where clears_on_teaching_team_change;

-- A wider item hidden for one Cluster (dated spells) or one Perjadin (undated).
create table preparation_item_hide (
  id                   uuid primary key default gen_random_uuid(),
  preparation_item_id  uuid not null references preparation_item (id) on delete cascade,
  cluster_id           uuid references cluster (id),
  perjadin_id          uuid references perjadin (id) on delete cascade,
  hidden_on            date,
  shown_on             date,
  created_at           timestamptz not null default now(),

  constraint preparation_item_hide_one_scope check ((cluster_id is null) <> (perjadin_id is null)),
  constraint preparation_item_hide_dated_iff_cluster check (
       (cluster_id is not null and hidden_on is not null)
    or (perjadin_id is not null and hidden_on is null and shown_on is null)),
  constraint preparation_item_hide_shown_after_hidden check (shown_on is null or shown_on >= hidden_on)
);
-- one open spell per (item, Cluster); one row per (item, Perjadin)

-- A wider item reworded for one Cluster or one Perjadin. Undated.
create table preparation_item_wording (
  id                   uuid primary key default gen_random_uuid(),
  preparation_item_id  uuid not null references preparation_item (id) on delete cascade,
  cluster_id           uuid references cluster (id),
  perjadin_id          uuid references perjadin (id) on delete cascade,
  label                text not null check (length(trim(label)) > 0),

  constraint preparation_item_wording_one_scope check ((cluster_id is null) <> (perjadin_id is null))
);
-- one per (item, Cluster) and per (item, Perjadin)

create table perjadin_preparation_tick (
  perjadin_id          uuid not null references perjadin (id) on delete cascade,
  preparation_item_id  uuid not null references preparation_item (id) on delete cascade,
  checked_by           uuid not null references person (id),
  checked_at           timestamptz not null default now(),

  primary key (perjadin_id, preparation_item_id)
);
```

**The items are rows, defined at three levels**
([ADR-0045](./adr/0045-the-preparation-checklist-is-stored-per-level-and-frozen-for-finished-perjadins.md)).
A `semua` item applies to every Perjadin, a `cluster` item to its Cluster's Perjadins, a `perjadin`
item to its one Perjadin. A Perjadin's Cluster is `sub_cluster.cluster_id` of its Sub-Cluster, so it
is known before the trip has a Session. A Cluster or a Perjadin may hide a wider item
(`preparation_item_hide`) or reword it (`preparation_item_wording`), and the most specific wording
wins. The order is `semua`, then the Cluster's, then the Perjadin's own, each by its own `position`.
One query-layer resolver (`queries/preparation-checklist.ts`) turns these rows into a Perjadin's
list, in a batched form for lists of trips.

**The dates are what freeze a finished Perjadin.** A `semua` or `cluster` item applies to Perjadin P
only while `added_on <= P.ends_on` and `removed_on` is null or later than `P.ends_on`. Each date is
the WIB day of the change. A Cluster hide works the same way, one row per spell. Removing a wider
item is therefore a soft-remove that stamps `removed_on`; the Perjadins that had ended keep it and
its ticks. A `perjadin` item and a Perjadin-level hide are undated and always apply; removing the
item deletes it, and its ticks by cascade. Nothing is snapshotted at the end date: the rule reads the
trip's `ends_on` as it stands, so moving a trip's dates re-decides which dated changes reach it. Wording is never dated, so a rewording keeps the item's
id and ticks and shows on finished Perjadins too.

**Only the ticks are stored**, as before ([ADR-0018](./adr/0018-the-preparation-checklist-stores-ticks-and-derives-the-list.md)).
A row in `perjadin_preparation_tick` means the item is ticked on that Perjadin; un-ticking is a
`DELETE`. The primary key makes a toggle idempotent, and the toggle refuses an item the Perjadin's
resolved list does not hold. A hidden item keeps its ticks, so showing it again brings them back.
`checked_by` and `checked_at` record who and when; nothing renders them yet.

**The system item** carries `clears_on_teaching_team_change`. Any Teaching-Team change (a name
added, renamed or removed) deletes that Perjadin's tick on it, inside the teacher-mutation queries
(`queries/perjadin-teachers.ts`). The flag, not an id or a label, is what those queries read, so a
rewording keeps the coupling. The database holds that **at most one item carries the flag**
(`preparation_item_one_system_item`) and that it is a `semua` item **never removed**
(`preparation_item_system_item_kept`). That it is never hidden is the query layer's rule
(`queries/preparation-items.ts`), as is which items may be hidden or reworded where: a `semua`
item for a Cluster or a Perjadin, a `cluster` item for a Perjadin of that Cluster. So are the
wording rules Pengaturan Perjadin (#422) applies: at most `MAX_PREPARATION_ITEM_LABEL_LENGTH` (200)
characters, runs of spaces made one, and no new item or rewording that repeats, ignoring case,
another item's wording on the list of the level it is given at. Adding, rewording and moving take
one transaction-scoped advisory lock, so those checks cannot race. Moving an item renumbers its level's `position`s, undated.

**The cutover** is migration `0043_preparation_levels`. The old six became `semua` items removed
on the day it ran, so every Perjadin that had already ended keeps them; their ticks were converted
by `item_key`. Ticks on keys no item had (`dosen:*`, `tiket_keberangkatan`, `tiket_kepulangan`)
were dropped. The company's 14 were added that same day, the second carrying the flag.
`perjadin_preparation_item` was dropped.

---

### Perjadin Documents

```sql
create table perjadin_document (
  id                     uuid primary key default gen_random_uuid(),
  perjadin_id            uuid not null references perjadin (id) on delete cascade,
  kind                   text not null check (kind in
                           ('Daftar Hadir Peserta', 'Daftar Hadir Narasumber',
                            'Daftar Hadir Pendamping', 'SPPD')),
  document_date          date,
  school_id              uuid references school (id),
  participant_type       text check (participant_type in ('Siswa', 'GTK-MS')),
  starts_at              time,
  ends_at                time,
  drive_file_id          text not null unique,
  content_type           text not null check (content_type = 'application/pdf'),
  byte_size              integer not null,
  uploaded_by_person_id  uuid not null references person (id),
  uploaded_at            timestamptz not null default now(),
  drive_synced_at        timestamptz,
  drive_sync_failed_at   timestamptz,
  -- One CHECK per kind, each that kind's exact shape.
  check (kind <> 'Daftar Hadir Peserta' or (document_date is not null and school_id is not null
          and participant_type is not null and starts_at is not null and ends_at is not null)),
  check (kind not in ('Daftar Hadir Narasumber', 'Daftar Hadir Pendamping')
          or (document_date is not null and school_id is null and participant_type is null
              and starts_at is null and ends_at is null)),
  check (kind <> 'SPPD' or (school_id is not null and document_date is null
          and participant_type is null and starts_at is null and ends_at is null)),
  check (ends_at > starts_at)
);

-- At most one SPPD per School on one Perjadin (#441).
create unique index perjadin_document_sppd_unique
  on perjadin_document (perjadin_id, school_id) where kind = 'SPPD';

create table perjadin_document_folder (
  perjadin_id      uuid not null references perjadin (id) on delete cascade,
  kind             text not null check (kind in (…the four…)),
  drive_folder_id  text not null,
  primary key (perjadin_id, kind)
);

alter table perjadin add column drive_dokumen_folder_id text;
```

**A Perjadin's paperwork, one PDF each** (#397,
[ADR-0042](./adr/0042-perjadin-documents-are-stored-in-the-company-google-drive.md)): three
attendance sheets, and each School's **SPPD** (#441). `kind` is
character for character `PERJADIN_DOCUMENT_KINDS`, and `participant_type` is
`PERJADIN_DOCUMENT_PARTICIPANT_TYPES`, a const of its own as `PRETEST_PARTICIPANT_TYPES` is.

**The database holds which fields a document carries**, one CHECK per kind. A Daftar Hadir
Peserta has a date, a School, a cohort and a session's local start and end; a Narasumber or
Pendamping sheet has a date and none of the four; an SPPD has a School and nothing else, not even a
date — so `document_date` is nullable. Another CHECK holds `ends_at` after `starts_at`, and the
content type is pinned to PDF.

**At most one SPPD per (Perjadin, School)** is the partial unique index
`perjadin_document_sppd_unique`. It is per Perjadin, never per School alone: the same School on
another trip gets its own. `checkDocumentFields` checks it first — the upload opener asks it, so a
second SPPD is refused before a byte moves (`sppd-exists`) — and `recordPerjadinDocument` asks again
in its transaction; the index is what holds two uploads racing, the loser's violation coming back
as the same `sppd-exists`.

**The application holds the rest**, in `recordPerjadinDocument`: `document_date` lies inside the
trip, and a Peserta sheet's School is one of **the trip's Schools** — it has a non-cancelled
Session on this Perjadin (`isTripSchool`, the same rule `tripSchoolNames` reads names through) —
refused as `school-not-on-perjadin` ([#410](https://github.com/sugt-itb/sugt-itb-26/issues/410)).
An SPPD's School is held to the same rule.
It used to be the trip's Sub-Cluster, but a Sub-Cluster may be covered by several trips (ADR-0043),
so that offered Schools this trip never visits. The Dokumen dialog's picker offers exactly that set.
The rule is checked on a new upload only: a sheet recorded for a School whose Sessions on the trip
were all cancelled later stays listed and deletable. It cannot be a constraint: it reads the
Sessions, which change after the sheet is written. The three attendance kinds have **no duplicate
rule**: two sheets of one kind and date are two rows, told apart in Drive by `D-{doc8}`.

**The row and its Activity Log entry are written in one transaction**, and the row lands with
`drive_synced_at` null; the reconcile sets it once the file is named, filed and shared. `id` is
generated before the insert, because the file's name carries it.

**Folders.** `perjadin.drive_dokumen_folder_id` is the trip's folder under `Dokumen/Pelaksanaan
Offline`, and `perjadin_document_folder` holds its four kind folders, each made on first use. Both
are claimed by compare-and-set: the first by `where drive_dokumen_folder_id is null`, the second by
the primary key, `on conflict do nothing`. A caller that lost trashes its own folder and uses the
winner's.

**Hapus trashes the file first, then deletes the row** (#398). Its file is public by link, so a row
must never vanish while the file stays live: the file goes to the Drive trash, and only then are the
row deleted and a `document_deleted` Log entry written, in one transaction. The entry is a snapshot
of the row's fields, since the row is gone after it. A file already in the trash, or gone, counts as
trashed, so if the delete fails after the trash, the row stays, pointing at a trashed file, and
Hapus again finishes it. Hapus is refused while the connection is not usable. An emptied kind folder
is left in place, and nothing is ever edited: a wrong upload is a Hapus and a new upload.

### Session Footage

```sql
create table session_footage (
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null references session (id),
  kind                   text not null check (kind in ('foto', 'video')),
  content_type           text not null,
  original_filename      text not null check (length(original_filename) > 0),
  byte_size              bigint not null,
  drive_file_id          text not null unique,
  uploaded_by_person_id  uuid not null,
  uploaded_by_role       text not null default 'Staff' check (uploaded_by_role = 'Staff'),
  uploaded_at            timestamptz not null default now(),
  drive_synced_at        timestamptz,
  drive_sync_failed_at   timestamptz,
  check ((kind = 'foto'  and content_type in ('image/jpeg', 'image/png', 'image/heic', 'image/webp'))
      or (kind = 'video' and content_type in ('video/mp4', 'video/quicktime'))),
  check (byte_size > 0 and byte_size <= case kind when 'foto' then 52428800 else 1048576000 end),
  foreign key (uploaded_by_person_id, uploaded_by_role) references person (id, role)
);

alter table perjadin add column drive_footage_folder_id text;
alter table session  add column drive_footage_folder_id text;
```

**One offline Session's photos and videos, one file each** (#424,
[ADR-0046](./adr/0046-session-footage-is-stored-in-the-company-google-drive.md)), shown as "Foto &
Video". **The database holds** each file's kind against its type and its kind's cap
(`MAX_FOOTAGE_PHOTO_BYTES`, `MAX_FOOTAGE_VIDEO_BYTES` as literals), so no write can store a 2 GB
"photo", and that the uploader is Staff, by the composite key a PIC's is held by. `content_type` is
the type the server **sniffed**; a HEIF file is stored as `image/heic`.

**The application holds the rest**: in `recordSessionFootage`, the Session is offline and not
cancelled when the footage is added — checked again under a row lock inside the commit — and, in
the upload's verify step before it, the file was opened for this Session and its declared kind
matches the sniffed one. Footage of a Session cancelled later stays. The key to
`session` has **no cascade**: offline Sessions are only ever cancelled, so a delete that would orphan
Drive files is refused rather than followed.

**The row and its Activity Log entry are written in one transaction** (`footage_uploaded`), with
`drive_synced_at` null until the reconcile names, files and shares the file. `id` is generated before
the insert, because the file's name carries it (`M-{footage8}`). **Hapus** is the Dokumen order: the
file to the Drive trash first, then the row and a `footage_deleted` entry in one transaction.

**Folders.** `perjadin.drive_footage_folder_id` is the trip's folder under `Foto & Video/Pelaksanaan
Offline`, named as its other two; `session.drive_footage_folder_id` is the Session's folder inside it,
`{held_on} · {HH.MM} · {School} · S-{session8}`. Both are claimed by compare-and-set
(`where … is null`). A Session's folder and files are renamed when its date or time moves.

## Money

**There is no `perjadin_report` table.** A Perjadin yields exactly one Report, always, so the
acquittal is the state already on `perjadin` — `report_filed_at` — plus the trip's transactions and
their evidence: every transaction on the trip, reconciled against nothing (ADR-0051).

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
  created_at            timestamptz not null default now(),
  drive_folder_id       text,
  drive_synced_at       timestamptz,
  drive_sync_failed_at  timestamptz
);

create table transaction_evidence (
  id                    uuid primary key default gen_random_uuid(),
  transaction_id        uuid not null references transaction (id) on delete cascade,
  drive_file_id         text not null unique,
  content_type          text not null
                        check (content_type in
                          ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size             bigint not null,
  uploaded_by_person_id uuid not null references person (id),
  uploaded_at           timestamptz not null default now()
);
```

**A transaction is a line for the trip as a whole**, not a person's share of it. Worth knowing:
[ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md) justified hiding money
from Teaching Team by citing "per-diem amounts and personal travel claims" — but that money-read
gate is reversed by [ADR-0026](./adr/0026-money-is-open-to-read-and-staff-only-to-write.md) (#180):
money is now open to any signed-in Person to **read**, so a Pimpinan reads these lines; only
_writing_ them stays Staff-only.

**`incurred_by_person_id` is gone (#182).** The column shipped in migration `0006` as a nullable
"who a per-diem was paid to" and never earned its keep: naming that person said nothing about the
trip's spend, and the Laporan needed a different cut of the spend than it offered. It is
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
Uang Perjalanan Terpakai into a Siswa and a GTK-MS subtotal, so the column is `NOT NULL`: there is no unset
state to carry and no third `Umum` value — a shared cost is attributed to whichever type it
predominantly served. It is character-for-character `TRANSACTION_PARTICIPANT_TYPES` in
`packages/domain/src/index.ts`, CHECKed the same way `category` is.
[ADR-0004](./adr/0004-delivery-data-is-open-internally-money-is-not.md)'s money-_read_ gate is amended
by [ADR-0026](./adr/0026-money-is-open-to-read-and-staff-only-to-write.md) (money read opened to any
signed-in Person; writing money stays Staff-only).

Note what did **not** enter the table: no cost-centre, no account code, no payee, no
`Ref Standar Biaya` — the RAB carries the last of these on most lines (`PMK 32/2025 No.28.1`
and the like) and it stays out until a real form asks for it.

**Uang Perjalanan Terpakai is derived, never stored.** It is `sum(amount_idr)` over the trip's lines,
all categories, and the same query answer on every screen that shows it. There is no Advance to
subtract it from, and so no remainder (ADR-0051, which supersedes ADR-0029's draw-down categories).

Evidence is **one to five per transaction** (ADR-0039). The application holds that range, not
the database: `recordTransaction` writes a line and its evidence together and refuses zero or
more than five, and `attachTransactionEvidence` refuses a batch that would take a line past five,
counting under a lock on the parent row. There is no CHECK, because the shared database may
already hold lines with none or more, and those are grandfathered.

**A receipt may be deleted, but never a line's only one** (#462,
[ADR-0050](./adr/0050-transactions-and-receipts-may-be-deleted-and-the-log-keeps-the-copy.md)).
Hapus bukti trashes the file in Drive first, then `deleteTransactionEvidence` locks the parent row
`for update` — the same lock `attachTransactionEvidence` counts under — counts again, and deletes
the row with its `evidence_deleted` Log entry in one transaction. The count is checked twice: before
the trash, so a line's only receipt is refused with nothing trashed, and under the lock, so two
concurrent Hapus on a two-receipt line cannot leave it with none. The loser of that race takes its
file back out of the Drive trash, since its row stands. A grandfathered line with more than five may
lose any of them, down to one. The freed slot counts toward the five again. Nothing about filing
gates it.

**A line may be deleted whole** (#463, ADR-0050), with however many receipts it holds. Hapus
transaksi trashes the line's Drive folder, and with it the receipts inside, then any receipt file
outside it, for example one still in `_staging`. Then `deleteTransaction` locks the row
`for update`, deletes it, its evidence rows cascading, and writes its `transaction_deleted` entry in
one transaction. The commit answers the folder and receipt files the row held under the lock, and
the action trashes any it had not already trashed: a receipt an Unggah bukti added, or a folder a
reconcile claimed, between its first read and the lock. The totals and the export are derived, so they
drop the line without a write of their own.

**Every receipt is a file in the company's Google Drive** (ADR-0040). `drive_file_id` is the
file's Drive id, written by Catat transaksi or by a line's own "Unggah bukti", and `not null`. A
CHECK pins `content_type` to the four types the server sniffs from the first bytes. `unique` means
a file cannot be attached twice. It is an id, never a path, so a folder renamed or moved by hand in
Drive breaks nothing.

**Receipts were once in a private Supabase bucket**, under a `storage_path` column. They were
moved to Drive by a one-off script (#377, run in #378), and migration 0036 dropped the column
(#379). That migration refuses to run while any row still lacks a `drive_file_id`, so it can never
drop the only pointer to a receipt the script had not moved.

**`drive_folder_id` on `transaction` and on `perjadin` name the line's and the trip's Drive
folders**, and `transaction.drive_synced_at` records when the reconcile last finished the line.
It finishes a line by putting its folder inside the Perjadin's, naming and moving its files there,
and sharing the folder "anyone with the link". Catat transaksi builds the line's folder privately
in `_staging` before it commits, so the folder id is written with the line. The Perjadin's folder
is claimed by **compare-and-set** (`… where drive_folder_id is null`) the first time a line on it
is reconciled. No row lock is ever held across a call to Google; a caller that lost the race
trashes its own folder and uses the winner's.

**"Unsynced" means `drive_synced_at is null` and at least one evidence row with a
`drive_file_id`** — that is, at least one receipt. It is derived, not stored. A line with no
receipt is never unsynced. A reconcile that fails after the commit leaves the line recorded and
unsynced, and its files wait in private `_staging` until the next reconcile finishes it. A reconcile marks a line
synced only for the receipts it read. If a newer receipt was committed while it ran, the mark does
not land, so that receipt stays owed rather than stranded under a line that claims to be done.

**A deleted line leaves only trashed items behind.** Its folder and receipts are in the Drive trash,
and nothing in the database points at them. A reconcile that was running when it went never
recreates the trashed folder. One that made the folder itself finds no row to claim it on
(`claimTransactionDriveFolder` answers `null`) and trashes it, and the sweep no longer lists
the line.

**A Perjadin's folder names are app-owned, and re-asserted.** Both of a trip's folders are named
from its Sub-Cluster, both dates and the trip's Schools, read live
([ADR-0044](./adr/0044-a-perjadin-is-named-by-its-kelompok-and-dates.md)); nothing stores the name
the folder was last given. A write that changes one of those parts renames the folders after it
commits, best effort (#407): Ubah tanggal on either date, and the three Session writes —
`addPerjadinSession`, `editPerjadinSession`, `cancelSession` — when they change the trip's set of
Schools, which each reports from inside its transaction by reading `tripSchoolNames` before and
after. A Sub-Cluster rename renames nothing at once. The reconciles re-assert the name every time
they touch a trip, and **Periksa koneksi** reads every Perjadin folder and renames those that are
out of date — at most 25 per press, within the sweep's time budget, in trip-id order, so the next
press re-reads the folders already checked and carries on. A folder in the Drive trash or gone is
reported, never recreated.

**`drive_sync_failed_at` keeps the sweep moving.** It records when a reconcile last failed to finish
the line, for example because its folder is in the Drive trash, which is never recreated, and it is
cleared when the line syncs. Periksa koneksi's sweep is bounded per press. It takes lines that have
never failed first, oldest first, then the longest-failed, so lines that fail every time cannot fill
every press while the lines behind them wait for good.

**The two receipt writes run in opposite orders, on purpose.** Catat transaksi builds the line's
folder in private `_staging`, moves the files into it, and only then commits. A line's own "Unggah
bukti" (`attachTransactionEvidence`) **commits first**. It locks the line, counts, writes the
evidence rows and sets `drive_synced_at` back to null, all in one transaction. Only then does the
reconcile move the new files out of `_staging` into the line's folder. The difference is the
folder: a new line's folder is private until it is shared last, but an existing line's folder is
usually **already public**. A file moved in before the count was settled could become a sixth
receipt anyone can open that no row records. So the count and the rows come first, under the lock,
and the files follow.

### The Activity Log

```sql
create table activity_log (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null default now(),
  actor_person_id  uuid not null references person (id),
  actor_email      text not null,
  perjadin_id      uuid not null references perjadin (id) on delete cascade,
  action           text not null check (action in (
                     'advance_set', 'advance_changed', 'transaction_recorded',
                     'evidence_uploaded', 'report_filed',
                     'document_uploaded', 'document_deleted',
                     'footage_uploaded', 'footage_deleted',
                     'evidence_deleted', 'transaction_deleted')),
  details          jsonb not null,
  search_text      text not null,
  backfilled       boolean not null default false
);

create index activity_log_occurred_at_id_idx on activity_log (occurred_at desc, id desc);
```

**One row per act on a Perjadin's money, receipts, documents or report** (#395), read only by an
Administrator on `/log`. The `action` values are character for character `ACTIVITY_LOG_ACTIONS` in
`packages/domain/src/index.ts`. The two `document_*` values went into the CHECK with the rest, so the
Dokumen uploads and Hapus needed no CHECK migration. The `footage_*` pair widened it in migration
0044, and the two money deletes, `evidence_deleted` and `transaction_deleted` (ADR-0050), in
migration 0049 — one migration for both.

**Each entry is written in the same database transaction as the change it records**, so a refused
or failed write logs nothing. The money writes log as below, each through `logActivity` in
`queries/activity-log.ts`; the Dokumen and Foto & Video writes are described with their tables:

| Write                       | `action`               | `details`                                                                          |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| nothing, since ADR-0051     | `advance_set`          | `{ amountIdr }`; history only — past rows stay readable (#464)                     |
| nothing, since ADR-0051     | `advance_changed`      | `{ fromIdr, toIdr }`; history only, like `advance_set`                             |
| `recordTransaction`         | `transaction_recorded` | `{ transactionId, category, amountIdr, participantType, spentOn, receiptCount }`   |
| `attachTransactionEvidence` | `evidence_uploaded`    | `{ transactionId, category, amountIdr, spentOn, added, total }`                    |
| `deleteTransactionEvidence` | `evidence_deleted`     | `{ transactionId, evidenceId, category, amountIdr, spentOn, left }`, a copy (#462) |
| `deleteTransaction`         | `transaction_deleted`  | as `transaction_recorded`, plus `description`; a copy (#463)                       |
| `filePerjadinReport`        | `report_filed`         | `{ transactionCount, totalIdr }`, every category, as the acquittal totals          |

**`actor_email` is a copy**, taken when the act happens, so the row stays true if the Person's email
later changes. **`search_text`** is the Aksi and Rincian text `/log` shows, lower-cased once at
write time, so the page's search runs in SQL over what the screen says. Nothing in the app updates
or deletes a row.

**Migration 0039 backfills what the existing rows can tell.** `transaction` records who created a
line and when, and `transaction_evidence` who uploaded each receipt and when, so the migration
derives, with `backfilled = true`:

- one `transaction_recorded` per existing line, at its `created_at`, by its creator. Its
  `receiptCount` is the receipts uploaded with it — those whose `uploaded_at` equals the line's
  `created_at`, since `recordTransaction` inserts both in one database transaction and so with one
  `now()`;
- one `evidence_uploaded` per later batch: the remaining receipts grouped by line, uploader and
  `uploaded_at`, for the same reason.

The backfilled `actor_email` is the Person's email at migration time, the best available. **Uang
Perjalanan and Laporan history cannot be recovered**: no column records who set an Advance or filed
a report, so those start at the migration. `/log` marks a backfilled row "(dari data lama)".

**The Log stays small** — a few thousand rows over the whole Programme — so `/log` reads one page of
50 plus one `count(*)`, and the index above serves "newest 50". Its search is a plain substring
match with no index: `ilike` on the email, the trip's Sub-Cluster name, its Schools (joined into
one string) and the PIC's name, `like` on the
already lower-cased `search_text`. If search over a much larger table ever becomes slow, a `pg_trgm` trigram index on the
searched text is the known fix.

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

**`story_photo` was built to mirror `transaction_evidence`** column for column: `storage_path
unique`, `content_type`/`byte_size`, uploader and timestamp, so there was one upload pattern to
build and one to learn. Receipts have since moved to Google Drive (ADR-0040), so the two now
differ in where the file lives — a Drive id there, a `storage_path` here — and a Story photograph
is the app's only upload to Supabase Storage. `uploaded_by_person_id` references `person` alone
rather than the pair, exactly as `transaction_evidence` does — uploading is not a role-gated act,
and the Story it hangs off already carries the Staff constraint. Keys are
`story/{story_id}/{uuid}` in `public-media`.

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

Recording a transaction now requires its receipts
([ADR-0039](./adr/0039-every-transaction-is-recorded-with-its-evidence.md)), and **that is the
other kind of rule: a field a form insists on before it will submit**. The receipts are part of
the line being written, not a separate record the action waits on. Filing gains no new
condition: `filePerjadinReport`'s evidence check is unchanged, and now only ever fires on a line
recorded before the rule.

A Story's photographs are public by intent, which is the whole difference from a receipt — see
[Object storage](#object-storage).

## Object storage

**Receipts and Perjadin Documents are not in Supabase Storage.** Receipts live in the company's
Google Drive
([ADR-0040](./adr/0040-transaction-evidence-is-stored-in-the-company-google-drive.md)): Catat
transaksi and a line's own "Unggah bukti" both upload there, and the database holds each file's
Drive id ([Money](#money)). Perjadin Documents are beside them, under `Dokumen/`
([ADR-0042](./adr/0042-perjadin-documents-are-stored-in-the-company-google-drive.md),
[Perjadin Documents](#perjadin-documents)):

```
SUGT ITB 2026 Internal App Object Storage/
├── Bukti Transaksi/Pelaksanaan Offline/{name} · {the trip's Schools} · P-{perjadin8}/…
└── Dokumen/Pelaksanaan Offline/{name} · {the trip's Schools} · P-{perjadin8}/
    ├── Daftar Hadir Peserta/{date} · {school} · {Siswa|GTK-MS} · Daftar Hadir Peserta · D-{doc8}.pdf
    ├── Daftar Hadir Pendamping/{date} · Daftar Hadir Pendamping · D-{doc8}.pdf
    └── Daftar Hadir Narasumber/{date} · Daftar Hadir Narasumber · D-{doc8}.pdf
```

The Drive side is the connection below and the `drive_*` columns. Every
upload is at most **50 MB** per file (`MAX_UPLOAD_BYTES`, ADR-0040 as amended by #394), checked as
the declared size when the upload session opens and again on the size Drive reports back.

One bucket:

| Bucket         | Visibility | Holds                                                        |
| -------------- | ---------- | ------------------------------------------------------------ |
| `public-media` | Public     | Published Story photographs. Keys: `story/{story_id}/{uuid}` |

**A receipt is reached by a public link, and that is the decision, not a leak.** The external
audit needs a spreadsheet with an "anyone with the link can view" link per transaction, so each
transaction's folder in Drive is shared that way (ADR-0040), and the acquittal links straight to
it and to each file. The app renders and signs nothing. What stays private is everything above a
transaction folder: the root, `_staging` and each Perjadin's folder. **A Perjadin Document is shared
file by file**, so all of `Dokumen/`'s folders stay private (ADR-0042).

**Historical: the `receipts` bucket.** Until #379 a second, private bucket held receipts, under
opaque `{uuid}` keys, read through short-lived URLs the app signed after checking Staff. A key
spelled nothing out because a signed URL carries its object path inside its JWT. Those receipts
were moved to Drive (#377, #378) and the bucket is deleted by hand (#380).

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
asking. A Story photograph is therefore uploaded through a signed upload URL the internal app
mints **after** it has checked the caller is Staff, with the service-role key, which stays on the
server.

### The company Google Drive connection

Every receipt is uploaded to the company's Google Drive
([ADR-0040](./adr/0040-transaction-evidence-is-stored-in-the-company-google-drive.md)) through the
connection an Administrator makes on `/pengaturan` (#372).

```sql
create table drive_connection (
  singleton                      boolean primary key default true check (singleton),
  account_email                  text not null,
  refresh_token_ciphertext       text not null,
  refresh_token_iv               text not null,
  refresh_token_tag              text not null,
  root_folder_id                 text,
  staging_folder_id              text,
  bukti_transaksi_folder_id      text,
  pelaksanaan_offline_folder_id  text,
  readme_file_id                 text,
  dokumen_folder_id              text,
  dokumen_pelaksanaan_offline_folder_id text,
  footage_folder_id              text,
  footage_pelaksanaan_offline_folder_id text,
  folder_problem                 text check (folder_problem in
                                   ('root-trashed', 'root-missing',
                                    'staging-trashed', 'staging-missing',
                                    'folders-unfinished')),
  status                         text not null check (status in ('connected', 'broken')),
  broken_at                      timestamptz,
  last_used_at                   timestamptz,
  connected_by_person_id         uuid not null references person (id),
  connected_at                   timestamptz not null default now(),
  check ((status = 'broken') = (broken_at is not null))
);
```

**The database holds that there is one connection or none.** `singleton` is the primary key and
CHECKed true, so a second row has nowhere to go. "Belum terhubung" is no row; there is no
disconnect, so a row is never deleted. It also holds that `status` and `broken_at` move together.

**The application holds everything about the token.** The refresh token is stored only as
AES-256-GCM ciphertext, with its IV and tag, under `DRIVE_TOKEN_KEY`. That key is in the
environment, never here, so the table alone yields no token. `@sugt/internal` encrypts, decrypts,
and talks to Google. It marks the row `broken` on the first `invalid_grant`, or on a token that
will not decrypt. It also checks that the account connected is `GOOGLE_DRIVE_ACCOUNT_EMAIL`.

**Drive ids, never paths.** The five ids name the fixed tree ADR-0040 draws: the root ("SUGT ITB
2026 Internal App Object Storage"), `_staging` ("SUGT ITB 2026 _staging — jangan dibagikan", a
sibling of the root, never inside it), `Bukti Transaksi`, `Pelaksanaan Offline` and the README. The
names matter only when a first connect creates the folders; the root and `_staging` are found by
stored id after that, so a rename by hand breaks nothing and nothing renames them back.

They are nullable because the row is written before the folders are ensured, in a second write,
since no transaction is held open across a call to Google. `folder_problem` is set when a reconnect
finds the root or `_staging` trashed or gone, or when Drive failed partway through. The root and
`_staging` are never quietly recreated, so the token stays stored while the card does not say
Terhubung. Uploads and the card read one rule: usable means no `folder_problem` and every id set.

**`dokumen_folder_id` and `dokumen_pelaksanaan_offline_folder_id`** are `Dokumen/` and its
`Pelaksanaan Offline/` (ADR-0042), beside `Bukti Transaksi`. They are not part of the five: a
connection made before them has neither, and a receipt must not wait on them. A connect, Periksa
koneksi and the document reconcile each make whichever is unset, missing or trashed, and claim it by
compare-and-set, so no Administrator has to reconnect for them. **`footage_folder_id` and
`footage_pelaksanaan_offline_folder_id`** are `Foto & Video/` and its `Pelaksanaan Offline/`
(ADR-0046), kept and ensured the same way — on connect, by Periksa koneksi and by the footage
reconcile.

**Who reaches it.** The card's read and the connect writes need the Administrator Grant. The
credential read, and the two writes a token refresh makes (`last_used_at`, broken), need Staff,
because any Staff member uploads through the connection.

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
token, refuses a cancelled Session's, and can insert into `participant_feedback` and nothing else. See
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
the hand-ticked "Narasumber sudah lengkap" box, not a constraint.

**"Two _different_ Schools cannot share a date and time on one Perjadin."** The Group is one
travelling party and cannot be in two places at once. This used to be the
`session_one_school_at_a_time_per_perjadin` index, but ADR-0019 dropped it because it also forbade
two Sessions at the _same_ School and moment, which ADR-0019 allowed. ADR-0038 forbids those again —
through its own per-School index, not by restoring the trip-wide one (see the Delivery section) — so
the different-Schools rule is still the application's, checked when a trip is planned (`planPerjadin` groups
the planned Sessions by `(date, time)` and refuses any slot holding more than one distinct School,
naming the pair) and when a Session is added or edited on the trip. It is a rule **per trip**: two
different trips may hold two different Schools at one moment, since two Groups can be in two places.
The database does reject two live Sessions at the _same_ School, date and time — one Session per
School per moment (ADR-0038), and since #408 **across every Perjadin** — through
`session_no_duplicate_offline_per_school`; `planPerjadin` checks that too, from the same grouping
within the payload and against the other trips, so the form gets a `duplicate-session` or
`school-booked-on-another-perjadin` value rather than a raw violation.

**Three app caps on the new Perjadin model.** None is a DB constraint, all live in the application in
the same spirit as the Group rules: **ten** offline Sessions per School per Perjadin
(`MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN`, a safety ceiling never reached in practice),
**twenty** trip-scoped teacher names per Perjadin (`MAX_TEACHING_TEAM_PER_PERJADIN`), and **ten**
extra Staff beyond the PIC on a Group (`MAX_EXTRA_STAFF_PER_GROUP`). All three constants are in
`@sugt/domain`; the writes that enforce them are T2/T3.

**"Both Streams were taught."** **Gone** ([#153](https://github.com/mafiefa02/sugt/issues/153), and
ADR-0022). It was an online-only rule, checked at delivery against the two `session_teacher` rows —
but no Session carries a Stream now (ADR-0034 online, ADR-0038 offline), and `session_teacher` is
dropped, so there is no both-Streams expectation left to hold on either side. Marking delivered is status-only for both modes.

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
3. **Resizing the trip** — the trip's range is two typed dates
   ([ADR-0041](./adr/0041-a-perjadin-carries-no-travel-legs-and-its-dates-are-typed.md)), and
   `updatePerjadinDates` in `@sugt/db` writes the new `starts_on`/`ends_on`. It **clamps, never
   shifts** (ADR-0021's rule, kept): it locks the trip and its arranged Sessions, and if the new
   window would leave an **arranged** Session outside it, the whole edit is refused (`would-strand`)
   and no Session moves; delivered and cancelled ones may sit outside the window their trip now
   claims and do not block it. One transaction with the trip's own update. The retired
   `movePerjadinDates` and its offset-shift ([#55](https://github.com/mafiefa02/sugt/issues/55)) are
   not coming back. The edit surface is Detail Perjadin's Staff-only **Ubah tanggal** dialog; the
   resize and its refusal are held by the query, with tests.

   **It never touches `starts_at`.** A date correction changes which days a trip spans, not the
   hour a School is expecting somebody — and it does not move any Session's `held_on` at all, since
   it clamps rather than shifting.

   **A correction that moves either date also renames the trip's Drive folders**, receipts and
   Dokumen, which are named `{name} · {the trip's Schools} · P-{perjadin8}` — the name carries both
   dates ([ADR-0040](./adr/0040-transaction-evidence-is-stored-in-the-company-google-drive.md),
   [ADR-0044](./adr/0044-a-perjadin-is-named-by-its-kelompok-and-dates.md), #376, #407). The rename
   runs after the commit and is best effort: a failed rename never fails or rolls back the
   correction. The next reconcile that touches that Perjadin sets the name back to what the database
   says, because folder names are app-owned. That is a Catat transaksi or Unggah bukti on it, a sweep
   reaching one of its unsynced lines, or a press of Periksa koneksi. Until then the folder keeps the
   old date.

So an arranged offline Session can no longer be born outside its trip, nor moved outside it, nor
stranded when the trip's range is resized — path 3 refuses the resize rather than moving Sessions.
Both halves of #28's invariant now hold, at the data layer and at the surface that drives it:
Detail Perjadin's Staff-only "Ubah tanggal" dialog is what a person resizes a trip through, and
it reaches the guard in path 3.

**That a Perjadin's Sessions are at Schools of its Sub-Cluster.** `perjadin.sub_cluster_id` is
NOT NULL and `school.sub_cluster_id` is NOT NULL, but nothing joins them. The composite-key
version was designed and rejected — [Delivery](#delivery) has the argument — because it would
also freeze a School into its Sub-Cluster the moment it had one delivered Session, and the
whole point of [ADR-0016](./adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md)
is that a Sub-Cluster is a revisable judgement. So it is checked in the application at the two
points it can be violated: planning a trip, where the eligible Schools are read from the chosen
Sub-Cluster and a payload naming any other School is refused whole; and adding a Session to an
existing trip (`addPerjadinSession`), whose picker offers the trip's whole Sub-Cluster so a School
can join a trip after it is planned.

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

**"Every transaction has at least one piece of evidence."** Also a cross-row count. Held at
entry since [ADR-0039](./adr/0039-every-transaction-is-recorded-with-its-evidence.md), in the one
write path: `recordTransaction` records a line with one to five receipts or refuses it. Filing
still checks it, as the backstop for lines entered before that rule, which no migration touched.

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

**Who writes a Perjadin** is the same kind of rule, at the same choke point. A Perjadin and its
offline Sessions are written only by **its Group** — a `group_member` row for the caller, the PIC
included — or by a Staff Person holding **Perjadin Editor** (an Administrator implies it)
([ADR-0048](./adr/0048-a-perjadin-is-written-by-its-group.md), #439). Every write on a trip runs
`requirePerjadinWriter` (or `requireSessionWriter`, for a write naming an offline Session) after its
`requireStaff`, on the write's own transaction where it has one, and a non-member without the Grant
is refused with `NotOnPerjadinError`. No key or CHECK could hold it: whether a row may be written
depends on who is asking, which Postgres does not know here, for the reason above.

Note what this is _not_: the public/internal boundary is still structural, held by the
dependency graph. It is only the Staff/non-Staff write line — and the Group line inside it — that is
a runtime check.

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
proof the submitter attended. Holding the link is the only gate, and it is a weak one by design.
The link never expires (ADR-0049), so a leaked one is removed by deleting its row by hand. See
[ADR-0012](./adr/0012-participants-write-through-a-short-lived-session-token.md). Rate limiting
belongs at the edge, not in a constraint.

**That a cancelled Session's link takes no feedback.** Nothing in `session_feedback_token` knows the
Session's status. The handler that resolves the token refuses it, and the submit action resolves
again.

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
that — so deleting a Perjadin destroys its acquittal rows, and nothing warns you. The files are
not removed: the Perjadin's folder in the company Google Drive (ADR-0040) outlives its rows. No
path in the app deletes a Perjadin. `perjadin_teacher` and `perjadin_pimpinan` cascade too — the
trip-scoped teacher names and the recorded Pimpinan are the trip's and outlive nothing — and
`session_teaching_team` cascades from `perjadin_teacher`, so an offline Session's "Diajar oleh"
links go with the names. `activity_log` cascades too, so the trip's Activity Log entries go with it.
So do `perjadin_document` and `perjadin_document_folder`; the files and folders stay in Drive.
`session_footage` does not cascade from `session`, which an offline Session's `perjadin_id` keeps
from being deleted anyway.

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
- **What else the Participant form asks for.** Right now: Class, name, three Ratings (four for
  Siswa, with Hands-on RBL), a comment on each Aspect, and two optional written answers (#446).
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
