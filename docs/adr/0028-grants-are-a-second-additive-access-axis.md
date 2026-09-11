# Grants are a second, additive access axis, separate from the write-once Role

The internal tool had one access axis: a Person's **Role**, exactly one per Person and **write-once**
([ADR-0013](./0013-people-are-added-in-the-tool-and-their-role-is-write-once.md), enforced by the
composite `(id, role)` foreign keys), widened once to admit a read-only **Pimpinan**
([ADR-0025](./0025-pimpinan-is-a-second-signed-in-read-only-person-role.md)). This adds a **second**
axis — a **Grant** — that is optional, revocable, and one a Person may hold several of, without
touching the Role at all.

## Why not widen the Role

The obvious move is to add `Administrator` and `Monitoring Editor` to `ROLES`. It is the wrong move
three times over:

- **A Role is exactly one; these are not.** A Person who administers Grants is still a working
  **Staff** member who plans Perjadin and writes money. Folding "administers Grants" into the Role
  would force a choice between `Staff` and `Administrator` for someone who is plainly both, and the
  same Person may also edit Monitoring — two capabilities at once, which a single-valued Role cannot
  express.
- **A Role is write-once; these are revocable.** The seven composite `(id, role)` foreign keys
  default to `NO ACTION`, so a Person's Role cannot change once they have been used anywhere — that
  is the whole point of ADR-0013, and it is load-bearing. A capability you must be able to **revoke**
  on a Tuesday cannot live on the one column the schema forbids updating.
- **Widening `ROLES` would ripple through the `(id, role)` keys.** Those keys pin `'Staff'`
  deliberately (a PIC, a Session-Record filer, a Story author is Staff). A new role value risks
  satisfying — or having to be excluded from — each of them, which is exactly the blast radius
  ADR-0025 kept small by widening only `person_role_check` and leaving every composite key pinned.

So the second axis is a **separate table**, not a wider CHECK.

## The decision

A **Grant** is a `person_grant` row: `(person_id, grant)`, unique, with a CHECK naming the two values
`GRANTS` holds (`Administrator`, `Monitoring Editor`) exactly as `person_role_check` names the Role
values, widened the same way when a third Grant is added. Holding the row **is** the capability;
deleting it is a revocation. A Person may hold several, so it is a child table, not a column.

Three properties define it:

- **Staff-only.** A Grant is a Staff capability. `requireGrant` asserts `role === 'Staff'` **before**
  any grant check, and the assign path refuses a non-Staff target, so no Grant can ever be held by a
  **Pimpinan** — which is what keeps a Grant from ever punching through "a Pimpinan writes nothing"
  (ADR-0025). A Pimpinan resolves with an empty grant list regardless of what rows exist.
- **Administrator implies every Grant.** An `Administrator` satisfies any grant check without holding
  that grant's own row. It is the administering Grant — it assigns and revokes any Grant on any Staff
  Person, including making another Administrator — so it necessarily sits above the others.
- **Additive.** Grants only ever _add_ capability to a Staff Person; they never subtract from what the
  Role already allows, and their absence is the default (no rows, no extra capability).

The guard lives beside `requireStaff` in the `@sugt/db` choke point, as `hasGrant` / `requireGrant`,
throwing a distinguishable `NotGrantedError` (`sugtErrorCode = "sugt/not-granted"`, discriminated on
the property, not `instanceof`, for the reason on `NotStaffError`) that `staffSurface()` translates
into a **403** — the same server-side translation, for the same reason, as the Staff-only refusal. A
Grant-guarded write opens with `requireGrant` exactly as a Staff-only one opens with `requireStaff`.

The current Person's Grants are **threaded onto the caller** at resolution, the same as `role`:
`findActivePersonByEmail` reads them in one round trip and hands them on, so the guard is synchronous
and any surface can decide what to render from `person.grants`.

## The `person.id` FK target, not `(id, role)`

`person_grant.person_id` references `person.id` — the plain primary key — **not** the composite
`(id, role)`. Two reasons:

- A `person_grant` row must not be able to **rewrite history** or ride the write-once Role. Pointing
  at `(id, role)` would tie a Grant to a Role value and drag it into the write-once machinery; pointing
  at `id` keeps the two axes independent, which is the entire point of a second axis.
- **Staff-only is enforced in the guard and the assign path, not the FK.** A composite key _could_
  pin `'Staff'` the way `perjadin_pimpinan` pins `'Pimpinan'`, but that would couple the Grant to the
  write-once Role again and give the false impression that the database, rather than the application,
  is what keeps a Grant off a Pimpinan. The rule is one the application owns, stated once in
  `requireGrant` and once on the assign path, and `docs/data-model.md` already lists Staff-only rules
  as application-enforced.

`on delete cascade` lets a revoked-and-deleted Person take their grants with them.

## The bootstrap

The first Administrator is seeded **outside the tool**, in the committed `founding-staff.example.sql`
template: a trailing `insert into person_grant (person_id, grant) select id, 'Administrator' from
person where role = 'Staff'`. There is otherwise no one who could grant it — administering Grants is
itself an Administrator-only act — so it is bootstrapped the same way the founding Staff themselves
are added outside the tool. The tail carries **no emails**: it rides whichever Staff rows the
gitignored `founding-staff.sql` inserts, and runs after `db:migrate` so the table already exists.

## Consequences

- The two named Grants land now; **Monitoring Editor's write path** (Monitoring Preparation) and the
  **/orang Grant-management UI** are sibling tickets that build on this primitive.
- Adding a third Grant is a widened CHECK plus a `GRANTS` / `GRANT_LABELS` entry — the same shape as
  adding a Role value, and the `Record<Grant, string>` label map forces the new key at compile time.
- Nothing about the Role changes: a Person is still `Staff` or `Pimpinan`, still write-once, still
  pinned by the composite keys. Grants sit entirely beside it.
