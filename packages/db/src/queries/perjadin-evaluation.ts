import {
  CONCERN_AT_OR_BELOW,
  PERJADIN_ASPECTS,
  PERJADIN_ASPECTS_BY_ROLE,
  type PerjadinAspect,
  type PerjadinEvaluationRole,
} from "@sugt/domain";
import { asc, eq, sql } from "drizzle-orm";

import { db } from "../client";
import { perjadinEvaluation, perjadinFeedbackToken } from "../schema/evaluations";
import { perjadin } from "../schema/travel";
import type { PerjadinToken, Person } from "./caller";

/**
 * **The Perjadin Evaluation** — how the trip went, as against how the teaching went. Four Aspects
 * about the journey, one about the Pendamping who accompanied it (#481), and none about a School.
 *
 * **Filed without signing in, through a token link (ADR-0024).** This used to be a
 * signed-in write gated on membership of the Group that travelled. That gate silently excluded
 * exactly the voices the evaluation wants — the name-based Narasumber and the record-only Pimpinan,
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
 * longer excuses a low one. **`lodging` is a nullable Rating**: a skipped hotel needs no comment,
 * exactly as Postgres `least()` drops a NULL out of the minimum.
 *
 * **`pendamping_support` is the other nullable Rating, and the Role decides it** (ADR-0054): a
 * Narasumber or a Pimpinan must give it and a Pendamping must not, since they would be Rating
 * themselves — `PERJADIN_ASPECTS_BY_ROLE`, the shape `submitParticipantFeedback` gives Hands-on RBL.
 */

/** Trim to the prose the CHECK counts, or `null` when only whitespace is left. */
function prose(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export type IssuePerjadinFeedbackTokenResult = {
  outcome: "issued";
  token: string;
};

/**
 * The Perjadin's Evaluation link: the one it has, or a new one when it has none.
 *
 * **Anyone signed in may do this**, so there is no `requireStaff` (ADR-0004 — the Evaluation carries
 * no money); whoever has the trip's page open shares the QR with the Narasumber, Pendamping and
 * Pimpinan. Unlike the Session token there is **no cancelled bar**: a Perjadin is a real trip once
 * it exists and is never cancelled, so the token always has a live trip behind it.
 *
 * **It never replaces a link** (ADR-0049), exactly as `issueFeedbackToken` does not: it reads the
 * trip's existing link and inserts only when there is none, and of several (only
 * `db:reattach-links` adds a second) it returns the original — the earliest `issued_at`, then
 * `token`. The Perjadin row is locked for the lookup and the insert, so two presses at the same
 * moment queue on it and the second reads the link the first inserted.
 */
export async function issuePerjadinFeedbackToken(
  caller: Person,
  perjadinId: string,
): Promise<IssuePerjadinFeedbackTokenResult> {
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: perjadin.id })
      .from(perjadin)
      .where(eq(perjadin.id, perjadinId))
      // `no key update` rather than `update`: two presses still queue on it, but a write that only
      // references the trip — an Evaluation landing, a Session added — is not held up behind it.
      .for("no key update");
    // A missing row throws, as `issueFeedbackToken` does for a Session: the trip page 404s on an
    // unknown id before offering the button, so this is a bug or a hand-edited request.
    if (!trip) {
      throw new Error(
        `No Perjadin has id ${perjadinId}. The trip page 404s on an unknown id before offering ` +
          "the button, so this is a bug or a hand-edited request.",
      );
    }

    const [existing] = await tx
      .select({ token: perjadinFeedbackToken.token })
      .from(perjadinFeedbackToken)
      .where(eq(perjadinFeedbackToken.perjadinId, perjadinId))
      .orderBy(asc(perjadinFeedbackToken.issuedAt), asc(perjadinFeedbackToken.token))
      .limit(1);
    if (existing) return { outcome: "issued", token: existing.token };

    // The token is minted in the database, the way every id in this schema is — a UUID is URL-safe
    // and unique by the column's own constraint. `gen_random_uuid()` is what `defaultRandom()`
    // compiles to.
    const [row] = await tx
      .insert(perjadinFeedbackToken)
      .values({ perjadinId, token: sql`gen_random_uuid()::text`, issuedByPersonId: caller.id })
      .returning({ token: perjadinFeedbackToken.token });

    return { outcome: "issued", token: row!.token };
  });
}

