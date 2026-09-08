# `@sugt/db`

The schema, the migrations, the connection and the queries. Supabase Postgres; both apps
deploy to Vercel.

`docs/data-model.md` is the document this package is a translation of — read it for why
anything is shaped the way it is. This file covers only how to run it.

## The queries are a subpath of their own

`@sugt/db/queries`, beside `@sugt/db/schema`. **Read `src/queries/index.ts` before adding
one** — it carries the five conventions every query follows, and they are the settled
answer to [#12](https://github.com/mafiefa02/sugt/issues/12) rather than one module's
house style. In short: every exported function takes a caller and takes it first, the
caller is three named types rather than one with optional fields, each function returns
what one screen renders in one round trip, a Staff-only surface opens with the Staff-only
choke point, and a write owns its own transaction.

The fourth of those read _"money opens with…"_ until Jadwalkan Sesi daring, which is
Staff-only and is not money — and since #180 money **reads** are open too, so **writing**
money is Staff-only (ADR-0026 reversed ADR-0004's read half), and **arranging delivery** is
Staff-only by the surface list. One guard, two reasons.

**This package resolves nobody.** It takes a `Person` it is given; `@sugt/internal`
produces one, because resolving is React-aware and this package is not.

## `@sugt/public` must never declare this package

AGENTS.md rule 1, and the mechanism behind
[ADR-0002](../../docs/adr/0002-two-apps-in-a-pnpm-workspace.md): pnpm's strict symlinked
`node_modules` is what makes "internal narrative cannot reach a public page" a fact about
the dependency graph rather than a convention held by code review. The public app reads
the aggregates endpoint and holds no credentials of any kind.

## Two URLs, not interchangeable

| Variable       | Supavisor mode | Port | Used by                                |
| -------------- | -------------- | ---- | -------------------------------------- |
| `DATABASE_URL` | transaction    | 6543 | the apps at runtime                    |
| `DIRECT_URL`   | session        | 5432 | `db:generate`, `db:migrate`, `db:seed` |

Both resolve to IPv4. The transaction pooler cannot run migrations, and it does not
support prepared statements — hence `prepare: false` in `src/client.ts`, which is not
optional and whose absence fails intermittently under load rather than at startup.

`DATABASE_URL` is declared in `turbo.json` under `build`, `typecheck` and `dev`, because
turbo runs with `envMode: strict` and a variable missing from the consuming task's `env`
is invisible even when it is set in the shell. `DIRECT_URL` is deliberately _not_ there:
drizzle-kit is invoked as a package script, outside turbo.

## Scripts

```sh
pnpm --filter @sugt/db db:generate     # diff src/schema against the last snapshot
pnpm --filter @sugt/db db:migrate      # apply pending migrations
pnpm --filter @sugt/db db:seed         # Provinces, 4 Clusters, 42 Schools (idempotent)
pnpm --filter @sugt/db db:seed:people  # the founding Staff, once, on a new environment
```

`db:seed:people` reads `seed/founding-staff.sql`, which is **gitignored**: this repository
is public and those are real addresses. Copy `seed/founding-staff.example.sql` and fill it
in. It is deliberately not idempotent — see the header in the template for why.

## Two things drizzle-kit cannot express

Both are hand-written migrations. drizzle-kit leaves them alone because they are not in
its snapshot under `migrations/meta/` — verified by generating again with the schema
unchanged and getting _"No schema changes, nothing to migrate"_.

- **`0001_deferred_pic_membership.sql`** — the `DEFERRABLE INITIALLY DEFERRED` foreign
  key putting the PIC inside their own Group. drizzle-orm has `deferrable` on
  transactions but not on foreign keys. It must be deferred: `perjadin` and its
  `group_member` rows are inserted in one transaction and neither can go first.
- **`0003_link_better_auth_user_to_person.sql`** — the cross-schema foreign key from
  `better_auth.user.person_id` to `public.person`. The column itself is **not** here: it
  is declared on the Drizzle table and created by `0002` with everything else.

## Better Auth's four tables are declared here

`user`, `session`, `account` and `verification`, by hand, inside the
`pgSchema("better_auth")` object in `src/schema/auth.ts`, and created by `0002`. They
cannot be generated: the Better Auth CLI emits `pgTable` and only `pgTable`, and
`auth migrate` refuses the Drizzle adapter outright. Hand-declaring them is the path the
library's own Drizzle documentation sanctions, because the adapter looks each model up as
a key in the schema object it is given rather than building a table name.

`auth generate`'s output is kept verbatim at
`reference/better-auth-1.6.27.generated.ts`. It is not a step in any workflow — it is what
to diff against when the library is upgraded. **The Drizzle property keys are the
library's field names**; renaming one breaks the adapter at runtime and not at typecheck.

## Verified, not assumed

The generated migration was applied to a real Postgres alongside `docs/data-model.md`'s
own SQL, and the two catalogs compared — every column, CHECK, foreign key, unique
constraint and index. **239 entries each, identical** apart from constraint names, which
Drizzle auto-generates. The 58-check invariant suite then ran against the Drizzle-built
database and passed.

Worth keeping that habit: this schema's rules live in composite foreign keys and CHECK
constraints, and a silently-dropped one looks exactly like a working schema until the day
it doesn't.

## The choke point is here, and so is the first write

[ADR-0011](../../docs/adr/0011-supabase-and-better-auth.md) puts the Staff-only choke point
in this package — every Staff-only query taking the authenticated Person and refusing a
non-Staff caller. It and the `Caller` union arrived with the query layer; this section said
they were still to come until then.

That matters most on a **write**, and `arrangeOnlineSession` is the first. A Next.js layout
does not run before a Server Action, so the app's own signed-in check protects pages and
leaves every write open — the guard in this package is the one that closes it.
