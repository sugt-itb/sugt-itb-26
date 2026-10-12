# People are added in the tool, and a Person's role is write-once

[ADR-0003](./0003-google-sign-in-with-an-invite-list.md) says the invite list is "maintained by hand" and leaves who and where open. It is a Staff-only People screen in the internal tool. The founding Staff rows are seeded, because the sign-up hook makes a `person` row a prerequisite for anyone getting an account at all; everyone after that is added through the screen. A Person's `role` cannot be changed once they have been used, so correcting one means revoking the row and adding a new one — and revoking has to reach further than `active = false` does on its own.

## Why a screen and not a seed file

Schools, Clusters and Topics have no admin screens because they are fixed reference data — [`product.md`](../product.md) is explicit, and [`data-model.md`](../data-model.md) scopes the rule the same way. **People are not reference data.** The Teaching Team roster grows as professors are recruited, and `active = false` is a revocation that happens on a Tuesday for a reason nobody planned for.

Maintaining `person` in an authored seed file the way `reference-data.sql` maintains Schools would make every new professor a commit and a deploy by the single developer. That is precisely the publishing bottleneck [ADR-0008](./0008-public-narrative-is-authored-in-the-internal-app.md) exists to prevent, applied to people instead of photographs.

## Why the first rows are still seeded

There is no way around this. `data-model.md` gives Better Auth a `databaseHooks.user.create.before` hook that throws when an email has no `person` row, so **an uninvited Google account cannot create a user row at all**. That is the mechanism ADR-0003 relies on, and it means nobody can sign in to reach the People screen until a Person already exists.

So the bootstrap is a seeded row — the founding Staff — and nothing else. The seed exists to break the cycle, not as an ongoing channel. A Person added by editing SQL after that is a Person the screen did not validate.

## Why role is write-once

Not a policy — the database already enforces it, and nobody had written that down. `group_member`, `session_teacher`, `class_record`, `session_record`, `perjadin.pic_person_id` and `session.online_pic_person_id` all reference `person (id, role)`, the composite key that makes "the PIC is Staff" and "only Teaching Team taught a Stream" declarative rather than trigger code. None of the six declares `on update`, so they default to `NO ACTION` and Postgres refuses to change `person.role` the moment a Person has been on a trip, taught a Stream, filed a record or been named PIC of an online Session.

Adding `on update cascade` was considered and is wrong on its own terms. It would rewrite history — a past Perjadin would come to claim a Staff member taught a Stream — and it fails anyway on the row that matters most, because `session_teacher.person_role` is pinned to `'Teaching Team'` by a CHECK the cascade cannot satisfy.

**So a wrong role is corrected by revoking the row and creating a new Person.** The old row keeps every historical reference intact and truthful: that Perjadin really did carry them as Teaching Team. The People screen says role is fixed after first use rather than offering an edit that the database will reject.

## What this costs: the email index becomes partial

Revoke-and-re-add means two rows share an email, which the original `unique on (lower(email))` across all rows rejects. It becomes partial:

```sql
create unique index person_email_key on person (lower(email)) where active;
```

At most one **active** Person per email, any number of revoked ones — the same partial-index trick already holding `session_one_per_school_per_perjadin`. Two consequences worth stating:

- The sign-up hook's lookup becomes `where lower(email) = $1 and active`, and is unambiguous by construction rather than by convention.
- A revoked person who has **never signed in** can no longer create an account, because the hook finds nothing.

## Revocation needs a second mechanism, and it is the admin plugin

