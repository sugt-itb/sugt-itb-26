import { db, schema } from "@sugt/db";
import {
  addPerjadinTeacher,
  isNotStaffError,
  myPerjadin,
  perjadinDetail,
  perjadinDirectory,
  removePerjadinTeacher,
  renamePerjadinTeacher,
  togglePreparationItem,
} from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addGroupMember,
  addPerjadin,
  addPerson,
  addSubCluster,
  COMPANY_PREPARATION_ITEMS,
  resetDatabase,
  RETIRED_PREPARATION_ITEMS,
  wibDaysFromToday,
} from "./support/fixtures";

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the Staff-only choke point still has to
 * reject a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the
 * row. The cast through `unknown` is the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Budi Santoso",
    email: "budi@gmail.com",
    role: "Teaching Team" as unknown as Role,
    grants: [],
  };
}

/**
 * **The Preparation Checklist after the cutover** ([#114](https://github.com/mafiefa02/sugt/issues/114),
 * ADR-0045). Migration 0043 retired the six fixed items on the day it ran and added the company's 14
 * that same day, so a Perjadin ending today or later shows the 14 and one that ended before shows
 * the six. `resetDatabase` restores exactly those rows, so these tests see what a real database has.
 *
 * Then the toggle, which takes an item's id and stores a tick only for an item the Perjadin's
 * checklist holds, and the one automatic un-tick in the system: any Teaching-Team change clears the
 * tick on the item carrying `clears_on_teaching_team_change`. Each block drives the query functions
 * against a real Postgres. The levels and their dates are `preparation-items.test.ts`'s.
 */

async function trip(dates: { startsOn: string; endsOn: string }) {
  const pic = await addPerson({
    fullName: "Rina Nurhayati",
    email: "rina@ditsama.itb.ac.id",
    role: "Staff",
  });
  const perjadin = await addPerjadin({ picPersonId: pic.id, ...dates });
  return { pic, perjadinId: perjadin.id };
}

/** A trip ending today: not finished, so it has the company's 14. */
const current = () => trip({ startsOn: wibDaysFromToday(-2), endsOn: wibDaysFromToday(0) });
/** A trip that ended yesterday: finished before the cutover, so it kept the old six. */
const finished = () => trip({ startsOn: wibDaysFromToday(-4), endsOn: wibDaysFromToday(-1) });

async function checklistOf(caller: Parameters<typeof perjadinDetail>[0], perjadinId: string) {
  return (await perjadinDetail(caller, perjadinId))?.preparation ?? [];
}

/** The stored ticks for one Perjadin, straight from the table. */
async function ticksOf(perjadinId: string) {
  return db
    .select({
      itemId: schema.perjadinPreparationTick.preparationItemId,
      checkedBy: schema.perjadinPreparationTick.checkedBy,
      checkedAt: schema.perjadinPreparationTick.checkedAt,
    })
    .from(schema.perjadinPreparationTick)
    .where(eq(schema.perjadinPreparationTick.perjadinId, perjadinId));
}

