import type {
  DeliveryPayload,
  ScopePayload,
  StoriesPayload,
  StoryPayload,
} from "-/lib/aggregates-types";
import { requireEnv } from "-/lib/env";

/**
 * **Reading the four aggregates endpoints, the one way `@sugt/public` touches data.**
 *
 * The caching model is [ADR-0014](../../../../docs/adr/0014-the-public-site-uses-the-pre-cache-components-caching-model.md)'s:
 * route-segment `revalidate` plus the fetch Data Cache, with `cacheComponents` left unset. Each
 * payload carries its own lifetime here through `next.revalidate`, so the fastest-moving payload does
 * not drag the others — scope changes almost never, delivery accrues weekly, Stories when someone
 * writes one.
 *
 * **Two obligations of that ADR are code in this file, not configuration:**
 *
 * 1. **The wrapper throws on a non-2xx response.** `fetch` does not throw on a `500`; a bare fetch of
 *    a down origin would bake `undefined` into the HTML and build green — the exact screen ADR-0001
 *    calls worse than publishing nothing. Throwing during prerender fails the build (framework half,
 *    `prerenderEarlyExit`), and at runtime the last good payload keeps being served.
 * 2. **A payload `version` this app does not know throws.** The producer bumps a version when it
 *    removes or retypes a field; refusing the payload is how an older reader avoids rendering half of
 *    one. The expected versions live here, not in `@sugt/domain`, because a shared constant would make
 *    the check vacuous — the whole point is that the two sides can differ after one deploys first.
 *
 * The secret and base URL are read **at call time** through `requireEnv`, never at module scope: a
 * `const` at the top of the file is evaluated during `next build`, where the variable need not be set.
 */

/** Data Cache lifetimes, in seconds. Scope a day; delivery an hour; Stories an hour as a backstop behind on-demand revalidation. */
const ONE_DAY = 86_400;
const ONE_HOUR = 3_600;

/**
 * The version each payload is expected to carry. Hardcoded, not imported: the producer holds its own
 * copy, and the two differing after one app deploys first is the state the check exists to catch.
 */
const EXPECTED_VERSION = { scope: 1, delivery: 1, stories: 1, story: 1 } as const;

function aggregatesUrl(path: string): string {
  return `${requireEnv("INTERNAL_APP_URL")}${path}`;
}

function authorization(): { authorization: string } {
  return { authorization: `Bearer ${requireEnv("AGGREGATES_SECRET")}` };
}

/**
 * Fetch one aggregates payload, throwing on a bad status or an unknown version — the two ADR-0014
 * obligations. `revalidate` is the Data Cache lifetime for this payload.
 */
async function fetchPayload<T extends { version: number }>(
  path: string,
  revalidate: number,
  expectedVersion: number,
): Promise<T> {
  const response = await fetch(aggregatesUrl(path), {
    headers: authorization(),
    next: { revalidate },
  });
  if (!response.ok) {
    throw new Error(
      `Aggregates ${path} responded ${response.status}. The internal app is down or refused the secret.`,
    );
  }
  const payload = (await response.json()) as T;
  if (payload.version !== expectedVersion) {
    throw new Error(
      `Aggregates ${path} sent version ${payload.version}, but this build expects ${expectedVersion}. ` +
        "A field was removed or retyped and @sugt/public has not caught up — refuse the payload rather than render half of one.",
    );
  }
  return payload;
}

/** The scope payload: the four Clusters and all forty-seven Schools. Cached a day. */
export function getScope(): Promise<ScopePayload> {
  return fetchPayload<ScopePayload>("/api/aggregates/scope", ONE_DAY, EXPECTED_VERSION.scope);
}

/** The delivery payload: the delivered total and the per-Cluster split. Cached an hour. */
export function getDelivery(): Promise<DeliveryPayload> {
  return fetchPayload<DeliveryPayload>(
    "/api/aggregates/delivery",
    ONE_HOUR,
    EXPECTED_VERSION.delivery,
  );
}

/** The Stories list: every published Story, newest first, bodies excluded. Cached an hour. */
export function getStories(): Promise<StoriesPayload> {
  return fetchPayload<StoriesPayload>(
    "/api/aggregates/stories",
    ONE_HOUR,
    EXPECTED_VERSION.stories,
  );
}

/**
 * One published Story by slug, or `null` when the slug names none — a draft, a withdrawal, or a stale
 * link. **A 404 is `null`, not a thrown build failure**: an absent Story is an expected state the page
 * turns into a 404, unlike a down origin, which must still fail the build. Every other non-2xx throws,
 * and an unknown version throws, exactly as the list endpoints do.
 */
export async function getStory(slug: string): Promise<StoryPayload | null> {
  const response = await fetch(aggregatesUrl(`/api/aggregates/stories/${slug}`), {
    headers: authorization(),
    next: { revalidate: ONE_HOUR },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Aggregates story ${slug} responded ${response.status}. The internal app is down or refused the secret.`,
    );
  }
  const payload = (await response.json()) as StoryPayload;
  if (payload.version !== EXPECTED_VERSION.story) {
    throw new Error(
      `Aggregates story ${slug} sent version ${payload.version}, but this build expects ${EXPECTED_VERSION.story}.`,
    );
  }
  return payload;
}
