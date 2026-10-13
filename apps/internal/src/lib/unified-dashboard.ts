import { requireEnv } from "-/lib/env";
import type { ProgrammeProgress } from "-/lib/programme-progress";
import type { UnifiedDashboardCaller } from "@sugt/db/queries";
import { jwtVerify } from "jose";

/**
 * **The Unified Dashboard's half of the internal app (#503, ADR-0057)** — who may call the summary
 * route, and the payload it answers with. The company's Unified Dashboard shows this Programme's
 * figures to company leadership behind its own login; `docs/unified-dashboard-api.md` is the
 * contract the other team builds against.
 *
 * **Secrets are read at call time, never at module scope.** A `const` at the top of a route file is
 * evaluated during `next build`, where the variable need not be set, and would fail the build — the
 * same rule `authorizeServiceCaller` follows.
 */

/**
 * **The payload's version, and the one rule for changing it** — the aggregates rule: bump it only
 * when a field is **removed or retyped**. Adding a field does not bump it (#504 adds two sections
 * at version 1); an older reader ignores what it does not know, and the contract tells the Unified
 * Dashboard to refuse a version it does not know rather than render half a payload.
 */
export const SUMMARY_VERSION = 1;

/** The longest a token may live, `iat` to `exp`. A token signed for longer is refused outright. */
const MAX_TOKEN_LIFETIME_SECONDS = 5 * 60;

/** How far the two servers' clocks may disagree before a fresh token reads as expired or future. */
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Who is calling, from the `Authorization: Bearer <JWT>` header — the `UnifiedDashboardCaller` when
 * the token verifies, `null` otherwise. `null` is the route's 401, **for every way a token can be
 * wrong**: no header, a bad signature, an expired or too-long-lived token, the wrong `iss` or `aud`,
 * `alg: none`, or something that is not a JWT at all. `jwtVerify` throws on each, and every throw
 * is a `null` — never a 500.
 *
 * - **The algorithm is pinned to `HS256`**, never taken from the token's header, so `alg: none` and
 *   an algorithm swap are both refused before the signature is looked at.
 * - **`exp` and `iat` are required, and `exp` is at most five minutes after `iat`.** With `iat` no
 *   later than now plus the 30-second tolerance, `exp` is at most five and a half minutes from
 *   now: a stolen token is worth minutes, and nobody can mint themselves a long-lived one.
 * - **`iss` and `aud` are required** and must equal the configured values.
 *
 * **This is the one function that knows how a caller is verified.** Moving to the Unified
 * Dashboard's own issuer — a JWKS and RS256/ES256 — is a change here and nowhere else.
 *
 * A missing variable still throws: that is a deploy without its configuration, a 500 worth reading
 * in the logs, not a caller to turn away.
 */
export async function authorizeUnifiedDashboard(
  request: Request,
): Promise<UnifiedDashboardCaller | null> {
  const secret = new TextEncoder().encode(requireEnv("UNIFIED_DASHBOARD_JWT_SECRET"));
  const issuer = requireEnv("UNIFIED_DASHBOARD_JWT_ISSUER");
  const audience = requireEnv("UNIFIED_DASHBOARD_JWT_AUDIENCE");

  const header = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return null;

  try {
    const { payload } = await jwtVerify(header.slice(prefix.length), secret, {
      algorithms: ["HS256"],
      issuer,
      audience,
      requiredClaims: ["exp", "iat"],
      // Also refuses an `iat` in the future, beyond the tolerance.
      maxTokenAge: MAX_TOKEN_LIFETIME_SECONDS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    // `requiredClaims` guarantees both are present; `jwtVerify` checked they are numbers.
    if (payload.exp! - payload.iat! > MAX_TOKEN_LIFETIME_SECONDS) return null;
  } catch {
    return null;
  }

  return { kind: "unified-dashboard" };
}

/** A delivery figure as it travels: delivered Sessions over capacity, and where to see them. */
type DeliveredFigure = { delivered: number; total: number; detailUrl: string };
/** An assessment figure as it travels: ticked boxes over Schools × 4. Not a Session, so not "delivered". */
type CompletedFigure = { completed: number; total: number; detailUrl: string };

/** The summary route's body. `docs/unified-dashboard-api.md` gives each field's meaning and grain. */
export type SummaryPayload = {
  version: number;
  generatedAt: string;
  progress: {
    detailUrl: string;
    kegiatanTerlaksana: { percent: number; completed: number; total: number };
    pretest: number;
    daring: number;
    luring: number;
    posttest: number;
  };
  sessions: {
    offline: DeliveredFigure;
    online: DeliveredFigure;
    pretest: CompletedFigure;
    posttest: CompletedFigure;
  };
};

/**
 * Lay the shared progress figures out in the contract's shape. **Nothing is computed here** — every
 * number is one `deriveProgress` produced for `/` as well — so this only renames, and builds each
 * Lihat Detail link.
 *
 * The links are built from **`BETTER_AUTH_URL`**, this app's own address, never a hard-coded host —
 * so a staging deploy links to staging. Pretest and Posttest point at `/`, whose Pelaksanaan tab has
 * both tables (`/pretest` is the Daring Editor's, and Posttest has no page). A link opens no page's
 * guard: whoever follows it signs in and is checked like anyone else.
 */
export function toSummaryPayload(progress: ProgrammeProgress, generatedAt: Date): SummaryPayload {
  const base = requireEnv("BETTER_AUTH_URL");
  const link = (path: string) => new URL(path, base).href;
  const { kegiatan, offline, online, pretest, posttest } = progress;

  return {
    version: SUMMARY_VERSION,
    generatedAt: generatedAt.toISOString(),
    progress: {
      detailUrl: link("/"),
      kegiatanTerlaksana: {
        percent: kegiatan.percent,
        completed: kegiatan.count,
        total: kegiatan.total,
      },
      pretest: pretest.percent,
      daring: online.percent,
      luring: offline.percent,
      posttest: posttest.percent,
    },
    sessions: {
      offline: { delivered: offline.count, total: offline.total, detailUrl: link("/perjadin") },
      online: { delivered: online.count, total: online.total, detailUrl: link("/sesi-daring") },
      pretest: { completed: pretest.count, total: pretest.total, detailUrl: link("/") },
      posttest: { completed: posttest.count, total: posttest.total, detailUrl: link("/") },
    },
  };
}
