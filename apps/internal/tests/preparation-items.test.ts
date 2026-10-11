import { db, schema } from "@sugt/db";
import {
  addPerjadinTeacher,
  addPreparationItem,
  clearPreparationItemWording,
  hidePreparationItem,
  isNotGrantedError,
  perjadinDetail,
  removePreparationItem,
  rewordPreparationItem,
  showPreparationItem,
  togglePreparationItem,
  type PreparationOverrideScope,
} from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addPerjadin,
  addPerson,
  addSubCluster,
  COMPANY_PREPARATION_ITEMS,
  refusedBy,
  resetDatabase,
  wibDaysFromToday,
} from "./support/fixtures";

/**
 * **The Preparation Checklist's three levels, and what a change reaches** (ADR-0045).
 *
 * Every write here runs on today's WIB date, so the dated rule is pinned the way it will run: a
 * change made today reaches a Perjadin ending today or later, and leaves one that ended yesterday
 * exactly as it was. Perjadin-level changes and every wording reach both. A Cluster hidden, shown
 * and hidden again is pinned with dated rows written directly, since only a past date can show it.
 */

let admin: Awaited<ReturnType<typeof addPerson>>;
let clusterId: string;
let subClusterId: string;

beforeEach(async () => {
  await resetDatabase();
  const person = await addPerson({
    fullName: "Admin",
    email: "admin@ditsama.itb.ac.id",
    role: "Staff",
  });
  admin = { ...person, grants: ["Administrator"] };
  clusterId = (await addCluster({ slug: "c-satu", name: "Cluster Satu" })).id;
  subClusterId = (await addSubCluster({ slug: "k-satu", name: "Kelompok 1", clusterId })).id;
});

/** A trip in Cluster Satu, ending `endsIn` days from today (WIB). It has no Session at all. */
async function tripEnding(endsIn: number, inSubCluster = subClusterId) {
  const row = await addPerjadin({
    picPersonId: admin.id,
    subClusterId: inSubCluster,
    startsOn: wibDaysFromToday(endsIn - 2),
    endsOn: wibDaysFromToday(endsIn),
  });
  return row.id;
}

async function labelsOf(perjadinId: string) {
  return ((await perjadinDetail(admin, perjadinId))?.preparation ?? []).map((item) => item.label);
}

async function itemsOf(perjadinId: string) {
  return (await perjadinDetail(admin, perjadinId))?.preparation ?? [];
}

const systemItemId = async () => {
  const [row] = await db
    .select({ id: schema.preparationItem.id })
    .from(schema.preparationItem)
    .where(eq(schema.preparationItem.clearsOnTeachingTeamChange, true));
  return row!.id;
};

