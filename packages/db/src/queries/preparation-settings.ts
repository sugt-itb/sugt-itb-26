import type { PreparationItemLevel } from "@sugt/domain";
import { and, desc, eq, gte } from "drizzle-orm";

import { db } from "../client";
import { cluster, subCluster } from "../schema/reference";
import { perjadin } from "../schema/travel";
import type { Person } from "./caller";
import { tripSchoolNames } from "./perjadin-naming";
import {
  loadChecklistCatalog,
  preparationChecklists,
  resolvePreparationChecklist,
  type ChecklistCatalog,
  type ChecklistPerjadin,
  type Executor,
} from "./preparation-checklist";
import type { PreparationScope } from "./preparation-items";
import { requireGrant } from "./staff-only";
import { WIB_TIME_ZONE } from "./today";

/**
 * **What Pengaturan Perjadin shows** (#422): the Preparation Checklist as it applies at one level,
 * read through the same resolver every Perjadin's list is (`./preparation-checklist.ts`), so the
 * screen can never show a list no Perjadin would get.
 *
 * - **Semua Perjadin** — the Semua items in force today.
 * - **Cluster** — what an unfinished Perjadin in that Cluster gets: the Semua items less the
 *   Cluster's hides, in its wording, then the Cluster's own items. It is resolved as a Perjadin of
 *   that Cluster ending today, which is exactly "not yet finished" (ADR-0045).
 * - **Perjadin** — that Perjadin's own list; for a finished one, its frozen list.
 *
 * Administrator only, like every write beneath it.
 */

/** One row of a level's list. */
export type PreparationSettingsItem = {
  itemId: string;
  /** The wording in force at this level. */
  label: string;
  /** Where the item is defined — the row's tag. */
  level: PreparationItemLevel;
  /** Defined at this level: Hapus removes it, Ubah rewords it everywhere, and it can be moved. */
  own: boolean;
  /**
   * The wording beneath this level's override, which "Kembalikan teks asal" restores; `null` when
   * this level has no override ("Diubah di sini" is not shown).
   */
  overriddenLabel: string | null;
  /** The system item: reworded, never removed or hidden (ADR-0045). */
  system: boolean;
  /**
   * How many unfinished Perjadins Hapus would take it from, at Semua or Cluster; `null` at Perjadin,
   * where the answer is always "this one".
   */
  reach: number | null;
};

/** A level's list, its hidden items and what the page needs to label them. */
export type PreparationSettings = {
  /** The Cluster at this level — the chosen one, or the Perjadin's — for the Cluster tag. */
  clusterName: string | null;
  /** At Perjadin level: the trip has ended, so only Perjadin-level changes still reach it. */
  finished: boolean;
  items: PreparationSettingsItem[];
  /** The wider items hidden at this level, each shown again with "Tampilkan lagi". */
  hidden: { itemId: string; label: string; level: PreparationItemLevel }[];
};

/** A level resolved: its list, and the catalog and trip it was resolved from. */
type LevelView = {
  trip: ChecklistPerjadin;
  catalog: ChecklistCatalog;
  items: ReturnType<typeof resolvePreparationChecklist>;
  clusterName: string | null;
  today: string;
};

/**
 * Today in WIB, as `YYYY-MM-DD` — the day every dated change is stamped with (`todayInWib`
 * in SQL), worked out here as `arrange-online-session.ts` does rather than asked of the database.
 */
function wibToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: WIB_TIME_ZONE }).format(new Date());
}

/**
 * Resolve one level, or `null` when its Cluster or Perjadin does not exist. Shared with the writes
 * that must compare against what a level shows (`./preparation-items.ts`), which read it inside
 * their own transaction — hence `executor`.
 */
export async function levelView(
  scope: PreparationScope,
  executor: Executor = db,
): Promise<LevelView | null> {
  const today = wibToday();

  let trip: ChecklistPerjadin;
  let clusterName: string | null = null;
  if (scope.level === "semua") {
    trip = { id: null, clusterId: null, endsOn: today };
  } else if (scope.level === "cluster") {
    const [row] = await executor
      .select({ name: cluster.name })
      .from(cluster)
      .where(eq(cluster.id, scope.clusterId));
    if (!row) return null;
    trip = { id: null, clusterId: scope.clusterId, endsOn: today };
    clusterName = row.name;
  } else {
    const [row] = await executor
      .select({
        clusterId: subCluster.clusterId,
        endsOn: perjadin.endsOn,
        clusterName: cluster.name,
      })
      .from(perjadin)
      .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
      .innerJoin(cluster, eq(cluster.id, subCluster.clusterId))
      .where(eq(perjadin.id, scope.perjadinId));
    if (!row) return null;
    trip = { id: scope.perjadinId, clusterId: row.clusterId, endsOn: row.endsOn };
    clusterName = row.clusterName;
  }

  const catalog = await loadChecklistCatalog(
    {
      clusterIds: trip.clusterId === null ? [] : [trip.clusterId],
      perjadinIds: trip.id === null ? [] : [trip.id],
    },
    executor,
  );
  const items = resolvePreparationChecklist(trip, catalog);
  return { trip, catalog, items, clusterName, today };
}

