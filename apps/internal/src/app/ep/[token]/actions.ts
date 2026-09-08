"use server";

import { resolvePerjadinFeedbackToken } from "-/lib/perjadin-feedback-token";
import {
  filePerjadinEvaluation,
  type FilePerjadinEvaluationResult,
  type NewPerjadinEvaluation,
} from "@sugt/db/queries";

/**
 * **Submit one Perjadin Evaluation.** A Server Action reached without a signed-in Person — the
 * second such write in the app, after `submitFeedbackAction`, and the same shape (ADR-0024).
 *
 * **It takes the opaque token and re-resolves it here.** The token is the credential; the
 * `perjadinId` is a *result* of validating it and is never an argument — a `perjadinId` parameter
 * would be an unauthenticated INSERT into any Perjadin anyone cared to name. The page resolved the
 * token to render the form, but that proves nothing about this call: a form held open past expiry,
 * or past a reissue, must fail here, so the resolution runs again inside the action.
 *
 * `gone` collapses expired, replaced and unknown into one outcome — the form shows the same
 * dead-link message a fresh load would. The write's own outcomes (`filed`, `name-required`,
 * `prose-required`) are reused rather than restated; `gone` is the one this layer adds.
 */
export type SubmitPerjadinEvaluationActionResult =
  | FilePerjadinEvaluationResult
  | { outcome: "gone" };

export async function submitPerjadinEvaluationAction(
  token: string,
  input: NewPerjadinEvaluation,
): Promise<SubmitPerjadinEvaluationActionResult> {
  const resolved = await resolvePerjadinFeedbackToken(token);
  if (resolved.outcome === "gone") return { outcome: "gone" };

  return filePerjadinEvaluation(resolved.caller, input);
}
