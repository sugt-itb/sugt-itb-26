# SUGT — STEM & Research Track

Sekolah Unggul Garuda Transformasi, as delivered by DITSAMA ITB. A public-facing
showcase of the Programme, plus an internal tool for tracking delivery and travel
administration.

What the two apps actually do is described in [`docs/product.md`](./docs/product.md).
Domain vocabulary lives in [`CONTEXT.md`](./CONTEXT.md); what is stored and which rules
the database holds is in [`docs/data-model.md`](./docs/data-model.md); the decisions
behind the shape of this repo live in [`docs/adr/`](./docs/adr).

## Layout

```
apps/
  public/     the public site      → @sugt/public
  internal/   the internal tool    → @sugt/internal
packages/
  db/         Drizzle schema, migrations, connection  → @sugt/db
  domain/     vocabulary shared by both apps          → @sugt/domain
  ui/         shadcn primitives and design tokens     → @sugt/ui
```

Two apps rather than one, because the public app must be unable to read internal
records or Perjadin Reports — see
[ADR-0002](./docs/adr/0002-two-apps-in-a-pnpm-workspace.md). Data access is
`@sugt/db`, which **only `@sugt/internal` declares**; pnpm's strict symlinked
`node_modules` is what makes that a fact about the dependency graph rather than a
convention.

The public app is still a placeholder. The internal one has sign-in — Google, gated by
the invite list — and nothing on top of it yet. The public site was originally to ship
first and alone; it now ships last. Neither its figures nor its Stories are authored in this
repo — both come from the database — so it waits on the internal app, the
aggregates endpoints, sign-in, the invite list and the Story editor. See the two
amendments to
[ADR-0008](./docs/adr/0008-public-narrative-is-authored-in-the-internal-app.md).

## Working on it

```bash
pnpm install

pnpm dev            # both apps — public on :3000, internal on :3001
pnpm dev:public     # just the public site
pnpm dev:internal   # just the internal tool

pnpm build          # both apps, in dependency order
pnpm typecheck      # next typegen && tsc --noEmit, per package
pnpm lint           # oxlint, type-aware
pnpm fmt            # oxfmt

pnpm --filter @sugt/internal test   # vitest, against a real local Postgres
```

The tests **drop and rebuild** the database `TEST_DATABASE_URL` names (default
`sugt_test` on the local cluster) and apply every migration from empty, which doubles
as the check that they apply in one pass on a new environment.

## The database

Supabase Postgres, with the schema and migrations in
[`packages/db`](./packages/db) — its README covers running them. Two connection
URLs, and they are not interchangeable: `DATABASE_URL` is the transaction pooler
(port 6543) for the apps, `DIRECT_URL` is session mode (5432) for migrations.

```bash
pnpm --filter @sugt/db db:migrate      # apply pending migrations
pnpm --filter @sugt/db db:seed         # Provinces, 4 Clusters, 47 Schools
pnpm --filter @sugt/db db:seed:people  # the founding Staff, once, per environment
```

`DATABASE_URL` is declared in `turbo.json` under `build`, `typecheck` and `dev`.
Turbo runs with `envMode: strict`, so a variable missing from a task's `env` is
invisible to it even when the shell has it.

Sign-in adds four more, declared on the same three tasks: `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Provisioning the
Google OAuth client and supplying the values is separate work; nothing in this repo
holds them.

The aggregates endpoints add `INTERNAL_APP_URL`, `PUBLIC_APP_URL`,
`AGGREGATES_SECRET` and `REVALIDATE_SECRET`, all subject to the same rule — and the
public app's build _fetches_, so a missing one fails the deploy rather than
degrading quietly. [`docs/data-model.md`](./docs/data-model.md) says which task
declares each.

`dev`, `build` and `typecheck` run through Turborepo, so an unchanged package is
restored from cache rather than rebuilt — a repeat `pnpm build` is milliseconds
instead of seconds. Scope any task to one package with
`turbo run <task> --filter=@sugt/public`.

`lint` and `fmt` deliberately bypass turbo: oxlint and oxfmt are single-process
scanners that cover the whole repo in well under a second, so per-package tasks
would cost more than they save.

## Dependency versions

Versions shared by both apps are pinned once in the `catalog:` block of
`pnpm-workspace.yaml`. Depend on `"catalog:"` rather than a range so the two apps
cannot drift apart on React or Next.
