import type { Grant } from "@sugt/domain";

import type { Person } from "./caller";

/**
 * The Staff-only choke point. **The boundary is now read (any signed-in Person) vs write
 * (Staff)** — [ADR-0004](../../../../docs/adr/0004-delivery-data-is-open-internally-money-is-not.md)
 * drew the line at delivery-vs-money, and [ADR-0026](../../../../docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md)
 * ([#180](https://github.com/mafiefa02/sugt/issues/180)) reversed the money-read half.
 *
 * **What passes through here is writes, not money reads.** Money READS are now open to any
 * signed-in Person — a Pimpinan reads all money (the acquittal, the CSV export, the trip money
 * strip, the `/monitoring` budget card), so `perjadinAcquittal` no longer opens with this guard.
 * What this choke point guards is money **WRITES** — recording, attaching, settling and filing a
 * transaction, plus the treasurer return — and delivery-*arranging* writes: Jadwalkan Sesi daring
 * and Rencanakan Perjadin are Staff-only because [#9](https://github.com/mafiefa02/sugt/issues/9)
 * says so, and ADR-0004 is silent on it (that ADR opens delivery data to both roles for **reading**
 * and leaves writes with "the record's owner", which a Session nobody has arranged yet does not
 * have). So the guard is one guard and the reasons are two, and neither of them is "this function
 * reads money".
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
 * variant as having the Advance strip, transactions and Report **absent rather than
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
        `[${person.grants.join(", ") || "no grants"}]. A Grant is Staff-only and additive ` +
        `(ADR-0028); the write that reaches one is refused server-side, so this is a bug in ` +
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
 */
export function hasGrant(person: Person, grant: Grant): boolean {
  if (person.role !== "Staff") return false;
  return person.grants.includes("Administrator") || person.grants.includes(grant);
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
