import {
  CONCERN_AT_OR_BELOW,
  PERJADIN_ASPECTS,
  PERJADIN_FEEDBACK_TOKEN_LIFETIME_HOURS,
  type PerjadinAspect,
  type PerjadinEvaluationRole,
} from "@sugt/domain";
import { sql } from "drizzle-orm";

import { db } from "../client";
import { perjadinEvaluation, perjadinFeedbackToken } from "../schema/evaluations";
import type { PerjadinToken, Person } from "./caller";

/**
 * **The Perjadin Evaluation** — how the trip went, as against how the teaching went. Four Aspects
 * about the journey and none about a School.
 *
 * **Filed without signing in, through a short-lived token link (ADR-0024).** This used to be a
 * signed-in write gated on membership of the Group that travelled. That gate silently excluded
 * exactly the voices the evaluation wants — the name-based Pengajar and the record-only Pimpinan,
 * neither of whom has a login — so #167 retargeted it onto the Participant Feedback token pattern
 * (ADR-0012). Two writes and no read, exactly as that ADR draws it: `issuePerjadinFeedbackToken`
 * is a normal signed-in write that mints the per-Perjadin token whose URL becomes a QR code, and
 * `filePerjadinEvaluation` takes a `PerjadinToken` — a caller the app produces by resolving that
 * token, never one signed in — and inserts one `perjadin_evaluation` row and nothing else. The
 * resolution that turns the token into the caller is an app-side step
 * (`apps/internal/src/lib/perjadin-feedback-token.ts`), because the token has to be checked before
 * there is a caller to check it as (see `./caller.ts`).
 *
 * **Not Staff-only, and no dedup.** A Perjadin Evaluation carries no money, so by ADR-0004 it
 * follows the open-delivery rule — anyone signed in may issue the token. The old "only the Group
 * may file" and "one per filer" are both gone with the sign-in gate: the filer self-declares a Role
 * and a Name, untrusted by design, and a duplicate is allowed (the accepted cost of the token
 * pattern, #167).
 *
 * The elaboration rule is **kept unchanged from #163/ADR-0023**, retargeted per-Aspect: a Rating at
 * or below `CONCERN_AT_OR_BELOW` on Aspect X needs X's OWN Komentar, checked here beside the write
 * and by `perjadin_evaluation_low_rating_needs_prose` behind it. A comment on a different Aspect no
 * longer excuses a low one. **`lodging` is the one nullable Rating**: a skipped hotel needs no
 * comment, exactly as Postgres `least()` drops a NULL out of the minimum.
 */

