import { first, uuidOrNull } from "-/lib/search-params";
import type { PreparationScope } from "@sugt/db/queries";

/** The level Pengaturan Perjadin is editing, as its URL names it. */
export type LevelChoice =
  | { level: "semua" }
  | { level: "cluster"; clusterId: string | null }
  | { level: "perjadin"; perjadinId: string | null };

/** `/perjadin/pengaturan`'s query string as Next hands it over. */
export type LevelSearchParams = Record<string, string | string[] | undefined>;

/**
 * **The level the URL asks for** (`?tingkat=semua|cluster|perjadin&cluster=&perjadin=`), so a level
 * can be bookmarked and survives a reload. Anything malformed is dropped rather than refused: an
 * unknown `tingkat` is Semua, a Cluster that is not one of `clusterIds` is the first Cluster, and a
 * Perjadin id that is not a UUID is none chosen yet.
 */
export function parseLevelParams(params: LevelSearchParams, clusterIds: string[]): LevelChoice {
  const tingkat = first(params.tingkat);
  if (tingkat === "cluster") {
    const clusterId = first(params.cluster);
    return {
      level: "cluster",
      clusterId: clusterId && clusterIds.includes(clusterId) ? clusterId : (clusterIds[0] ?? null),
    };
  }
  if (tingkat === "perjadin") {
    return { level: "perjadin", perjadinId: uuidOrNull(first(params.perjadin)) };
  }
  return { level: "semua" };
}

/** The level to read, or `null` while a Cluster or Perjadin is still to be chosen. */
export function scopeOf(choice: LevelChoice): PreparationScope | null {
  if (choice.level === "cluster") {
    return choice.clusterId === null ? null : { level: "cluster", clusterId: choice.clusterId };
  }
  if (choice.level === "perjadin") {
    return choice.perjadinId === null ? null : { level: "perjadin", perjadinId: choice.perjadinId };
  }
  return { level: "semua" };
}

/** The `/perjadin/pengaturan` URL for a level, carrying only what it needs. */
export function levelHref(choice: LevelChoice): string {
  const query = new URLSearchParams();
  if (choice.level !== "semua") query.set("tingkat", choice.level);
  if (choice.level === "cluster" && choice.clusterId) query.set("cluster", choice.clusterId);
  if (choice.level === "perjadin" && choice.perjadinId) query.set("perjadin", choice.perjadinId);
  const search = query.toString();
  return search ? `/perjadin/pengaturan?${search}` : "/perjadin/pengaturan";
}
