import type { AssessmentKind, PretestParticipantType, Stream } from "@sugt/domain";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../client";
import { assessmentCompletion } from "../schema/monitoring";
import type { Person } from "./caller";
import { requireGrant } from "./staff-only";

/**
 * **Pretest/Posttest completion — the data layer** (ticket #246,
 * [ADR-0031](../../../../docs/adr/0031-pretest-posttest-completion-is-tracked-as-delivery-not-outcomes.md)).
 * The read behind the `/monitoring` Pretest tracker and the one guarded write that ticks a box.
 *
 * A completion is a bare tuple **(School × Stream × participant-type × kind)** — presence of the row
 * *is* "done" (see `assessment_completion` in `../schema/monitoring.ts`). This layer never derives
 * the "X / 47" progress reading: the denominator is always all 47 Schools, folded on the app side
 * from `schools.length` (ticket #248), so the suite drives the fold without a database — the same
 * split `preparationCards` keeps.
 *
 * **Reading is open** to any signed-in Person, like the rest of `/monitoring`. **The write opens
 * with `requireGrant(caller, "Editor")`** (an Administrator implies it, ADR-0028): a
 * layout does not run before a Server Action, so this line is the enforcement, not the hidden UI
 * control.
 */

/** One ticked box: the tuple that, by its presence, means the assessment was administered. */
export type AssessmentCompletion = {
  schoolId: string;
  stream: Stream;
  participantType: PretestParticipantType;
  kind: AssessmentKind;
};

/**
 * Every completion row, in a stable `(schoolId, stream, participantType, kind)` order so a caller —
 * and the suite — reads them deterministically. Open to any signed-in Person; the app folds these
 * into the /47 tracker.
 */
export async function assessmentCompletions(_caller: Person): Promise<AssessmentCompletion[]> {
  return db
    .select({
      schoolId: assessmentCompletion.schoolId,
      stream: assessmentCompletion.stream,
      participantType: assessmentCompletion.participantType,
      kind: assessmentCompletion.kind,
    })
    .from(assessmentCompletion)
    .orderBy(
      asc(assessmentCompletion.schoolId),
      asc(assessmentCompletion.stream),
      asc(assessmentCompletion.participantType),
      asc(assessmentCompletion.kind),
    );
}

/** The box to toggle, plus the desired state. `done` true ticks it, false un-ticks it. */
export type SetAssessmentCompletionInput = AssessmentCompletion & { done: boolean };

export type SetAssessmentCompletionResult = { outcome: "ticked" } | { outcome: "unticked" };

/**
 * Tick or un-tick one box — **Editor-guarded**. Ticking inserts the tuple (a repeat tick
 * is a no-op by the unique constraint, so the box cannot go to two rows); un-ticking deletes it (a
 * repeat un-tick removes nothing). Either way the write drives the box to the requested state and
 * reports which state that is, so a stale screen re-ticking or re-unticking is idempotent rather
 * than an error.
 */
export async function setAssessmentCompletion(
  caller: Person,
  input: SetAssessmentCompletionInput,
): Promise<SetAssessmentCompletionResult> {
  requireGrant(caller, "Editor");

  const { schoolId, stream, participantType, kind, done } = input;

  if (done) {
    await db
      .insert(assessmentCompletion)
      .values({ schoolId, stream, participantType, kind })
      .onConflictDoNothing();
    return { outcome: "ticked" };
  }

  await db
    .delete(assessmentCompletion)
    .where(
      and(
        eq(assessmentCompletion.schoolId, schoolId),
        eq(assessmentCompletion.stream, stream),
        eq(assessmentCompletion.participantType, participantType),
        eq(assessmentCompletion.kind, kind),
      ),
    );
  return { outcome: "unticked" };
}
