import { deriveProgress } from "-/lib/programme-progress";
import { authorizeUnifiedDashboard, toSummaryPayload } from "-/lib/unified-dashboard";
import {
  assessmentCompletions,
  NO_PARTICIPANT_FEEDBACK_SCOPE,
  NO_PERJADIN_FEEDBACK_SCOPE,
  participantFeedbackFigures,
  perjadinFeedbackFigures,
  programmeDelivery,
} from "@sugt/db/queries";
import { NextResponse } from "next/server";

/**
 * **The Unified Dashboard's summary route** (#503, ADR-0057) — this Programme's summary for company
 * leadership, delivery progress and the two feedback averages (#504), read by the company's
 * Unified Dashboard from its backend. Behind an HS256 JWT, not a
 * session and not `AGGREGATES_SECRET`; programme-wide, with no query parameters.
 *
 * **Fresh on every request (`no-store`).** Every figure is the number `/` shows, from the same rows
 * and the same `deriveProgress`, and a cache would only let the two disagree. No CORS headers are
 * sent: a browser cannot call this, only the Unified Dashboard's server.
 */
export async function GET(request: Request) {
  const caller = await authorizeUnifiedDashboard(request);
  if (!caller) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Programme-wide: the feedback figures are read unscoped, as `/feedback` opens (#504).
  const [delivery, completions, participant, perjadin] = await Promise.all([
    programmeDelivery(caller),
    assessmentCompletions(caller),
    participantFeedbackFigures(caller, NO_PARTICIPANT_FEEDBACK_SCOPE),
    perjadinFeedbackFigures(caller, NO_PERJADIN_FEEDBACK_SCOPE),
  ]);

  const payload = toSummaryPayload(
    deriveProgress(delivery, completions),
    { participant, perjadin },
    new Date(),
  );
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
