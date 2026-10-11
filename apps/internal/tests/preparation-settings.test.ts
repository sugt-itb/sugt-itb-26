import { db, schema } from "@sugt/db";
import {
  addPreparationItem,
  isNotGrantedError,
  movePreparationItem,
  perjadinDetail,
  preparationSettings,
  preparationSettingsClusters,
  preparationSettingsPerjadins,
  removePreparationItem,
  removePreparationItemAt,
  rewordPreparationItem,
  rewordPreparationItemAt,
  showPreparationItem,
  clearPreparationItemWording,
  type PreparationScope,
} from "@sugt/db/queries";
import { MAX_PREPARATION_ITEM_LABEL_LENGTH } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  COMPANY_PREPARATION_ITEMS,
  resetDatabase,
  wibDaysFromToday,
} from "./support/fixtures";

/**
 * **Pengaturan Perjadin** (#422): the checklist as each level shows it, and the writes the page makes
 * — addressed to the level on screen, so Hapus and Ubah pick removal or hiding, and an item's own
 * wording or an override, from where the Administrator stands. Every rule they lean on is
 * `./preparation-items.test.ts`'s; this pins what the screen reads and the choice each write makes.
 */

let admin: Awaited<ReturnType<typeof addPerson>> & { grants: "Administrator"[] };
let staff: Awaited<ReturnType<typeof addPerson>>;
let clusterId: string;
let otherClusterId: string;
let subClusterId: string;
let otherSubClusterId: string;

const SEMUA: PreparationScope = { level: "semua" };
const cluster = (): PreparationScope => ({ level: "cluster", clusterId });
const trip = (perjadinId: string): PreparationScope => ({ level: "perjadin", perjadinId });

beforeEach(async () => {
  await resetDatabase();
  const person = await addPerson({
    fullName: "Admin",
    email: "admin@ditsama.itb.ac.id",
    role: "Staff",
  });
  admin = { ...person, grants: ["Administrator"] };
  staff = await addPerson({ fullName: "Staf", email: "staf@ditsama.itb.ac.id", role: "Staff" });
  clusterId = (await addCluster({ slug: "c-satu", name: "Cluster Satu" })).id;
  otherClusterId = (await addCluster({ slug: "c-dua", name: "Cluster Dua" })).id;
  subClusterId = (await addSubCluster({ slug: "k-satu", name: "Kelompok 1", clusterId })).id;
  otherSubClusterId = (
    await addSubCluster({ slug: "k-dua", name: "Kelompok 2", clusterId: otherClusterId })
  ).id;
});

/** A trip ending `endsIn` days from today (WIB), in Cluster Satu unless told otherwise. */
async function tripEnding(endsIn: number, inSubCluster = subClusterId) {
  const row = await addPerjadin({
    picPersonId: admin.id,
    subClusterId: inSubCluster,
    startsOn: wibDaysFromToday(endsIn - 2),
    endsOn: wibDaysFromToday(endsIn),
  });
  return row.id;
}

async function settingsAt(scope: PreparationScope) {
  const settings = await preparationSettings(admin, scope);
  if (!settings) throw new Error("no such level");
  return settings;
}

async function labelsOf(perjadinId: string) {
  return ((await perjadinDetail(admin, perjadinId))?.preparation ?? []).map((item) => item.label);
}

async function added(scope: PreparationScope, label: string) {
  const result = await addPreparationItem(admin, { scope, label });
  if (result.outcome !== "added") throw new Error(`fixture failed: ${result.outcome}`);
  return result.itemId;
}

/** A company item's id, by its wording. */
async function companyItem(label: string) {
  const [row] = await db
    .select({ id: schema.preparationItem.id })
    .from(schema.preparationItem)
    .where(eq(schema.preparationItem.label, label));
  return row!.id;
}

const SYSTEM_LABEL = "Fiksasi Dosen/Narasumber oleh PIC Dosen";

