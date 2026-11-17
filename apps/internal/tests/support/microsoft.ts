import { vi } from "vitest";

/**
 * What ITB's tenant puts in the ID token. `email` and `preferredUsername` are each optional, as
 * they are on a real Entra token: either can be absent, and the guard reads `email` first.
 */
export type MicrosoftProfile = {
  /** The token's `sub`: stable for one account and one app registration. */
  microsoftId: string;
  email?: string;
  /** The UPN, `preferred_username`. */
  preferredUsername?: string;
  name: string;
};

/** The tenant the app is configured for, as `vitest.config.mts` sets it. */
export const TENANT_ID = process.env.MICROSOFT_TENANT_ID!;

const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

/**
 * ITB's tenant's token endpoint, stubbed at the network boundary, as `./google.ts` stubs Google's.
 *
 * **A request to `graph.microsoft.com` fails the test**: decision 5 of #565 forbids any Graph call,
 * and the built-in provider makes one on every sign-in. It is counted as well as thrown, because
 * the callback may swallow the throw into an `?error=` redirect; assert `graphRequests` is 0.
 * Anything else that tries to leave the process throws too.
 *
 * The ID token is decoded, not verified, on the authorization-code path, so an unsigned one is
 * enough — the same reasoning as Google's stub.
 */
export function stubMicrosoft(profile: MicrosoftProfile) {
  const stub = {
    /** How many times the token endpoint was exchanged. Assert it, or a stub that never ran passes. */
    tokenExchanges: 0,
    /** Requests to Microsoft Graph. Must stay 0. */
    graphRequests: 0,
  };

  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(TOKEN_ENDPOINT)) {
      stub.tokenExchanges += 1;
      return Response.json({
        access_token: "stub-access-token",
        token_type: "Bearer",
        expires_in: 3599,
        scope: "openid profile email",
        id_token: mintIdToken(profile),
      });
    }
    if (new URL(url).hostname === "graph.microsoft.com") {
      stub.graphRequests += 1;
      throw new Error(`No Microsoft Graph request is allowed (#565). Unexpected: ${url}`);
    }
    throw new Error(`The tests stub ITB's tenant only. Unexpected outbound request: ${url}`);
  });

  return stub;
}

function mintIdToken(profile: MicrosoftProfile): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64UrlSegment({ alg: "RS256", kid: "stub", typ: "JWT" });
  const payload = base64UrlSegment({
    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    aud: process.env.MICROSOFT_CLIENT_ID,
    tid: TENANT_ID,
    sub: profile.microsoftId,
    oid: `oid-${profile.microsoftId}`,
    name: profile.name,
    ...(profile.email !== undefined && { email: profile.email }),
    ...(profile.preferredUsername !== undefined && {
      preferred_username: profile.preferredUsername,
    }),
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + 3600,
  });
  return `${header}.${payload}.c3R1Yi1zaWduYXR1cmU`;
}

function base64UrlSegment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
