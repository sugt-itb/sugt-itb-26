import { db, schema } from "@sugt/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";

import { requireEnv } from "./env";
import { findActivePersonByEmail } from "./invite-list";
import { microsoftProvider } from "./itb-microsoft";

/**
 * The one code a rejected visitor's browser ever carries back.
 *
 * Uninvited and revoked fail identically, because they fail for the same reason: no
 * matching active Person. `/masuk` renders one
 * Indonesian sentence for **every** value of `?error` and never echoes it, so the
 * indistinguishability is true by construction — this constant only makes the two
 * routes agree on the wire as well.
 *
 * It is a code and not prose on purpose. A thrown message arrives underscored, and
 * Better Auth's built-in error page validates the code against
 * `/^['A-Za-z0-9_-]+$/` and renders `UNKNOWN` on anything else. The Indonesian
 * sentence contains two full stops. The copy stays in the app.
 */
const REJECTED = "NOT_ON_INVITE_LIST";

/**
 * **`code` is load-bearing and `message` is not interchangeable with it**, because the
 * two hooks below are caught at different depths and each reads a different field:
 *
 * - The invite hook's throw is caught around the user-creation call, which keeps
 *   `message` — so the browser lands at `/masuk?error=NOT_ON_INVITE_LIST`.
 * - The revocation hook's throw escapes to the callback route, whose `catch` redirects
 *   **only when `e.body.code` is set** and otherwise rethrows. Without `code` a revoked
 *   Person would get a 500 instead of the sign-in screen.
 *
 * Verified by driving both paths through the handler, not assumed: `1.6.27` sends both
 * to `/masuk` with a 302 and the same `error` value.
 */
function refuse(): never {
  throw new APIError("FORBIDDEN", { message: REJECTED, code: REJECTED });
}

export const auth = betterAuth({
  baseURL: requireEnv("BETTER_AUTH_URL"),
  secret: requireEnv("BETTER_AUTH_SECRET"),

  /**
   * `@sugt/db` owns the tables; this app owns the auth. The adapter never builds a
   * table-name string — it looks each model up as a key in this object — so the
   * hand-declared `pgSchema("better_auth")` tables emit `better_auth."user"` by
   * themselves. Note the keys are Better Auth's **model** names, which is why
   * `session` here is the Drizzle export called `authSession`.
   */
  database: drizzleAdapter(db, { provider: "pg", schema: schema.betterAuthSchema }),

  user: {
    additionalFields: {
      /**
       * The column is declared on the Drizzle table as a real `uuid`. This entry does
       * something different and also necessary: it **registers the field with the
       * library**, because the adapter builds its insert from Better Auth's own field
       * registry and silently drops anything not in it. `type: "string"` is the
       * nearest thing the library's vocabulary has to a uuid and never reaches the
       * DDL — nothing here issues DDL.
       *
       * `input: false` is what stops a client supplying it. On the OAuth path the
       * library skips every `input: false` field before parsing the provider profile,
       * so Google cannot inject a `person_id` claim either.
       */
      personId: { type: "string", required: false, input: false },
    },
  },

  /**
   * **Google, and ITB's Microsoft tenant** (#565, ADR-0062). Two ways to prove you own an email;
   * the invite list below is still the only gate, by email, whichever is used. One Person is one
   * `user` with an `account` row per provider used, linked by email. Email-and-password stays off,
   * which is its default.
   */
  socialProviders: {
    google: {
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),

      /**
       * **This costs a click on every sign-in and is not a mistake — do not delete it.**
       * Both halves are load-bearing against the one dead end this screen can reach.
       *
       * `select_account` reopens Google's account chooser. Without it, Google silently
       * re-authorizes the account it already remembers for this client, so a visitor the
       * invite gate refuses is handed the **same** refused account on every retry and can
       * never offer a different one — the "personal Gmail out of habit" case ADR-0003
       * names becomes unrecoverable from inside the app. That is the fix.
       *
       * `consent` re-shows Google's permission screen each time, deliberately: it puts the
       * chosen account's email in front of the person one more time before they land, so a
       * mis-picked account is caught by them rather than by the invite gate. It is **not**
       * for a refresh token — nothing here is persisted from Google; `resolvePerson`
       * re-reads the invite list by email every request.
       *
       * `1.6.27` accepts `prompt` **only** in this server config — the `sign-in/social`
       * body has no such field — so it is unconditional by construction and cannot be made
       * to fire only after a failure. Accepted, not overlooked: sessions persist, so
       * sign-in is rare, and one extra click beats an unrecoverable dead end.
       */
      prompt: "select_account consent",
    },

    /**
     * **ITB's Microsoft (Entra ID) tenant only**, ITB addresses only — the guard runs before any
     * account is linked, and reads the ID token alone, with no Graph request. See
     * `./itb-microsoft.ts`. Booting fails here when `MICROSOFT_OAUTH_REDIRECT_URL` is not exactly
     * this app's callback.
     */
    microsoft: microsoftProvider(),
  },

  session: {
    /**
     * **Cookie caching stays off.** It is the default, and leaving it alone is a
     * decision rather than an omission.
     *
     * It is no longer load-bearing for revocation: `person` is our table, so the
     * `active` lookup every request makes is a fresh read whatever the session cache
     * does. What is left is that the performance case for turning it on is weak —
     * every request already resolves the Person in order to read `role`, so the
     * round trip the cache would save is being made anyway.
     */
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * **The invite gate.** No active `person` row, no account — and the refusal
         * lands before the insert, so an uninvited Google or ITB account leaves no trace in
         * the database at all. That is order rather than rollback: every
         * `create.before` hook runs before the adapter's create is called.
         *
         * It **throws** rather than returning `false`. Returning `false` makes the
         * internal create return `null`, after which the OAuth path reads `.id` off
         * it and dies with a `TypeError` — no user row either way, but by accident
         * and with an unusable error.
         */
        before: async (user) => {
          const person = await findActivePersonByEmail(user.email);
          if (!person) refuse();

          return { data: { ...user, personId: person.id } };
        },
      },
    },

    session: {
      create: {
        /**
         * **Revocation, at sign-in.** The hook above fires on user *creation* only: a
         * revoked Person who already has a `better_auth.user` row creates a
         * *session*, not a user, so without this they would obtain a cookie and only
         * be bounced on the next request.
         *
         * Two enforcement points, one authority — `person.active`, read by both. The
         * third is `requirePerson()`, which reads it again on every request.
         */
        before: async (session) => {
          const [identity] = await db
            .select({ email: schema.user.email })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1);

          if (!identity) refuse();
          if (!(await findActivePersonByEmail(identity.email))) refuse();
        },
      },
    },
  },

  /**
   * `nextCookies()` must be **last** in this array. Better Auth warns when a plugin
   * declaring `hooks.after` sits after it, because those hooks may set cookies that
   * are never forwarded to Next's cookie store.
   */
  plugins: [nextCookies()],
});