describe("what each level shows", () => {
  it("shows Semua as the company's 14, each its own, the system item flagged", async () => {
    const settings = await settingsAt(SEMUA);

    expect(settings.items.map((item) => item.label)).toEqual(COMPANY_PREPARATION_ITEMS);
    expect(settings.items.every((item) => item.level === "semua" && item.own)).toBe(true);
    expect(settings.items.filter((item) => item.system).map((item) => item.label)).toEqual([
      SYSTEM_LABEL,
    ]);
    expect(settings.hidden).toEqual([]);
    expect(settings.finished).toBe(false);
  });

  it("shows a Cluster as an unfinished Perjadin there gets it, with hides and wordings applied", async () => {
    const own = await added(cluster(), "Khusus Cluster Satu");
    const hiddenId = await companyItem("Pemesanan Hotel");
    const rewordedId = await companyItem("Pemesanan Tiket Pesawat/Kereta/Travel");
    await removePreparationItemAt(admin, { itemId: hiddenId, at: cluster() });
    await rewordPreparationItemAt(admin, { itemId: rewordedId, label: "Tiket", at: cluster() });
    const ending = await tripEnding(3);

    const settings = await settingsAt(cluster());

    expect(settings.clusterName).toBe("Cluster Satu");
    // Exactly the list a Perjadin of this Cluster that has not ended gets.
    expect(settings.items.map((item) => item.label)).toEqual(await labelsOf(ending));
    expect(settings.items.at(-1)).toEqual(
      expect.objectContaining({ itemId: own, level: "cluster", own: true }),
    );
    expect(settings.items.find((item) => item.itemId === rewordedId)).toEqual(
      expect.objectContaining({
        label: "Tiket",
        level: "semua",
        own: false,
        overriddenLabel: "Pemesanan Tiket Pesawat/Kereta/Travel",
      }),
    );
    expect(settings.hidden).toEqual([
      { itemId: hiddenId, label: "Pemesanan Hotel", level: "semua" },
    ]);

    // Semua is not touched by the Cluster's changes, and another Cluster sees none of them.
    expect((await settingsAt(SEMUA)).items.map((item) => item.label)).toEqual(
      COMPANY_PREPARATION_ITEMS,
    );
    const other = await settingsAt({ level: "cluster", clusterId: otherClusterId });
    expect(other.items.map((item) => item.label)).toEqual(COMPANY_PREPARATION_ITEMS);
  });

  it("shows a Perjadin its own list, tagging each item with where it comes from", async () => {
    await added(cluster(), "Dari Cluster");
    const perjadinId = await tripEnding(3);
    await added(trip(perjadinId), "Hanya di sini");

    const settings = await settingsAt(trip(perjadinId));

    expect(settings.clusterName).toBe("Cluster Satu");
    expect(settings.items.map((item) => item.label)).toEqual(await labelsOf(perjadinId));
    expect(settings.items.slice(-2).map((item) => [item.level, item.own])).toEqual([
      ["cluster", false],
      ["perjadin", true],
    ]);
    expect(settings.items.every((item) => item.reach === null)).toBe(true);
  });

  it("shows a finished Perjadin its frozen list, and says it is finished", async () => {
    const ended = await tripEnding(-1);
    await added(SEMUA, "Baru hari ini");

    const settings = await settingsAt(trip(ended));

    expect(settings.finished).toBe(true);
    expect(settings.items.map((item) => item.label)).not.toContain("Baru hari ini");
    expect(settings.items.map((item) => item.label)).toEqual(await labelsOf(ended));
  });

  it("lists as hidden only what is hidden at this level", async () => {
    const perjadinId = await tripEnding(3);
    const byCluster = await companyItem("Pemesanan Hotel");
    const byTrip = await companyItem("Uang pegangan konsumsi sudah diterima");
    await removePreparationItemAt(admin, { itemId: byCluster, at: cluster() });
    await removePreparationItemAt(admin, { itemId: byTrip, at: trip(perjadinId) });

    const settings = await settingsAt(trip(perjadinId));

    // The Cluster's hide is the Cluster's to undo; only the Perjadin's own is listed here.
    expect(settings.hidden.map((item) => item.itemId)).toEqual([byTrip]);
    expect(settings.items.map((item) => item.itemId)).not.toContain(byCluster);
  });

  it("is null for a Cluster or Perjadin that does not exist", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(await preparationSettings(admin, { level: "cluster", clusterId: missing })).toBeNull();
    expect(await preparationSettings(admin, { level: "perjadin", perjadinId: missing })).toBeNull();
  });
});

