# The Unified Dashboard is a third reader, behind a short-lived JWT

The internal app now has a third kind of reader besides a signed-in Person and the public site: the
company's **Unified Dashboard**, which shows this Programme's summary to company leadership
([#503](https://github.com/sugt-itb/sugt-itb-26/issues/503)). It calls one route,
`GET /api/unified-dashboard/summary`, from its own backend, with a JWT it signs using a secret both
sides hold. It is not the public site's `ServiceCaller`. It gets its own arm in the `Caller` union,
`UnifiedDashboardCaller`, and reads aggregates only. Settled in a grilling session with the product
owner when the ticket was written.

## Why it is not the public site's reader

[ADR-0001](./0001-public-site-reads-aggregates-only.md) draws a line around the public site: it reads
aggregates, never narrative, and `ServiceCaller` _means_ the public site holding `AGGREGATES_SECRET`.
The Unified Dashboard has a different audience. It is **company leadership**, behind the Unified
Dashboard's own login, not anyone on the internet. Leadership may therefore see things the public
site may not. Next to this summary,
[#504](https://github.com/sugt-itb/sugt-itb-26/issues/504) adds the aggregate Participant Feedback
and Perjadin Evaluation averages, which ADR-0001 keeps off the public site.

Reusing `ServiceCaller` would join the two readers' rights. Any query opened to the Unified
Dashboard would be open to the public site too, and the line ADR-0001 draws would then be held by
nothing. So the new reader is a separate type. A query it may read **names `UnifiedDashboardCaller`
in its signature**, which is how every other read right in `@sugt/db` is held.

## What it may read

- **Aggregates only.** Programme-wide counts and percentages, each the same number the Dashboard
  (`/`) shows, from the same rows and the same derivation, so the two cannot disagree. The figures
  are shared, not reimplemented. The Dashboard's reads were split so that the money-free half,
  `programmeDelivery`, takes either caller, while the budget sum stays behind `monitoringData`,
  which takes a `Person` only.
- **No money.** The Dashboard's budget figure is not in the payload, and the arm cannot reach the
  query that reads it.
- **No narrative, no names, no per-response rows.** No Story, no Session Record, no comment and no
  Participant. #504's averages are aggregates in the same sense.

## How it authenticates

**An HS256 JWT over a shared secret, living five minutes at most.** The Unified Dashboard signs one
token per call, or reuses one for under five minutes, with `iss`, `aud`, `iat` and `exp`.
`authorizeUnifiedDashboard` in `@sugt/internal` verifies it:

- the algorithm is pinned to `HS256` and never taken from the token header, so `alg: none` and an
  algorithm swap are refused;
- `exp` and `iat` are required, and `exp` may be at most five minutes after `iat`;
- `iss` and `aud` must equal the configured values;
- the clocks may disagree by up to 30 seconds.

Every failure is a plain 401 and never a 500. A missing variable is a deploy without its
configuration, so that still throws.

The verification is **one function** returning the caller or `null`. The route never sees how the
token was checked, so moving to the Unified Dashboard's own issuer later (a JWKS, with RS256 or
ES256) is a change to that function alone.

## Considered options

- **A static bearer token, like `AGGREGATES_SECRET`.** The simplest. Rejected: the token would live
  forever, and anyone who saw one request could replay it indefinitely. The aggregates secret gets
  away with this because it guards what the public site already shows.
- **We issue tokens (client credentials).** The Unified Dashboard would exchange a client secret
  with us for a short-lived token. Rejected for now: it builds a token issuer here, with its own
  endpoint, rotation and revocation, to serve one caller.
- **Their JWKS (RS256/ES256).** The cleanest in the long run: no shared secret, and they rotate
  keys without telling us. Rejected for now because the Unified Dashboard does not publish one yet.
  It is the planned next step, and the one-function seam is there so it costs little.
- **HS256 over a shared secret, short-lived (chosen).** One secret to agree on, and a token that is
  worth minutes if it leaks: five, plus the 30 seconds of tolerated clock skew. Changing the secret rotates it and also switches the integration
  off.

## Consequences

- **Lihat Detail links do not bypass anything.** Each figure carries a `detailUrl` into this app,
  built from the app's own address. Following one is an ordinary visit: whoever follows it signs in
  and is checked by that page's own guard. Leadership need a Pimpinan row in `/orang`, or every link
  ends at a sign-in they cannot pass.
- **The route is a deliberate hole in the sign-in redirect**, listed in `proxy.ts` beside
  `/api/aggregates/**`. A caller with no cookie must get the route's 401, not a redirect to a
  sign-in page.
- **Fresh per request (`no-store`).** A cache would only let the summary disagree with `/`.
- **The payload carries a `version`**, under the aggregates rule: it is bumped only when a field is
  removed or retyped. #504 adds sections without a bump.
- **Three new variables**, `UNIFIED_DASHBOARD_JWT_SECRET`, `UNIFIED_DASHBOARD_JWT_ISSUER` and
  `UNIFIED_DASHBOARD_JWT_AUDIENCE`, are declared in `turbo.json` and listed in
  `docs/data-model.md`. The contract the other team builds against is
  [`docs/unified-dashboard-api.md`](../unified-dashboard-api.md).