describe("Semua and Cluster changes are dated: they skip a Perjadin that has already ended", () => {
  it("adds a Semua item to a Perjadin ending today, not to one that ended yesterday", async () => {
    const ended = await tripEnding(-1);
    const ending = await tripEnding(0);
    const before = await labelsOf(ended);

    expect(await addPreparationItem(admin, { scope: { level: "semua" }, label: "Baru" })).toEqual(
      expect.objectContaining({ outcome: "added" }),
    );

    expect(await labelsOf(ended)).toEqual(before);
    expect(await labelsOf(ending)).toEqual([...COMPANY_PREPARATION_ITEMS, "Baru"]);
  });

  it("removes a Semua item from a Perjadin ending today, and keeps it, ticked, on one that ended", async () => {
    const ended = await tripEnding(-1);
    const ending = await tripEnding(0);
    const added = await addPreparationItem(admin, {
      scope: { level: "semua" },
      label: "Sementara",
    });
    if (added.outcome !== "added") throw new Error("fixture failed");
    // Backdate it, as if added long ago, so the trip that ended yesterday has it too.
    await db
      .update(schema.preparationItem)
      .set({ addedOn: wibDaysFromToday(-30) })
      .where(eq(schema.preparationItem.id, added.itemId));
    await togglePreparationItem(admin, { perjadinId: ended, itemId: added.itemId, checked: true });

    expect(await removePreparationItem(admin, added.itemId)).toEqual({ outcome: "removed" });

    expect(await labelsOf(ending)).not.toContain("Sementara");
    const kept = (await itemsOf(ended)).find((item) => item.itemId === added.itemId);
    expect(kept?.checked).toBe(true);
  });

  it("adds and removes a Cluster item by the same rule, and only in that Cluster", async () => {
    const ended = await tripEnding(-1);
    const ending = await tripEnding(0);
    const otherCluster = (await addCluster({ slug: "c-dua", name: "Cluster Dua" })).id;
    const elsewhere = await tripEnding(
      0,
      (await addSubCluster({ slug: "k-dua", name: "Kelompok 2", clusterId: otherCluster })).id,
    );

    const added = await addPreparationItem(admin, {
      scope: { level: "cluster", clusterId },
      label: "Khusus Cluster Satu",
    });
    if (added.outcome !== "added") throw new Error("fixture failed");

    // Its Cluster is known from the Sub-Cluster alone: none of these trips has a Session.
    expect(await labelsOf(ending)).toContain("Khusus Cluster Satu");
    expect(await labelsOf(ended)).not.toContain("Khusus Cluster Satu");
    expect(await labelsOf(elsewhere)).not.toContain("Khusus Cluster Satu");

    await removePreparationItem(admin, added.itemId);
    expect(await labelsOf(ending)).not.toContain("Khusus Cluster Satu");
  });

  it("removes a long-standing Cluster item from today on, leaving a finished Perjadin's ticked", async () => {
    const ended = await tripEnding(-1);
    const ending = await tripEnding(0);
    const added = await addPreparationItem(admin, {
      scope: { level: "cluster", clusterId },
      label: "Lama di Cluster",
    });
    if (added.outcome !== "added") throw new Error("fixture failed");
    await db
      .update(schema.preparationItem)
      .set({ addedOn: wibDaysFromToday(-30) })
      .where(eq(schema.preparationItem.id, added.itemId));
    await togglePreparationItem(admin, { perjadinId: ended, itemId: added.itemId, checked: true });

    await removePreparationItem(admin, added.itemId);

    expect(await labelsOf(ending)).not.toContain("Lama di Cluster");
    const kept = (await itemsOf(ended)).find((item) => item.itemId === added.itemId);
    expect(kept?.checked).toBe(true);
  });

  it("hides a Semua item for a Cluster from today, and shows it again with its ticks", async () => {
    const ended = await tripEnding(-1);
    const ending = await tripEnding(0);
    // A long-standing Semua item, so both trips have it, ticked on both.
    const added = await addPreparationItem(admin, { scope: { level: "semua" }, label: "Lama" });
    if (added.outcome !== "added") throw new Error("fixture failed");
    await db
      .update(schema.preparationItem)
      .set({ addedOn: wibDaysFromToday(-30) })
      .where(eq(schema.preparationItem.id, added.itemId));
    for (const perjadinId of [ended, ending]) {
      await togglePreparationItem(admin, { perjadinId, itemId: added.itemId, checked: true });
    }
    const itemOn = async (perjadinId: string) =>
      (await itemsOf(perjadinId)).find((item) => item.itemId === added.itemId);

    expect(
      await hidePreparationItem(admin, { itemId: added.itemId, scope: { clusterId } }),
    ).toEqual({ outcome: "hidden" });
    expect(await itemOn(ending)).toBeUndefined();
    expect((await itemOn(ended))?.checked).toBe(true);

    await showPreparationItem(admin, { itemId: added.itemId, scope: { clusterId } });
    expect((await itemOn(ending))?.checked).toBe(true);
  });
});

describe("a Cluster hidden, shown and hidden again", () => {
  it("decides each Perjadin by the spell its end date falls in", async () => {
    const added = await addPreparationItem(admin, { scope: { level: "semua" }, label: "Bergilir" });
    if (added.outcome !== "added") throw new Error("fixture failed");
    await db
      .update(schema.preparationItem)
      .set({ addedOn: wibDaysFromToday(-60) })
      .where(eq(schema.preparationItem.id, added.itemId));
    // Hidden from day -10 to day -5, then again from day -2 on: one row per spell.
    await db.insert(schema.preparationItemHide).values([
      {
        preparationItemId: added.itemId,
        clusterId,
        hiddenOn: wibDaysFromToday(-10),
        shownOn: wibDaysFromToday(-5),
      },
      { preparationItemId: added.itemId, clusterId, hiddenOn: wibDaysFromToday(-2) },
    ]);

    const has = async (endsIn: number) =>
      (await labelsOf(await tripEnding(endsIn))).includes("Bergilir");

    expect(await has(-12)).toBe(true); // ended before the first hide
    expect(await has(-10)).toBe(false); // ended the day it was hidden
    expect(await has(-6)).toBe(false); // ended inside the first spell
    expect(await has(-5)).toBe(true); // ended the day it was shown again
    expect(await has(-3)).toBe(true); // between the spells
    expect(await has(0)).toBe(false); // inside the open spell
  });
});

