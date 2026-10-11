import type { Grant } from "@sugt/domain";
import { type SQL, sql } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { groupMember, perjadin } from "../schema/travel";
import type { Person } from "./caller";
import type { Executor } from "./preparation-checklist";

/**
 * The Staff-only choke point. **The boundary is now read (any signed-in Person) vs write
 * (Staff)** — [ADR-0004](../../../../docs/adr/0004-delivery-data-is-open-internally-money-is-not.md)
 * drew the line at delivery-vs-money, and [ADR-0026](../../../../docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md)
 * ([#180](https://github.com/mafiefa02/sugt/issues/180)) reversed the money-read half.
 *
 * **What passes through here is writes, not money reads.** Money READS are now open to any
 * signed-in Person — a Pimpinan reads all money (the acquittal, the CSV export, the trip money
 * strip, the `/monitoring` budget card), so `perjadinAcquittal` no longer opens with this guard. The
 * one money read gated again is `/keuangan`'s programme-wide table (ADR-0053), and by a Grant through
 * `requireGrant` below, not by this Staff line.
 * What this choke point guards is money **WRITES** — recording, attaching, deleting and filing a
 * transaction — and delivery-*arranging* writes: Jadwalkan Sesi daring
 * and Rencanakan Perjadin are Staff-only because [#9](https://github.com/mafiefa02/sugt/issues/9)
 * says so (and since ADR-0047 also need a Grant — Daring Editor or Perjadin Editor, ADR-0052 — through
 * `requireGrant` below), and ADR-0004 is silent on it (that ADR opens delivery data to both roles for **reading**
 * and leaves writes with "the record's owner", which a Session nobody has arranged yet does not
 * have). So the guard is one guard and the reasons are two, and neither of them is "this function
 * reads money".
 *
 * **Inside the Staff line, a Perjadin is its Group's** (ADR-0048): every write on a trip and its
 * offline Sessions also runs `requirePerjadinWriter` below, which passes the trip's Group, a Perjadin
 * Editor and an Administrator and refuses every other Staff member with `NotOnPerjadinError`.
 *
 * That rule is application code rather than RLS, because Better Auth means there is
 * no `auth.uid()` in Postgres and a policy would need `SET LOCAL` on every
 * transaction plus a non-superuser role with `FORCE ROW LEVEL SECURITY` — a great
 * deal of machinery for one two-role rule. So it lives here, at **one** place rather
 * than at each call site. See `docs/data-model.md`, *what the database does not
 * hold*.
 */

const NOT_STAFF_ERROR_CODE = "sugt/not-staff";

/**
 * A non-Staff `Person` reached a Staff-only query.
 *
 * **Reaching this is a bug or an attack, never a user state.**
 * [#9](https://github.com/mafiefa02/sugt/issues/9) specifies the money-free Perjadin
 * variant as having the money strip, transactions and Report **absent rather than
 * disabled**, so the UI decides by role and never offers the surface to a Teaching
 * Team member.
 *
 * It throws rather than returning an empty result for exactly that reason: an empty
 * return would make a mis-passed caller indistinguishable from a Perjadin that
 * genuinely has no transactions yet, with nothing in the logs to separate them.
 */
export class NotStaffError extends Error {
  /**
   * **Discriminate on this, not on `instanceof`.**
   *
   * Two module instances of this package — a bundler splitting server and client
   * graphs is the ordinary way to get them — give two distinct classes, and
   * `instanceof` is false across them while the error is plainly the same error. A
   * string property survives that, and survives `structuredClone` and `JSON` too.
   */
  readonly sugtErrorCode = NOT_STAFF_ERROR_CODE;

  override readonly name = "NotStaffError";

  constructor(person: Person) {
    super(
      `A Staff-only query was handed ${person.role} caller ${person.id}. Writing money is ` +
        `Staff-only by ADR-0026 (reading it is open to any signed-in Person) and arranging ` +
        `delivery is Staff-only by the surface list; either way the write that reaches one is ` +
        `refused server-side for a non-Staff Person — so this is a bug in whoever offered the ` +
        `write, not a state a user can reach.`,
    );
  }
}

