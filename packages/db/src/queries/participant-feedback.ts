import {
  FEEDBACK_TOKEN_LIFETIME_HOURS,
  type ClassKind,
  type ParticipantFeedbackAspect,
} from "@sugt/domain";
import { eq, sql } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { participantFeedback, sessionFeedbackToken } from "../schema/evaluations";
import type { ParticipantToken, Person } from "./caller";

/**
 * **Participant Feedback** — the one write path in either app with no signed-in Person.
 *
 * Two writes and no read, exactly as ADR-0012 draws it. `issueFeedbackToken` is a normal
 * signed-in write: anyone signed in may mint the per-Session token whose URL becomes a QR
 * code. `submitParticipantFeedback` takes a `ParticipantToken` — a caller the app produces by
 * resolving that token, never one signed in — and inserts one `participant_feedback` row and
 * nothing else. The resolution that turns the token into the caller is an app-side step
 * (`apps/internal/src/lib/feedback-token.ts`), because the token has to be checked before
 * there is a caller to check it as (see `./caller.ts`).
 *
 * **No elaboration rule here.** A Participant owes nothing and refusing their 3 for want of a
 * sentence would simply lose the 3 — the CHECK that forces prose is on `class_record` and
 * `session_record` only. There is no rate limiting either, deliberately: the accepted cost is
 * that junk Ratings reach the Feedback list (#33, ADR-0012) — the `/feedback` Peserta tab that
 * replaced the retired `/concerns` page (#169).
 */

export type IssueFeedbackTokenResult =
  | { outcome: "issued"; token: string; expiresAt: Date }
  /** A cancelled Session gets no feedback — there was nothing to sit in the room for. */
  | { outcome: "session-cancelled" };

/**
 * Issue — or reissue — the feedback token for one Session.
 *
 * **Anyone signed in may do this**, so there is no `requireStaff`; the QR is held up at the end
 * of the Session by whoever is standing there. The only bar is a cancelled Session. A cancelled
 * Session is the terminal state that stops it; `arranged` and `delivered` both may issue,
 * because the token is shown at the end of a Session that happened, which is exactly when it is
 * marked delivered.
 *
 * **The upsert is keyed on `session_id`, the table's primary key, so reissuing replaces the
 * row.** The moment the new row lands, the previous token string is gone from the table and
 * every link already handed out resolves to nothing — which is the whole of what makes "one
 * token per Session, issuing a new one replaces the old" true.
 *
 * The status read and the upsert share a transaction, with the Session row locked, so a Session
 * cancelled at the same instant cannot slip a token out.
 */
export async function issueFeedbackToken(
  caller: Person,
  sessionId: string,
): Promise<IssueFeedbackTokenResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: session.status })
      .from(session)
      .where(eq(session.id, sessionId))
      .for("update");
    // A missing row throws rather than refusing: Detail Sesi 404s on an unknown id before
    // offering the button, and nothing deletes a Session, so this is a bug or a hand-edited
    // request and not a user state.
    if (!current) {
      throw new Error(
        `No Session has id ${sessionId}. Detail Sesi 404s on an unknown id before offering ` +
          "the button, and nothing deletes a Session, so this is a bug or a hand-edited request.",
      );
    }
    if (current.status === "cancelled") return { outcome: "session-cancelled" };

    // The token is minted in the database, the way every id in this schema is — `@sugt/db`
    // generates none in TypeScript, and a UUID is URL-safe and unique by the column's own
    // constraint. `gen_random_uuid()` is what `defaultRandom()` compiles to for the id columns.
    const token = sql`gen_random_uuid()::text`;
    // The lifetime is set from `FEEDBACK_TOKEN_LIFETIME_HOURS` on **both** paths rather than
    // leaning on the column default for the insert — otherwise a change to the constant would
    // move a reissued token's expiry while a first-issued one silently kept the old default.
    const expiresAt = sql`now() + make_interval(hours => ${FEEDBACK_TOKEN_LIFETIME_HOURS})`;
    const [row] = await tx
      .insert(sessionFeedbackToken)
      .values({ sessionId, token, issuedByPersonId: caller.id, expiresAt })
      .onConflictDoUpdate({
        target: sessionFeedbackToken.sessionId,
        set: {
          token,
          issuedByPersonId: caller.id,
          issuedAt: sql`now()`,
          expiresAt,
        },
      })
      .returning({
        token: sessionFeedbackToken.token,
        expiresAt: sessionFeedbackToken.expiresAt,
      });

    return { outcome: "issued", token: row!.token, expiresAt: row!.expiresAt };
  });
}

/** The three Ratings a Participant gives — no elaboration rule, so all three are simply present. */
export type ParticipantFeedbackRatings = {
  materials: number;
  instructor: number;
  relevance: number;
};

/**
 * One optional comment per Aspect, keyed off `PARTICIPANT_FEEDBACK_ASPECTS` so the form, this
 * type and the Feedback read (`feedback.ts`) stay driven by the one list. Each is independently
 * optional — a Participant may explain one low Rating and leave the rest blank.
 */
export type ParticipantFeedbackComments = Record<ParticipantFeedbackAspect, string | null>;

/** What the public form collects. The `sessionId` is not here — it comes from the resolved token. */
export type NewParticipantFeedback = {
  classKind: ClassKind;
  name: string;
  ratings: ParticipantFeedbackRatings;
  comments: ParticipantFeedbackComments;
};

export type SubmitParticipantFeedbackResult =
  | { outcome: "submitted" }
  /** The Participant typed no name. `name` is `not null`, and a blank one is not a name. */
  | { outcome: "name-required" };

/**
 * Insert one Participant's feedback.
 *
 * **The caller is a `ParticipantToken`, never a `Person`** — the sole write in the system
 * keyed on a token rather than an account. The `sessionId` it carries was resolved and
 * unexpired when the token was checked; this trusts that, exactly as a `Person`-taking write
 * trusts `requireStaff` ran. It writes `participant_feedback` and nothing else, which is the
 * whole of what the token authorises.
 */
export async function submitParticipantFeedback(
  caller: ParticipantToken,
  input: NewParticipantFeedback,
): Promise<SubmitParticipantFeedbackResult> {
  const name = input.name.trim();
  if (name === "") return { outcome: "name-required" };

  // Trim each comment blank → null exactly as the single `comment` was — a Participant owes no
  // prose, so an empty box stores nothing rather than an empty string.
  const trimmed = (comment: string | null): string | null => {
    const value = comment?.trim() ?? "";
    return value === "" ? null : value;
  };
  await db.insert(participantFeedback).values({
    sessionId: caller.sessionId,
    classKind: input.classKind,
    name,
    materials: input.ratings.materials,
    instructor: input.ratings.instructor,
    relevance: input.ratings.relevance,
    materialsComment: trimmed(input.comments.materials),
    instructorComment: trimmed(input.comments.instructor),
    relevanceComment: trimmed(input.comments.relevance),
  });

  return { outcome: "submitted" };
}