describe("Hapus reach: the unfinished Perjadins an item would leave", () => {
  it("counts every unfinished Perjadin at Semua, and only the Cluster's at Cluster", async () => {
    await tripEnding(-1);
    await tripEnding(0);
    await tripEnding(5);
    await tripEnding(5, otherSubClusterId);
    const hotel = await companyItem("Pemesanan Hotel");

    const semua = await settingsAt(SEMUA);
    expect(semua.items.find((item) => item.itemId === hotel)?.reach).toBe(3);

    const satu = await settingsAt(cluster());
    expect(satu.items.find((item) => item.itemId === hotel)?.reach).toBe(2);
  });

  it("leaves out a Perjadin that has already hidden the item", async () => {
    const hiding = await tripEnding(2);
    await tripEnding(2);
    const hotel = await companyItem("Pemesanan Hotel");
    await removePreparationItemAt(admin, { itemId: hotel, at: trip(hiding) });

    const semua = await settingsAt(SEMUA);
    expect(semua.items.find((item) => item.itemId === hotel)?.reach).toBe(1);
  });
});

describe("Hapus, addressed to a level", () => {
  it("removes an item defined at the level, and hides a wider one there", async () => {
    const perjadinId = await tripEnding(3);
    const own = await added(cluster(), "Milik Cluster");
    const wide = await companyItem("Pemesanan Hotel");

    expect(await removePreparationItemAt(admin, { itemId: own, at: cluster() })).toEqual({
      outcome: "removed",
    });
    expect(await removePreparationItemAt(admin, { itemId: wide, at: cluster() })).toEqual({
      outcome: "hidden",
    });

    expect(await labelsOf(perjadinId)).not.toContain("Milik Cluster");
    expect(await labelsOf(perjadinId)).not.toContain("Pemesanan Hotel");
    // The Semua item is hidden, not removed: Semua still lists it.
    expect((await settingsAt(SEMUA)).items.map((item) => item.itemId)).toContain(wide);
  });

  it("hides a Semua item for one Perjadin, and Tampilkan lagi brings it back", async () => {
    const perjadinId = await tripEnding(3);
    const neighbour = await tripEnding(3);
    const hotel = await companyItem("Pemesanan Hotel");

    expect(await removePreparationItemAt(admin, { itemId: hotel, at: trip(perjadinId) })).toEqual({
      outcome: "hidden",
    });
    expect(await labelsOf(perjadinId)).not.toContain("Pemesanan Hotel");
    expect(await labelsOf(neighbour)).toContain("Pemesanan Hotel");

    await showPreparationItem(admin, { itemId: hotel, scope: { perjadinId } });
    expect(await labelsOf(perjadinId)).toContain("Pemesanan Hotel");
  });

  it("refuses the system item at every level", async () => {
    const perjadinId = await tripEnding(3);
    const system = await companyItem(SYSTEM_LABEL);

    for (const at of [SEMUA, cluster(), trip(perjadinId)]) {
      expect(await removePreparationItemAt(admin, { itemId: system, at })).toEqual({
        outcome: "system-item",
      });
    }
    expect(await labelsOf(perjadinId)).toContain(SYSTEM_LABEL);
  });

  it("refuses to hide a Cluster's item for a Perjadin of another Cluster", async () => {
    const elsewhere = await tripEnding(3, otherSubClusterId);
    const own = await added(cluster(), "Milik Cluster Satu");

    expect(await removePreparationItemAt(admin, { itemId: own, at: trip(elsewhere) })).toEqual({
      outcome: "not-wider",
    });
  });
});