/**
 * Is this the Staff-only refusal?
 *
 * The app translates a `true` here into a **403**, not a crash page. Do that
 * **server-side**, at the call site: an `error.tsx` boundary is a client component
 * and receives a sanitized error in production, where every property but `digest` is
 * stripped — so a guard run there passes in development and silently fails in
 * production.
 */
export function isNotStaffError(error: unknown): error is NotStaffError {
  return (
    typeof error === "object" &&
    error !== null &&
    "sugtErrorCode" in error &&
    error.sugtErrorCode === NOT_STAFF_ERROR_CODE
  );
}

/**
 * The choke point itself. Every Staff-only query opens with it — it is the only thing
 * standing between Teaching Team and a receipt, and now also the only thing standing
 * between them and a Session they arranged for a School themselves.
 *
 * **On a write it is load-bearing in a way it is not on a read.** A Next.js layout does
 * not run before a Server Action, so the signed-in layout's `requirePerson()` protects
 * reads and leaves every write open; a write query that opens with this line is what
 * closes it. See the amendment on
 * [#24](https://github.com/mafiefa02/sugt/issues/24).
 *
 * It takes a `Person` rather than a `Caller` because the union's other two arms are
 * refused by the signature: `ServiceCaller` reads the three aggregate payloads and
 * `ParticipantToken` reads nothing at all, so neither can be handed to a money query
 * in the first place. Narrowing the union here instead would make the arm a runtime
 * shape check, which is what three named types exist to avoid.
 *
 * It returns nothing. A narrowed `Person & { role: "Staff" }` would be a type with no
 * consumer — a money query that wants the caller already has it — and the passing case
 * is not what any call site here is interested in.
 */
export function requireStaff(person: Person): void {
  if (person.role !== "Staff") throw new NotStaffError(person);
}

const NOT_GRANTED_ERROR_CODE = "sugt/not-granted";

/**
 * A caller reached a Grant-guarded surface without the Grant.
 *
 * The sibling of `NotStaffError`, and it is a sibling on purpose: a Grant is a **second, additive
 * access axis** beside the write-once role (ADR-0028), so its refusal is a second typed error at
 * the same choke point rather than a variant of the first. `staffSurface()` translates it into the
 * same **403** — reaching it is a bug or an attack, never a user state, because the UI offers a
 * Grant-guarded write only to a Person who holds the Grant.
 *
 * It is discriminated on `sugtErrorCode`, not `instanceof`, for the reason spelled out on
 * `NotStaffError`: two module instances of this package give two classes, and `instanceof` is false
 * across them while the error is plainly the same one.
 */
export class NotGrantedError extends Error {
  readonly sugtErrorCode = NOT_GRANTED_ERROR_CODE;

  override readonly name = "NotGrantedError";

  constructor(person: Person, grant: Grant) {
    super(
      `A ${grant}-granted surface was handed ${person.role} caller ${person.id}, who holds ` +
        `[${person.grants.join(", ") || "no grants"}]. A Grant is Staff-only ` +
        `(ADR-0028, ADR-0047); the write that reaches one is refused server-side, so this is a bug in ` +
        `whoever offered the write, not a state a user can reach.`,
    );
  }
}

/**
 * Is this the Grant refusal? Translated into a **403** server-side by `staffSurface()`, the same
 * as `isNotStaffError` — see the note there on why this must not run in an `error.tsx` boundary.
 */
export function isNotGrantedError(error: unknown): error is NotGrantedError {
  return (
    typeof error === "object" &&
    error !== null &&
    "sugtErrorCode" in error &&
    error.sugtErrorCode === NOT_GRANTED_ERROR_CODE
  );
}

/**
 * **Which other Grants satisfy a Grant check** (ADR-0052), besides Administrator, which satisfies
 * every one. Only one Grant is implied by another: Dashboard Editor reads the Dashboard it writes.
 */
const GRANT_IMPLIED_BY: Partial<Record<Grant, readonly Grant[]>> = {
  "Dashboard Viewer": ["Dashboard Editor"],
};

