import { GET as summaryRoute } from "-/app/api/unified-dashboard/summary/route";
import type { SummaryPayload } from "-/lib/unified-dashboard";
import { SignJWT } from "jose";
import { expect } from "vitest";

/**
 * Calling the Unified Dashboard's summary route the way its backend does (#503): sign a token with
 * the suite's throwaway secret (`vitest.config.mts`) and send it as a bearer. Verification is the
 * real `authorizeUnifiedDashboard`; nothing here is a stub.
 */

export const ORIGIN = "http://localhost:3001";
export const SUMMARY_URL = `${ORIGIN}/api/unified-dashboard/summary`;
export const ISSUER = process.env.UNIFIED_DASHBOARD_JWT_ISSUER!;
export const AUDIENCE = process.env.UNIFIED_DASHBOARD_JWT_AUDIENCE!;
const SECRET = process.env.UNIFIED_DASHBOARD_JWT_SECRET!;

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A token the way the Unified Dashboard's backend signs one; each option breaks one thing. */
export function signUnifiedDashboardToken({
  secret = SECRET,
  issuer = ISSUER,
  audience = AUDIENCE,
  issuedAt = nowSeconds(),
  lifetimeSeconds = 60,
  withExp = true,
}: {
  secret?: string;
  issuer?: string;
  audience?: string;
  issuedAt?: number;
  lifetimeSeconds?: number;
  withExp?: boolean;
} = {}) {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(issuedAt);
  if (withExp) jwt.setExpirationTime(issuedAt + lifetimeSeconds);
  return jwt.sign(new TextEncoder().encode(secret));
}

/** A request to the summary route carrying `token` as its bearer. */
export const bearer = (token: string) =>
  new Request(SUMMARY_URL, { headers: { authorization: `Bearer ${token}` } });

/** The summary a freshly signed token is served, asserting it was a 200. */
export async function summary(token?: string): Promise<SummaryPayload> {
  const response = await summaryRoute(bearer(token ?? (await signUnifiedDashboardToken())));
  expect(response.status).toBe(200);
  return (await response.json()) as SummaryPayload;
}