/**
 * The five Ratings on a Perjadin Evaluation. `lodging` is `null` when the Group did not stay
 * anywhere — a day trip has no hotel — and 1–10 otherwise. `pendamping_support` is `null` exactly
 * when the Role is not asked it (`PERJADIN_ASPECTS_BY_ROLE`): a Pendamping's. The other three are
 * always given.
 */
export type PerjadinEvaluationRatings = {
  lodging: number | null;
  transport: number;
  meals: number;
  punctuality: number;
  pendamping_support: number | null;
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
  | { outcome: "prose-required" }
  /**
   * The Ratings are not the Role's Aspects: a Narasumber or Pimpinan with no Pendamping Support, a
   * Pendamping with one (ADR-0054), or any filer missing one the Role always owes. The form never sends either; a forced request, or a form left
   * open from before #481, gets this, and nothing is written.
   */
  | { outcome: "ratings-mismatch" };

/**
 * File one Perjadin Evaluation.
 *
 * **The caller is a `PerjadinToken`, never a `Person`** (ADR-0024) — the `perjadinId` it carries
 * was resolved when the token was checked; this trusts that, exactly as a
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

  // Pendamping Support is the Role's to give or not: required of a Narasumber or a Pimpinan and
  // refused from a Pendamping. Only the second half has a CHECK behind it — rows filed before #481
  // hold a NULL from every Role. The `?? []` is for a forged `role` from the unauthenticated form,
  // which the types cannot rule out: it is asked nothing, so it is refused here rather than failing
  // the CHECK. The `?? null` is for a form loaded before #481, which sends no Pendamping Support.
  // `lodging` is asked of everyone and may still be null — a day trip — so it is the one Aspect
  // whose presence is not the Role's to decide.
  const asked = PERJADIN_ASPECTS_BY_ROLE[input.role] ?? [];
  const pendampingSupport = input.ratings.pendamping_support ?? null;
  const matches = PERJADIN_ASPECTS.every(
    (aspect) => aspect === "lodging" || (input.ratings[aspect] != null) === asked.includes(aspect),
  );
  if (asked.length === 0 || !matches) return { outcome: "ratings-mismatch" };

  // Trim each Komentar blank → null once, and reuse it for both the gate and the insert so the
  // rule the client sees and the row that lands agree on what counts as "said".
  const comments: PerjadinEvaluationComments = {
    lodging: prose(input.comments.lodging),
    transport: prose(input.comments.transport),
    meals: prose(input.comments.meals),
    punctuality: prose(input.comments.punctuality),
    // A Komentar on an Aspect the Role is not asked is dropped, as the form drops it.
    pendamping_support: asked.includes("pendamping_support")
      ? prose(input.comments.pendamping_support ?? null)
      : null,
  };
  const ratings: Record<PerjadinAspect, number | null> = {
    lodging: input.ratings.lodging,
    transport: input.ratings.transport,
    meals: input.ratings.meals,
    punctuality: input.ratings.punctuality,
    pendamping_support: pendampingSupport,
  };

  // Per-Aspect, not trip-wide: a low Aspect owes ITS OWN Komentar, and prose on a different Aspect
  // does not satisfy it (#163). A null `lodging` or `pendamping_support` is not low — it drops out of
  // the check exactly as Postgres `least()` leaves a NULL out of the minimum — so it never demands one.
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
      pendampingSupport,
      lodgingComment: comments.lodging,
      transportComment: comments.transport,
      mealsComment: comments.meals,
      punctualityComment: comments.punctuality,
      pendampingSupportComment: comments.pendamping_support,
    })
    .returning({ id: perjadinEvaluation.id });

  return { outcome: "filed", evaluationId: evaluation!.id };
}
