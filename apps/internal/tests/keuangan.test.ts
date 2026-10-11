import { db, schema } from "@sugt/db";
import {
  DEFAULT_KEUANGAN_SORT,
  isNotGrantedError,
  isNotStaffError,
  KEUANGAN_SORT_KEYS,
  keuanganExport,
  keuanganPage,
  keuanganPerjadinOptions,
  type KeuanganFilters,
  type KeuanganRow,
  type KeuanganSort,
  type Person,
} from "@sugt/db/queries";
import type { Grant, Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addGrant,
  addPerjadin,
  addPerson,
  addTransaction,
  addTransactionEvidence,
  resetDatabase,
} from "./support/fixtures";

/**
 * **`/keuangan`'s queries** (#472, ADR-0053): every transaction across every Perjadin, filtered by a
 * Perjadin and by a range on the Perjadin's start date, sorted and paged over the whole filtered set,
 * and exported oldest first. A Keuangan holder's or an Administrator's to read, nobody else's.
 */

beforeEach(resetDatabase);

const NO_FILTERS: KeuanganFilters = { perjadinId: null, dari: null, sampai: null };

async function person(email: string, role: Role, grants: Grant[] = []): Promise<Person> {
  const row = await addPerson({ fullName: email, email, role });
  for (const grant of grants) await addGrant(row.id, grant);
  return { ...row, grants } as Person;
}

/**
 * Kelompok 1 starts 1 Okt, Kelompok 2 on 31 Okt, Kelompok 3 on 1 Nov, Kelompok 4 has no transaction.
 * Six lines across the first three, every column distinct enough to sort on.
 */
async function scene() {
  const keuangan = await person("keu@itb.ac.id", "Staff", ["Keuangan"]);
  const trip = (name: string, startsOn: string, endsOn: string) =>
    addPerjadin({ picPersonId: keuangan.id, subClusterName: name, startsOn, endsOn });
  const k1 = await trip("Kelompok 1", "2026-10-01", "2026-10-03");
  const k2 = await trip("Kelompok 2", "2026-10-31", "2026-11-02");
  const k3 = await trip("Kelompok 3", "2026-11-01", "2026-11-02");
  await trip("Kelompok 4", "2026-09-01", "2026-09-02");
  const line = (
    perjadinId: string,
    spentOn: string,
    amountIdr: number,
    category: "Konsumsi" | "Akomodasi" | "ATK" | "Lainnya",
    description: string,
    participantType: "Siswa" | "GTK-MS",
  ) =>
    addTransaction({
      perjadinId,
      spentOn,
      amountIdr,
      category,
      description,
      participantType,
      createdByPersonId: keuangan.id,
    });
  const lines = [
    await line(k1.id, "2026-10-01", 150_000, "Konsumsi", "Makan siang", "Siswa"),
    await line(k1.id, "2026-10-02", 900_000, "Akomodasi", "Hotel", "GTK-MS"),
    await line(k2.id, "2026-10-31", 40_000, "ATK", "Kertas", "Siswa"),
    await line(k2.id, "2026-11-01", 300_000, "Lainnya", "Bensin", "GTK-MS"),
    await line(k3.id, "2026-11-01", 75_000, "Konsumsi", "Air minum", "Siswa"),
    await line(k3.id, "2026-11-02", 1_200_000, "Akomodasi", "Wisma", "GTK-MS"),
  ];
  return { keuangan, k1, k2, k3, lines };
}

const descriptions = (rows: KeuanganRow[]) => rows.map((row) => row.description);

async function all(caller: Person, filters: KeuanganFilters, sort = DEFAULT_KEUANGAN_SORT) {
  return keuanganPage(caller, { filters, sort, page: 1 });
}

