import { type Grant, type Role } from "@sugt/domain";
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "../client";
import { user } from "../schema/auth";
import { session } from "../schema/delivery";
import { classRecord, sessionRecord } from "../schema/evaluations";
import { person, personGrant } from "../schema/people";
import { story } from "../schema/stories";
import { groupMember, perjadin } from "../schema/travel";
import type { Person } from "./caller";
import { requireStaff } from "./staff-only";

/**
 * **Orang** — the roster, which is also the invite list. `person` is the invite list, so a row
 * is an invitation. Anyone signed in reads it, because a Group is assembled from it; **Staff add
 * and revoke** (ADR-0013, ADR-0004).
 *
 * The read carries two derived facts per Person that no column holds:
 *
 * - **`signedIn`** — whether a `better_auth.user` row exists for the email. It joins on
 *   `lower(email)`, **not** on `user.person_id`: that column is pinned at account creation and
 *   after a revoke-and-re-add it names the *revoked* row, which is exactly the pair this screen
 *   shows side by side. The three states are `revoked` (`active = false`), `signed in`, and
 *   invited-but-never-signed-in — the last is real because the invite gates signup.
 *
 * - **`used`** — whether the Person is referenced by any of the **six** composite foreign keys
 *   into `person (id, role)`. None declares `on update`, so Postgres refuses to change a used
 *   Person's `role`: it is write-once, and the screen shows a lock rather than an edit the
 *   database would reject. Correcting a role is revoke-and-re-add, which `addPerson` and
 *   `revokePerson` already do between them.
 */

/** One row of the roster: the Person, plus the two facts the screen derives. */
export type RosterEntry = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  /** `false` is a revocation. A revoked Person resolves to nothing on their next request. */
  active: boolean;
  /** A `better_auth.user` row exists for this email — they have signed in at least once. */
  signedIn: boolean;
  /** Referenced by one of the six composite foreign keys, so their `role` is now write-once. */
  used: boolean;
  /**
   * The Grants this Person holds (ADR-0028), ordered, so the roster's Grant-management controls
   * render each toggle's state without a per-row round trip. Empty for anyone with none — and always
   * empty for a Pimpinan, who holds none by construction (Grants are Staff-only).
   */
  grants: Grant[];
};

/**
 * The outer `person` row's columns, **qualified by hand**. Drizzle renders `person.id` as bare
 * `"id"` when `person` is the single FROM table, and inside these correlated subqueries that
 * collides with the sub-table's own `id`/`email` column — so `sy.written_by_person_id = "id"`
 * silently means `= sy.id` and never matches. Writing `"person"."id"` keeps the correlation. The
 * table is `person`, unaliased, because `roster` does `.from(person)` with no `.as()` — **if that
 * FROM is ever aliased, these two must change with it**, and Postgres will error on the stale name
 * rather than mis-bind, which is the failure you want.
 */
const OUTER_PERSON_ID = sql.raw(`"person"."id"`);
const OUTER_PERSON_EMAIL = sql.raw(`"person"."email"`);

/**
 * Whether a Person is used anywhere their `(id, role)` is a composite foreign key's target.
 *
 * **Six references now** (T3, #153): `session_teacher` is dropped, so its composite FK is gone.
 * `class_record`'s FK stays in the check — the table stands as a dead surface — but nothing
 * satisfies it, because a Class Record filer would be a `Teaching Team` Person and that role is
 * retired; every active Person is Staff. The single-column references to `person(id)` —
 * `transaction.created_by`, `session_feedback_token.issued_by`, `perjadin_evaluation.filed_by`
 * and the rest — do **not** lock the role, because they do not pin `role`, so they are absent here.
 */
const usedByComposite = sql<boolean>`(
  exists (select 1 from ${groupMember} gm where gm.person_id = ${OUTER_PERSON_ID})
  or exists (select 1 from ${perjadin} pj where pj.pic_person_id = ${OUTER_PERSON_ID})
  or exists (select 1 from ${session} s where s.online_pic_person_id = ${OUTER_PERSON_ID})
  or exists (select 1 from ${classRecord} cr where cr.filed_by_person_id = ${OUTER_PERSON_ID})
  or exists (select 1 from ${sessionRecord} sr where sr.filed_by_person_id = ${OUTER_PERSON_ID})
  or exists (select 1 from ${story} sy where sy.written_by_person_id = ${OUTER_PERSON_ID})
)`;

