# Dashboard read is gated by a grant; a Pimpinan reads it by role

Reading the **Dashboard** (`/`) in `@sugt/internal` now **needs a grant**. Only these reach it:

- a **`Pimpinan`** — by Role, holding no Grant (the Dashboard is their home,
  [ADR-0025](./0025-pimpinan-is-a-second-signed-in-read-only-person-role.md));
- a **`Staff`** Person holding **`Editor`** or **`Dashboard Viewer`** (an **`Administrator`** implies
  both, [ADR-0028](./0028-grants-are-a-second-additive-access-axis.md)).

A **grant-less Staff** Person who visits `/` is **redirected to `/pendamping`** (server-side, HTTP 307) — the mirror of the existing `/pendamping → /` redirect a Pimpinan gets. This qualifies the
"reading is open to any signed-in Person" boundary that
[ADR-0026](./0026-money-is-open-to-read-and-staff-only-to-write.md) drew: the Dashboard is now the
**documented exception** where a read needs a grant.

## Why

The Dashboard is the Programme overview — delivery progress and budget across every Cluster. It is
the right landing surface for leadership (Pimpinan) and for the Staff who steer the Programme
(Administrators, Editors, and now read-only Dashboard Viewers), but it is **not** the working surface
for a Staff Person who only accompanies delivery: their home is `/pendamping`. Leaving `/` open to
every signed-in Person put the overview in front of Staff who have no reason to read it and no grant
saying they should.

The **`Dashboard Viewer`** Grant ([#321](https://github.com/sugt-itb/sugt-itb-26/issues/321)) exists
precisely to name "may read the Dashboard, and nothing more" for a Staff Person who is neither an
Administrator nor an Editor. With that vocabulary in place, gating the read is a one-predicate change.

## The predicate, in one place

Both the page guard and the sidebar's Dashboard link read the **same** predicate — never duplicated,
so a link is shown exactly when the page is reachable:

```ts
export function canViewDashboard(person: Person): boolean {
  if (person.role === "Pimpinan") return true; // by Role, not a Grant
  return hasGrant(person, "Editor") || hasGrant(person, "Dashboard Viewer");
}
```

It lives beside `hasGrant` in `@sugt/db` (`packages/db/src/queries/staff-only.ts`), the one module
both the `/` page and the app layout already import from. `hasGrant` folds in "Administrator implies
every Grant", so the two grant calls cover all of `{Administrator, Editor, Dashboard Viewer}` without
naming Administrator.

## Redirect, not 403

A grant-less Staff at `/` gets `redirect("/pendamping")`, **not** `forbidden()`. The redirect changes
the address bar to `/pendamping` — the requested behaviour, and the mirror of the Pimpinan redirect —
whereas a 403 would keep `/` in the bar and render an error. The redirect is **conditional**: a Staff
holding any of the three grants passes the predicate and renders `/` with no redirect.

## What stays intact

- **Grants stay Staff-only** (ADR-0028). A Pimpinan holds no Grant; their Dashboard access is the
  Role branch of the predicate, not a grant. This ADR does not put a Grant on a Pimpinan.
- **The `/pendamping → /` Pimpinan redirect** and the **sign-in landing** (Staff → `/pendamping`,
  Pimpinan → `/`) are unchanged.
- **Money stays read-open elsewhere** (ADR-0026). A grant-less Staff simply no longer reaches the
  Dashboard budget card; every other money-read surface is unaffected. This is a Dashboard-read
  exception, not a reversal of the money-read rule.

## Consequences

- The Dashboard page and the sidebar agree by construction — a link that would bounce is never shown,
  a link that works is never hidden.
- A Staff Person's Dashboard access is now an Administrator's decision (grant `Dashboard Viewer` or
  `Editor`), revocable like any Grant, rather than a property of merely being signed in.
