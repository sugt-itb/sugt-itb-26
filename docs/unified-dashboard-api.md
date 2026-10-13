# Unified Dashboard summary API

The contract between this Programme's internal app (`@sugt/internal`) and the company's **Unified
Dashboard**. The route serves the Programme's summary, for the Unified Dashboard to show to company
leadership. Why it exists, and why it is shaped this way, is in
[ADR-0057](./adr/0057-the-unified-dashboard-is-a-third-reader.md). This document describes what you
build against.

## The route

```
GET {INTERNAL_APP_URL}/api/unified-dashboard/summary
Authorization: Bearer <JWT>
```

- **Programme-wide.** It takes no query parameters and no filters.
- **Fresh on every request.** The response carries `Cache-Control: no-store`, and every figure is
  computed at request time. Don't cache it for longer than you would show a stale number to
  leadership.
- **Server to server only.** The route sends no CORS headers, so a browser cannot call it. Call it
  from your backend, which is the only place the secret may live.
- **Any authentication failure is `401 Unauthorized`** with no detail in the body. That covers a
  missing header, a bad signature, an expired token, wrong claims, or something that is not a token
  at all. The response does not say which.

## Authentication

Sign a JWT with **HS256** using the shared secret, and send it as `Authorization: Bearer <token>`.

| Claim | Required | Rule                                                            |
| ----- | -------- | --------------------------------------------------------------- |
| `iss` | yes      | equals the issuer we agreed with you (e.g. `unified-dashboard`) |
| `aud` | yes      | equals the audience we agreed with you (e.g. `sugt-internal`)   |
| `iat` | yes      | when you signed it, in seconds; not in the future               |
| `exp` | yes      | at most **5 minutes** after `iat`                               |

- **The algorithm must be `HS256`.** We do not read the algorithm from the token header, and we
  refuse `alg: none`.
- **A token may live 5 minutes at most.** We refuse a token whose `exp` is more than five minutes
  after its `iat`, even if it has not expired. Sign one per call, or reuse one for under five
  minutes.
- **Clocks.** We allow 30 seconds of skew. Keep your server's clock NTP-synced.

For example, with `jose` in Node:

```ts
const token = await new SignJWT({})
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setIssuer("unified-dashboard")
  .setAudience("sugt-internal")
  .setIssuedAt()
  .setExpirationTime("5m")
  .sign(new TextEncoder().encode(process.env.SUGT_JWT_SECRET));
```

## The payload

```jsonc
{
  "version": 1,
  "generatedAt": "2026-10-13T08:00:00.000Z",
  "progress": {
    "detailUrl": "https://internal.sugtitb.com/",
    "kegiatanTerlaksana": { "percent": 42, "completed": 198, "total": 470 },
    "pretest": 61,
    "daring": 38,
    "luring": 50,
    "posttest": 0,
  },
  "sessions": {
    "offline": {
      "delivered": 47,
      "total": 94,
      "detailUrl": "https://internal.sugtitb.com/perjadin",
    },
    "online": {
      "delivered": 107,
      "total": 282,
      "detailUrl": "https://internal.sugtitb.com/sesi-daring",
    },
    "pretest": { "completed": 115, "total": 188, "detailUrl": "https://internal.sugtitb.com/" },
    "posttest": { "completed": 0, "total": 188, "detailUrl": "https://internal.sugtitb.com/" },
  },
}
```

**Every number is the number the internal app's own Dashboard (`/`) shows**, from the same data and
the same calculation. Percentages are whole numbers, rounded half up. Each count sits on the same
grain as its percentage, so `count / total`, rounded, reproduces the percentage beside it. With no
Schools at all, every count, total and percentage is `0`.