describe("Ubah, addressed to a level", () => {
  it("rewords an item defined at the level itself, with no override", async () => {
    const own = await added(cluster(), "Lama");

    expect(
      await rewordPreparationItemAt(admin, { itemId: own, label: "Baru", at: cluster() }),
    ).toEqual({ outcome: "reworded" });

    const [row] = await db
      .select({ label: schema.preparationItem.label })
      .from(schema.preparationItem)
      .where(eq(schema.preparationItem.id, own));
    expect(row?.label).toBe("Baru");
    expect(await db.select().from(schema.preparationItemWording)).toEqual([]);
    expect(
      (await settingsAt(cluster())).items.find((item) => item.itemId === own)?.overriddenLabel,
    ).toBeNull();
  });

  it("overrides a wider item at the level, and Kembalikan teks asal restores it", async () => {
    const perjadinId = await tripEnding(3);
    const hotel = await companyItem("Pemesanan Hotel");

    await rewordPreparationItemAt(admin, { itemId: hotel, label: "Hotel", at: trip(perjadinId) });
    expect(await labelsOf(perjadinId)).toContain("Hotel");
    expect((await settingsAt(SEMUA)).items.map((item) => item.label)).toContain("Pemesanan Hotel");
    expect(
      (await settingsAt(trip(perjadinId))).items.find((item) => item.itemId === hotel)
        ?.overriddenLabel,
    ).toBe("Pemesanan Hotel");

    await clearPreparationItemWording(admin, { itemId: hotel, scope: { perjadinId } });
    expect(await labelsOf(perjadinId)).toContain("Pemesanan Hotel");
  });

  it("names the Cluster's wording as the text beneath a Perjadin's override", async () => {
    const perjadinId = await tripEnding(3);
    const hotel = await companyItem("Pemesanan Hotel");
    await rewordPreparationItemAt(admin, { itemId: hotel, label: "Hotel Cluster", at: cluster() });
    await rewordPreparationItemAt(admin, {
      itemId: hotel,
      label: "Hotel Trip",
      at: trip(perjadinId),
    });

    const item = (await settingsAt(trip(perjadinId))).items.find((row) => row.itemId === hotel);
    expect(item?.label).toBe("Hotel Trip");
    expect(item?.overriddenLabel).toBe("Hotel Cluster");
  });

  it("lets the system item be reworded at any level", async () => {
    const system = await companyItem(SYSTEM_LABEL);
    expect(
      await rewordPreparationItemAt(admin, {
        itemId: system,
        label: "Fiksasi Dosen",
        at: cluster(),
      }),
    ).toEqual({ outcome: "reworded" });
  });

  it("refuses a wording another item on the level's list already has", async () => {
    const hotel = await companyItem("Pemesanan Hotel");

    expect(
      await rewordPreparationItemAt(admin, {
        itemId: hotel,
        label: "  uang PEGANGAN   konsumsi sudah diterima ",
        at: SEMUA,
      }),
    ).toEqual({ outcome: "duplicate-label" });
    // Its own wording in another case is not a clash with itself.
    expect(
      await rewordPreparationItemAt(admin, { itemId: hotel, label: "pemesanan hotel", at: SEMUA }),
    ).toEqual({ outcome: "reworded" });
  });
});

describe("Tambah item", () => {
  it("refuses a wording already on the level's list, in any case or spacing", async () => {
    expect(await addPreparationItem(admin, { scope: SEMUA, label: "pemesanan  HOTEL" })).toEqual({
      outcome: "duplicate-label",
    });
  });

  it("compares with the wording in force at the level, not the item's own", async () => {
    const hotel = await companyItem("Pemesanan Hotel");
    await rewordPreparationItemAt(admin, { itemId: hotel, label: "Hotel", at: cluster() });

    expect(await addPreparationItem(admin, { scope: cluster(), label: "Hotel" })).toEqual({
      outcome: "duplicate-label",
    });
    // The original wording no longer applies in the Cluster, so it is free there.
    expect(await addPreparationItem(admin, { scope: cluster(), label: "Pemesanan Hotel" })).toEqual(
      expect.objectContaining({ outcome: "added" }),
    );
  });

  it("refuses a wording over the length limit, and takes one at it", async () => {
    expect(
      await addPreparationItem(admin, {
        scope: SEMUA,
        label: "a".repeat(MAX_PREPARATION_ITEM_LABEL_LENGTH + 1),
      }),
    ).toEqual({ outcome: "label-too-long" });
    expect(
      await addPreparationItem(admin, {
        scope: SEMUA,
        label: "a".repeat(MAX_PREPARATION_ITEM_LABEL_LENGTH),
      }),
    ).toEqual(expect.objectContaining({ outcome: "added" }));
  });
});

