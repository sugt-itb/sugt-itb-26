import { deriveProgress } from "-/app/(app)/dashboard-derive";
import { authorizeUnifiedDashboard, toSummaryPayload } from "-/lib/unified-dashboard";
import { assessmentCompletions, programmeDelivery } from "@sugt/db/queries";
import { NextResponse } from "next/server";

/**
 * **The Unified Dashboard's summary route** (#503, ADR-0057) — this Programme's progress for company
 * leadership, read by the company's Unified Dashboard from its backend. Behind an HS256 JWT, not a
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

  const [delivery, completions] = await Promise.all([
    programmeDelivery(caller),
    assessmentCompletions(caller),
  ]);

  return NextResponse.json(toSummaryPayload(deriveProgress(delivery, completions), new Date()), {
    headers: { "Cache-Control": "no-store" },
  });
}
