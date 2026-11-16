import { decodeJwt } from "jose";

import { requireEnv } from "./env";

/**
 * **ITB's Microsoft sign-in** (#565, [ADR-0062](../../../../docs/adr/0062-itb-microsoft-sign-in-beside-google.md)):
 * the second way to prove you own an email, beside Google. **It admits nobody by itself** — the
 * invite list is still the only gate, read by email in `auth.ts`'s hooks and `requirePerson()`.
 * What this module adds is the provider's configuration and the one check that has to run before
 * Better Auth links an account: the address must be ITB's.
 */

/** ITB's own domain. An address here or at any subdomain of it is ITB's to vouch for. */
const ITB_DOMAIN = "itb.ac.id";

/**
 * **Is this an ITB address?** `itb.ac.id` itself or any subdomain of it — `ditsama.itb.ac.id`
 * included — matched on the **domain**, never as a suffix of the whole string, so
 * `x@evilitb.ac.id` is refused. Expects a lowercased address.
 */
function isItbAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0 || email.indexOf("@") !== at) return false;
  const domain = email.slice(at + 1);
  // Every label non-empty, so `a@.itb.ac.id` and `a@x..itb.ac.id` are no ITB addresses either.
  if (domain.split(".").some((label) => label === "")) return false;
  return domain === ITB_DOMAIN || domain.endsWith(`.${ITB_DOMAIN}`);
}

/** What `getUserInfo` answers Better Auth for an accepted ITB address: the identity it links by. */
type ItbUserInfo = {
  user: { id: string; name: string; email: string; emailVerified: true };
  data: Record<string, unknown>;
};

/**
 * **The signed-in identity, read from the ID token alone** — no Microsoft Graph request of any
 * kind, which the built-in `getUserInfo` always makes (for a profile photo) before it can be told
 * not to.
 *
 * The token came straight from the tenant's token endpoint over the authorization-code flow, so it
 * is decoded rather than verified, as Better Auth's own providers do on this path. The address is
 * its `email` claim, or `preferred_username` (the UPN) when there is none, lowercased. **Anything
 * not ITB's is refused** (`null`): a tenant guest carrying a Gmail, say. Returning `null` here is
 * what makes the callback redirect to `/masuk?error=unable_to_get_user_info` with nothing written —
 * and it has to happen here, because the linking to an existing user by email runs right after,
 * before any database hook.
 *
 * An accepted address is reported `emailVerified: true`, **because ITB's directory is the authority
 * for its own addresses**, and only after the guard. Entra tokens carry no `email_verified`, so left
 * to the built-in reading it would be `false`, and an account would then never link to a Person who
 * signed in with Google first — nor Google to one who signed in here first.
 */
function itbUserInfo(idToken: string | undefined): ItbUserInfo | null {
  if (!idToken) return null;
  const claims = decodeJwt(idToken);
  const claimed = typeof claims.email === "string" && claims.email ? claims.email : null;
  const upn = typeof claims.preferred_username === "string" ? claims.preferred_username : null;
  const email = (claimed ?? upn)?.trim().toLowerCase();
  if (!email || !isItbAddress(email) || typeof claims.sub !== "string") return null;

  const name = typeof claims.name === "string" && claims.name ? claims.name : email;
  return { user: { id: claims.sub, name, email, emailVerified: true }, data: claims };
}

/**
 * **`MICROSOFT_OAUTH_REDIRECT_URL`, checked against where Better Auth will receive the callback.**
 * It is what ITB's app registration lists, so a value that is not exactly
 * `${BETTER_AUTH_URL}/api/auth/callback/microsoft` would only fail at someone's first sign-in, as
 * Microsoft's redirect-mismatch page. Failing here makes it a deploy-time error instead.
 */
function microsoftRedirectURI(): string {
  const configured = requireEnv("MICROSOFT_OAUTH_REDIRECT_URL");
  const expected = `${requireEnv("BETTER_AUTH_URL")}/api/auth/callback/microsoft`;
  if (configured !== expected) {
    throw new Error(
      `MICROSOFT_OAUTH_REDIRECT_URL is "${configured}", but Better Auth receives the ITB sign-in ` +
        `at "${expected}" (BETTER_AUTH_URL followed by /api/auth/callback/microsoft). Set it to ` +
        `exactly that, and list the same URL on ITB's app registration.`,
    );
  }
  return configured;
}

/**
 * **The `microsoft` social provider's configuration** — ITB's tenant only, never `common` or
 * `organizations`, so a personal Microsoft account or another organisation's cannot use the ITB
 * button at all.
 *
 * - `prompt: "select_account"` reopens the account chooser, for the reason Google's does in
 *   `auth.ts`. **Not `consent`**: if ITB has turned user consent off, `consent` would show "Need
 *   admin approval" on every sign-in.
 * - Scopes are `openid profile email` and nothing else (`disableDefaultScope` drops the default
 *   `User.Read` and `offline_access`): nothing is read from Graph and no refresh token is wanted.
 */
export function microsoftProvider() {
  return {
    clientId: requireEnv("MICROSOFT_CLIENT_ID"),
    clientSecret: requireEnv("MICROSOFT_CLIENT_SECRET"),
    tenantId: requireEnv("MICROSOFT_TENANT_ID"),
    redirectURI: microsoftRedirectURI(),
    prompt: "select_account" as const,
    disableDefaultScope: true,
    scope: ["openid", "profile", "email"],
    getUserInfo: async (token: { idToken?: string }) => itbUserInfo(token.idToken),
  };
}