describe("up and down", () => {
  it("swaps an item with its neighbour, and the move shows on a Perjadin", async () => {
    const perjadinId = await tripEnding(3);
    const a = await added(trip(perjadinId), "A");
    const b = await added(trip(perjadinId), "B");
    await added(trip(perjadinId), "C");

    expect(await movePreparationItem(admin, { itemId: b, direction: "up" })).toEqual({
      outcome: "moved",
    });
    expect((await labelsOf(perjadinId)).slice(-3)).toEqual(["B", "A", "C"]);

    expect(await movePreparationItem(admin, { itemId: a, direction: "down" })).toEqual({
      outcome: "moved",
    });
    expect((await labelsOf(perjadinId)).slice(-3)).toEqual(["B", "C", "A"]);
  });

  it("refuses to move the first item up or the last down", async () => {
    const first = await companyItem(COMPANY_PREPARATION_ITEMS[0]!);
    const last = await companyItem(COMPANY_PREPARATION_ITEMS.at(-1)!);

    expect(await movePreparationItem(admin, { itemId: first, direction: "up" })).toEqual({
      outcome: "at-end",
    });
    expect(await movePreparationItem(admin, { itemId: last, direction: "down" })).toEqual({
      outcome: "at-end",
    });
  });

  it("stays within the item's own level and skips a removed item", async () => {
    const perjadinId = await tripEnding(3);
    const x = await added(cluster(), "X");
    const gone = await added(cluster(), "Hilang");
    const y = await added(cluster(), "Y");
    await removePreparationItem(admin, gone);

    // Up from Y passes over the removed item to X; up again from first in the Cluster stops,
    // rather than climbing into the Semua items above.
    expect(await movePreparationItem(admin, { itemId: y, direction: "up" })).toEqual({
      outcome: "moved",
    });
    expect(await movePreparationItem(admin, { itemId: y, direction: "up" })).toEqual({
      outcome: "at-end",
    });
    expect((await labelsOf(perjadinId)).slice(-2)).toEqual(["Y", "X"]);
    expect((await settingsAt(cluster())).items.slice(-2).map((item) => item.itemId)).toEqual([
      y,
      x,
    ]);
  });

  it("still swaps two items that share a position", async () => {
    const perjadinId = await tripEnding(3);
    const a = await added(trip(perjadinId), "A");
    const b = await added(trip(perjadinId), "B");
    // Two adds at once can land on one position; the resolver then orders them by id.
    await db
      .update(schema.preparationItem)
      .set({ position: 1 })
      .where(eq(schema.preparationItem.perjadinId, perjadinId));
    const before = (await labelsOf(perjadinId)).slice(-2);
    const second = before[1] === "A" ? a : b;

    expect(await movePreparationItem(admin, { itemId: second, direction: "up" })).toEqual({
      outcome: "moved",
    });
    expect((await labelsOf(perjadinId)).slice(-2)).toEqual(before.toReversed());
  });
});

