/**
 * Where a signed-out visitor was going, carried through Google sign-in (#502).
 *
 * The proxy puts it on `/masuk?next=…`, the sign-in screen hands it to Better Auth as the
 * `callbackURL`, and the visitor lands on it. Nothing in that chain is allowed to trust the
 * value: `?next` is a query parameter anybody can write, so it is an **open-redirect** surface
 * unless every reader goes through {@link safeDestination}, which honours a same-site path and
 * nothing else.
 *
 * It decides *where to go*, never *whether you may*. A destination the Person cannot read is
 * still refused by that page's own guard, exactly as it is when they click a link to it while
 * signed in.
 */

/** Where the sign-in screen lives. Outside the signed-in tree, and outside the proxy's matcher. */
export const SIGN_IN_PATH = "/masuk";

/** The query parameter the destination travels in. */
export const DESTINATION_PARAM = "next";

/**
 * **Better Auth's own shape for a relative `callbackURL`, restated so we never hand it one it
 * refuses.** `1.6.27` accepts a relative URL only if it matches this pattern (its
 * `matchesOriginPattern` with `allowRelativePaths`), and answers anything else with a 403 —
 * which would leave the Masuk button doing nothing. Testing our output against the same pattern
 * turns "Better Auth would refuse it" into "we fall back to the default landing", and
 * `sign-in-destination.test.tsx` drives every accepted case through the real handler so a
 * library upgrade that narrows it fails a test rather than the button.
 *
 * It is also most of the open-redirect defence on its own: one leading `/` that is not followed
 * by another `/`, a backslash or their encodings, and no `:` anywhere, so no scheme.
 */
const BETTER_AUTH_RELATIVE = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

/**
 * A base that only exists so `new URL` can parse a path. Anything that parses to a different
 * origin was never a path on this app.
 */
const PARSE_BASE = "http://sugt.invalid";

/**
 * Next's client router appends this to the request it makes for a page's RSC payload. A
 * signed-out client navigation reaches the proxy carrying it; landing a person on it after
 * sign-in would only add noise to their address bar.
 */
const RSC_PARAM = "_rsc";

/**
 * The destination a `?next` value names, or `null` when it names nothing we will send a person
 * to — and `null` means the role-aware default landing, never an error.
 *
 * Accepted: a path on this app, with its query string re-encoded into the shape Better Auth
 * takes. The path itself is not re-encoded, so one Better Auth would refuse — a `,`, a `~`, a
 * percent-encoded space or letter — is refused here too, and costs only the deep link: today's
 * routes are UUIDs and `[a-z0-9-]` slugs. Refused: an absolute URL, `//host`, any backslash, a control character, a scheme such
 * as `javascript:`, anything not starting with `/`, and a repeated `?next` (an array) — there is
 * no honest way to pick one. The fragment is dropped: it never reaches a server anyway.
 */
export function safeDestination(value: string | string[] | undefined | null): string | null {
  if (typeof value !== "string") return null;
  // Browsers fold `\` into `/` and strip tabs and newlines, so `/\evil.com` and `/\t/evil.com`
  // are `//evil.com` by the time they navigate. Refused outright rather than normalised.
  if (!value.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, PARSE_BASE);
  } catch {
    return null;
  }
  if (url.origin !== PARSE_BASE) return null;

  url.searchParams.delete(RSC_PARAM);
  const query = url.searchParams.toString();
  const destination = query ? `${url.pathname}?${query}` : url.pathname;

  return BETTER_AUTH_RELATIVE.test(destination) ? destination : null;
}

/**
 * The sign-in screen, carrying `destination` when there is one.
 *
 * `/` is carried like any other page: the Unified Dashboard's Progress figure links to it. A
 * Person who may not read the Dashboard is sent on to `/pendamping` by its own guard, which is
 * where the default landing would have put them anyway.
 */
export function signInPath(destination: string | null): string {
  if (!destination) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?${new URLSearchParams({ [DESTINATION_PARAM]: destination })}`;
}