| Field                           | Meaning                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                       | The payload's version. See [Versions](#versions).                                                                                                                                   |
| `generatedAt`                   | When this response was computed, as an ISO 8601 UTC timestamp.                                                                                                                      |
| `progress.detailUrl`            | The internal Dashboard, where every figure below is shown.                                                                                                                          |
| `progress.kegiatanTerlaksana`   | **Activities done.** Each School has 10 units: 8 Sessions, a Pretest unit and a Posttest unit. `completed` is delivered Sessions plus completed units, and `total` is Schools × 10. |
| `progress.pretest` / `posttest` | The percentage of Pretest (or Posttest) boxes ticked. Each School has 4 boxes: 2 streams × 2 participant types. Posttest is an honest `0` until posttests are recorded.             |
| `progress.daring` / `luring`    | The percentage of the online (Daring) or offline (Luring) Sessions planned that have been delivered.                                                                                |
| `sessions.offline`              | `delivered` offline Sessions over `total`, which is the full plan: Schools × 2. It is not the number arranged so far. Reproduces `progress.luring`.                                 |
| `sessions.online`               | `delivered` online Sessions over `total`, which is Schools × 6. Reproduces `progress.daring`.                                                                                       |
| `sessions.pretest` / `posttest` | Ticked boxes, `completed`, over Schools × 4. Named `completed` rather than `delivered` because a Pretest is not a Session. Reproduces `progress.pretest` / `progress.posttest`.     |
| `detailUrl` (every one)         | Where **Lihat Detail** goes, built from the internal app's own address, so staging links to staging.                                                                                |

A Pretest unit in `kegiatanTerlaksana` counts only when **all four** of a School's Pretest boxes are
ticked. The `pretest` percentage counts **boxes**. A School with three of four boxes ticked adds 3 to
`sessions.pretest.completed` and nothing to `kegiatanTerlaksana.completed`.

The payload carries **no money**, **no names**, **no comments** and **no per-School rows**.

### Versions

`version` changes only when a field is **removed or retyped**. **Adding a field does not change
it.** The Participant Feedback and Perjadin Evaluation averages
([#504](https://github.com/sugt-itb/sugt-itb-26/issues/504)) arrive as new fields at version 1.
Therefore:

- **Refuse a version you do not know** rather than render half a payload.
- **Ignore fields you do not know.**

### `null`

No field in version 1 is ever `null`. The averages #504 adds can be `null`, meaning nothing has
been rated yet. **Render `null` as "—", never as 0.**

## Lihat Detail

Render each `detailUrl` as a plain link that opens in a new tab. Following one is an ordinary visit
to the internal app:

- a signed-out visitor signs in with Google and lands on the linked page;
- that page's own access rules apply.

Leadership need a **Pimpinan** account in the internal app, or every link ends at a sign-in they
cannot pass. A Pimpinan can read `/`, `/perjadin`, `/sesi-daring` and `/feedback`.

## Handover

**On the internal app's side, once deployed:**

1. Generate the secret: `openssl rand -base64 48`.
2. Set `UNIFIED_DASHBOARD_JWT_SECRET`, `UNIFIED_DASHBOARD_JWT_ISSUER` and
   `UNIFIED_DASHBOARD_JWT_AUDIENCE` in production, and in staging with a **different** secret.
3. Agree `iss` and `aud` with the Unified Dashboard's developer. Share the secret through a password
   manager or a one-time-secret link, never by chat, email or an issue.
4. Have an Administrator add leadership's Google accounts as **Pimpinan** in `/orang`.
5. Smoke-test with the Postman CLI:
   - a freshly signed token returns 200;
   - a token signed with the wrong secret, an expired token and a token with the wrong `aud` each
     return 401.
6. The secret can live indefinitely. Rotate it after a leak or when someone who held it leaves.
   Changing it is also the off switch.

**On the Unified Dashboard's side:**

1. Keep the secret **server-side only**. Sign the token and call the API from your backend.
2. Sign `HS256` with `iss`, `aud`, `iat` and `exp ≤ iat + 5 min`, per call or reused for under five
   minutes. Keep the server clock NTP-synced.
3. Check `version`, and refuse one you do not know.
4. Render `null` as "—", never as 0.
5. Render Lihat Detail as a plain link to `detailUrl`, opened in a new tab.
