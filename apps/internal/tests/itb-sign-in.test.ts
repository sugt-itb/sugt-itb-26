import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addPerson,
  authAccounts,
  authSessions,
  authUsers,
  resetDatabase,
  revokePerson,
} from "./support/fixtures";
import { TENANT_ID } from "./support/microsoft";
import { SIGN_IN_PATH, signInWithGoogle, signInWithMicrosoft } from "./support/sign-in";

/**
 * **Masuk dengan akun ITB** (#565, ADR-0062): ITB's Microsoft tenant beside Google, through the
 * same seam `invite-gate.test.ts` drives — the real auth handler, only the tenant's token endpoint
 * stubbed. Only external behaviour is asserted: the authorization URL, the callback's status and
 * `Location`, the session cookie, and the rows in `better_auth.user`, `better_auth.account` and
 * `better_auth.session`. **The invite list is still the only gate**; the ITB button adds a way to
 * prove an email, and refuses any address that is not ITB's before an account can be linked.
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A refusal, as the browser sees it: back to `/masuk` with an `?error`, and no cookie. */
function expectRefused(result: { response: Response; location: URL; sessionCookie: unknown }) {
  expect(result.response.status).toBe(302);
  expect(result.location.pathname).toBe(SIGN_IN_PATH);
  expect(result.location.searchParams.has("error")).toBe(true);
  expect(result.sessionCookie).toBeNull();
}

describe("the authorization URL", () => {
  it("goes to ITB's tenant, reopens the account chooser and asks only openid profile email", async () => {
    const { authorizationURL } = await signInWithMicrosoft({
      microsoftId: "ms-anyone",
      email: "anyone@itb.ac.id",
      name: "Anyone",
    });

    expect(authorizationURL.origin).toBe("https://login.microsoftonline.com");
    expect(authorizationURL.pathname).toBe(`/${TENANT_ID}/oauth2/v2.0/authorize`);
    expect(authorizationURL.searchParams.get("prompt")).toBe("select_account");
    expect(authorizationURL.searchParams.get("scope")).toBe("openid profile email");
    expect(authorizationURL.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/auth/callback/microsoft",
    );
  });
});

describe("an invited Person at ITB", () => {
  it.each(["dosen@itb.ac.id", "rina@ditsama.itb.ac.id"])("is admitted at %s", async (email) => {
    const person = await addPerson({ fullName: "Rina", email, role: "Staff" });

    const result = await signInWithMicrosoft({ microsoftId: `ms-${email}`, email, name: "Rina" });

    expect(result.tokenExchanges).toBe(1);
    expect(result.graphRequests).toBe(0);
    expect(result.sessionCookie).not.toBeNull();
    expect(result.location.pathname).toBe("/");
    const users = await authUsers();
    expect(users.map((user) => [user.email, user.personId])).toEqual([[email, person.id]]);
  });

  it("is admitted by the UPN when the token carries no email", async () => {
    await addPerson({ fullName: "Upn", email: "upn@itb.ac.id", role: "Pimpinan" });

    const result = await signInWithMicrosoft({
      microsoftId: "ms-upn",
      preferredUsername: "upn@itb.ac.id",
      name: "Upn",
    });

    expect(result.sessionCookie).not.toBeNull();
    await expect(authUsers()).resolves.toMatchObject([{ email: "upn@itb.ac.id" }]);
  });

  it("matches a lowercase roster row from a mixed-case address", async () => {
    const person = await addPerson({ fullName: "Name", email: "name@itb.ac.id", role: "Staff" });

    const result = await signInWithMicrosoft({
      microsoftId: "ms-name",
      email: "Name@ITB.ac.id",
      name: "Name",
    });

    expect(result.sessionCookie).not.toBeNull();
    await expect(authUsers()).resolves.toMatchObject([
      { email: "name@itb.ac.id", personId: person.id },
    ]);
  });
});

