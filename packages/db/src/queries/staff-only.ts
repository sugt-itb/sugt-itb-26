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
