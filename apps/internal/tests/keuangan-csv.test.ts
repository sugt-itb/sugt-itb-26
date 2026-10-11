import { keuanganCsv, keuanganCsvFileName } from "-/app/(app)/keuangan/ekspor/keuangan-csv";
import {
  keuanganExportHref,
  keuanganHref,
  parseKeuanganParams,
  sortAfterClick,
} from "-/app/(app)/keuangan/keuangan-params";
import { csvOf } from "-/app/(app)/perjadin/[id]/laporan/ekspor/csv";
import { csvDocument } from "-/lib/csv";
import type { KeuanganRow, PerjadinAcquittal } from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

/**
 * **`/keuangan`'s URL, its export and the shared CSV writer** (#472), with no database and no HTTP:
 * the URL round-trips and falls back on anything malformed, the export is exactly its ten columns,
 * and the writer both exports share guards a formula-looking text cell.
 */

/** RFC 4180, as the two exports write it: a BOM, every field quoted, CRLF rows. */
function parse(csv: string): string[][] {
  expect(csv.startsWith("﻿")).toBe(true);
  return csv
    .slice(1)
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => {
      const fields = [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(([, inner]) =>
        inner!.replaceAll('""', '"'),
      );
      expect(fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(","), line).toBe(line);
      return fields;
    });
}

const UUID = "11111111-2222-4333-8444-555555555555";