/** Is this level's own override row — a hide or a wording — on `row`? */
function atLevel(
  scope: PreparationScope,
  row: { clusterId: string | null; perjadinId: string | null },
): boolean {
  if (scope.level === "cluster") return row.clusterId === scope.clusterId;
  if (scope.level === "perjadin") return row.perjadinId === scope.perjadinId;
  return false;
}

/** The checklist at one level, for Pengaturan Perjadin; `null` when the level does not exist. */
export async function preparationSettings(
  caller: Person,
  scope: PreparationScope,
): Promise<PreparationSettings | null> {
  requireGrant(caller, "Administrator");

  const view = await levelView(scope);
  if (!view) return null;
  const { trip, catalog, items, today } = view;

  // The same level without its own overrides: what is hidden here is what that list has and this
  // one lacks, and an override's wording is what that list says.
  const beneath = resolvePreparationChecklist(trip, {
    ...catalog,
    hides: catalog.hides.filter((hide) => !atLevel(scope, hide)),
    wordings: catalog.wordings.filter((wording) => !atLevel(scope, wording)),
  });
  const beneathLabel = new Map(beneath.map((item) => [item.itemId, item.label]));
  const shown = new Set(items.map((item) => item.itemId));
  const reworded = new Set(
    catalog.wordings
      .filter((wording) => atLevel(scope, wording))
      .map((wording) => wording.preparationItemId),
  );

  const reach = scope.level === "perjadin" ? null : await reachOf(scope, today);

  return {
    clusterName: view.clusterName,
    finished: trip.endsOn < today,
    items: items.map((item) => ({
      itemId: item.itemId,
      label: item.label,
      level: item.level,
      own: item.level === scope.level,
      overriddenLabel: reworded.has(item.itemId) ? (beneathLabel.get(item.itemId) ?? null) : null,
      system: item.clearsOnTeachingTeamChange,
      reach: reach === null ? null : (reach.get(item.itemId) ?? 0),
    })),
    hidden: beneath
      .filter((item) => !shown.has(item.itemId))
      .map((item) => ({ itemId: item.itemId, label: item.label, level: item.level })),
  };
}

/**
 * For each item, how many unfinished Perjadins — every one, or the Cluster's — have it on their list
 * now: what removing or hiding it at Semua or Cluster takes it from. Counted off their resolved
 * lists, so a Perjadin that has hidden the item already is not counted.
 */
async function reachOf(
  scope: Exclude<PreparationScope, { level: "perjadin" }>,
  today: string,
): Promise<Map<string, number>> {
  const unfinished = await db
    .select({ id: perjadin.id })
    .from(perjadin)
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(
      and(
        gte(perjadin.endsOn, today),
        scope.level === "cluster" ? eq(subCluster.clusterId, scope.clusterId) : undefined,
      ),
    );

  const counts = new Map<string, number>();
  const lists = await preparationChecklists(unfinished.map((trip) => trip.id));
  for (const list of lists.values()) {
    for (const item of list) counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + 1);
  }
  return counts;
}

/** One Perjadin, as the Perjadin picker on Pengaturan Perjadin labels it. */
export type PreparationSettingsPerjadin = {
  id: string;
  subClusterName: string;
  startsOn: string;
  endsOn: string;
  schoolNames: string[];
};

/** Every Perjadin, newest trip first — `perjadinDirectory`'s order — for the Perjadin picker. */
export async function preparationSettingsPerjadins(
  caller: Person,
): Promise<PreparationSettingsPerjadin[]> {
  requireGrant(caller, "Administrator");
  return db
    .select({
      id: perjadin.id,
      subClusterName: subCluster.name,
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      schoolNames: tripSchoolNames(perjadin.id),
    })
    .from(perjadin)
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .orderBy(desc(perjadin.startsOn), desc(perjadin.id));
}

/** The four Clusters, by name, for the Cluster picker. */
export async function preparationSettingsClusters(
  caller: Person,
): Promise<{ id: string; name: string }[]> {
  requireGrant(caller, "Administrator");
  return db.select({ id: cluster.id, name: cluster.name }).from(cluster).orderBy(cluster.name);
}
