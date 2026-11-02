import type { PreparationItemLevel } from "@sugt/domain";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "../client";
import { person } from "../schema/people";
import { subCluster } from "../schema/reference";
import { perjadin, preparationItem } from "../schema/travel";
import type { Person } from "./caller";
import { tripSchoolNames } from "./perjadin-naming";
import { preparationChecklists, type PreparationItem } from "./preparation-checklist";

/**
 * **One week of Preparation Checklists** (#423) — what the Dashboard's Persiapan Luring tab reads:
 * the Perjadins of a Monday–Saturday week, each with its resolved checklist, and the defining
 * wording of every item on them. Read-only; it is folded into the figures by
 * `persiapan-luring-derive.ts` in `@sugt/internal`.
 *
 * **A Perjadin belongs to the week its `starts_on` falls in**, and one starting on a Sunday to the
 * week that follows. So the week of Monday M holds the trips starting from M − 1 (the Sunday) through
 * M + 5 (the Saturday) — exactly one week per trip. The caller passes those two dates.
 *
 * Seven selects whatever the week holds: the trips, `preparationChecklists`'s five, and the items'
 * own wording.
 *
 * Gated by the Dashboard page (`canViewDashboard`), like `programmeDelivery` and `preparationCards`
 * beside it; it reads no money.
 */

/** One Perjadin of the week, with its resolved checklist. */
export type WeekPerjadin = {
  id: string;
  subClusterName: string;
  startsOn: string;
  endsOn: string;
  picFullName: string;
  schoolNames: string[];
  /** Its own resolved checklist (ADR-0045), in render order, with its ticks. */
  preparation: PreparationItem[];
};

/** An item on at least one of the week's checklists, as its defining level words it. */
export type WeekPreparationItem = {
  itemId: string;
  /** The item's own wording — not a Cluster's or a Perjadin's rewording of it. */
  label: string;
  level: PreparationItemLevel;
  position: number;
};

export type PreparationWeek = { perjadins: WeekPerjadin[]; items: WeekPreparationItem[] };

/** The Perjadins starting from `from` through `until` (both `YYYY-MM-DD`, both included). */
export async function preparationWeek(
  _caller: Person,
  range: { from: string; until: string },
): Promise<PreparationWeek> {
  const trips = await db
    .select({
      id: perjadin.id,
      subClusterName: subCluster.name,
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      picFullName: person.fullName,
      schoolNames: tripSchoolNames(perjadin.id),
    })
    .from(perjadin)
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .innerJoin(person, eq(person.id, perjadin.picPersonId))
    .where(and(gte(perjadin.startsOn, range.from), lte(perjadin.startsOn, range.until)))
    .orderBy(asc(perjadin.startsOn), asc(perjadin.id));
  if (trips.length === 0) return { perjadins: [], items: [] };

  const checklists = await preparationChecklists(trips.map((trip) => trip.id));
  const perjadins = trips.map((trip) => ({
    ...trip,
    preparation: checklists.get(trip.id) ?? [],
  }));

  const itemIds = [
    ...new Set(perjadins.flatMap((trip) => trip.preparation.map((item) => item.itemId))),
  ];
  const items =
    itemIds.length === 0
      ? []
      : await db
          .select({
            itemId: preparationItem.id,
            label: preparationItem.label,
            level: preparationItem.level,
            position: preparationItem.position,
          })
          .from(preparationItem)
          .where(inArray(preparationItem.id, itemIds));

  return { perjadins, items };
}
