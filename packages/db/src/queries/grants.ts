import type { Grant } from "@sugt/domain";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../client";
import { person, personGrant } from "../schema/people";
import type { Person } from "./caller";
import { requireGrant, requireStaff } from "./staff-only";

/**
 * **Grants** — the read of a Person's Grants and the two administrative writes that assign and
 * revoke them. The second, additive access axis beside the write-once role (ADR-0028): a Grant is
 * a `person_grant` row, holding it is a capability, and deleting the row is a revocation.
 *
 * Two facts govern every function here:
 * - **Grants are Staff-only.** A `person_grant` row's FK targets `person.id`, not the composite
 *   `(id, role)`, so the database cannot pin the target to Staff — the assign path does, refusing a
 *   non-Staff target, and the guard asserts `role === 'Staff'` before any grant check. This keeps a
 *   Grant from ever punching through "a Pimpinan writes nothing" (ADR-0025).
 * - **Administering Grants is itself a Grant.** `assignGrant`/`revokeGrant` open with
 *   `requireGrant(caller, "Administrator")` — an Administrator administers any Grant on any Staff
 *   Person, including making another Administrator, because Administrator implies every Grant.
 *
 * The current Person's own Grants are **not** read here: they are threaded onto the caller at
 * resolution (`findActivePersonByEmail` in `@sugt/internal`), the same as `role`, so a guard has
 * them in hand. This module's read is the administrative one — reading *another* Person's Grants
 * for the management surface — and so it takes a caller and opens Staff-only like every other query.
 */

/**
 * Read a Person's Grants, ordered so the caller renders a stable list. Staff-only: reading who holds
 * what is an administrative view, and a Pimpinan has no Grant surface to populate. Returns an empty
 * list for a Person with none — never `null`.
 */
export async function personGrants(caller: Person, personId: string): Promise<Grant[]> {
  requireStaff(caller);

  const rows = await db
    .select({ grant: personGrant.grant })
    .from(personGrant)
    .where(eq(personGrant.personId, personId))
    .orderBy(asc(personGrant.grant));

  return rows.map((row) => row.grant);
}

export type SetGrantResult =
  | { outcome: "assigned" | "revoked" }
  /** No active Person has that id — already revoked, or a stale screen. */
  | { outcome: "no-such-person" }
  /** The target Person is not Staff. Grants are Staff-only, so a Grant is refused to a Pimpinan. */
  | { outcome: "not-staff-target" };

/**
 * Verify the target is an **active Staff** Person — the gate `assignGrant` opens with. It is not
 * shared with `revokeGrant`: revoke is an unconditional removal (see there), and a non-Staff target
 * can never hold a grant to begin with, so the check only ever does work on the assign path.
 * `active` matters: a revoked Person is not a grant target, the same way `requirePerson()` follows
 * `active` on every request.
 */
async function activeStaffTarget(personId: string): Promise<SetGrantResult | null> {
  const [target] = await db
    .select({ role: person.role, active: person.active })
    .from(person)
    .where(eq(person.id, personId))
    .limit(1);

  if (!target || !target.active) return { outcome: "no-such-person" };
  if (target.role !== "Staff") return { outcome: "not-staff-target" };
  return null;
}

/**
 * Assign a Grant to a Staff Person — **Administrator-guarded, and refuses a non-Staff target**.
 *
 * The Staff-only rule the `person.id` FK cannot express lives here: the target is checked to be an
 * active Staff Person before the row is written, so a Grant can never land on a Pimpinan. The
 * insert is `onConflictDoNothing` against `person_grant_person_id_grant_key`, so re-assigning a
 * Grant a Person already holds is idempotent rather than an error — the outcome is still `assigned`.
 */
export async function assignGrant(
  caller: Person,
  personId: string,
  grant: Grant,
): Promise<SetGrantResult> {
  requireGrant(caller, "Administrator");

  const refusal = await activeStaffTarget(personId);
  if (refusal) return refusal;

  await db.insert(personGrant).values({ personId, grant }).onConflictDoNothing();
  return { outcome: "assigned" };
}

/**
 * Revoke a Grant — **Administrator-guarded, and unconditional**. Deleting the `person_grant` row is
 * the whole revocation, and it does not gate on the target the way `assignGrant` does: the
 * post-condition — the Person does not hold the Grant — is reached whether or not the row existed,
 * whether the Person is Staff, and whether they are still active. So a Grant a Person never held
 * deletes nothing and still reports `revoked`, and a lingering row on a now-revoked Person can be
 * cleaned up rather than refused. There is no target check to do: a non-Staff Person can never hold
 * a Grant (the assign path refuses one), so the only possible effect of this delete is removal.
 */
export async function revokeGrant(
  caller: Person,
  personId: string,
  grant: Grant,
): Promise<SetGrantResult> {
  requireGrant(caller, "Administrator");

  await db
    .delete(personGrant)
    .where(and(eq(personGrant.personId, personId), eq(personGrant.grant, grant)));
  return { outcome: "revoked" };
}