describe("the checklist after the cutover", () => {
  beforeEach(resetDatabase);

  it("is the company's 14, in order and word for word, on a Perjadin ending today or later", async () => {
    const { pic, perjadinId } = await current();

    const items = await checklistOf(pic, perjadinId);

    expect(items.map((item) => item.label)).toEqual(COMPANY_PREPARATION_ITEMS);
    expect(items.every((item) => !item.checked && item.level === "semua")).toBe(true);
    // The second is the one the Teaching Team clears, and the only one.
    expect(
      items.filter((item) => item.clearsOnTeachingTeamChange).map((item) => item.label),
    ).toEqual(["Fiksasi Dosen/Narasumber oleh PIC Dosen"]);
  });

  it("is the retired six on a Perjadin that ended before the cutover", async () => {
    const { pic, perjadinId } = await finished();

    const items = await checklistOf(pic, perjadinId);

    expect(items.map((item) => item.label)).toEqual(RETIRED_PREPARATION_ITEMS);
    expect(items.some((item) => item.clearsOnTeachingTeamChange)).toBe(false);
  });

  it("reads the same x/N on /perjadin, /pendamping and the detail page", async () => {
    const { pic, perjadinId } = await current();
    const [first, second] = await checklistOf(pic, perjadinId);
    await togglePreparationItem(pic, { perjadinId, itemId: first!.itemId, checked: true });
    await togglePreparationItem(pic, { perjadinId, itemId: second!.itemId, checked: true });

    const listed = (await perjadinDirectory(pic)).find((row) => row.id === perjadinId);
    expect([listed?.preparationDone, listed?.preparationTotal]).toEqual([2, 14]);

    const card = (await myPerjadin(pic)).current.find((row) => row.id === perjadinId);
    expect(card?.preparation.filter((item) => item.checked)).toHaveLength(2);
    expect(card?.preparation).toHaveLength(14);

    const detail = await checklistOf(pic, perjadinId);
    expect(detail.filter((item) => item.checked).map((item) => item.itemId)).toEqual([
      first!.itemId,
      second!.itemId,
    ]);
  });
});