describe("Perjadin-level changes always apply, finished or not", () => {
  it("adds, hides and rewords for one Perjadin even after it ended", async () => {
    const ended = await tripEnding(-1);
    const [retiredFirst] = await itemsOf(ended);

    const added = await addPreparationItem(admin, {
      scope: { level: "perjadin", perjadinId: ended },
      label: "Hanya trip ini",
    });
    expect(added.outcome).toBe("added");
    expect((await labelsOf(ended)).at(-1)).toBe("Hanya trip ini");

    const scope: PreparationOverrideScope = { perjadinId: ended };
    await rewordPreparationItem(admin, { itemId: retiredFirst!.itemId, label: "SK", scope });
    expect((await labelsOf(ended))[0]).toBe("SK");

    await hidePreparationItem(admin, { itemId: retiredFirst!.itemId, scope });
    expect((await itemsOf(ended)).map((item) => item.itemId)).not.toContain(retiredFirst!.itemId);
  });

  it("brings a hidden item's ticks back when it is shown again", async () => {
    const ending = await tripEnding(0);
    const [first] = await itemsOf(ending);
    await togglePreparationItem(admin, {
      perjadinId: ending,
      itemId: first!.itemId,
      checked: true,
    });
    const scope = { perjadinId: ending };

    await hidePreparationItem(admin, { itemId: first!.itemId, scope });
    await showPreparationItem(admin, { itemId: first!.itemId, scope });

    expect((await itemsOf(ending))[0]).toEqual(expect.objectContaining({ checked: true }));
  });

  it("deletes a removed Perjadin item and its ticks", async () => {
    const ending = await tripEnding(0);
    const added = await addPreparationItem(admin, {
      scope: { level: "perjadin", perjadinId: ending },
      label: "Sekali pakai",
    });
    if (added.outcome !== "added") throw new Error("fixture failed");
    await togglePreparationItem(admin, { perjadinId: ending, itemId: added.itemId, checked: true });

    await removePreparationItem(admin, added.itemId);

    expect(
      await db
        .select()
        .from(schema.perjadinPreparationTick)
        .where(eq(schema.perjadinPreparationTick.preparationItemId, added.itemId)),
    ).toEqual([]);
    expect(await labelsOf(ending)).not.toContain("Sekali pakai");
  });
});

describe("wording", () => {
  it("keeps the item's id and ticks, and reaches a Perjadin that has already ended", async () => {
    const ended = await tripEnding(-1);
    const [retiredFirst] = await itemsOf(ended);
    await togglePreparationItem(admin, {
      perjadinId: ended,
      itemId: retiredFirst!.itemId,
      checked: true,
    });

    await rewordPreparationItem(admin, { itemId: retiredFirst!.itemId, label: "SK Perjadin" });

    expect((await itemsOf(ended))[0]).toEqual(
      expect.objectContaining({
        itemId: retiredFirst!.itemId,
        label: "SK Perjadin",
        checked: true,
      }),
    );
  });

  it("lets the most specific wording win, and restores the wider one when it is cleared", async () => {
    const ending = await tripEnding(0);
    const [first] = await itemsOf(ending);
    const itemId = first!.itemId;

    await rewordPreparationItem(admin, { itemId, label: "Untuk Cluster", scope: { clusterId } });
    expect((await labelsOf(ending))[0]).toBe("Untuk Cluster");

    await rewordPreparationItem(admin, {
      itemId,
      label: "Untuk trip ini",
      scope: { perjadinId: ending },
    });
    expect((await labelsOf(ending))[0]).toBe("Untuk trip ini");

    await clearPreparationItemWording(admin, { itemId, scope: { perjadinId: ending } });
    expect((await labelsOf(ending))[0]).toBe("Untuk Cluster");
    await clearPreparationItemWording(admin, { itemId, scope: { clusterId } });
    expect((await labelsOf(ending))[0]).toBe(COMPANY_PREPARATION_ITEMS[0]);
  });

  it("takes two rewords for one scope at once without either failing", async () => {
    const ending = await tripEnding(0);
    const [first] = await itemsOf(ending);
    const scope = { clusterId };

    const results = await Promise.all(
      ["Satu", "Dua"].map((label) =>
        rewordPreparationItem(admin, { itemId: first!.itemId, label, scope }),
      ),
    );

    expect(results).toEqual([{ outcome: "reworded" }, { outcome: "reworded" }]);
    expect(["Satu", "Dua"]).toContain((await labelsOf(ending))[0]);
  });

  it("does not move an item", async () => {
    const ending = await tripEnding(0);
    const items = await itemsOf(ending);

    await rewordPreparationItem(admin, { itemId: items[5]!.itemId, label: "A dulu" });

    expect((await itemsOf(ending)).map((item) => item.itemId)).toEqual(
      items.map((item) => item.itemId),
    );
  });
});

