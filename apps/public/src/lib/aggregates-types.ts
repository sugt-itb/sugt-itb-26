import type { StoryKind, Stream } from "@sugt/domain";

/**
 * **The four aggregates payloads, retyped on the reader's side.**
 *
 * The producer's types live in `@sugt/db`/`@sugt/internal` (`apps/internal/src/lib/aggregates.ts`),
 * which this app **cannot** import — `@sugt/public` never declares `@sugt/db` (AGENTS.md rule 1,
 * made a fact by pnpm's strict `node_modules`). So the wire shapes are declared again here. They are
 * small, and the `version` field is exactly the guard against the two copies drifting: a producer
 * that removes or retypes a field bumps the version, and `./aggregates.ts` refuses a payload whose
 * version it does not know. A retype without a bump is the bug the check is there to catch.
 *
 * `StoryKind` and `Stream` come from `@sugt/domain` (a dependency this app *may* declare) so those
 * two unions stay in lockstep with their single source of truth rather than being re-spelled here.
 *
 * **Photographs arrive as full public URLs**, not storage paths: the producer resolves them at its
 * edge with `SUPABASE_URL`, which is `@sugt/internal`'s environment. So the fields here are `coverUrl`
 * and `gallery[].url`, never the `coverPhotoPath` the database query returns.
 */

/** One of the four Clusters, with the Topic it works on and the Problem it addresses. */
export type ScopeCluster = {
  id: string;
  slug: string;
  name: string;
  topic: string;
  problem: string;
};

/** One School with where it is and which Cluster it belongs to. */
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

/** The scope payload: the four Clusters and all forty-seven Schools, each stamped with a version. */
export type ScopePayload = {
  version: number;
  clusters: ScopeCluster[];
  schools: ScopeSchool[];
};

/** One Cluster's delivered-Session count. Per Cluster, never per School — no public surface shows a School's own figure. */
export type ClusterDelivery = {
  clusterId: string;
  clusterSlug: string;
  delivered: number;
};

/** The delivery payload: the delivered total and the same figure split by Cluster. No denominator travels — the reader derives it. */
export type DeliveryPayload = {
  version: number;
  deliveredTotal: number;
  perCluster: ClusterDelivery[];
};

/** A row in the public Stories list: cover as a URL, an excerpt, and **no body** (the body travels only on the detail route). */
export type StoryListItem = {
  slug: string;
  title: string;
  kind: StoryKind;
  stream: Stream | null;
  coverUrl: string | null;
  excerpt: string;
};

/** The Stories-list payload. */
export type StoriesPayload = {
  version: number;
  stories: StoryListItem[];
};

/** One photograph in a Story's gallery, as a public URL and its caption. */
export type StoryGalleryPhoto = {
  url: string;
  caption: string | null;
};

/** One published Story with its Markdown body and ordered gallery — the detail payload. */
export type StoryPayload = {
  version: number;
  slug: string;
  title: string;
  kind: StoryKind;
  stream: Stream | null;
  body: string;
  coverUrl: string | null;
  gallery: StoryGalleryPhoto[];
};
