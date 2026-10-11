import { perjadinDirectory, togglePreparationItem, type Person } from "@sugt/db/queries";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  COMPANY_PREPARATION_ITEMS,
  resetDatabase,
  wibDaysFromToday,
} from "./support/fixtures";

/**
 * **The `/perjadin` table's counts** (#343). Three read-only columns come off `perjadinDirectory`:
 * Sekolah counts only Schools with a **non-cancelled** Session, and Terlaksana is delivered over
 * non-cancelled Sessions — each a correlated subquery, so none fans the row out. The Staff Persiapan
 * pill opens the checklist dialog, so the payload carries the checklist items too.
 */

/** The list is open to anyone signed in, so the caller's identity does not matter here. */
const caller: Person = {
  id: "00000000-0000-0000-0000-000000000001",
  fullName: "Budi Santoso",
  email: "budi@ditsama.itb.ac.id",
  role: "Staff",
  grants: [],
};

async function staff() {
  return addPerson({ fullName: "Rina Nurhayati", email: "rina@ditsama.itb.ac.id", role: "Staff" });
}

async function twoSchools() {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const first = await addSchool({
    slug: "sman-1",
    name: "SMAN 1 Bandung",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
  const second = await addSchool({
    slug: "sman-2",
    name: "SMAN 2 Bandung",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
  return [first, second] as const;
}

describe("perjadinDirectory — the table's counts", () => {
  beforeEach(resetDatabase);

  it("counts delivered over non-cancelled Sessions, and only Schools with a non-cancelled Session", async () => {
    const pic = await staff();
    const [first, second] = await twoSchools();
    const perjadin = await addPerjadin({ picPersonId: pic.id });
    await addOfflineSession({
      schoolId: first.id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      status: "delivered",
      perjadinId: perjadin.id,
    });
    await addOfflineSession({
      schoolId: first.id,
      heldOn: "2026-09-01",
      startsAt: "13:00",
      perjadinId: perjadin.id,
    });
    // The second School holds only a cancelled Session: out of Sekolah and out of Terlaksana's N.
    await addOfflineSession({
      schoolId: second.id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      status: "cancelled",
      perjadinId: perjadin.id,
    });

    const [trip] = await perjadinDirectory(caller);

    expect(trip?.schoolCount).toBe(1);
    expect(trip?.sessionsDelivered).toBe(1);
    expect(trip?.sessionsTotal).toBe(2);
    // The trip's Schools (ADR-0044) — the School line and the search — agree with the count: the
    // School whose only Session was cancelled is no longer visited, so it drops out of both.
    expect(trip?.schoolNames).toEqual(["SMAN 1 Bandung"]);
  });

  it("reads 0/0 and zero Schools for a Perjadin with no Sessions", async () => {
    const pic = await staff();
    await addPerjadin({ picPersonId: pic.id });

    const [trip] = await perjadinDirectory(caller);

    expect(trip?.schoolCount).toBe(0);
    expect(trip?.sessionsDelivered).toBe(0);
    expect(trip?.sessionsTotal).toBe(0);
  });

  it("carries the trip's checklist with its tick state, agreeing with the pill's count", async () => {
    const pic = await staff();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      startsOn: wibDaysFromToday(0),
      endsOn: wibDaysFromToday(2),
    });
    const [before] = await perjadinDirectory(caller);
    const [first, second] = before!.preparation;
    for (const item of [first!, second!]) {
      await togglePreparationItem(pic, {
        perjadinId: perjadin.id,
        itemId: item.itemId,
        checked: true,
      });
    }

    const [trip] = await perjadinDirectory(caller);

    // A trip not yet over has the company's 14 (ADR-0045).
    expect(trip?.preparation.map((item) => item.label)).toEqual(COMPANY_PREPARATION_ITEMS);
    expect(trip?.preparation.filter((item) => item.checked).map((item) => item.itemId)).toEqual([
      first!.itemId,
      second!.itemId,
    ]);
    expect(trip?.preparationDone).toBe(2);
    expect(trip?.preparationTotal).toBe(14);
  });

  it("gives a trip with no ticks every item unchecked", async () => {
    const pic = await staff();
    await addPerjadin({
      picPersonId: pic.id,
      startsOn: wibDaysFromToday(0),
      endsOn: wibDaysFromToday(2),
    });

    const [trip] = await perjadinDirectory(caller);

    expect(trip?.preparation.every((item) => !item.checked)).toBe(true);
    expect(trip?.preparation).toHaveLength(14);
  });
});