describe("who reads it", () => {
  it("is a Keuangan holder's and an Administrator's; a Staff member without either and a Pimpinan are refused", async () => {
    await scene();
    const admin = await person("admin@itb.ac.id", "Staff", ["Administrator"]);
    const editor = await person("ed@itb.ac.id", "Staff", ["Perjadin Editor", "Dashboard Viewer"]);
    const pimpinan = await person("pim@itb.ac.id", "Pimpinan");

    await expect(all(admin, NO_FILTERS)).resolves.toMatchObject({ total: 6 });
    await expect(keuanganExport(admin, NO_FILTERS)).resolves.toHaveLength(6);

    for (const [caller, refused] of [
      [editor, isNotGrantedError],
      [pimpinan, isNotGrantedError],
    ] as const) {
      for (const read of [
        () => all(caller, NO_FILTERS),
        () => keuanganExport(caller, NO_FILTERS),
        () => keuanganPerjadinOptions(caller),
      ]) {
        const error = await read().catch((thrown: unknown) => thrown);
        expect(refused(error) || isNotStaffError(error), caller.email).toBe(true);
      }
    }
  });
});

describe("the table", () => {
  it("lists every transaction, newest Tanggal Transaksi first, with the whole set's count and total", async () => {
    const { keuangan } = await scene();

    const page = await all(keuangan, NO_FILTERS);

    expect(page).toMatchObject({ total: 6, totalIdr: 2_665_000, page: 1, pageCount: 1 });
    expect(page.rows.map((row) => row.spentOn)).toEqual([
      "2026-11-02",
      "2026-11-01",
      "2026-11-01",
      "2026-10-31",
      "2026-10-02",
      "2026-10-01",
    ]);
    expect(page.rows[0]).toMatchObject({
      category: "Akomodasi",
      participantType: "GTK-MS",
      amountIdr: 1_200_000,
      perjadin: { subClusterName: "Kelompok 3", startsOn: "2026-11-01", endsOn: "2026-11-02" },
    });
  });

  it("pages 50 at a time over a stable order, ties broken by entry time then id, never repeating a row", async () => {
    const { keuangan, k1 } = await scene();
    for (let index = 0; index < 52; index += 1) {
      await addTransaction({
        perjadinId: k1.id,
        spentOn: "2026-12-01",
        amountIdr: 1_000,
        createdByPersonId: keuangan.id,
      });
    }

    const first = await keuanganPage(keuangan, {
      filters: NO_FILTERS,
      sort: DEFAULT_KEUANGAN_SORT,
      page: 1,
    });
    const second = await keuanganPage(keuangan, {
      filters: NO_FILTERS,
      sort: DEFAULT_KEUANGAN_SORT,
      page: 2,
    });

    expect(first).toMatchObject({ total: 58, page: 1, pageCount: 2 });
    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(8);
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(58);
    // A page past the end reads as the last one, with the same totals.
    await expect(
      keuanganPage(keuangan, { filters: NO_FILTERS, sort: DEFAULT_KEUANGAN_SORT, page: 9 }),
    ).resolves.toMatchObject({ page: 2, total: 58 });
  });

  it("sorts, counts and totals the whole filtered set, not the page shown", async () => {
    const { keuangan, k1 } = await scene();
    // 52 newer lines of Rp1.000: the default sort fills page one with them alone.
    for (let index = 0; index < 52; index += 1) {
      await addTransaction({
        perjadinId: k1.id,
        spentOn: "2026-12-01",
        amountIdr: 1_000,
        createdByPersonId: keuangan.id,
      });
    }
    const byAmount = (page: number) =>
      keuanganPage(keuangan, {
        filters: NO_FILTERS,
        sort: { key: "amountIdr", direction: "desc" },
        page,
      });

    const [first, second] = [await byAmount(1), await byAmount(2)];
    expect(first.rows.slice(0, 6).map((row) => row.amountIdr)).toEqual([
      1_200_000, 900_000, 300_000, 150_000, 75_000, 40_000,
    ]);
    expect(second.rows.map((row) => row.amountIdr)).toEqual(Array(8).fill(1_000));
    for (const page of [first, second]) {
      expect(page).toMatchObject({ total: 58, totalIdr: 2_665_000 + 52_000 });
    }
  });

  it("breaks ties by entry time, then id, the same way as the column", async () => {
    const { keuangan, k1 } = await scene();
    // Pairs entered in the same instant, the pairs a second apart, the later pairs inserted first.
    const base = Date.parse("2026-12-01T00:00:00Z");
    for (let index = 0; index < 52; index += 1) {
      const line = await addTransaction({
        perjadinId: k1.id,
        spentOn: "2026-12-01",
        amountIdr: 1_000,
        createdByPersonId: keuangan.id,
      });
      await db
        .update(schema.transaction)
        .set({ createdAt: new Date(base - Math.floor(index / 2) * 1_000) })
        .where(eq(schema.transaction.id, line.id));
    }
    const tied = await db
      .select({ id: schema.transaction.id, createdAt: schema.transaction.createdAt })
      .from(schema.transaction)
      .where(eq(schema.transaction.spentOn, "2026-12-01"));
    const expected = tied
      .toSorted(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )
      .map((row) => row.id);

    const pages = await Promise.all(
      [1, 2].map((page) =>
        keuanganPage(keuangan, { filters: NO_FILTERS, sort: DEFAULT_KEUANGAN_SORT, page }),
      ),
    );
    const shown = pages.flatMap((page) => page.rows).filter((row) => row.spentOn === "2026-12-01");
    expect(shown.map((row) => row.id)).toEqual(expected);
  });

  it("sorts by Perjadin on its start date, not its name", async () => {
    const { keuangan, k1 } = await scene();
    // Kelompok 9 starts first, though its name sorts last.
    await db
      .update(schema.subCluster)
      .set({ name: "Kelompok 9" })
      .where(eq(schema.subCluster.id, k1.subClusterId));

    const { rows } = await all(keuangan, NO_FILTERS, { key: "perjadin", direction: "asc" });
    expect(rows.map((row) => row.perjadin.subClusterName)).toEqual([
      "Kelompok 9",
      "Kelompok 9",
      "Kelompok 2",
      "Kelompok 2",
      "Kelompok 3",
      "Kelompok 3",
    ]);
  });

  it.each(KEUANGAN_SORT_KEYS)("sorts by %s both ways over the whole set", async (key) => {
    const { keuangan } = await scene();
    const expected = (direction: "asc" | "desc") => {
      const value = (row: KeuanganRow): string | number =>
        key === "perjadin" ? row.perjadin.startsOn : row[key];
      return (rows: KeuanganRow[]) =>
        rows.every((row, index) => {
          if (index === 0) return true;
          const [a, b] = [value(rows[index - 1]!), value(row)];
          // Text compares as the database collates it, letters before case; numbers numerically.
          const order = typeof a === "number" ? a - (b as number) : a.localeCompare(b as string);
          return direction === "asc" ? order <= 0 : order >= 0;
        });
    };

    for (const direction of ["asc", "desc"] as const) {
      const sort: KeuanganSort = { key, direction };
      const { rows } = await all(keuangan, NO_FILTERS, sort);
      expect(rows, direction).toHaveLength(6);
      expect(expected(direction)(rows), `${key} ${direction}`).toBe(true);
    }
  });
});

