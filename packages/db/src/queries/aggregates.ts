import type { StoryKind, Stream } from "@sugt/domain";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../client";
import { session } from "../schema/delivery";
import { cluster, province, school } from "../schema/reference";
import { story, storyPhoto } from "../schema/stories";
import type { ServiceCaller } from "./caller";
import { deliveredSessionCount, onDeliveredSessions } from "./delivered-sessions";

/**
 * **The aggregates** — the four payloads `@sugt/public` reads, and the one part of the query layer
 * whose caller is the [`ServiceCaller`](./caller.ts) arm rather than a `Person`. There is no
 * Staff-only choke point here and no role check: the arm *is* the check, and the shared-secret gate
 * that produces it lives in `@sugt/internal`'s route handlers, which is the only place a
 * `ServiceCaller` is ever minted (`docs/adr/0008-…`).
 *
 * **These four functions sit in one module, against the one-function-per-surface grain**, because
 * they are not four internal screens — they are one external contract with four payloads split by
 * lifetime (ADR-0008's endpoint contract: scope changes ~never, delivery accrues weekly, Stories
 * when someone writes one, and the Story detail shares the Stories lifetime). Keeping them together
 * is what lets delivery reuse Coverage's delivered-Session rule from `./delivered-sessions.ts`
 * rather than restate it.
 *
 * **Photographs leave here as storage paths, not URLs.** Turning a `storage_path` into a full public
 * URL needs `SUPABASE_URL`, which is `@sugt/internal`'s environment and not this package's — so the
 * route handler does it at the edge, exactly as `apps/internal/.../cerita` pages already do. The
 * `version` integer each payload carries is stamped there too, for the same reason: it is a fact
 * about the wire contract, not about the database.
 */

/** One of the four Clusters, with the Topic it works on and the Problem it addresses. */
export type ScopeCluster = {
  id: string;
  slug: string;
  name: string;
  topic: string;
  problem: string;
};

/**
 * One School with where it is and which Cluster it belongs to. **No count travels beside this
 * list** — `47 Sekolah · 16 provinsi` is `schools.length` and the number of distinct
 * `provinceCode`s, derived by the reader, never a figure sent alongside that could disagree with
 * the list it summarises.
 */
export type ScopeSchool = {
  id: string;
  slug: string;
  name: string;
  kabupatenKota: string;
  provinceCode: string;
  provinceName: string;
  clusterId: string;
  clusterSlug: string;
};

/** The scope payload's data: the four Clusters and all forty-seven Schools. */
export type ScopeData = {
  clusters: ScopeCluster[];
  schools: ScopeSchool[];
};

/** One Cluster's delivered-Session count. **Per Cluster, never per School** — no public surface needs a School's own figure, so none is exposed here. */
export type ClusterDelivery = {
  clusterId: string;
  clusterSlug: string;
  delivered: number;
};

/**
 * The delivery payload's data: the delivered total and the same figure split by Cluster.
 *
 * **No denominator travels.** Total possible Sessions is `TOTAL_SESSIONS_PER_SCHOOL` in
 * `@sugt/domain` times the School count the scope payload already carries, computed by the reader —
 * the same reasoning `./delivered-sessions.ts` gives for keeping the denominator out of Coverage.
 * Arranged and cancelled Sessions count for nothing, by that module's rule.
 */
export type DeliveryData = {
  deliveredTotal: number;
  perCluster: ClusterDelivery[];
};

/**
 * A row in the public Stories list. **It has no `body` field**, so "the list carries no bodies" is
 * structural rather than a rule the route has to remember to strip — the same move
 * `story-photo-url.ts` makes. `excerpt` is a plain-text lead derived from the body here, so the body
 * itself never leaves this function.
 */
export type StoryListItem = {
  slug: string;
  title: string;
  kind: StoryKind;
  stream: Stream | null;
  /** The cover's storage path, or `null` for a Story with no cover. The route turns it into a URL. */
  coverPhotoPath: string | null;
  excerpt: string;
};

/** One photograph in a Story's gallery, as a storage path the route turns into a URL. */
export type StoryGalleryPhoto = {
  storagePath: string;
  caption: string | null;
};

/** One published Story with its body and ordered gallery — the detail payload's data. */
export type StoryDetailData = {
  slug: string;
  title: string;
  kind: StoryKind;
  stream: Stream | null;
  body: string;
  /** The cover's storage path, or `null`. Carried so the detail page can feature it; the gallery still lists every photograph. */
  coverPhotoPath: string | null;
  gallery: StoryGalleryPhoto[];
};

/** How long an excerpt runs before it is cut at a word boundary and given an ellipsis. */
const EXCERPT_MAX = 200;

