import type {
  DeliveryPayload,
  ScopeCluster,
  ScopePayload,
  ScopeSchool,
} from "-/lib/aggregates-types";
import { TOTAL_SESSIONS_PER_SCHOOL } from "@sugt/domain";

/**
 * **The figures the site derives rather than fetches.**
 *
 * `docs/product.md` is emphatic that a count never travels beside the list it summarises: `47 Sekolah`
 * is `schools.length`, `16 provinsi` is the number of distinct Provinces among them, and the delivery
 * denominator is `10 × schools.length` — each computed by the reader so it can never disagree with the
 * data it describes. These are the pure helpers that do that computing.
 */

/** How many distinct Provinces the Schools span — the `16 provinsi` beside `47 Sekolah`. */
export function provinceCount(schools: ScopeSchool[]): number {
  return new Set(schools.map((school) => school.provinceCode)).size;
}

/**
 * The total possible Sessions across every School — the denominator delivery is reported against.
 * `TOTAL_SESSIONS_PER_SCHOOL` is a `@sugt/domain` constant, not a figure on the wire, for the reason
 * `./aggregates-types.ts` gives: a fixed set sent twice is a duplication waiting to drift.
 */
export function deliveryDenominator(schoolCount: number): number {
  return TOTAL_SESSIONS_PER_SCHOOL * schoolCount;
}

/**
 * **Whether there is any delivery to report yet.** The delivery band renders only when this is true,
 * so launch day shows scope with no `0 Sesi terlaksana` gap — the screen ADR-0001 names as worse than
 * publishing nothing. It is computed from the payload, never read off a boolean flag that could
 * disagree with the number beside it.
 */
export function hasDelivery(delivery: DeliveryPayload): boolean {
  return delivery.deliveredTotal > 0;
}

/** One Cluster with the two figures the list and detail surfaces show beside it. */
export type ClusterFigures = {
  cluster: ScopeCluster;
  schoolCount: number;
  delivered: number;
};

/**
 * **Join scope and delivery into per-Cluster figures.** The scope payload has the Clusters and their
 * Schools; the delivery payload has the delivered count per Cluster (zero for a Cluster that has
 * delivered nothing, which the producer keeps in the list rather than dropping). This pairs them by
 * slug so a card can show both without either surface re-counting — the derivation lives once here.
 * Clusters come back in the scope payload's order.
 */
export function clusterFigures(scope: ScopePayload, delivery: DeliveryPayload): ClusterFigures[] {
  const deliveredBySlug = new Map(
    delivery.perCluster.map((entry) => [entry.clusterSlug, entry.delivered]),
  );
  const schoolCountBySlug = new Map<string, number>();
  for (const school of scope.schools) {
    schoolCountBySlug.set(school.clusterSlug, (schoolCountBySlug.get(school.clusterSlug) ?? 0) + 1);
  }
  return scope.clusters.map((cluster) => ({
    cluster,
    schoolCount: schoolCountBySlug.get(cluster.slug) ?? 0,
    delivered: deliveredBySlug.get(cluster.slug) ?? 0,
  }));
}