describe("the filters", () => {
  it("narrows to one Perjadin, and offers only Perjadin with transactions, earliest first", async () => {
    const { keuangan, k2 } = await scene();

    expect(descriptions((await all(keuangan, { ...NO_FILTERS, perjadinId: k2.id })).rows)).toEqual([
      "Bensin",
      "Kertas",
    ]);
    const options = await keuanganPerjadinOptions(keuangan);
    expect(options.map((option) => option.subClusterName)).toEqual([
      "Kelompok 1",
      "Kelompok 2",
      "Kelompok 3",
    ]);
  });

  it("keeps the Perjadin whose start date is in Dari–Sampai, both ends inclusive, either end open", async () => {
    const { keuangan } = await scene();
    const trips = async (dari: string | null, sampai: string | null) =>
      [
        ...new Set(
          (await all(keuangan, { perjadinId: null, dari, sampai })).rows.map(
            (row) => row.perjadin.subClusterName,
          ),
        ),
      ].toSorted();

    await expect(trips("2026-10-01", "2026-10-31")).resolves.toEqual(["Kelompok 1", "Kelompok 2"]);
    await expect(trips("2026-10-02", "2026-11-01")).resolves.toEqual(["Kelompok 2", "Kelompok 3"]);
    await expect(trips("2026-10-31", null)).resolves.toEqual(["Kelompok 2", "Kelompok 3"]);
    await expect(trips(null, "2026-10-01")).resolves.toEqual(["Kelompok 1"]);
    // Kelompok 2's transactions run into November; only the trip's start date counts.
    await expect(trips("2026-11-01", "2026-11-30")).resolves.toEqual(["Kelompok 3"]);
  });

  it("ANDs the Perjadin and the dates, and reads an unknown or malformed id as empty", async () => {
    const { keuangan, k3 } = await scene();

    await expect(
      all(keuangan, { perjadinId: k3.id, dari: null, sampai: "2026-10-31" }),
    ).resolves.toMatchObject({ rows: [], total: 0, totalIdr: 0, pageCount: 1 });
    for (const perjadinId of ["bukan-id", "00000000-0000-4000-8000-000000000000"]) {
      await expect(all(keuangan, { ...NO_FILTERS, perjadinId })).resolves.toMatchObject({
        total: 0,
      });
    }
  });
});

