import Page from "-/app/(app)/page";
import {
  addWeeks,
  deriveWeek,
  parseWeekParam,
  weekOf,
  weekStarts,
  weekTitle,
} from "-/app/(app)/persiapan-luring-derive";
import { ReadOnlyChecklist } from "-/app/(app)/persiapan-luring-tab";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import {
  addPreparationItem,
  hidePreparationItem,
  preparationWeek,
  togglePreparationItem,
  type Person,
} from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addGrant,
  addPerjadin,
  addPerson,
  addSubCluster,
  COMPANY_PREPARATION_ITEMS,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Persiapan Luring** (#423): the Dashboard tab that follows one Monday–Saturday week's Preparation
 * Checklists. The week rule is pure and pinned without a database; the figures are pinned through
 * the real query and resolver, on a week in the future so every trip has the company's 14.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined }),
}));

/** Monday 8 March 2027: the week every database test below reads. */
const MONDAY = "2027-03-08";

describe("which week a date is in", () => {
  it("puts Monday to Saturday in the week of that Monday", () => {
    expect(weekOf("2027-03-08")).toBe(MONDAY);
    expect(weekOf("2027-03-10")).toBe(MONDAY);
    expect(weekOf("2027-03-13")).toBe(MONDAY);
  });

  it("puts a Sunday in the week that starts the next day", () => {
    expect(weekOf("2027-03-07")).toBe(MONDAY);
    expect(weekOf("2027-03-14")).toBe("2027-03-15");
    // The ticket's example: Kelompok 12 · 11–14 Okt 2026 starts on a Sunday, in the week of 12–17.
    expect(weekOf("2026-10-11")).toBe("2026-10-12");
  });

  it("reads trips from the Sunday before through the Saturday", () => {
    expect(weekStarts(MONDAY)).toEqual({ from: "2027-03-07", until: "2027-03-13" });
  });

  it("steps by whole weeks across a month and a year", () => {
    expect(addWeeks("2026-12-28", 1)).toBe("2027-01-04");
    expect(addWeeks("2026-10-05", -1)).toBe("2026-09-28");
  });

  it("titles the week Monday to Saturday, across a month and a year", () => {
    expect(weekTitle("2026-10-12")).toBe("Persiapan Luring 12–17 Okt 2026");
    expect(weekTitle("2026-09-28")).toBe("Persiapan Luring 28 Sep – 3 Okt 2026");
    expect(weekTitle("2026-12-28")).toBe("Persiapan Luring 28 Des 2026 – 2 Jan 2027");
  });

  it("takes any real date from the URL as its week, and today's week for anything else", () => {
    expect(parseWeekParam("2027-03-11", "2026-10-07")).toBe(MONDAY);
    expect(parseWeekParam("2027-03-07", "2026-10-07")).toBe(MONDAY);
    expect(parseWeekParam(undefined, "2027-03-09")).toBe(MONDAY);
    expect(parseWeekParam("2027-02-30", "2027-03-09")).toBe(MONDAY);
    expect(parseWeekParam("minggu-lalu", "2027-03-14")).toBe("2027-03-15");
  });

  it("refuses a year no week of the Programme is in, so the query never sees one", () => {
    for (const odd of ["0000-01-01", "0001-01-01", "1899-12-31", "3000-01-01", "9999-12-31"]) {
      expect(parseWeekParam(odd, "2027-03-09")).toBe(MONDAY);
    }
  });
});

let admin: Person;
let clusterId: string;
let otherClusterId: string;
let subClusterId: string;
let otherSubClusterId: string;

