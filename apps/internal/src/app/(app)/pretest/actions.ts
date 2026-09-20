"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { setAssessmentCompletion, type SetAssessmentCompletionResult } from "@sugt/db/queries";
import type { PretestParticipantType, Stream } from "@sugt/domain";
import { revalidatePath } from "next/cache";

/**
 * **The `/pretest` grid's one write** — tick or un-tick a Pretest box, behind
 * `requireGrant(person, "Monitoring Editor")` inside the `@sugt/db` write (ADR-0028, #246).
 * `staffSurface` turns a non-holder's `NotGrantedError` into a 403 — the page hides the grid from
 * non-holders and its route gate refuses them, but a layout does not run before a Server Action, so
 * this guard is the real enforcement even against a direct call.
 *
 * `kind` is fixed to `"pretest"`: this surface never writes a posttest row. On success it
 * revalidates `/pretest` (so a reload reflects the true state and the optimistic UI falls back to
 * it) and `/monitoring` (so the tracker card #248 re-reads once it lands).
 */
export async function setPretestCompletionAction(input: {
  schoolId: string;
  stream: Stream;
  participantType: PretestParticipantType;
  done: boolean;
}): Promise<SetAssessmentCompletionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() =>
    setAssessmentCompletion(person, { ...input, kind: "pretest" }),
  );
  revalidatePath("/pretest");
  revalidatePath("/monitoring");
  return result;
}