describe("the URL", () => {
  it("round-trips the filter, sort and page, carrying only what is not the default", () => {
    const view = parseKeuanganParams({
      perjadin: UUID,
      dari: "2026-10-01",
      sampai: "2026-10-31",
      urut: "amountIdr",
      arah: "asc",
      page: "3",
    });

    expect(view).toMatchObject({
      filters: { perjadinId: UUID, dari: "2026-10-01", sampai: "2026-10-31" },
      sort: { key: "amountIdr", direction: "asc" },
      page: 3,
      rangeReversed: false,
    });
    const href = keuanganHref(view);
    expect(parseKeuanganParams(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual(
      view,
    );
    expect(keuanganHref(parseKeuanganParams({}))).toBe("/keuangan");
    expect(keuanganExportHref(view.filters)).toBe(
      `/keuangan/ekspor?perjadin=${UUID}&dari=2026-10-01&sampai=2026-10-31`,
    );
  });

  it("falls back to the defaults on anything malformed", () => {
    expect(
      parseKeuanganParams({
        perjadin: "bukan-id",
        dari: "2026-02-30",
        sampai: "kemarin",
        urut: "kodeRahasia",
        arah: "naik",
        page: "-2",
      }),
    ).toMatchObject({
      filters: { perjadinId: null, dari: null, sampai: null },
      sort: { key: "spentOn", direction: "desc" },
      page: 1,
    });
    // A column named without a direction starts descending, as a header click does.
    expect(parseKeuanganParams({ urut: "category" }).sort).toEqual({
      key: "category",
      direction: "desc",
    });
  });

  it("applies neither date when Dari is after Sampai, and says so", () => {
    expect(parseKeuanganParams({ dari: "2026-11-01", sampai: "2026-10-01" })).toMatchObject({
      filters: { dari: null, sampai: null },
      rangeReversed: true,
      entered: { dari: "2026-11-01", sampai: "2026-10-01" },
    });
  });

  it("sorts a newly chosen column descending first, and flips the sorted one", () => {
    const byDate = { key: "spentOn", direction: "desc" } as const;
    expect(sortAfterClick(byDate, "amountIdr")).toEqual({ key: "amountIdr", direction: "desc" });
    expect(sortAfterClick(byDate, "spentOn")).toEqual({ key: "spentOn", direction: "asc" });
    expect(sortAfterClick({ key: "spentOn", direction: "asc" }, "spentOn")).toEqual(byDate);
  });
});

const row = (over: Partial<KeuanganRow>): KeuanganRow => ({
  id: "t",
  spentOn: "2026-10-12",
  category: "Konsumsi",
  description: "Makan siang",
  participantType: "Siswa",
  amountIdr: 150_000,
  perjadin: {
    id: "p",
    subClusterName: "Kelompok 10",
    startsOn: "2026-10-12",
    endsOn: "2026-10-13",
  },
  driveSyncedAt: null,
  receiptFileIds: [],
  ...over,
});

describe("the export", () => {
  it("is its ten columns, a row per transaction in the order given, Jumlah as digits, links as URLs", () => {
    const csv = keuanganCsv([
      row({ id: "a", spentOn: "2026-10-01", receiptFileIds: ["f1", "f2"] }),
      row({
        id: "b",
        spentOn: "2026-10-02",
        category: "Akomodasi",
        description: 'Hotel "Bintang", 2 malam',
        participantType: "GTK-MS",
        amountIdr: 1_250_000,
        receiptFileIds: ["g1", "g2", "g3", "g4", "g5"],
      }),
    ]);
    const [header, ...rows] = parse(csv);

    expect(header).toEqual([
      "Tanggal Transaksi",
      "Kategori",
      "Keterangan",
      "Tipe Peserta",
      "Jumlah (Rp)",
      "Link Bukti 1",
      "Link Bukti 2",
      "Link Bukti 3",
      "Link Bukti 4",
      "Link Bukti 5",
    ]);
    expect(rows).toEqual([
      [
        "2026-10-01",
        "Konsumsi",
        "Makan siang",
        "Siswa",
        "150000",
        "https://drive.google.com/file/d/f1/view",
        "https://drive.google.com/file/d/f2/view",
        "",
        "",
        "",
      ],
      [
        "2026-10-02",
        "Akomodasi",
        'Hotel "Bintang", 2 malam',
        "GTK-MS",
        "1250000",
        ...["g1", "g2", "g3", "g4", "g5"].map((id) => `https://drive.google.com/file/d/${id}/view`),
      ],
    ]);
    expect(csv).not.toContain("HYPERLINK");
    expect(csv).not.toContain("Perjadin");
  });

  it("guards a Keterangan that starts like a formula, in this export and the Laporan's", () => {
    const risky = ["=1+1", "+62 812", "-5 diskon", "@SUM(A1)", "\tTab", "\rCR"];
    const keuangan = parse(
      keuanganCsv(risky.map((description, index) => row({ id: String(index), description }))),
    );
    expect(keuangan.slice(1).map((fields) => fields[2])).toEqual(risky.map((text) => `'${text}`));

    const acquittal = {
      transactions: risky.map((description, index) => ({
        id: String(index),
        spentOn: "2026-10-12",
        description,
        amountIdr: 1_000,
        category: "Konsumsi",
        participantType: "Siswa",
        driveFolderId: null,
        driveSyncedAt: null,
        evidence: [],
      })),
      spentIdr: 6_000,
      siswaSpentIdr: 6_000,
      gtkMsSpentIdr: 0,
      pimpinan: [],
    } as unknown as PerjadinAcquittal;
    const laporan = parse(csvOf(acquittal));
    expect(laporan.slice(1, 7).map((fields) => fields[1])).toEqual(risky.map((text) => `'${text}`));
  });

  it("leaves numbers and ordinary text alone", () => {
    expect(parse(csvDocument([[-5, 1_000, "2026-10-12", "Hotel", "a=b"]]))).toEqual([
      ["-5", "1000", "2026-10-12", "Hotel", "a=b"],
    ]);
  });

  it("names the file for its filter and today", () => {
    const none = { perjadinId: null, dari: null, sampai: null };
    const trip = {
      id: UUID,
      subClusterName: "Kelompok 10",
      startsOn: "2026-10-12",
      endsOn: "2026-10-13",
    };
    expect(keuanganCsvFileName(none, null, "2026-10-12")).toBe("keuangan-semua-2026-10-12.csv");
    expect(keuanganCsvFileName({ ...none, perjadinId: UUID }, trip, "2026-10-12")).toBe(
      "keuangan-kelompok-10-12-13-okt-2026-2026-10-12.csv",
    );
    expect(
      keuanganCsvFileName(
        { ...none, dari: "2026-10-01", sampai: "2026-10-31" },
        null,
        "2026-10-12",
      ),
    ).toBe("keuangan-2026-10-01_2026-10-31-2026-10-12.csv");
    expect(keuanganCsvFileName({ ...none, dari: "2026-10-01" }, null, "2026-10-12")).toBe(
      "keuangan-2026-10-01_-2026-10-12.csv",
    );
  });
});