/**
 * Does this Person hold this Grant? **Staff-only first, then the grant**, and it is synchronous
 * because the caller carries its `grants` (threaded at resolution, like `role`).
 *
 * Two rules, in this order:
 * 1. **Grants are Staff-only.** A non-Staff caller holds no Grant, whatever rows exist — a Pimpinan
 *    resolves with an empty list, but this guards the role directly so the answer does not depend on
 *    that. This is what keeps a Grant from ever punching through "a Pimpinan writes nothing"
 *    (ADR-0025).
 * 2. **Administrator implies every Grant.** An Administrator satisfies any grant check without
 *    holding that grant's own row — the one privilege that makes it the administering Grant.
 * 3. **Otherwise only `GRANT_IMPLIED_BY`** (ADR-0052): Dashboard Editor satisfies Dashboard Viewer,
 *    and no other Grant satisfies another.
 */
export function hasGrant(person: Person, grant: Grant): boolean {
  if (person.role !== "Staff") return false;
  const satisfiedBy: readonly Grant[] = [
    "Administrator",
    grant,
    ...(GRANT_IMPLIED_BY[grant] ?? []),
  ];
  return person.grants.some((held) => satisfiedBy.includes(held));
}

/**
 * The Grant choke point. A Grant-guarded write opens with it, exactly as a Staff-only one opens with
 * `requireStaff`, and it throws the distinguishable `NotGrantedError` that `staffSurface()` turns
 * into a 403. It returns nothing for the same reason `requireStaff` does: the passing case is not
 * what any call site is interested in, and a narrowed type would have no consumer.
 */
export function requireGrant(person: Person, grant: Grant): void {
  if (!hasGrant(person, grant)) throw new NotGrantedError(person, grant);
}

/**
 * **May this Person read the Dashboard (`/`)?** The one predicate behind both the page guard and the
 * sidebar's Dashboard link — never duplicated, so the link is shown exactly when the page is
 * reachable (#322).
 *
 * Two ways in, and they are different in kind:
 * - **A `Pimpinan` reads it by Role**, not by a Grant. Grants stay Staff-only (ADR-0028) — a
 *   Pimpinan holds none — so their access is the role branch, and the Dashboard is their home
 *   (ADR-0025).
 * - **A `Staff` reads it by holding `Dashboard Viewer`**. `hasGrant` folds in that Administrator
 *   and Dashboard Editor both satisfy it (ADR-0052), so this one call covers all three. Perjadin
 *   Editor, Daring Editor and Keuangan do not.
 *
 * A grant-less Staff Person falls through to `false` and is redirected to `/pendamping` — the mirror
 * of the `/pendamping → /` redirect a Pimpinan gets. This is the documented exception to "reading is
 * open to any signed-in Person" (ADR-0026): the Dashboard read now needs a grant (see the ADR
 * this ticket adds).
 */
export function canViewDashboard(person: Person): boolean {
  if (person.role === "Pimpinan") return true;
  return hasGrant(person, "Dashboard Viewer");
}

const NOT_ON_PERJADIN_ERROR_CODE = "sugt/not-on-perjadin";

/**
 * A Staff caller reached a write on a Perjadin whose Group they are not in, without the Perjadin
 * Editor Grant (ADR-0048, ADR-0052).
 *
 * The third sibling at this choke point, after `NotStaffError` and `NotGrantedError`, and the same
 * kind of refusal: the UI hides every write on a trip from a Person who may not make it, so reaching
 * this is a bug, an attack, or a screen gone stale since its Person left the Group. `staffSurface()`
 * turns it into the same **403**. Discriminated on `sugtErrorCode`, not `instanceof`, for the reason
 * on `NotStaffError`.
 */
export class NotOnPerjadinError extends Error {
  readonly sugtErrorCode = NOT_ON_PERJADIN_ERROR_CODE;

  override readonly name = "NotOnPerjadinError";

  constructor(person: Person, perjadinId: string) {
    super(
      `A write on Perjadin ${perjadinId} was handed Staff caller ${person.id}, who is not in its ` +
        `Group and holds [${person.grants.join(", ") || "no grants"}]. A Perjadin is written by its ` +
        `Group, Perjadin Editors and Administrators (ADR-0048); the UI offers its writes to no one else, so ` +
        `this is a bug or a stale screen, not a state a user can reach.`,
    );
  }
}

/** Is this the Perjadin-writer refusal? Translated into a **403** server-side by `staffSurface()`. */
export function isNotOnPerjadinError(error: unknown): error is NotOnPerjadinError {
  return (
    typeof error === "object" &&
    error !== null &&
    "sugtErrorCode" in error &&
    error.sugtErrorCode === NOT_ON_PERJADIN_ERROR_CODE
  );
}