/** A `better_auth.user` row for this email, compared case-insensitively as the invite gate does. */
const hasSignedIn = sql<boolean>`exists (
  select 1 from ${user} u where lower(u.email) = lower(${OUTER_PERSON_EMAIL})
)`;

/**
 * The Grants this Person holds, as an ordered array (ADR-0028) — a correlated `array_agg` so the
 * whole roster's grant state comes back in the one read the screen already makes. `coalesce(…, '{}')`
 * makes a Person with none an empty array, never `null`. A non-Staff Person holds none by
 * construction, so this is empty for a Pimpinan; the roster still renders no Grant controls on those
 * rows regardless, since Grants are Staff-only.
 */
const grantsHeld = sql<Grant[]>`coalesce(
  (
    select array_agg(pg.grant order by pg.grant)
    from ${personGrant} pg
    where pg.person_id = ${OUTER_PERSON_ID}
  ),
  '{}'::text[]
)`;

/**
 * The whole roster, revoked rows included, oldest name first.
 *
 * A read open to anyone signed in, so **no `requireStaff`** — the caller is taken because every
 * query does (convention 1), not to gate on it. Revoked rows are returned rather than filtered:
 * the screen keeps them behind a foot toggle, and `activeRosters` — which does filter them — is
 * for the pickers that must not offer a revoked Person, not for this screen.
 */
export async function roster(_caller: Person): Promise<RosterEntry[]> {
  return db
    .select({
      id: person.id,
      fullName: person.fullName,
      email: person.email,
      role: person.role,
      active: person.active,
      signedIn: hasSignedIn,
      used: usedByComposite,
      grants: grantsHeld,
    })
    .from(person)
    .orderBy(asc(person.fullName));
}

/** The name of the constraint that refused a write, read from both places a driver may put it. */
function constraintOf(error: unknown): string | null {
  const wrapped = error as { constraint_name?: string; cause?: { constraint_name?: string } };
  return wrapped.cause?.constraint_name ?? wrapped.constraint_name ?? null;
}

/** What the single-row add form collects. */
export type NewPerson = {
  fullName: string;
  email: string;
  role: Role;
};

export type AddPersonResult =
  | { outcome: "added"; personId: string }
  /** A blank name or email. The form requires both, so this is a stale or hand-edited submit. */
  | { outcome: "incomplete" }
  /** An active Person already holds this email. `person_email_key` (partial, `where active`) refuses it. */
  | { outcome: "email-taken" };

/**
 * Add a Person — an invitation.
 *
 * Staff-only. The gate is the invite list alone (ADR-0003, amended by #115): a row's email is
 * simply whatever the person signs in with, and Staff no longer need any particular address —
 * the `@ditsama.itb.ac.id` domain rule that used to sit beside this write is gone.
 *
 * The duplicate-email refusal is caught outside the insert, as the record writes catch theirs.
 * The index is **partial** (`where active`), which is what lets revoke-and-re-add leave two rows
 * sharing an email: only the active one counts.
 */
export async function addPerson(caller: Person, input: NewPerson): Promise<AddPersonResult> {
  requireStaff(caller);

  const fullName = input.fullName.trim();
  const email = input.email.trim();
  if (fullName === "" || email === "") return { outcome: "incomplete" };

  try {
    const [row] = await db
      .insert(person)
      .values({ fullName, email, role: input.role })
      .returning({ id: person.id });
    return { outcome: "added", personId: row!.id };
  } catch (error) {
    if (constraintOf(error) === "person_email_key") return { outcome: "email-taken" };
    throw error;
  }
}

export type RevokePersonResult =
  | { outcome: "revoked" }
  /** No active Person has that id — already revoked, or a stale screen. */
  | { outcome: "no-such-person" };

/**
 * Revoke a Person — **one write, `active = false`**, and the whole mechanism (ADR-0013's
 * amendment). There is no Better Auth ban and so no half-failed state to design for: one write
 * cannot half-land. It takes effect on the revoked Person's very next request, because
 * `requirePerson()` re-reads `active` every time; their session row is left alone and does not
 * need deleting.
 *
 * The update is gated on `active = true`, so revoking a row that is already revoked reports
 * `no-such-person` rather than silently re-writing it.
 */
export async function revokePerson(caller: Person, personId: string): Promise<RevokePersonResult> {
  requireStaff(caller);

  const [row] = await db
    .update(person)
    .set({ active: false })
    .where(and(eq(person.id, personId), eq(person.active, true)))
    .returning({ id: person.id });

  return row ? { outcome: "revoked" } : { outcome: "no-such-person" };
}