describe("refused", () => {
  it("an uninvited ITB address, leaving no user row", async () => {
    const result = await signInWithMicrosoft({
      microsoftId: "ms-stranger",
      email: "stranger@itb.ac.id",
      name: "Stranger",
    });

    expectRefused(result);
    await expect(authUsers()).resolves.toEqual([]);
  });

  it("a revoked Person who already has a user row, minting no new session", async () => {
    const person = await addPerson({
      fullName: "Dicabut",
      email: "dicabut@itb.ac.id",
      role: "Staff",
    });
    const profile = { microsoftId: "ms-dicabut", email: "dicabut@itb.ac.id", name: "Dicabut" };
    expect((await signInWithMicrosoft(profile)).sessionCookie).not.toBeNull();
    await revokePerson(person.id);

    const again = await signInWithMicrosoft(profile);

    expectRefused(again);
    await expect(authUsers()).resolves.toHaveLength(1);
    await expect(authSessions()).resolves.toHaveLength(1);
  });

  it("a tenant guest's Gmail, even when an active Person and a user row hold it — no account linked", async () => {
    await addPerson({ fullName: "Prof. Ratna", email: "ratna@gmail.com", role: "Staff" });
    const google = await signInWithGoogle({
      googleId: "google-ratna",
      email: "ratna@gmail.com",
      name: "Prof. Ratna",
    });
    expect(google.sessionCookie).not.toBeNull();

    const guest = await signInWithMicrosoft({
      microsoftId: "ms-guest-ratna",
      email: "ratna@gmail.com",
      name: "Prof. Ratna",
    });

    expectRefused(guest);
    expect(guest.graphRequests).toBe(0);
    await expect(authAccounts()).resolves.toMatchObject([{ providerId: "google" }]);
    await expect(authSessions()).resolves.toHaveLength(1);
  });

  it.each([
    ["a lookalike domain", { email: "x@evilitb.ac.id" }],
    ["a domain that only ends in itb.ac.id's letters", { email: "x@notitb.ac.id" }],
    ["no email and a non-ITB UPN", { preferredUsername: "ratna@gmail.com" }],
    ["an empty label under itb.ac.id", { email: "x@.itb.ac.id" }],
    ["a doubled dot under itb.ac.id", { email: "x@dept..itb.ac.id" }],
    ["no email and no UPN", {}],
  ])("%s", async (_case, address) => {
    // Every address here is on the invite list, so only the ITB guard can be what refuses it.
    for (const email of [
      "x@evilitb.ac.id",
      "x@notitb.ac.id",
      "ratna@gmail.com",
      "x@.itb.ac.id",
      "x@dept..itb.ac.id",
    ]) {
      await addPerson({ fullName: email, email, role: "Staff" });
    }

    const result = await signInWithMicrosoft({ microsoftId: "ms-x", name: "X", ...address });

    expectRefused(result);
    await expect(authUsers()).resolves.toEqual([]);
  });
});

describe("one Person, both providers, one identity", () => {
  const email = "rina@ditsama.itb.ac.id";

  it.each([
    ["Google first, then ITB", ["google", "microsoft"]],
    ["ITB first, then Google", ["microsoft", "google"]],
  ] as const)("%s: one user, two accounts, two sessions", async (_case, order) => {
    const person = await addPerson({ fullName: "Rina", email, role: "Staff" });

    for (const provider of order) {
      const result =
        provider === "google"
          ? await signInWithGoogle({ googleId: "google-rina", email, name: "Rina" })
          : await signInWithMicrosoft({ microsoftId: "ms-rina", email, name: "Rina" });
      expect(result.sessionCookie, provider).not.toBeNull();
      expect(result.location.pathname).toBe("/");
    }

    const users = await authUsers();
    expect(users).toHaveLength(1);
    expect(users[0]!.personId).toBe(person.id);
    const accounts = await authAccounts();
    expect(accounts.map((account) => account.providerId).sort()).toEqual(["google", "microsoft"]);
    expect(accounts.every((account) => account.userId === users[0]!.id)).toBe(true);
    await expect(authSessions()).resolves.toHaveLength(2);
  });
});

describe("booting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("refuses a MICROSOFT_OAUTH_REDIRECT_URL that is not this app's callback, naming the expected value", async () => {
    vi.resetModules();
    vi.stubEnv("MICROSOFT_OAUTH_REDIRECT_URL", "https://sugt.example/api/auth/callback/microsoft");

    await expect(import("-/lib/auth")).rejects.toThrow(
      '"http://localhost:3001/api/auth/callback/microsoft"',
    );
  });
});