describe("the receipts", () => {
  it("carries up to five, by upload time then id, and marks a line not yet synced", async () => {
    const { keuangan, lines } = await scene();
    const [hotel] = lines.filter((line) => line.description === "Hotel");
    for (const [index, minute] of [3, 1, 5, 2, 6, 4].entries()) {
      const receipt = await addTransactionEvidence({
        transactionId: hotel!.id,
        uploadedByPersonId: keuangan.id,
        driveFileId: `bukti-${index}`,
      });
      await db
        .update(schema.transactionEvidence)
        .set({ uploadedAt: new Date(Date.UTC(2026, 9, 2, 1, minute)) })
        .where(eq(schema.transactionEvidence.id, receipt.id));
    }
    await db
      .update(schema.transaction)
      .set({ driveSyncedAt: new Date() })
      .where(eq(schema.transaction.id, lines[0]!.id));

    const { rows } = await all(keuangan, NO_FILTERS);
    const row = (description: string) => rows.find((line) => line.description === description)!;

    // Uploaded at minutes 3, 1, 5, 2, 6, 4: the first five by time, the sixth left off.
    expect(row("Hotel").receiptFileIds).toEqual([
      "bukti-1",
      "bukti-3",
      "bukti-0",
      "bukti-5",
      "bukti-2",
    ]);
    expect(row("Kertas").receiptFileIds).toEqual([]);
    expect(row("Makan siang").driveSyncedAt).toBeInstanceOf(Date);
    expect(row("Hotel").driveSyncedAt).toBeNull();
  });
});

describe("the export", () => {
  it("is every row of the filter, oldest first whatever the page's sort, regardless of page", async () => {
    const { keuangan, k1 } = await scene();
    for (let index = 0; index < 50; index += 1) {
      await addTransaction({
        perjadinId: k1.id,
        spentOn: "2026-09-15",
        amountIdr: 1_000,
        createdByPersonId: keuangan.id,
      });
    }

    const rows = await keuanganExport(keuangan, NO_FILTERS);

    expect(rows).toHaveLength(56);
    expect(rows.map((row) => row.spentOn)).toEqual(rows.map((row) => row.spentOn).toSorted());
    expect(descriptions(rows.slice(-2))).toEqual(["Air minum", "Wisma"]);
    await expect(
      keuanganExport(keuangan, { perjadinId: null, dari: "2026-10-31", sampai: null }),
    ).resolves.toHaveLength(4);
  });
});