/** A trip starting on `startsOn` and ending two days later, in Cluster Satu unless told otherwise. */
async function tripStarting(startsOn: string, inSubCluster = subClusterId) {
  const end = new Date(`${startsOn}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  const row = await addPerjadin({
    picPersonId: admin.id,
    subClusterId: inSubCluster,
    startsOn,
    endsOn: end.toISOString().slice(0, 10),
  });
  return row.id;
}

async function companyItem(label: string) {
  const [row] = await db
    .select({ id: schema.preparationItem.id })
    .from(schema.preparationItem)
    .where(eq(schema.preparationItem.label, label));
  return row!.id;
}

async function figuresOf(monday: string) {
  return deriveWeek(await preparationWeek(admin, weekStarts(monday)));
}

describe("the Per item order, folded from rows in any order", () => {
  it("puts the lowest percent first and keeps checklist order among equals", () => {
    const listItem = (
      itemId: string,
      level: "semua" | "cluster" | "perjadin",
      checked: boolean,
    ) => ({
      itemId,
      label: itemId,
      level,
      clearsOnTeachingTeamChange: false,
      checked,
      checkedBy: null,
      checkedAt: null,
    });
    const trip = {
      id: "t",
      subClusterName: "Kelompok 1",
      startsOn: MONDAY,
      endsOn: MONDAY,
      picFullName: "PIC",
      schoolNames: [],
      preparation: [
        listItem("s1", "semua", false),
        listItem("s2", "semua", true),
        listItem("s3", "semua", false),
        listItem("c1", "cluster", false),
        listItem("p1", "perjadin", false),
      ],
    };
    // The query returns the items in no particular order; checklist order is level, then position.
    const items = [
      { itemId: "p1", label: "p1", level: "perjadin" as const, position: 1 },
      { itemId: "c1", label: "c1", level: "cluster" as const, position: 1 },
      { itemId: "s3", label: "s3", level: "semua" as const, position: 3 },
      { itemId: "s2", label: "s2", level: "semua" as const, position: 2 },
      { itemId: "s1", label: "s1", level: "semua" as const, position: 1 },
    ];

    const order = deriveWeek({ perjadins: [trip], items }).items.map((row) => row.itemId);
    expect(order).toEqual(["s1", "s3", "c1", "p1", "s2"]);
  });
});

describe("a week's Perjadins and figures", () => {
  beforeEach(async () => {
    await resetDatabase();
    const person = await addPerson({
      fullName: "Admin",
      email: "admin@ditsama.itb.ac.id",
      role: "Staff",
    });
    admin = { ...person, grants: ["Administrator"] } as Person;
    clusterId = (await addCluster({ slug: "c-satu", name: "Cluster Satu" })).id;
    otherClusterId = (await addCluster({ slug: "c-dua", name: "Cluster Dua" })).id;
    subClusterId = (await addSubCluster({ slug: "k-satu", name: "Kelompok 1", clusterId })).id;
    otherSubClusterId = (
      await addSubCluster({ slug: "k-dua", name: "Kelompok 2", clusterId: otherClusterId })
    ).id;
  });

  it("holds the trips starting Sunday before through Saturday, ordered by start", async () => {
    const saturdayBefore = await tripStarting("2027-03-06");
    const sunday = await tripStarting("2027-03-07");
    const wednesday = await tripStarting("2027-03-10");
    const saturday = await tripStarting("2027-03-13");
    const sundayAfter = await tripStarting("2027-03-14");

    const ids = (await figuresOf(MONDAY)).perjadins.map((trip) => trip.id);
    expect(ids).toEqual([sunday, wednesday, saturday]);

    // Each trip is in exactly one week: the Saturday before is the week before's, the Sunday after
    // the week after's.
    expect((await figuresOf(addWeeks(MONDAY, -1))).perjadins.map((trip) => trip.id)).toEqual([
      saturdayBefore,
    ]);
    expect((await figuresOf(addWeeks(MONDAY, 1))).perjadins.map((trip) => trip.id)).toEqual([
      sundayAfter,
    ]);
  });

  it("sums ticked over all items, each trip with its own list", async () => {
    // A: the 14 plus one item of its own — 15. B, in Cluster Dua, which hides one — 13.
    const a = await tripStarting("2027-03-08");
    const b = await tripStarting("2027-03-09", otherSubClusterId);
    const extra = await addPreparationItem(admin, {
      scope: { level: "perjadin", perjadinId: a },
      label: "Sewa bus",
    });
    if (extra.outcome !== "added") throw new Error("fixture failed");
    const hotel = await companyItem("Pemesanan Hotel");
    await hidePreparationItem(admin, { itemId: hotel, scope: { clusterId: otherClusterId } });
    const first = await companyItem(COMPANY_PREPARATION_ITEMS[0]!);
    const second = await companyItem(COMPANY_PREPARATION_ITEMS[1]!);
    for (const itemId of [first, second, extra.itemId]) {
      await togglePreparationItem(admin, { perjadinId: a, itemId, checked: true });
    }
    await togglePreparationItem(admin, { perjadinId: b, itemId: first, checked: true });

    const figures = await figuresOf(MONDAY);

    expect(figures.perjadins.map((trip) => [trip.done, trip.total, trip.percent])).toEqual([
      [3, 15, 20],
      [1, 13, 8],
    ]);
    expect([figures.done, figures.total, figures.percent]).toEqual([4, 28, 14]);
  });

  it("counts each item over the trips it applies to, lowest percentage first", async () => {
    const a = await tripStarting("2027-03-08");
    const b = await tripStarting("2027-03-09", otherSubClusterId);
    const extra = await addPreparationItem(admin, {
      scope: { level: "perjadin", perjadinId: a },
      label: "Sewa bus",
    });
    if (extra.outcome !== "added") throw new Error("fixture failed");
    const hotel = await companyItem("Pemesanan Hotel");
    await hidePreparationItem(admin, { itemId: hotel, scope: { clusterId: otherClusterId } });
    // A rewording at a narrower level is still the same item, under its own wording.
    await db.insert(schema.preparationItemWording).values({
      preparationItemId: hotel,
      perjadinId: a,
      label: "Hotel",
    });
    const first = await companyItem(COMPANY_PREPARATION_ITEMS[0]!);
    const second = await companyItem(COMPANY_PREPARATION_ITEMS[1]!);
    await togglePreparationItem(admin, { perjadinId: a, itemId: first, checked: true });
    await togglePreparationItem(admin, { perjadinId: b, itemId: first, checked: true });
    await togglePreparationItem(admin, { perjadinId: a, itemId: second, checked: true });
    await togglePreparationItem(admin, { perjadinId: a, itemId: hotel, checked: true });

    const rows = new Map((await figuresOf(MONDAY)).items.map((row) => [row.itemId, row]));

    expect(rows.size).toBe(15);
    expect(rows.get(first)).toEqual(expect.objectContaining({ done: 2, applies: 2, percent: 100 }));
    expect(rows.get(second)).toEqual(expect.objectContaining({ done: 1, applies: 2, percent: 50 }));
    expect(rows.get(hotel)).toEqual(
      expect.objectContaining({ label: "Pemesanan Hotel", done: 1, applies: 1, percent: 100 }),
    );
    expect(rows.get(extra.itemId)).toEqual(
      expect.objectContaining({ label: "Sewa bus", done: 0, applies: 1, percent: 0 }),
    );

    const order = (await figuresOf(MONDAY)).items;
    expect(order.map((row) => row.percent)).toEqual(
      order.map((row) => row.percent).toSorted((x, y) => x - y),
    );
    // Ties keep checklist order: the 0% rows are the company items in order, then Sewa bus last.
    const zero = order.filter((row) => row.percent === 0).map((row) => row.label);
    expect(zero.at(-1)).toBe("Sewa bus");
    expect(zero.slice(0, -1)).toEqual(
      COMPANY_PREPARATION_ITEMS.filter((label, index) => index > 1 && label !== "Pemesanan Hotel"),
    );
  });

  it("is empty for a week with no Perjadins", async () => {
    await tripStarting("2027-03-15");

    expect(await figuresOf(MONDAY)).toEqual({
      done: 0,
      total: 0,
      percent: 0,
      perjadins: [],
      items: [],
    });
  });
});

describe("the Dashboard's tabs", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  const render = async (params: Record<string, string> = {}) =>
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) } as never));

  async function pimpinan() {
    const row = await addPerson({ fullName: "Pim", email: "pim@itb.ac.id", role: "Pimpinan" });
    vi.mocked(requirePerson).mockResolvedValue(row);
    return row;
  }

  it("reads Pelaksanaan · Persiapan Program · Persiapan Luring, opening on Pelaksanaan", async () => {
    await pimpinan();
    const html = await render();

    const tabs = [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(tabs).toEqual(["Pelaksanaan", "Persiapan Program", "Persiapan Luring"]);
    expect(html).not.toContain("Persiapan Luring 8–13 Mar 2027");
  });

  it("opens on Persiapan Luring for a URL naming a week, read-only even for a Dashboard Editor", async () => {
    const staff = await addPerson({ fullName: "Ed", email: "ed@itb.ac.id", role: "Staff" });
    await addGrant(staff.id, "Dashboard Editor");
    vi.mocked(requirePerson).mockResolvedValue({
      ...staff,
      grants: ["Dashboard Editor"],
    } as Person);
    const cluster = (await addCluster({ slug: "c", name: "Cluster" })).id;
    const sub = (await addSubCluster({ slug: "k", name: "Kelompok 7", clusterId: cluster })).id;
    await addPerjadin({
      picPersonId: staff.id,
      subClusterId: sub,
      startsOn: "2027-03-09",
      endsOn: "2027-03-11",
    });

    const html = await render({ minggu: "2027-03-10" });

    expect(html).toContain("Persiapan Luring 8–13 Mar 2027");
    expect(html).toContain("0/14 item · 1 Perjadin");
    expect(html).toContain("Kelompok 7 · 9–11 Mar 2027");
  });

  it("says so for a week with no Perjadins", async () => {
    await pimpinan();
    expect(await render({ minggu: "2027-03-08" })).toContain("Tidak ada Perjadin minggu ini");
  });
});

describe("the read-only checklist a card opens", () => {
  it("renders every box disabled, ticked or not", () => {
    const item = (itemId: string, checked: boolean) => ({
      itemId,
      label: itemId,
      level: "semua" as const,
      clearsOnTeachingTeamChange: false,
      checked,
      checkedBy: null,
      checkedAt: null,
    });
    const html = renderToStaticMarkup(
      createElement(ReadOnlyChecklist, { items: [item("a", true), item("b", false)] }),
    );

    const boxes = [...html.matchAll(/<[^>]*role="checkbox"[^>]*>/g)].map((match) => match[0]);
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box).toContain('aria-disabled="true"');
  });
});