/** Trim to the prose the CHECK counts, or `null` when only whitespace is left. */
function prose(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export type IssuePerjadinFeedbackTokenResult = {
  outcome: "issued";
  token: string;
  expiresAt: Date;
};

/**
 * Issue — or reissue — the feedback token for one Perjadin.
 *
 * **Anyone signed in may do this**, so there is no `requireStaff` (ADR-0004 — the Evaluation carries
 * no money); whoever has the trip's page open shares the QR with the Pengajar, Pendamping and
 * Pimpinan. Unlike the Session token there is **no cancelled bar**: a Perjadin is a real trip once
 * it exists and is never cancelled, so the token always has a live trip behind it and the write is
 * a plain upsert with no status to read or lock.
 *
 * **The upsert is keyed on `perjadin_id`, the table's primary key, so reissuing replaces the row.**
 * The moment the new row lands, the previous token string is gone from the table and every link
 * already handed out resolves to nothing — the whole of what makes "one token per Perjadin,
 * issuing a new one replaces the old" true.
 *
 * The lifetime is set from `PERJADIN_FEEDBACK_TOKEN_LIFETIME_HOURS` on **both** paths rather than
 * leaning on the column default for the insert — otherwise a change to the constant would move a
 * reissued token's expiry while a first-issued one silently kept the old default. This mirrors
 * `issueFeedbackToken` exactly.
 */
export async function issuePerjadinFeedbackToken(
  caller: Person,
  perjadinId: string,
): Promise<IssuePerjadinFeedbackTokenResult> {
  // The token is minted in the database, the way every id in this schema is — a UUID is URL-safe and
  // unique by the column's own constraint. `gen_random_uuid()` is what `defaultRandom()` compiles to.
  const token = sql`gen_random_uuid()::text`;
  const expiresAt = sql`now() + make_interval(hours => ${PERJADIN_FEEDBACK_TOKEN_LIFETIME_HOURS})`;

  const [row] = await db
    .insert(perjadinFeedbackToken)
    .values({ perjadinId, token, issuedByPersonId: caller.id, expiresAt })
    .onConflictDoUpdate({
      target: perjadinFeedbackToken.perjadinId,
      set: {
        token,
        issuedByPersonId: caller.id,
        issuedAt: sql`now()`,
        expiresAt,
      },
    })
    .returning({
      token: perjadinFeedbackToken.token,
      expiresAt: perjadinFeedbackToken.expiresAt,
    });

  return { outcome: "issued", token: row!.token, expiresAt: row!.expiresAt };
}

/**
 * The four Ratings on a Perjadin Evaluation. `lodging` is `null` when the Group did not stay
 * anywhere — a day trip has no hotel — and 1–10 otherwise. The other three are always given.
 */
export type PerjadinEvaluationRatings = {
  lodging: number | null;
  transport: number;
  meals: number;
  punctuality: number;
};

/**
 * One optional comment per Aspect, keyed off `PERJADIN_ASPECTS` so the form, this type and the
 * concerns query stay driven by the one list. Each is nullable in the row, but the per-Aspect
 * elaboration rule below *forces* the comment for any Aspect Rated low — so it belongs to the
 * Rating it explains.
 */
export type PerjadinEvaluationComments = Record<PerjadinAspect, string | null>;

/**
 * What the public form collects. **No `perjadinId` here** — it comes from the resolved token, never
 * trusted from the client, exactly as `NewParticipantFeedback` carries no `sessionId`. The `role`
 * and `name` are the filer's self-declared identity (ADR-0024).
 */
export type NewPerjadinEvaluation = {
  role: PerjadinEvaluationRole;
  name: string;
  ratings: PerjadinEvaluationRatings;
  comments: PerjadinEvaluationComments;
};

export type FilePerjadinEvaluationResult =
  | { outcome: "filed"; evaluationId: string }
  /** The filer typed no name. `filed_by_name` is `not null`, and a blank one is not a name. */
  | { outcome: "name-required" }
  /**
   * A Rating of 7 or below on an Aspect whose OWN Komentar is blank.
   * `perjadin_evaluation_low_rating_needs_prose` refuses it too, per-Aspect (#163).
   */
  | { outcome: "prose-required" };

/**
 * File one Perjadin Evaluation.
 *
 * **The caller is a `PerjadinToken`, never a `Person`** (ADR-0024) — the `perjadinId` it carries
 * was resolved and unexpired when the token was checked; this trusts that, exactly as a
 * `Person`-taking write trusts `requireStaff` ran, and as `submitParticipantFeedback` trusts its
 * `ParticipantToken`. It writes `perjadin_evaluation` and nothing else, which is the whole of what
 * the token authorises. There is no Group-member check and no `already-filed` bar any more — the
 * identity is self-declared and untrusted, and duplicates are allowed.
 *
 * The per-Aspect prose gate is checked here beside the write and again by the CHECK behind it,
 * unchanged from #163. There is no transaction: the membership read the old version wrapped is
 * gone, so this is a single insert with the constraint enforcing the rest.
 */
export async function filePerjadinEvaluation(
  caller: PerjadinToken,
  input: NewPerjadinEvaluation,
): Promise<FilePerjadinEvaluationResult> {
  // A blank name is not a name — trimmed and refused, the same money-free rule
  // `submitParticipantFeedback` holds on its own untrusted `name`.
  const name = input.name.trim();
  if (name === "") return { outcome: "name-required" };

  // Trim each Komentar blank → null once, and reuse it for both the gate and the insert so the
  // rule the client sees and the row that lands agree on what counts as "said".
  const comments: PerjadinEvaluationComments = {
    lodging: prose(input.comments.lodging),
    transport: prose(input.comments.transport),
    meals: prose(input.comments.meals),
    punctuality: prose(input.comments.punctuality),
  };
  const ratings: Record<PerjadinAspect, number | null> = {
    lodging: input.ratings.lodging,
    transport: input.ratings.transport,
    meals: input.ratings.meals,
    punctuality: input.ratings.punctuality,
  };

  // Per-Aspect, not trip-wide: a low Aspect owes ITS OWN Komentar, and prose on a different Aspect
  // does not satisfy it (#163). A null `lodging` is not low — it drops out of the check exactly as
  // Postgres `least()` leaves a NULL out of the minimum — so it never demands one.
  const lowAspectLacksProse = PERJADIN_ASPECTS.some((aspect) => {
    const rating = ratings[aspect];
    return rating !== null && rating <= CONCERN_AT_OR_BELOW && comments[aspect] === null;
  });
  if (lowAspectLacksProse) return { outcome: "prose-required" };

  const [evaluation] = await db
    .insert(perjadinEvaluation)
    .values({
      perjadinId: caller.perjadinId,
      filedByRole: input.role,
      filedByName: name,
      lodging: input.ratings.lodging,
      transport: input.ratings.transport,
      meals: input.ratings.meals,
      punctuality: input.ratings.punctuality,
      lodgingComment: comments.lodging,
      transportComment: comments.transport,
      mealsComment: comments.meals,
      punctualityComment: comments.punctuality,
    })
    .returning({ id: perjadinEvaluation.id });

  return { outcome: "filed", evaluationId: evaluation!.id };
}