> **The problem stands; the answer is void.** A second mechanism is still needed, and this
> section's statement of why is untouched and still correct. What it reaches for is not: see
> [Amendment: revocation is one write, checked on every request](#amendment-revocation-is-one-write-checked-on-every-request).
> The section is kept because the amendment answers the problem it states, and because the last
> line of it is the argument the amendment rests on.

The point above is as far as `active = false` reaches on its own, and it is much less far than it looks. `databaseHooks.user.create.before` fires **before a user row is created** — Better Auth's own documentation files this hook under `signup_disabled`. A returning sign-in creates a _session_, not a user, so the hook never runs again. `data-model.md` was right that the invite list "gates signup, not merely authorisation"; the corollary nobody had drawn is that **anyone who has signed in once keeps signing in after being revoked.**

That was tolerable when the internal tool held only delivery records. It is not now: the invite list gates a Staff-only publishing surface that writes the public site.

So revocation goes through Better Auth's **admin plugin** — `/admin/ban-user` blocks sign-in and revokes existing sessions in one call, which is the library's supported answer rather than one we invent.

**`person.active` is authoritative; `banned` is its effect.** Revoking in the People screen sets `active = false` and bans in the same operation, and re-inviting reverses both. Every domain query reads `person.active` and nothing reads `banned`, which exists solely so Better Auth enforces a decision the domain made. One writer, one direction — and if the two ever disagree, `person.active` wins and the ban is re-applied. The alternative, letting the plugin own the fact, is exactly the coupling [ADR-0011](./0011-supabase-and-better-auth.md) chose Better Auth to avoid.

They are not two different states. `active = false` does not mean "off the Programme but still allowed to read" — that would be a third role, and [`product.md`](../product.md) says there are two.

## Consequences

> **The first three stand; the last three do not.** The plugin no longer joins the stack and
> brings no columns, and the cookie-cache bullet keeps its advice while losing its reason. See
> [Amendment: revocation is one write, checked on every request](#amendment-revocation-is-one-write-checked-on-every-request).

- One more screen in the internal tool, Staff-only for writes. Reads follow [ADR-0004](./0004-delivery-data-is-open-internally-money-is-not.md)'s open-delivery rule: anyone signed in can see the roster, because a Group is assembled from it.
- A migration to make `person_email_key` partial.
- The founding-Staff seed is a real artefact someone has to write and keep out of the reference-data seed, which is about fixed facts and re-run freely.
- Better Auth's admin plugin joins the stack. Revocation is now two writes in one operation instead of one.
- **It brings four columns, not one.** The plugin's schema adds `role`, `banned`, `banReason` and `banExpires` to `user`, plus `impersonatedBy` to `session` — verified against the 1.6.27 bundle, not inferred. Only `banned` is written by the domain, and none is read by it; the discipline above ("`person.active` is authoritative") extends to all four.

  **`role` is the one to watch.** The plugin registers its own `databaseHooks.user.create.before` writing `role: defaultRole ?? "user"` on every signup, so a column named `role` would otherwise sit on the identity table beside write-once `person.role` meaning something entirely different. It is **renamed** through the plugin's schema mapping so the collision cannot be read as intentional.

- **Revocation is immediate only while `session.cookieCache` stays disabled**, which is the default. `banUser` deletes session rows and the ban is enforced on `session.create.before`, but nothing checks `banned` per request — a cached session cookie is served without a database read for up to its `maxAge`. Enabling cookie caching for performance would silently reopen the hole this section exists to close, and the performance case is weak anyway: every request already resolves the Person in order to read `role`.

## Amendment: revocation is one write, checked on every request

**`person.active = false` is the whole mechanism.** Better Auth's admin plugin is dropped, and the ban with it. Decided while prototyping the People screen, and appended here rather than folded into the section above, because that section states the problem this one answers.

**Its problem statement is untouched and still correct.** `databaseHooks.user.create.before` fires before a `user` row is created; a returning sign-in creates a _session_ rather than a user, so the hook never runs again, and anyone who has signed in once keeps signing in after being revoked. A second mechanism is genuinely needed. It is simply a different one.

**What changes is the answer.** The plugin was chosen because nothing checked revocation _per request_. Something now does: **`requirePerson()` reads `person.active` on every request** and refuses when it is false. The argument for it is already in this ADR, in the last line of the section above — _"the performance case is weak anyway: every request already resolves the Person in order to read `role`."_ The row is being fetched regardless, so reading one more column off it costs nothing. It also satisfies this ADR's own discipline more directly than the ban did: _"every domain query reads `person.active` and nothing reads `banned`"_ is easiest to guarantee when the column does not exist.

### Three enforcement points, on one authority

`requirePerson()` on its own would let a revoked Person sign in successfully, take a cookie, and only be bounced afterwards — which is not what revocation should mean, and is the hole the plugin was bought to close. So the mechanism is three points rather than two, and all three read `person.active` and nothing else:

1. **`databaseHooks.user.create.before`** — refuses somebody with no active Person their first account. Unchanged: this is the invite gate [ADR-0003](./0003-google-sign-in-with-an-invite-list.md) rests on.
2. **`databaseHooks.session.create.before`** — refuses a revoked Person a new session, by the same `where lower(email) = $1 and active` lookup the invite hook uses. Needed because somebody who already has a `better_auth.user` row creates a session rather than a user, and so never reaches the first hook.
3. **`requirePerson()`** — refuses every request, including one made mid-session on a cookie already issued.

**The third point sits in two places, and the split is security-relevant.** The signed-in layout calls `requirePerson()`; that is the cheap outer gate, and it covers pages. `@sugt/db`'s choke point is the one that actually holds, because every query takes a `Caller` and constructing a `Person` caller requires an **active** Person. The distinction is load-bearing rather than pedantic: **a Next.js layout does not run before a Server Action.** The action runs before the layout re-renders, so a layout-only check protects reads and leaves every write open. The query layer is what closes that, which means the choke point now carries revocation as well as the Staff-only rule.

### What goes with the plugin

- **All four columns it adds** — `role`, `banned`, `banReason` and `banExpires` on `user`, plus `impersonatedBy` on `session`. They were this ADR's own reason to watch the plugin, and none of them is written or read by anything now.
- **The schema-mapping rename.** It existed solely to stop a second `role` sitting on the identity table beside write-once `person.role` meaning something else entirely. No plugin, no second `role`, nothing to rename.
- **The separate banned-rejection path.** Uninvited and revoked now fail identically — no matching active Person — instead of by two routes carrying one message.

Two of the [Consequences](#consequences) above go with it. The plugin no longer joins the stack, so revocation is **one write rather than two in one operation**; and the four columns are not added, so there is nothing for the discipline about them to govern. It follows that **there is no half-failed revocation** — one write cannot half-land — so the People screen has no partial state to design for.

### What changes rather than goes

**`session.cookieCache` stops being load-bearing for revocation.** The reasoning changes, not the setting. `person` is our table rather than Better Auth's, so resolving it is a fresh read whatever the session cache holds, and revocation is immediate by construction. Leaving the cookie cache off remains the default and remains fine — it is simply no longer the thing holding the property up, and turning it on would no longer reopen the hole.

**A revoked Person's session row survives until it expires.** Nothing deletes it, and nothing needs to: the next request re-reads `person.active` and is refused.

## Amendment (2026-10-12): People are added and revoked by an Administrator

"People are added in the tool" still holds, but by an **Administrator**, not any Staff member
([#470](https://github.com/sugt-itb/sugt-itb-26/issues/470)). Revoking is still one write,
`active = false`, and now refuses the Administrator's own row (`self`); deactivating another
Administrator is allowed. The role stays write-once.