/**
 * A plain-text lead from a Story's Markdown body. Not a rendering and not reversible: it strips the
 * commonest Markdown so a heading's `#` or a link's URL does not surface in a one-line teaser, then
 * cuts to `EXCERPT_MAX` at the last whole word. The public list shows it under the title; the body
 * travels only on the detail route.
 */
function excerptOf(body: string): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= EXCERPT_MAX) return text;
  const cut = text.slice(0, EXCERPT_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The scope payload: the four Clusters, and all forty-seven Schools with province and Cluster. Two
 * queries because the two lists are independent — a Cluster fold like Coverage's would only nest
 * one inside the other, and the public Cluster and School pages want them flat.
 */
export async function scope(_caller: ServiceCaller): Promise<ScopeData> {
  const clusters = await db
    .select({
      id: cluster.id,
      slug: cluster.slug,
      name: cluster.name,
      topic: cluster.topic,
      problem: cluster.problem,
    })
    .from(cluster)
    .orderBy(asc(cluster.name), asc(cluster.id));

  const schools = await db
    .select({
      id: school.id,
      slug: school.slug,
      name: school.name,
      kabupatenKota: school.kabupatenKota,
      provinceCode: province.code,
      provinceName: province.name,
      clusterId: cluster.id,
      clusterSlug: cluster.slug,
    })
    .from(school)
    // Both inner: `province_code` and `cluster_id` are NOT NULL, so neither is ever a School with
    // no Province or no Cluster to render.
    .innerJoin(province, eq(province.code, school.provinceCode))
    .innerJoin(cluster, eq(cluster.id, school.clusterId))
    .orderBy(asc(school.name), asc(school.id));

  return { clusters, schools };
}

/**
 * The delivery payload: the delivered total and the delivered count per Cluster. One query grouped
 * by Cluster; the total is the sum of those counts, which is exact because every delivered Session's
 * School has a Cluster (`school.cluster_id` is NOT NULL).
 */
export async function delivery(_caller: ServiceCaller): Promise<DeliveryData> {
  const perCluster = await db
    .select({
      clusterId: cluster.id,
      clusterSlug: cluster.slug,
      delivered: deliveredSessionCount,
    })
    .from(cluster)
    .innerJoin(school, eq(school.clusterId, cluster.id))
    // The delivered filter is in the JOIN, not a WHERE, so a Cluster that has delivered nothing
    // still appears at zero rather than dropping out — the reason `./delivered-sessions.ts` gives.
    .leftJoin(session, onDeliveredSessions)
    .groupBy(cluster.id)
    .orderBy(asc(cluster.name), asc(cluster.id));

  const deliveredTotal = perCluster.reduce((sum, row) => sum + row.delivered, 0);
  return { deliveredTotal, perCluster };
}

/**
 * The Stories list: every **published** Story, newest first, with its cover path and an excerpt but
 * no body. A draft — `published_at` NULL — never appears, which is what a withdrawal (clearing
 * `published_at`) removes it from.
 */
export async function publishedStories(_caller: ServiceCaller): Promise<StoryListItem[]> {
  const cover = alias(storyPhoto, "cover");
  const rows = await db
    .select({
      slug: story.slug,
      title: story.title,
      kind: story.kind,
      stream: story.stream,
      coverPhotoPath: cover.storagePath,
      body: story.body,
    })
    .from(story)
    .leftJoin(cover, eq(cover.id, story.coverPhotoId))
    .where(isNotNull(story.publishedAt))
    .orderBy(desc(story.publishedAt), asc(story.id));

  return rows.map(({ body, ...row }) => ({ ...row, excerpt: excerptOf(body) }));
}

/**
 * One published Story by slug: its body and its gallery, ordered the way the editor and schema fix
 * it — by `uploaded_at`, tie-broken by `id`. `null` when the slug names no Story or names a draft,
 * which the route turns into a 404 so a withdrawn Story stops resolving.
 */
export async function publishedStory(
  _caller: ServiceCaller,
  slug: string,
): Promise<StoryDetailData | null> {
  const cover = alias(storyPhoto, "cover");
  const [row] = await db
    .select({
      id: story.id,
      slug: story.slug,
      title: story.title,
      kind: story.kind,
      stream: story.stream,
      body: story.body,
      coverPhotoPath: cover.storagePath,
    })
    .from(story)
    .leftJoin(cover, eq(cover.id, story.coverPhotoId))
    .where(and(eq(story.slug, slug), isNotNull(story.publishedAt)));
  if (!row) return null;

  const gallery = await db
    .select({ storagePath: storyPhoto.storagePath, caption: storyPhoto.caption })
    .from(storyPhoto)
    .where(eq(storyPhoto.storyId, row.id))
    .orderBy(asc(storyPhoto.uploadedAt), asc(storyPhoto.id));

  const { id: _id, ...detail } = row;
  return { ...detail, gallery };
}
