# sugt

Instructions for AI agents working in this repository.

## Workspace

A pnpm workspace with two apps and four shared packages:

- `apps/public` (`@sugt/public`) — the public site, port 3000
- `apps/internal` (`@sugt/internal`) — the internal tool, port 3001
- `packages/db` (`@sugt/db`) — the Drizzle schema, migrations, connection and queries
- `packages/domain` (`@sugt/domain`) — vocabulary shared by both
- `packages/ui` (`@sugt/ui`) — shadcn primitives and the design tokens, shared by both
- `packages/story-format` (`@sugt/story-format`) — the Story-body allowlist and public
  renderer, ADR-0015's one list. Its `./allowlist` (the Milkdown editor schema) is imported by
  `@sugt/internal`; its `./story-body` (the `react-markdown` renderer) by `@sugt/public`, which
  never reaches `@milkdown/kit` through it.

Four rules to work within:

1. **`@sugt/public` must never gain a dependency that can read Session Records or
   Perjadin Reports.** ADR-0002 claims that leak is unbuildable rather than merely
   unlikely; what makes that true is pnpm's strict symlinked `node_modules`, so an
   `.npmrc` with `node-linker=hoisted` or `shamefully-hoist=true` would quietly
   downgrade it to a convention. Don't add one.
2. **Shared dependency versions come from the `catalog:` block in
   `pnpm-workspace.yaml`**, not from ranges in an app's `package.json`.
3. **Add domain vocabulary to `packages/domain` only if it is in `CONTEXT.md` and
   needs no database.** Anything requiring stored data belongs in `packages/db`
   (`@sugt/db` — Drizzle schema, migrations and queries), which rule 1 forbids
   `@sugt/public` from declaring. See [`docs/data-model.md`](./docs/data-model.md).
4. **`@sugt/ui` stays presentational.** Both apps depend on it, so anything it can
   reach, the public app can reach — see [ADR-0010](./docs/adr/0010-one-shared-ui-package-not-shadcn-per-app.md).
   No data fetching, no `@sugt/domain` import, no environment variables.

`@sugt/db`, `@sugt/domain`, `@sugt/ui` and `@sugt/story-format` are Just-in-Time packages: their
`exports` point straight at `./src`, they have no build step, and Turbopack compiles them as part
of whichever app imports them (so no `transpilePackages` entry is needed — Next
only requires that for `node_modules` dependencies shipping raw TS). The tradeoff
is that turbo has no build output to cache for them; it does still hash their
sources into each app's `build` and `typecheck`, so editing one is not a stale
cache hit — verified with `turbo run build --dry=json`. If either grows enough to
be worth caching, the documented upgrade is a Compiled Package: add a `build`
script and point `exports` at `./dist` with `types` at the source.

## Tooling

`dev`, `build` and `typecheck` are Turborepo tasks (`turbo.json`). `lint` and `fmt`
are deliberately **not** — and not merely because oxlint and oxfmt are fast. Turbo
supports root tasks (`"//#lint"`), but a root task hashes only root-level files, so
editing `apps/public/src/**` leaves it a cache hit and the changed code goes
unlinted. Verified, not assumed. Keep whole-repo scanners as plain root scripts.

