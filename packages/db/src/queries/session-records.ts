import {
  CONCERN_AT_OR_BELOW,
  SESSION_RECORD_ASPECTS,
  type SessionRecordAspect,
  type SessionStatus,
} from "@sugt/domain";
import { eq } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { sessionRecord } from "../schema/evaluations";
import type { Person } from "./caller";
import { requireSessionWriter, requireStaff } from "./staff-only";

/**
 * **The PIC's Session Record form**, filed against a Session that has been delivered.
 *
 * **The Class Record write path was retired in T3** ([#153](https://github.com/mafiefa02/sugt/issues/153)):
 * a Class Record was filed by a `Teaching Team` Person, but that role is gone — online teachers are
 * free-text names now (ADR-0022) and offline ones always were (ADR-0020), and neither can sign in and
 * file. The `class_record` table stands as a dead surface (its Teaching-Team FK unsatisfiable); Class
 * Records are deferred for both modes, the `CONTEXT.md` open question.
 *
 * The Session Record is a write and owns its transaction, by convention 5 beside this package: the
 * status read and the insert sit in one transaction, and the constraint catch sits outside
 * it, as `moveSessionDate` does. **The delivered gate is best-effort, not a lock** — the read
 * takes no `for update`, so a Session cancelled between the read and the insert is not
 * prevented, and deliberately: `docs/data-model.md` says nothing in the database stops a
 * Record against an arranged or cancelled Session, so the gate is the application being
 * helpful rather than an invariant to serialise around. It is not a Staff-only *read*, so it
 * exposes no payload function here; the reads that render these Records live on `./session-detail.ts`.
 *
 * **The elaboration rule is the one `docs/data-model.md` calls _enforced twice by design_.**
 * A Rating at or below `CONCERN_AT_OR_BELOW` cannot be filed without prose, and that is
 * checked here beside the write **and** by `class_record_low_rating_needs_prose` /
 * `session_record_low_rating_needs_prose` behind it. The application half is what makes the
 * refusal a value the form can put on a field; the CHECK is what makes it true of every
 * write path, this one included. See convention 4's note on `./index.ts`.
 */

/** Trim to the prose the CHECK counts, or `null` when only whitespace is left. */
function prose(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * The name of the constraint that refused a write, read from both places a driver may put
 * it. A wrapped statement carries it under `cause`; nothing here fails at COMMIT, but the
 * two-place read costs nothing and mirrors `constraintOf` in the tests — the name it borrows,
 * to stay clear of `fixtures.ts`'s `refusedBy`, which is the async form over a write in flight.
 */
function constraintOf(error: unknown): string | null {
  const wrapped = error as { constraint_name?: string; cause?: { constraint_name?: string } };
  return wrapped.cause?.constraint_name ?? wrapped.constraint_name ?? null;
}

/**
 * Whether the lowest Rating in a set reaches the concerns threshold, which is exactly when
 * prose becomes mandatory. The same `least(...) <= CONCERN` the CHECK computes, in
 * JavaScript rather than SQL so the refusal is a value.
 */
function needsProse(ratings: number[]): boolean {
  return Math.min(...ratings) <= CONCERN_AT_OR_BELOW;
}

/**
 * One Session's status.
 *
 * **A missing row throws rather than returning a value**, and that is the same rule
 * `lockedSession` states on `./session-detail.ts`: Detail Sesi 404s on an unknown id before
 * offering either form, and nothing deletes a Session, so an id naming nothing here arrived
 * by a bug or a hand-edited request and is not a user state to be helpful about.
 */
async function statusOf(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sessionId: string,
): Promise<SessionStatus> {
  const [row] = await tx
    .select({ status: session.status })
    .from(session)
    .where(eq(session.id, sessionId));
  if (!row) {
    throw new Error(
      `No Session has id ${sessionId}. Detail Sesi 404s on an unknown id before offering ` +
        "the form, and nothing deletes a Session, so this is a bug or a hand-edited request.",
    );
  }
  return row.status;
}

/**
 * A Session that is not `delivered`.
 *
 * A Record is offered only on a delivered Session — `docs/data-model.md` is explicit that
 * nothing in the database stops one against an arranged or cancelled Session, so the gate is
 * the application's. The excluded value is `"delivered"` itself: every refusal below is
 * *because* the Session is not there.
 */
export type NotDelivered = Exclude<SessionStatus, "delivered">;

/** The five Ratings on a Session Record, one per Aspect, each 1–10. */
export type SessionRecordRatings = Record<SessionRecordAspect, number>;

/** What the Session Record form collects. `null` on any prose field the filer left blank. */
export type NewSessionRecord = {
  sessionId: string;
  ratings: SessionRecordRatings;
  problems: string | null;
  suggestions: string | null;
};

export type FileSessionRecordResult =
  | { outcome: "filed"; recordId: string }
  /** The Session is not delivered, so no Record is owed against it yet. */
  | { outcome: "session-not-delivered"; status: NotDelivered }
  /** A Rating of 7 or below with no prose. `session_record_low_rating_needs_prose` refuses it too. */
  | { outcome: "prose-required" }
  /** This Staff member already filed one for this Session, by `session_record_one_per_filer`. */
  | { outcome: "already-filed" };

/**
 * File one Session Record — the visit as a whole, five Aspects, no `covered` because the
 * filer taught nothing.
 *
 * Opens with the Staff-only choke point, which throws `NotStaffError` on a Teaching Team
 * caller, then `requireSessionWriter`, which throws `NotOnPerjadinError` on a Staff member off
 * the Session's trip without the Perjadin Editor Grant (ADR-0048). Those are the opposite case to the
 * refusals below: only Staff file one, and the composite foreign key
 * `session_record_filed_by_staff` holds the Staff half behind the throw. A refusal here is instead a state a correct screen can reach — the Session was
 * cancelled, or this member already filed while the page was open.
 */
export async function fileSessionRecord(
  caller: Person,
  input: NewSessionRecord,
): Promise<FileSessionRecordResult> {
  requireStaff(caller);

  const problems = prose(input.problems);
  if (
    needsProse(SESSION_RECORD_ASPECTS.map((aspect) => input.ratings[aspect])) &&
    problems === null
  ) {
    return { outcome: "prose-required" };
  }

  try {
    return await db.transaction(async (tx) => {
      await requireSessionWriter(caller, input.sessionId, tx);

      const status = await statusOf(tx, input.sessionId);
      if (status !== "delivered") return { outcome: "session-not-delivered", status };

      const [record] = await tx
        .insert(sessionRecord)
        .values({
          sessionId: input.sessionId,
          filedByPersonId: caller.id,
          filedByRole: "Staff",
          facilities: input.ratings.facilities,
          turnout: input.ratings.turnout,
          schoolSupport: input.ratings.school_support,
          timing: input.ratings.timing,
          coordination: input.ratings.coordination,
          problems,
          suggestions: prose(input.suggestions),
        })
        .returning({ id: sessionRecord.id });

      return { outcome: "filed", recordId: record!.id };
    });
  } catch (error) {
    if (constraintOf(error) === "session_record_one_per_filer") return { outcome: "already-filed" };
    throw error;
  }
}
