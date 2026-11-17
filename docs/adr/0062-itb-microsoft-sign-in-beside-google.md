# ITB Microsoft sign-in beside Google; the invite list is still the gate

The internal tool gains a second way to sign in: **Masuk dengan akun ITB**, through ITB's Microsoft
(Entra ID) tenant, beside **Masuk dengan Google**
([#565](https://github.com/sugt-itb/sugt-itb-26/issues/565)). **The invite list is still the only
gate.** An ITB account is one more way to prove you own an email; being one admits nobody. A Person
still has exactly one roster email, and admission is still the active `person` row with that email.

This supersedes the "not ITB SSO" half of
[ADR-0003](./0003-google-sign-in-with-an-invite-list.md). Its reasons no longer hold: the Teaching
Team stopped being a sign-in role in T3 ([#153](https://github.com/mafiefa02/sugt/issues/153)), so
no signed-in Person is a professor without an ITB account, and ITB IT has already registered the
app, so nothing waits on a university department's schedule. Google stays, because Persons listed
under a Gmail still sign in with it.

## The decisions

1. **The gate does not change.** `databaseHooks.user.create.before`,
   `databaseHooks.session.create.before` and `requirePerson()` still read `person.active` by email.
   A Person of either role can use either button.
2. **ITB's tenant only.** Better Auth's `microsoft` provider is configured with
   `tenantId: MICROSOFT_TENANT_ID`, never `common` or `organizations`, so a personal Microsoft
   account or another organisation's cannot use the ITB button.
3. **A domain guard, then a trusted email.** Only an address at `itb.ac.id` or any subdomain of it
   (`ditsama.itb.ac.id` included) is accepted, matched on the domain, so `evilitb.ac.id` is refused.
   An accepted address is reported **verified**, because ITB's directory is the authority for its
   own addresses. Anything else is refused — a tenant **guest** carrying a Gmail above all. The
   guard has to run in the provider's `getUserInfo`, before Better Auth links an account by email:
   a guest whose Gmail matches a Person who already signed in with Google would otherwise be linked
   to that Person before any database hook ran. Refusing there sends the browser back to `/masuk`
   with nothing written. Entra tokens carry no `email_verified`; left unreported, accounts would
   never link between the two providers in either order, so verification is asserted only after
   the guard and for this provider alone — never through `trustedProviders` or by turning off
   `requireLocalEmailVerified`.
4. **The UPN when there is no email.** With no `email` claim, `preferred_username` is used.
   Whichever is used is lowercased, then guarded.
5. **Least privilege.** `prompt: "select_account"` reopens the account chooser, as Google's does;
   **not `consent`**, which shows "Need admin approval" on every sign-in if ITB has turned user
   consent off. Scopes are `openid profile email` only — no `User.Read`, no `offline_access` — and
   **no Microsoft Graph request is made**: the identity is read from the ID token, which came
   straight from the tenant's token endpoint over the code flow. The built-in `getUserInfo`
   always asks Graph for a profile photo, so the app supplies its own.
6. **Required configuration, checked at boot.** `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
   `MICROSOFT_TENANT_ID` and `MICROSOFT_OAUTH_REDIRECT_URL` are read through `requireEnv`. The
   redirect URL must be exactly `${BETTER_AUTH_URL}/api/auth/callback/microsoft`, or the app
   refuses to boot with a sentence naming both values — so a mismatch with ITB's app registration
   shows at deploy time, not at someone's first sign-in.

## Consequences

- **One Person, one `user`, one `account` per provider used.** Signing in with Google and then
  with ITB, or the other way round, for the same address, links the second account to the same
  user; each sign-in mints its own session.
- **One email per Person is a constraint, accepted.** The provider has to present the roster email,
  so a Person listed under a Gmail keeps using Google, or an Administrator revokes them and re-adds
  them under their ITB address, their history staying on the old row
  ([ADR-0013](./0013-people-are-added-in-the-tool-and-their-role-is-write-once.md)). Editing a
  Person's email may come later.
- **Every refusal still reads the same.** A non-ITB address on the ITB button comes back as one
  more `?error` value, and `/masuk` renders one sentence for every value and never echoes it.
- **A deploy needs the four values before this ships**, provisioned by
  [#564](https://github.com/sugt-itb/sugt-itb-26/issues/564).
