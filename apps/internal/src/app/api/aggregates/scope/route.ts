import { authorizeServiceCaller, toScopePayload } from "-/lib/aggregates";
import { scope } from "@sugt/db/queries";
import { NextResponse } from "next/server";

/**
 * **The scope route.** The four Clusters and all forty-seven Schools, behind `AGGREGATES_SECRET`.
 * Reached only with the shared secret — a browser with none gets a 401 — so no visitor's request
 * ever reaches Postgres. `@sugt/public` reads this at build time and caches it until the next deploy
 * (ADR-0008, ADR-0014).
 */
export async function GET(request: Request) {
  const caller = authorizeServiceCaller(request);
  if (!caller) return new NextResponse("Unauthorized", { status: 401 });

  return NextResponse.json(toScopePayload(await scope(caller)));
}