/**
 * **The Perjadin-writer rule as one SQL boolean** (ADR-0048), correlated to the `perjadin` row of
 * the query it sits in: Staff only, then the Perjadin Editor Grant (an Administrator implies it)
 * writes every Perjadin, then anyone else only a trip whose Group — a `group_member` row, the PIC included —
 * they are in. A Pimpinan recorded on a trip is not in its Group (ADR-0020). The one statement of
 * the rule: `requirePerjadinWriter`, `canWritePerjadin` and the `/perjadin` directory's per-row
 * answer all read it. Not exported from the package.
 */
export function perjadinWriterSql(person: Person): SQL<boolean> {
  if (person.role !== "Staff") return sql<boolean>`false`;
  if (hasGrant(person, "Perjadin Editor")) return sql<boolean>`true`;
  return sql<boolean>`exists (
    select 1 from ${groupMember} gm
    where gm.perjadin_id = ${perjadin.id} and gm.person_id::text = ${person.id}
  )`;
}

/**
 * May this Person write this Perjadin — or `null` when no such Perjadin exists. A text compare, so
 * a malformed id is simply no Perjadin rather than a cast error.
 */
async function writesPerjadin(
  executor: Executor,
  person: Person,
  perjadinId: string,
): Promise<boolean | null> {
  const [row] = await executor
    .select({ writer: perjadinWriterSql(person) })
    .from(perjadin)
    .where(sql`${perjadin.id}::text = ${perjadinId}`);
  return row ? row.writer : null;
}

/**
 * **May this Person write this Perjadin?** (ADR-0048) The non-throwing twin of
 * `requirePerjadinWriter`, for the UI to decide which write controls to show.
 */
export async function canWritePerjadin(person: Person, perjadinId: string): Promise<boolean> {
  return (await writesPerjadin(db, person, perjadinId)) === true;
}

/**
 * **The Perjadin-writer choke point** (ADR-0048). Every write on a Perjadin and on its offline
 * Sessions runs it, and it is three rules in this order:
 *
 * 1. `requireStaff` first, so a Pimpinan is still refused as `NotStaffError` — a Pimpinan writes
 *    nothing (ADR-0025), Group or not.
 * 2. The Perjadin Editor Grant writes every Perjadin; an Administrator implies it.
 * 3. Anyone else writes only a Perjadin whose Group they are in, and is otherwise refused with
 *    `NotOnPerjadinError`.
 *
 * **A Perjadin that does not exist passes**, so a write on a stale id still answers its own
 * `no-such-perjadin` as a value: nobody is in a deleted trip's Group, and a stale screen is a state
 * a member can honestly reach.
 *
 * Pass the write's own transaction where it has one, so the membership it reads is the state the
 * write commits against: a member who has just left the Group is refused on their next write.
 * Membership is application-enforced, not a database rule (`docs/data-model.md`).
 */
export async function requirePerjadinWriter(
  person: Person,
  perjadinId: string,
  executor: Executor = db,
): Promise<void> {
  requireStaff(person);
  if ((await writesPerjadin(executor, person, perjadinId)) === false) {
    throw new NotOnPerjadinError(person, perjadinId);
  }
}

/**
 * **`requirePerjadinWriter` for a write that names a Session rather than its trip.** An offline
 * Session is written by its Perjadin's Group (ADR-0048), so this resolves the Session's
 * `perjadin_id` and runs the Perjadin guard on it. An online Session has no Perjadin and no Group —
 * who writes one is the Daring Editor Grant (ADR-0047, ADR-0052), checked by its own surface — and no such Session is the
 * write's own refusal to give, so both pass with only `requireStaff` here.
 */
export async function requireSessionWriter(
  person: Person,
  sessionId: string,
  executor: Executor = db,
): Promise<void> {
  requireStaff(person);
  const [row] = await executor
    .select({ perjadinId: session.perjadinId })
    .from(session)
    .where(sql`${session.id}::text = ${sessionId}`);
  if (row?.perjadinId) await requirePerjadinWriter(person, row.perjadinId, executor);
}