`fmt` writes; `fmt:check` reads. `fmt:check` (`oxfmt --check`) is the formatting
gate, a peer to `lint`. Run both on the branch before a pull request, and treat a
failure the same way. `fmt` stays advisory on purpose: it rewrites files, so it
cannot be a gate that only reports. Making the writer the gate is what let three
files drift onto `main` unnoticed ([#56](https://github.com/mafiefa02/sugt/issues/56)) —
whoever ran `fmt` next swept the churn into their own ticket's diff. `fmt:check`
catches that drift and exits non-zero without changing anything. It is not a turbo
task either, for the reason above: it scans the whole repo, so it stays a plain root
script.

`envMode` defaults to `strict`: a task only sees environment variables declared in
its `env` (or `globalEnv`). `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
`MICROSOFT_TENANT_ID`, `MICROSOFT_OAUTH_REDIRECT_URL` and `CRON_SECRET` (the bearer token Vercel
Cron sends to the daily Foto & Video copy, #562) are declared on `build`, `typecheck` and `dev`
for exactly that reason — without it a value is invisible even when set in the
shell. Anything reading one goes through `requireEnv` in `@sugt/internal`, which fails
with a sentence naming the strict-mode cause rather than with `undefined`. A new
variable belongs in `turbo.json` in the same commit that first reads it.

`DIRECT_URL` and `TEST_DATABASE_URL` are deliberately absent: drizzle-kit, `@sugt/db`'s
`db:seed` and `db:reattach-links`, and vitest all run as package scripts, outside turbo. `NEXT_PUBLIC_*` is handled automatically
for Next apps.

Tests are **Vitest, in `@sugt/internal`, against a real local Postgres** —
`pnpm --filter @sugt/internal test`. There is no `test` turbo task, for the same
reason `lint` is not one. The run drops and rebuilds the database `TEST_DATABASE_URL`
names (default `sugt_test`) and applies every migration from empty, which doubles as
the check that they apply in one pass on a new environment. Point it somewhere else
before running it anywhere that matters.

Two things in `turbo.json` are load-bearing and easy to break:

- **`tsconfig.base.json` is listed in `globalDependencies`.** Turbo only hashes
  files inside a package, so without that entry an edit to the shared tsconfig
  would leave every build served from a stale cache. Any future shared config at
  the root needs adding there too.
- **`typecheck` declares no `outputs` on purpose.** It would otherwise capture
  `.next/types/**`, which `build` already owns — overlapping outputs between two
  tasks in the same package means two caches racing to write the same files. A
  cache hit here means "this input set already typechecked", which is the whole
  point of the task.

`tsconfig.base.json` holds vendor-neutral compiler options only. `paths`, the
`next` plugin and `include` are declared per package, because relative paths in an
inherited tsconfig resolve against the file that declares them.

Nested `.oxfmtrc.json` files **replace** the root config rather than merging with
it, so each app's copy restates every option it needs. Change a formatting rule in
all three.

`sortTailwindcss` lives in the two app configs and in `packages/ui`, all three
pointing at `packages/ui/src/styles/globals.css` — the one stylesheet that
declares the theme, so the one that defines the sort order. Anything else with a
Tailwind surface needs its own `.oxfmtrc.json` too; adding the key at the root
would not reach it. Note that a `stylesheet` path that doesn't resolve makes oxfmt
skip class sorting silently — no error, exit 0 — so check the path first when
sorting appears to stop working.

## shadcn/ui

Components and design tokens live in `packages/ui`, laid out the way
`shadcn init --monorepo` expects, so `shadcn add` works unmodified:

```
packages/ui/
├── README.md                # the inventory: which primitive exists, and for which surface
├── components.json          # aliases resolve to @sugt/ui/*
└── src/
    ├── components/          # the primitives — @sugt/ui/components/button
    ├── lib/utils.ts         # cn() — @sugt/ui/lib/utils
    └── styles/globals.css   # the whole theme, imported by both apps
```

[`packages/ui/README.md`](./packages/ui/README.md) lists every primitive against the
surface that needs it, says which ones are deliberately absent, and carries the two
Rating controls' rules. Read it before adding a component there.

**Run `pnpm dlx shadcn@latest add <component>` against an app, not against
`packages/ui`** — either from the app directory or with `-c apps/public` from the
root. The CLI reads the app's `components.json`, sees that `ui` and `utils` are
aliased into `@sugt/ui`, and writes primitives there while writing composed blocks
into the app's own `src/components`. That split is the point: an app owns what only
it uses; both apps share everything else. `packages/ui/components.json` aliases
`components` to the same place as `ui`, so targeting it puts blocks among the
primitives and the split quietly collapses. Each app's `components.json` also points
`tailwind.css` at the shared stylesheet, so a theme change lands once.

At the repo root the CLI has no single workspace to read, so `shadcn info` returns
`{"error": "monorepo_root"}` — which is also what the vendored `shadcn` skill's
injected context block resolves to. The `shadcn-sugt` skill covers that and the
config this repo differs on (Base UI, not Radix).

**`shadcn` is a dependency of `@sugt/ui`, not a CLI pin.** `globals.css` opens with
`@import "shadcn/tailwind.css"`, so the package ships CSS that compiles into both
apps — which is why it sits in `dependencies` beside `tw-animate-css`, its sibling on
the line above, rather than in `devDependencies`. Removing it fails the build with
`Can't resolve 'shadcn/tailwind.css'`, not a missing binary.

Only `packages/ui` needs it. The apps used to carry a copy too, and those were dead
weight: the import resolves from the stylesheet's real location, so it is
`packages/ui/node_modules` that gets searched no matter which app pulls the CSS in.
Verified by building both apps with the app-level copies removed.

Nothing runs the installed binary — `pnpm exec shadcn` isn't even reachable from the
root, since strict `node_modules` keeps it in `packages/ui`. CLI work goes through
`pnpm dlx shadcn@latest`, as above. When `@latest` has moved past the `catalog:`
version, bump the catalog in the same commit: a generated component and the
`shadcn/tailwind.css` it is styled against are a matched pair, and only the catalog
entry decides which CSS the apps compile.

Three things here are load-bearing:

- **`@source "../**/*.{ts,tsx}"` at the top of `globals.css`.** Tailwind detects
  sources from the importing app's root and skips `node_modules`, so this
  package's components — reached through a pnpm symlink — would otherwise be
  invisible and every class in them tree-shaken out of both apps' CSS. Verified by
  building with the line removed, not assumed. It lives in the package rather than
  per app because the path resolves against the file's real location; the same
  directive written in an app would resolve against the symlinked copy under that
  app's `node_modules`, which the scanner ignores — it silently does nothing.
- **Apps import `@sugt/ui/globals.css` directly** in `src/app/layout.tsx`. Neither
  app has a stylesheet of its own; a second one would be a second place for tokens
  to drift.
- **`@sugt/ui` resolves through its `exports` map, not through tsconfig `paths`.**
  Same as `@sugt/domain`. The `paths` entry inside `packages/ui/tsconfig.json` is
  only so the package's own components can import `@sugt/ui/lib/utils` — the form
  the CLI writes — rather than a relative path.

`.agents/skills/` holds skills vendored by the `skills` CLI — from
`mattpocock/skills`, plus `shadcn` from `shadcn/ui` — hash-checked by
`skills-lock.json`; the formatter ignores it and so should you. Re-add a vendored
skill with `pnpm dlx skills add <owner>/<repo> --skill <name>` rather than editing it
in place, since an edit breaks its hash. The `*-sugt` skills are the exception:
`shadcn-sugt` and `code-review-sugt` are hand-written, have no lock entry, and are the
right place for anything repo-specific — each an override read beside the vendored
skill it names.
`.claude/skills/` is symlinks into `.agents/skills/` and holds no content of its own
— it exists because Claude Code only discovers skills under `.claude/skills/`, so
deleting it would make them invisible. Don't try to collapse the two.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The canonical five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Code review

`/code-review`'s sub-agents verify by ablation, so they modify the working tree. Run
them isolated — spawn each with `isolation: "worktree"`, review only committed work,
and diff the branch by name — so an ablation can never reach the tree you stage from.
The `code-review-sugt` skill carries the contract, the two preconditions isolation
forces, and the failure it prevents; read it beside the vendored `code-review` skill.

**Before you stage, never `git add -A` — stage explicit paths.** A review sub-agent
may hold an ablation on disk at that instant, and `-A` commits it — in the worst case
a `db:generate` migration for a schema nobody meant to change, indistinguishable from
an intentional one. This is the companion rule to isolation, not a replacement for it.
See [#54](https://github.com/mafiefa02/sugt/issues/54) and `code-review-sugt`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

`docs/product.md` sits alongside them and describes what the two apps do on screen —
the surfaces, not the vocabulary and not the rationale. `docs/data-model.md` is the
fourth: what is stored and which rules the database holds rather than the application.
Read the relevant ones before building a feature; `CONTEXT.md` tells you what the words
mean, the ADRs tell you why, product.md tells you what the thing looks like, and
data-model.md tells you what the tables are. Keep them separate: a glossary that
acquires screens, or a product doc that re-argues a decision, stops being useful to the
next reader. Anything marked _(Proposed, not ratified)_ is exactly that — confirm before
building on it.

Note that far fewer things are tables than are glossary terms. data-model.md opens with
the list of terms that are deliberately _not_ stored; read it before adding one.
