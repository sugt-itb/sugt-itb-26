import type { Role } from "@sugt/domain";

/**
 * Who is asking. **Three named types, not one type with optional fields.**
 *
 * A single type carrying optional fields would turn "is this a Staff caller" into a
 * runtime shape check — which is precisely what the composite foreign keys avoid
 * everywhere else in this schema, and the same argument applies one layer up. So the
 * arms are separate types, and a query narrows by **naming the arm it accepts in its
 * signature** rather than by inspecting a value it was handed.
 *
 * | Caller             | Is                                                     | May read                      | May write                   |
 * | ------------------ | ------------------------------------------------------ | ----------------------------- | --------------------------- |
 * | `Person`           | somebody signed in whose `person` row is still `active` | delivery; money only if Staff | their own records           |
 * | `ServiceCaller`    | `@sugt/public`, holding `AGGREGATES_SECRET`            | the four aggregate payloads   | nothing                     |
 * | `ParticipantToken` | a live Session feedback token                          | nothing                       | `participant_feedback` only |
 * | `PerjadinToken`    | a live Perjadin feedback token                         | nothing                       | `perjadin_evaluation` only  |
 *
 * See `docs/data-model.md`, *what the database does not hold*.
 */
export type Caller = Person | ServiceCaller | ParticipantToken | PerjadinToken;

/**
 * Somebody signed in, whose `person` row is still `active`.
 *
 * **Constructing one requires an active Person, and that is the revocation
 * mechanism.** The lookup is `where lower(email) = $1 and active`, and it lives in
 * `@sugt/internal` rather than here: resolving is what *produces* the caller these
 * queries are checked against, so it cannot itself be one of them, and Better Auth's
 * two hooks need it before any Person exists. **This package resolves nobody.** It
 * takes a Person it is given, and the app has exactly one way to give it one.
 *
 * Why that matters more than it sounds: **a Next.js layout does not run before a
 * Server Action.** The signed-in layout calls `requirePerson()` too, but a
 * layout-only check protects reads and leaves every write open. A query that takes a
 * `Person` is what closes it. See the amendment on
 * [#24](https://github.com/mafiefa02/sugt/issues/24).
 *
 * `role` is write-once — seven composite foreign keys into `person (id, role)` default
 * to `NO ACTION` — so nothing re-reads it within a session.
 */
export type Person = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
};

/**
 * `@sugt/public`, holding `AGGREGATES_SECRET`. No Person at all, and no way to get
 * one: the public app declares neither `@sugt/db` nor `better-auth`.
 *
 * This arm is the sibling `docs/data-model.md` left open — *"whether the Staff-only
 * choke point needs a sibling for 'no Person at all, but a valid secret'"*. It does,
 * and **the sibling is a type rather than a second guard**.
 *
 * The four aggregates queries are [#37](https://github.com/mafiefa02/sugt/issues/37)'s
 * work. The type is declared here because the union is one decision and splitting it
 * across three tickets is how the arms drift apart.
 */
export type ServiceCaller = {
  /** Named so the type is not structurally empty, and so a log line says who called. */
  readonly kind: "service";
};

/**
 * A live Session feedback token. **It reads nothing** — `docs/data-model.md` gives it
 * write access to `participant_feedback` and no read at all, so no read query will
 * ever accept this arm.
 *
 * The handler resolving the token needs the Session, and that resolution is an
 * internal step rather than a query taking a `ParticipantToken`: the token has to be
 * checked before there is a caller to check it as. See
 * [ADR-0012](../../../../docs/adr/0012-participants-write-through-a-short-lived-session-token.md)
 * and [#33](https://github.com/mafiefa02/sugt/issues/33).
 */
export type ParticipantToken = {
  readonly kind: "participant";
  /** The Session the token was issued for, already resolved and already unexpired. */
  sessionId: string;
};

/**
 * A live Perjadin feedback token — the same idea as `ParticipantToken`, one table over. **It reads
 * nothing**: `docs/data-model.md` gives it write access to `perjadin_evaluation` and no read at all,
 * so no read query will ever accept this arm.
 *
 * A Perjadin Evaluation used to be a signed-in write by a Group member; ADR-0024 retargeted it onto
 * the Participant Feedback token pattern so the name-based Pengajar and the record-only Pimpinan —
 * who have no login — can file too. The handler resolving the token needs the Perjadin, and that
 * resolution is an internal step (`apps/internal/src/lib/perjadin-feedback-token.ts`) rather than a
 * query taking a `PerjadinToken`: the token has to be checked before there is a caller to check it
 * as. See ADR-0012, ADR-0024 and [#167](https://github.com/mafiefa02/sugt/issues/167).
 */
export type PerjadinToken = {
  readonly kind: "perjadin";
  /** The Perjadin the token was issued for, already resolved and already unexpired. */
  perjadinId: string;
};
