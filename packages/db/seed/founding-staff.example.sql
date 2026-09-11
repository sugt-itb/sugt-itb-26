-- The founding Staff. **Template. Copy to `founding-staff.sql` and fill it in.**
--
--     cp seed/founding-staff.example.sql seed/founding-staff.sql
--     pnpm --filter @sugt/db db:seed:people
--
-- `founding-staff.sql` is gitignored. This repository is public and these are real
-- people's addresses, so the template is committed and the filled-in copy is not —
-- the same rule the RAB spreadsheet follows. Whoever provisions an environment writes
-- it; no agent does, because the contents are personal data and not a code artefact.
--
-- ## Why this file exists at all
--
-- `databaseHooks.user.create.before` throws when an email has no active `person` row,
-- so an uninvited Google account cannot create a `user` row. Nobody can sign in to
-- reach the People screen that adds everybody else until a Person already exists. This
-- seed breaks that cycle and is not an ongoing channel: a Person added by editing SQL
-- afterwards is a Person the screen did not validate. See
-- `docs/adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md`.
--
-- ## Why it is separate from reference-data.sql
--
-- That file is fixed facts and is re-run freely. People are not fixed facts: the roster
-- grows, and `active = false` is a revocation that happens on a Tuesday. Re-running the
-- Schools must never resurrect a revoked colleague, which is exactly what would happen
-- if these rows lived beside them.
--
-- ## Two rules the rows below have to obey
--
-- 1. **Each row's email is simply the Google account that person signs in with.** Any
--    address — the sign-in gate is the active `person` row alone. The old
--    `@ditsama.itb.ac.id` requirement on Staff was dropped in ADR-0003's amendment
--    ("the gate is single-tier", #115), so a founding-Staff row may hold any Google
--    address. Every row is `role = 'Staff'` now: the `Teaching Team` role was retired in
--    T3 (#153), so `person_role_check` admits only `'Staff'`.
-- 2. **`role` is write-once.** Six composite foreign keys point at `person (id, role)`
--    and none declares `on update`, so Postgres refuses to change it the moment the
--    Person has been used anywhere. A wrong role is corrected by revoking that row and
--    inserting a new one, not by an UPDATE.
--
-- Deliberately **not** idempotent, unlike `reference-data.sql`. There is no `on
-- conflict` clause: `person_email_key` is partial (`where active`), so re-running this
-- against a database where one of these People has since been revoked would either
-- resurrect them or silently do nothing. Both are worse than an error. Run it once, on
-- a fresh environment.
--
-- ## The Administrator grant tail
--
-- The trailing `insert` grants **Administrator** to every founding Staff row above. Administrator
-- is a **Grant** — the second, additive access axis beside the write-once role (ADR-0028) — and it
-- bootstraps Grant administration: the first Administrator is the only one who can then assign or
-- revoke any Grant (including making another Administrator) through the tool, so someone has to be
-- granted it outside the tool exactly as the founding Staff themselves are added outside it. It runs
-- **after `db:migrate`**, so `person_grant` already exists; it carries **no emails** of its own —
-- it selects `where role = 'Staff'`, so it grants to whichever founding Staff the rows above insert.
-- Provisioning order: `db:migrate` → `db:seed` → fill this file in → `db:seed:people`.

begin;

-- Replace with the real founding Staff. One row per person.
--
-- insert into person (full_name, email, role) values
--   ('Nama Lengkap', 'nama@ditsama.itb.ac.id', 'Staff');

-- Grant Administrator to every founding Staff inserted above. No emails here — this rides the rows
-- above, so filling in the `insert` is the only edit this file needs.
insert into person_grant (person_id, grant)
  select id, 'Administrator' from person where role = 'Staff';

commit;