describe("order", () => {
  it("is Semua, then the Cluster's, then the Perjadin's own", async () => {
    const ending = await tripEnding(0);
    // Added in the reverse order, so the order cannot be insertion order.
    await addPreparationItem(admin, {
      scope: { level: "perjadin", perjadinId: ending },
      label: "Trip",
    });
    await addPreparationItem(admin, { scope: { level: "cluster", clusterId }, label: "Cluster" });
    await addPreparationItem(admin, { scope: { level: "semua" }, label: "Semua" });

    expect((await labelsOf(ending)).slice(-3)).toEqual(["Semua", "Cluster", "Trip"]);
  });
});

describe("the system item", () => {
  it("is never removed or hidden, at any level, but may be reworded", async () => {
    const ending = await tripEnding(0);
    const itemId = await systemItemId();

    expect(await removePreparationItem(admin, itemId)).toEqual({ outcome: "system-item" });
    expect(await hidePreparationItem(admin, { itemId, scope: { clusterId } })).toEqual({
      outcome: "system-item",
    });
    expect(await hidePreparationItem(admin, { itemId, scope: { perjadinId: ending } })).toEqual({
      outcome: "system-item",
    });
    expect(await labelsOf(ending)).toContain("Fiksasi Dosen/Narasumber oleh PIC Dosen");

    await rewordPreparationItem(admin, { itemId, label: "Narasumber sudah fiks" });
    const reworded = (await itemsOf(ending)).find((item) => item.itemId === itemId);
    expect(reworded).toEqual(
      expect.objectContaining({ label: "Narasumber sudah fiks", clearsOnTeachingTeamChange: true }),
    );

    // Reworded, it still unticks on a Teaching-Team change: the coupling reads the flag.
    await togglePreparationItem(admin, { perjadinId: ending, itemId, checked: true });
    await addPerjadinTeacher(admin, ending, "Prof. Baru");
    expect((await itemsOf(ending)).find((item) => item.itemId === itemId)?.checked).toBe(false);
  });

  it("is the only item that can carry the flag", async () => {
    expect(
      await refusedBy(
        db.insert(schema.preparationItem).values({
          level: "semua",
          label: "Kedua",
          position: 99,
          addedOn: wibDaysFromToday(0),
          clearsOnTeachingTeamChange: true,
        }),
      ),
    ).toBe("preparation_item_one_system_item");
  });
});

describe("refusals", () => {
  it("refuses hiding or rewording an item for a scope it is not wider than", async () => {
    const ending = await tripEnding(0);
    const added = await addPreparationItem(admin, {
      scope: { level: "cluster", clusterId },
      label: "Cluster",
    });
    if (added.outcome !== "added") throw new Error("fixture failed");

    // A Cluster item for a Cluster is not an override; for a Perjadin of that Cluster it is.
    expect(
      await hidePreparationItem(admin, { itemId: added.itemId, scope: { clusterId } }),
    ).toEqual({ outcome: "not-wider" });
    expect(
      await hidePreparationItem(admin, { itemId: added.itemId, scope: { perjadinId: ending } }),
    ).toEqual({ outcome: "hidden" });
  });

  it("refuses a blank label", async () => {
    expect(await addPreparationItem(admin, { scope: { level: "semua" }, label: "  " })).toEqual({
      outcome: "label-required",
    });
  });

  it("refuses a Staff member who is not an Administrator", async () => {
    const staff = await addPerson({
      fullName: "Staf",
      email: "staf@ditsama.itb.ac.id",
      role: "Staff",
    });

    await expect(
      addPreparationItem(staff, { scope: { level: "semua" }, label: "Tidak boleh" }),
    ).rejects.toSatisfy(isNotGrantedError);
  });
});
