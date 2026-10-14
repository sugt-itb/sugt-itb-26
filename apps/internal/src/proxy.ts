import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { safeDestination, signInPath } from "./lib/sign-in-destination";

/**
 * **The optimistic check, and nothing more.** Is a session cookie present? If not,
 * send the visitor to `/masuk` so they land on the sign-in screen rather than on a
 * blank page.
 *
 * It does **not** validate the cookie and it must not start to. Next 16 renamed
 * middleware to Proxy and defaults it to the Node.js runtime, so this *could* reach
 * Postgres — Next's own documentation says it should not be used as a full
 * session-management or authorisation solution, and it runs on every matched request.
 * The authoritative checks are the signed-in layout, for pages, and `@sugt/db`'s choke
 * point, for anything that writes.
 *
 * The redirect carries the path and query the visitor asked for (#502), so a deep link — a
 * **Lihat Detail** on the Unified Dashboard — survives sign-in. Carrying it is all this does:
 * whether it is a safe place to send anyone is decided by `safeDestination` here and again on
 * `/masuk`, and whether the Person may read it by that page's own guard.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(
    new URL(signInPath(safeDestination(pathname + search)), request.url),
  );
}

/**
 * The matcher's exclusions are **two different lists and are written as two**.
 * Conflating them is how the interesting one stops getting reviewed.
 *
 * **Mechanical.** Without these, sign-in does not work at all. There is nothing to
 * weigh and no authorisation decision in any of them:
 *
 *   - `/api/auth/**` — the Google OAuth callback arrives carrying **no session
 *     cookie**; it is the request that creates one. An optimistic check that redirects
 *     cookie-less requests to `/masuk` would intercept the callback and no session
 *     would ever be created. **Check this first if sign-in appears to loop.**
 *   - `/masuk` itself, or the redirect target redirects to itself.
 *   - `_next/static`, `_next/image` and the favicon. Standard, and cheap to get right.
 *
 * **Deliberate — the authorisation holes.** These carry a decision and are the
 * ones a reviewer should scrutinise. Each is reached by something that is not a
 * Person, and the routes themselves belong to other specs:
 *
 *   - `/f/**` — the Participant Feedback handler. Reached by a **token** in the URL
 *     (one that never expires, ADR-0049), by a Participant who has no account and never will.
 *   - `/ep/**` — the Perjadin Evaluation handler (ADR-0024). The same hole as `/f/**`,
 *     one form over: reached by a **token** in the URL, by a Narasumber,
 *     Pendamping or Pimpinan who need not sign in and self-declare who they are.
 *   - `/api/aggregates/**` — the four routes the public site reads. They authenticate
 *     with a **shared secret** in a header, not a session.
 *   - `/api/unified-dashboard/**` — the summary the company's Unified Dashboard reads
 *     (ADR-0057). It authenticates with a **short-lived JWT** in a header, not a session,
 *     and a caller with no cookie must get its 401, not a redirect to a sign-in page.
 */
export const config = {
  matcher: [
    "/((?!api/auth|api/aggregates|api/unified-dashboard|masuk|f/|ep/|_next/static|_next/image|favicon.ico).*)",
  ],
};