describe("the pickers", () => {
  it("lists every Perjadin newest first, with its Schools", async () => {
    const older = await tripEnding(-10);
    const newer = await tripEnding(10);
    await addProvince("32", "Jawa Barat");
    const school = await addSchool({
      slug: "sma-satu",
      name: "SMA Satu",
      clusterId,
      provinceCode: "32",
      subClusterId,
    });
    await addOfflineSession({
      perjadinId: newer,
      schoolId: school.id,
      heldOn: wibDaysFromToday(9),
    });

    const trips = await preparationSettingsPerjadins(admin);

    expect(trips.map((row) => row.id)).toEqual([newer, older]);
    expect(trips[0]?.schoolNames).toEqual(["SMA Satu"]);
    expect(trips[0]?.subClusterName).toBe("Kelompok 1");
  });

  it("lists the Clusters by name", async () => {
    expect((await preparationSettingsClusters(admin)).map((row) => row.name)).toEqual([
      "Cluster Dua",
      "Cluster Satu",
    ]);
  });
});

describe("Administrator only", () => {
  it("refuses a Staff member who is not an Administrator, on every read and write", async () => {
    const perjadinId = await tripEnding(3);
    const hotel = await companyItem("Pemesanan Hotel");
    const calls: (() => Promise<unknown>)[] = [
      () => preparationSettings(staff, SEMUA),
      () => preparationSettingsPerjadins(staff),
      () => preparationSettingsClusters(staff),
      () => removePreparationItemAt(staff, { itemId: hotel, at: trip(perjadinId) }),
      () => rewordPreparationItemAt(staff, { itemId: hotel, label: "X", at: SEMUA }),
      () => movePreparationItem(staff, { itemId: hotel, direction: "down" }),
      () => showPreparationItem(staff, { itemId: hotel, scope: { perjadinId } }),
      () => clearPreparationItemWording(staff, { itemId: hotel, scope: { perjadinId } }),
    ];

    for (const call of calls) await expect(call()).rejects.toSatisfy(isNotGrantedError);
    expect(await labelsOf(perjadinId)).toEqual(COMPANY_PREPARATION_ITEMS);
  });
});

describe("writes at the same moment", () => {
  it("lets only one of two identical adds through", async () => {
    const results = await Promise.all([
      addPreparationItem(admin, { scope: cluster(), label: "Sama" }),
      addPreparationItem(admin, { scope: cluster(), label: "sama" }),
    ]);

    expect(results.map((result) => result.outcome).toSorted()).toEqual([
      "added",
      "duplicate-label",
    ]);
    const labels = (await settingsAt(cluster())).items.map((item) => item.label.toLowerCase());
    expect(labels.filter((label) => label === "sama")).toHaveLength(1);
  });

  it("applies both of two moves, one after the other, losing neither", async () => {
    const perjadinId = await tripEnding(3);
    const a = await added(trip(perjadinId), "A");
    await added(trip(perjadinId), "B");
    const c = await added(trip(perjadinId), "C");

    await Promise.all([
      movePreparationItem(admin, { itemId: c, direction: "up" }),
      movePreparationItem(admin, { itemId: a, direction: "down" }),
    ]);

    // C up then A down gives C,A,B; A down then C up gives B,C,A. Anything else lost a move.
    expect([
      ["C", "A", "B"],
      ["B", "C", "A"],
    ]).toContainEqual((await labelsOf(perjadinId)).slice(-3));
  });
});

describe("the wording itself", () => {
  it("is stored trimmed, with its runs of spaces made one", async () => {
    const itemId = await added(SEMUA, "  Bawa   spanduk  ");
    const [row] = await db
      .select({ label: schema.preparationItem.label })
      .from(schema.preparationItem)
      .where(eq(schema.preparationItem.id, itemId));
    expect(row?.label).toBe("Bawa spanduk");
  });

  it("is refused as a duplicate by a plain rewording too, at the item's own level", async () => {
    const hotel = await companyItem("Pemesanan Hotel");
    expect(
      await rewordPreparationItem(admin, {
        itemId: hotel,
        label: "Uang pegangan konsumsi sudah diterima",
      }),
    ).toEqual({ outcome: "duplicate-label" });
    expect(
      await rewordPreparationItem(admin, {
        itemId: hotel,
        label: "Uang pegangan konsumsi sudah diterima",
        scope: { clusterId },
      }),
    ).toEqual({ outcome: "duplicate-label" });
  });
});