describe("toggling a box", () => {
  beforeEach(resetDatabase);

  it("writes a row with checkedBy and checkedAt on tick, and deletes it on un-tick", async () => {
    const { pic, perjadinId } = await current();
    const [item] = await checklistOf(pic, perjadinId);

    expect(
      await togglePreparationItem(pic, { perjadinId, itemId: item!.itemId, checked: true }),
    ).toEqual({ outcome: "toggled" });
    const [row] = await ticksOf(perjadinId);
    expect(row?.itemId).toBe(item!.itemId);
    expect(row?.checkedBy).toBe(pic.id);
    expect(row?.checkedAt).not.toBeNull();

    await togglePreparationItem(pic, { perjadinId, itemId: item!.itemId, checked: false });
    expect(await ticksOf(perjadinId)).toEqual([]);
  });

  it("is idempotent both ways — a second tick is one row, a second un-tick is a no-op", async () => {
    const { pic, perjadinId } = await current();
    const [item] = await checklistOf(pic, perjadinId);
    const toggle = (checked: boolean) =>
      togglePreparationItem(pic, { perjadinId, itemId: item!.itemId, checked });

    await toggle(true);
    await toggle(true);
    expect(await ticksOf(perjadinId)).toHaveLength(1);

    await toggle(false);
    await toggle(false);
    expect(await ticksOf(perjadinId)).toEqual([]);
  });

  it("records the Staff member who most recently ticked it", async () => {
    const { pic, perjadinId } = await current();
    const other = await addPerson({
      fullName: "Dewi Lestari",
      email: "dewi@ditsama.itb.ac.id",
      role: "Staff",
    });
    // A second member of the Group: only its members, Perjadin Editors and Administrators tick (ADR-0048).
    await addGroupMember(perjadinId, other.id);
    const [item] = await checklistOf(pic, perjadinId);

    await togglePreparationItem(pic, { perjadinId, itemId: item!.itemId, checked: true });
    await togglePreparationItem(other, { perjadinId, itemId: item!.itemId, checked: true });

    const [row] = await ticksOf(perjadinId);
    expect(row?.checkedBy).toBe(other.id);
  });

  it("refuses an item that is not on the Perjadin's checklist, and stores nothing", async () => {
    const { pic, perjadinId } = await current();
    // A retired item — on every finished trip, not on this one.
    const [retired] = await db
      .select({ id: schema.preparationItem.id })
      .from(schema.preparationItem)
      .where(eq(schema.preparationItem.label, "SK Perjalanan"));
    // Another Cluster's item.
    const elsewhere = await addCluster({ slug: "cluster-lain", name: "Cluster Lain" });
    const [theirs] = await db
      .insert(schema.preparationItem)
      .values({
        level: "cluster",
        clusterId: elsewhere.id,
        label: "Hanya di sana",
        position: 1,
        addedOn: wibDaysFromToday(-30),
      })
      .returning();

    for (const itemId of [retired!.id, theirs!.id, "00000000-0000-4000-8000-000000000000"]) {
      expect(await togglePreparationItem(pic, { perjadinId, itemId, checked: true })).toEqual({
        outcome: "not-applicable",
      });
    }
    expect(await ticksOf(perjadinId)).toEqual([]);
  });

  it("refuses a non-Staff caller", async () => {
    const { pic, perjadinId } = await current();
    const [item] = await checklistOf(pic, perjadinId);

    await expect(
      togglePreparationItem(nonStaff(), { perjadinId, itemId: item!.itemId, checked: true }),
    ).rejects.toSatisfy(isNotStaffError);
    expect(await ticksOf(perjadinId)).toEqual([]);
  });

  it("refuses a Pimpinan", async () => {
    const { pic, perjadinId } = await current();
    const pimpinan = await addPerson({
      fullName: "Ir. Pimpinan",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    const [item] = await checklistOf(pic, perjadinId);

    await expect(
      togglePreparationItem(pimpinan, { perjadinId, itemId: item!.itemId, checked: true }),
    ).rejects.toSatisfy(isNotStaffError);
  });
});

describe("the one automatic un-tick — the system item", () => {
  beforeEach(resetDatabase);

  /** Tick the system item and one other on a current trip; answer both ids. */
  async function tickTwo(pic: Parameters<typeof togglePreparationItem>[0], perjadinId: string) {
    const items = await checklistOf(pic, perjadinId);
    const system = items.find((item) => item.clearsOnTeachingTeamChange)!;
    const other = items.find((item) => !item.clearsOnTeachingTeamChange)!;
    for (const item of [system, other]) {
      await togglePreparationItem(pic, { perjadinId, itemId: item.itemId, checked: true });
    }
    return { systemId: system.itemId, otherId: other.itemId };
  }

  const tickedIds = async (perjadinId: string) =>
    (await ticksOf(perjadinId)).map((tick) => tick.itemId);

  it("clears when a Teaching-Team name is added, and leaves every other box alone", async () => {
    const { pic, perjadinId } = await current();
    const { systemId, otherId } = await tickTwo(pic, perjadinId);

    await addPerjadinTeacher(pic, perjadinId, "Prof. Baru");

    expect(await tickedIds(perjadinId)).toEqual([otherId]);
    expect(await tickedIds(perjadinId)).not.toContain(systemId);
  });

  it("clears when a Teaching-Team name is renamed", async () => {
    const { pic, perjadinId } = await current();
    const added = await addPerjadinTeacher(pic, perjadinId, "Prof. Lama");
    if (added.outcome !== "added") throw new Error("fixture failed to add a teacher");
    const { otherId } = await tickTwo(pic, perjadinId);

    await renamePerjadinTeacher(pic, added.teacherId, "Prof. Baru");

    expect(await tickedIds(perjadinId)).toEqual([otherId]);
  });

  it("clears when a Teaching-Team name is removed", async () => {
    const { pic, perjadinId } = await current();
    const added = await addPerjadinTeacher(pic, perjadinId, "Prof. Pergi");
    if (added.outcome !== "added") throw new Error("fixture failed to add a teacher");
    const { otherId } = await tickTwo(pic, perjadinId);

    await removePerjadinTeacher(pic, added.teacherId);

    expect(await tickedIds(perjadinId)).toEqual([otherId]);
  });

  it("clears only on that Perjadin", async () => {
    const { pic, perjadinId } = await current();
    const subCluster = await addSubCluster({
      slug: "kelompok-lain",
      name: "Kelompok Lain",
      clusterId: (await addCluster({ slug: "c-lain", name: "C Lain" })).id,
    });
    const otherTrip = await addPerjadin({
      picPersonId: pic.id,
      subClusterId: subCluster.id,
      startsOn: wibDaysFromToday(1),
      endsOn: wibDaysFromToday(3),
    });
    const { systemId } = await tickTwo(pic, otherTrip.id);

    await addPerjadinTeacher(pic, perjadinId, "Prof. Baru");

    expect(await tickedIds(otherTrip.id)).toContain(systemId);
  });
});
