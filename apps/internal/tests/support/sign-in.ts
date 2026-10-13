import { auth } from "-/lib/auth";
import { resolvePerson, type Person } from "-/lib/person";
import { SIGN_IN_PATH } from "-/lib/sign-in-destination";
import type { Role } from "@sugt/domain";

import { addPerson } from "./fixtures";
import { stubGoogle, type GoogleProfile } from "./google";

const ORIGIN = "http://localhost:3001";

/** Where a rejected visitor is sent, and where the sign-in screen lives. */
export { SIGN_IN_PATH };

export type SignInResult = {
  /** The callback's own response. Nothing follows the redirect. */
  response: Response;
  /**
   * The authorization URL `POST /sign-in/social` handed back — the one a browser would
   * send to Google. Exposed because the failure this whole flow guards against was a
   * **missing** `prompt` param on it, and nothing type-checks the absence of a query
   * parameter; only an assertion on this URL can.
   */
  authorizationURL: URL;
  /** Where the browser is sent next, as a URL. */
  location: URL;
  /** The session cookie, ready to hand to seam 2. `null` when none was issued. */
  sessionCookie: string | null;
  /** How many times Google's token endpoint was reached. */
  tokenExchanges: number;
};

/**
 * Drive a whole Google sign-in through the same handler `route.ts` mounts.
 *
 * Two requests, because that is what a browser makes: `POST /sign-in/social` to get
 * the authorization URL and the state cookie, then `GET /callback/google` carrying
 * the code Google would have sent back. Nothing here is a Next.js server and nothing
 * is a browser driver — the assertions are on a real `Response`.
 */
export async function signInWithGoogle(
  profile: GoogleProfile,
  /** Where the sign-in screen asks to land afterwards — the Masuk button's `callbackURL`. */
  { callbackURL = "/" }: { callbackURL?: string } = {},
): Promise<SignInResult> {
  const google = stubGoogle(profile);

  const start = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        provider: "google",
        callbackURL,
        errorCallbackURL: SIGN_IN_PATH,
      }),
    }),
  );
  if (!start.ok) {
    throw new Error(`sign-in/social failed: ${start.status} ${await start.text()}`);
  }

  const { url } = (await start.json()) as { url: string };
  const authorizationURL = new URL(url);
  const state = authorizationURL.searchParams.get("state");
  if (!state) throw new Error(`No state on the authorization URL: ${url}`);

  const response = await auth.handler(
    new Request(
      `${ORIGIN}/api/auth/callback/google?state=${encodeURIComponent(state)}&code=stub-authorization-code`,
      { headers: { cookie: cookieHeader(start), origin: ORIGIN } },
    ),
  );

  return {
    response,
    authorizationURL,
    location: new URL(response.headers.get("location") ?? "", ORIGIN),
    sessionCookie: sessionCookie(response),
    tokenExchanges: google.tokenExchanges,
  };
}

/**
 * Both seams end to end: put a Person on the invite list, sign them in through the
 * handler, and resolve the cookie it issued the way a request does.
 *
 * This is the one way to obtain a real `Person`, so it is what any test needing a
 * caller for `@sugt/db` uses. Fabricating an object of the right shape would prove
 * nothing about the query layer's caller, which is the whole point of it being one.
 */
export async function signInAsPerson(role: Role, email: string, fullName: string): Promise<Person> {
  await addPerson({ fullName, email, role });

  const result = await signInWithGoogle({ googleId: `google-${email}`, email, name: fullName });
  if (!result.sessionCookie) throw new Error(`No session cookie issued signing in ${email}`);

  const person = await resolvePerson(new Headers({ cookie: result.sessionCookie }));
  if (!person) throw new Error(`The cookie issued for ${email} resolved to no Person`);
  return person;
}

/** Every `Set-Cookie` on a response, as the `name=value` pairs a browser would send back. */
function issuedCookies(response: Response): string[] {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]!);
}

/** Those pairs folded into one `Cookie` header. */
export function cookieHeader(response: Response): string {
  return issuedCookies(response).join("; ");
}

/**
 * The session cookie alone, as a `Cookie` header. Seam 2 is fed by seam 1: sign in
 * through the handler, take what it issued, hand it to the resolver — so the
 * resolver's inputs are always real ones.
 *
 * The empty-value filter matters: signing out and being refused both clear the cookie
 * by setting it to `""`, and a cleared cookie is not an issued one.
 */
export function sessionCookie(response: Response): string | null {
  const session = issuedCookies(response).filter(
    (cookie) => cookie.includes("session_token") && !cookie.endsWith("="),
  );
  return session.length > 0 ? session.join("; ") : null;
}
