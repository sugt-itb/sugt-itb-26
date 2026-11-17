import {
  fetchKeuanganSheet,
  keuanganSourceFromUrl,
  parseKeuanganCsv,
  type KeuanganSheet,
} from "-/lib/keuangan-sheet";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **The `/keuangan` Block B reader, tested with no network (#548).** The parser is pure — CSV in, typed
 * Kelompok and totals out, or a typed failure naming the row or column — so every rule the ticket
 * names is an assertion here, against a made-up sheet built in the test. The repo is public: no real
 * names, amounts, sheet id or URL appear below.
 */

describe("keuanganSourceFromUrl", () => {
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-xyz";

  it("takes the gid from the query", () => {
    expect(
      keuanganSourceFromUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=123456`),
    ).toEqual({ ok: true, sheetId: ID, gid: "123456" });
  });

  it("takes the gid from the fragment, trimming the pasted text", () => {
    expect(
      keuanganSourceFromUrl(`  https://docs.google.com/spreadsheets/d/${ID}/edit#gid=987\n`),
    ).toEqual({ ok: true, sheetId: ID, gid: "987" });
  });

  it("prefers the fragment's gid, which is the tab the browser has open", () => {
    expect(
      keuanganSourceFromUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0#gid=55`),
    ).toEqual({ ok: true, sheetId: ID, gid: "55" });
  });

  it.each([
    ["another host", `https://example.com/spreadsheets/d/${ID}/edit#gid=1`],
    ["a look-alike host", `https://docs.google.com.example.com/spreadsheets/d/${ID}/edit#gid=1`],
    ["plain http", `http://docs.google.com/spreadsheets/d/${ID}/edit#gid=1`],
    ["another path", `https://docs.google.com/document/d/${ID}/edit#gid=1`],
    ["no sheet id", "https://docs.google.com/spreadsheets/d//edit#gid=1"],
    ["a missing gid", `https://docs.google.com/spreadsheets/d/${ID}/edit`],
    ["a non-numeric gid", `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=abc`],
    ["text that is not a URL", "Blok B"],
    ["an empty paste", "   "],
    ["a port", `https://docs.google.com:8443/spreadsheets/d/${ID}/edit#gid=1`],
    ["credentials", `https://user:pass@docs.google.com/spreadsheets/d/${ID}/edit#gid=1`],
    [
      "a published-to-web link",
      "https://docs.google.com/spreadsheets/d/e/2PACX-made-up/pubhtml?gid=1",
    ],
  ])("refuses %s with a reason", (_, text) => {
    const result = keuanganSourceFromUrl(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/\S/);
  });

  it("says the gid is what is missing, since that is the usual mistake", () => {
    const result = keuanganSourceFromUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
    expect(result).toEqual({ ok: false, detail: expect.stringContaining("gid") });
  });
});

/** The columns the reader looks up by header, plus Finance's hidden ones and a side note it ignores. */
type Column =
  | "A"
  | "Sub Blok Anggaran"
  | "E"
  | "Kegiatan"
  | "Link"
  | "Link_raw"
  | "Alokasi_formula"
  | "Tgl"
  | "Bln"
  | "Thn"
  | "Alokasi"
  | "Realisasi"
  | "Sisa"
  | "Catatan";

type Row = Partial<Record<Column, string>>;

/** Finance's layout: the hidden columns A and E, a side note on the right. */
const SHEET_ORDER: Column[] = [
  "A",
  "Sub Blok Anggaran",
  "E",
  "Kegiatan",
  "Link",
  "Link_raw",
  "Alokasi_formula",
  "Tgl",
  "Bln",
  "Thn",
  "Alokasi",
  "Realisasi",
  "Sisa",
  "Catatan",
];

/** Tgl, Bln and Thn sit under a merged "Tanggal" in row 1; every other header is on row 1. */
const ROW_2_HEADERS: Column[] = ["Tgl", "Bln", "Thn"];
const UNNAMED: Column[] = ["A", "E"];

const quote = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

/** Build the tab's CSV export from rows, the two header rows first, in the given column order. */
function sheetCsv(rows: Row[], order: Column[] = SHEET_ORDER): string {
  const header1 = order.map((c) =>
    UNNAMED.includes(c) ? "" : ROW_2_HEADERS.includes(c) ? (c === "Tgl" ? "Tanggal" : "") : c,
  );
  const header2 = order.map((c) => (ROW_2_HEADERS.includes(c) ? c : ""));
  return [header1, header2, ...rows.map((r) => order.map((c) => r[c] ?? ""))]
    .map((cells) => cells.map(quote).join(","))
    .join("\r\n");
}

/**
 * A made-up Block B tab. Rows 3 on: a preamble row before the first Kelompok (ignored), two Kelompok,
 * Finance's total row (the stop row), and Finance's roll-up below it (ignored).
 */
const ROWS: Row[] = [
  // Row 3: before the first Kelompok — ignored, money and all.
  { "Sub Blok Anggaran": "Blok B Pembelajaran Luring", Alokasi: "Rp999", Realisasi: "Rp999" },
  // Row 4: Kelompok 1 opens; its Sisa is ignored.
  { "Sub Blok Anggaran": "Kelompok 1\nSMA Contoh Satu\nSMA Contoh Dua", Sisa: "Rp0" },
  // Row 5: a Budget Line with new money, a receipt link and a full date.
  {
    A: "1",
    Kegiatan: "Konsumsi",
    Link: "Nota 1",
    Link_raw: "https://example.com/nota-1",
    Alokasi_formula: "FALSE",
    Tgl: "12",
    Bln: "10",
    Thn: "2026",
    Alokasi: "Rp1.000.000",
    Realisasi: "Rp250.000",
    Sisa: "Rp750.000",
    Catatan: "catatan Keuangan",
  },
  // Row 6: same line (empty Kegiatan), a carried balance, a label with no URL, month and year only.
  {
    Link: "Bluebird",
    Alokasi_formula: "true",
    Bln: "10",
    Thn: "2026",
    Alokasi: "Rp750.000",
    Realisasi: "Rp300.000",
    Sisa: "Rp450.000",
  },
  // Row 7: same line, a top-up of new money on an empty Kegiatan — kept, though otherwise blank.
  { Alokasi_formula: "SALAH", Alokasi: "Rp200.000", Sisa: "Rp650.000" },
  // Row 8: a blank carried row — dropped.
  { Alokasi_formula: "BENAR", Alokasi: "Rp650.000", Sisa: "Rp650.000" },
  // Row 9: a new line with Realisasi and no Alokasi, a negative Sisa, and a URL that is not http(s).
  {
    Kegiatan: "Transportasi",
    Link: "Tiket",
    Link_raw: "javascript:alert(1)",
    Realisasi: "Rp100.000",
    Sisa: "-Rp100.000",
  },
  // Row 10: an empty row — dropped.
  {},
  // Row 11: Kelompok 2.
  { "Sub Blok Anggaran": "Kelompok 2" },
  // Row 12: comma-grouped figures.
  {
    Kegiatan: "Penginapan",
    Alokasi_formula: "FALSE",
    Alokasi: "2,000,000",
    Realisasi: "1,234,500",
    Sisa: "765,500",
  },
  // Row 13: a refund — a negative Realisasi, with the minus after Rp — and its receipt.
  {
    Link: "Bukti refund",
    Link_raw: "http://example.com/refund",
    Realisasi: "Rp-45.600",
    Sisa: "811,100",
  },
  // Row 14: an Indonesian decimal, with a non-breaking space around the value.
  { Kegiatan: "ATK", Realisasi: "\u00a0Rp1.500,25 ", Sisa: "9876543.21" },
  // Row 15: Finance's total row — the stop row. CSV shows it rounded.
  { Alokasi_formula: "TRUE", Realisasi: "Rp1.840.400", Sisa: "Rp1.359.600" },
  // Row 16 on: Finance's roll-up — never read.
  { "Sub Blok Anggaran": "Kelompok 99", Kegiatan: "Rekap", Alokasi: "not a number" },
  { Kegiatan: "Total", Realisasi: "Rp5", Tgl: "x" },
];

const blank = {
  link: null,
  date: null,
  alokasi: null,
  realisasi: null,
  sisa: null,
};

/** {@link ROWS} with one sheet row's cells changed. */
const changed = (sheetRow: number, cells: Row): Row[] =>
  ROWS.map((r, i) => (i + 3 === sheetRow ? { ...r, ...cells } : r));

describe("parseKeuanganCsv", () => {
  const parse = (csv: string): KeuanganSheet => {
    const result = parseKeuanganCsv(csv);
    if (!result.ok) throw new Error(result.detail);
    return result.sheet;
  };

  it("returns the Kelompok in sheet order, full text kept, with their rows and totals", () => {
    const sheet = parse(sheetCsv(ROWS));

    expect(sheet.kelompok.map((k) => k.name)).toEqual([
      "Kelompok 1\nSMA Contoh Satu\nSMA Contoh Dua",
      "Kelompok 2",
    ]);

    expect(sheet.kelompok[0].rows).toEqual([
      {
        ...blank,
        sheetRow: 5,
        budgetLine: "Konsumsi",
        kegiatan: "Konsumsi",
        link: { label: "Nota 1", url: "https://example.com/nota-1" },
        date: { day: 12, month: 10, year: 2026 },
        alokasi: { amount: 1_000_000, kind: "new" },
        realisasi: 250_000,
        sisa: 750_000,
      },
      {
        ...blank,
        sheetRow: 6,
        budgetLine: "Konsumsi",
        kegiatan: "",
        link: { label: "Bluebird", url: null },
        date: { day: null, month: 10, year: 2026 },
        alokasi: { amount: 750_000, kind: "carried" },
        realisasi: 300_000,
        sisa: 450_000,
      },
      {
        ...blank,
        sheetRow: 7,
        budgetLine: "Konsumsi",
        kegiatan: "",
        alokasi: { amount: 200_000, kind: "new" },
        sisa: 650_000,
      },
      {
        ...blank,
        sheetRow: 9,
        budgetLine: "Transportasi",
        kegiatan: "Transportasi",
        link: { label: "Tiket", url: null },
        realisasi: 100_000,
        sisa: -100_000,
      },
    ]);
    expect(sheet.kelompok[0].totals).toEqual({
      alokasi: 1_200_000,
      realisasi: 650_000,
      sisa: 550_000,
    });

    expect(sheet.kelompok[1].rows.map((r) => [r.sheetRow, r.budgetLine, r.kegiatan])).toEqual([
      [12, "Penginapan", "Penginapan"],
      [13, "Penginapan", ""],
      [14, "ATK", "ATK"],
    ]);
    expect(
      sheet.kelompok[1].rows.map((r) => [r.alokasi?.amount ?? null, r.realisasi, r.sisa]),
    ).toEqual([
      [2_000_000, 1_234_500, 765_500],
      [null, -45_600, 811_100],
      [null, 1_500.25, 9_876_543.21],
    ]);
    expect(sheet.kelompok[1].totals).toEqual({
      alokasi: 2_000_000,
      realisasi: 1_190_400.25,
      sisa: 809_599.75,
    });

    expect(sheet.totals).toEqual({
      alokasi: 3_200_000,
      realisasi: 1_840_400.25,
      sisa: 1_359_599.75,
    });
  });

  it("finds columns by header text, so another column order parses identically", () => {
    const shuffled: Column[] = [
      "Sisa",
      "Link_raw",
      "Catatan",
      "Thn",
      "Kegiatan",
      "A",
      "Alokasi_formula",
      "Realisasi",
      "Bln",
      "Sub Blok Anggaran",
      "Link",
      "Tgl",
      "E",
      "Alokasi",
    ];
    expect(parse(sheetCsv(ROWS, shuffled))).toEqual(parse(sheetCsv(ROWS)));
  });

  it("keeps nothing from the stop row down", () => {
    const sheet = parse(sheetCsv(ROWS));
    const rows = sheet.kelompok.flatMap((k) => k.rows);
    expect(sheet.kelompok.some((k) => k.name.startsWith("Kelompok 99"))).toBe(false);
    expect(Math.max(...rows.map((r) => r.sheetRow))).toBe(14);
  });

  it("drops blank carried rows but never a row of new money", () => {
    const rows = parse(sheetCsv(ROWS)).kelompok[0].rows.map((r) => r.sheetRow);
    expect(rows).not.toContain(8);
    expect(rows).not.toContain(10);
    expect(rows).toContain(7);
  });

  it("keeps a carried row that has a Link label", () => {
    const rows = parse(sheetCsv(changed(8, { Link: "Nota 8" }))).kelompok[0].rows;
    expect(rows.find((r) => r.sheetRow === 8)?.link).toEqual({ label: "Nota 8", url: null });
  });

  it("keeps a Kelompok's text exactly as written, trailing line break included", () => {
    const sheet = parse(sheetCsv(changed(4, { "Sub Blok Anggaran": "Kelompok 1\nSMA A\n" })));
    expect(sheet.kelompok[0].name).toBe("Kelompok 1\nSMA A\n");
  });

  it("starts each Kelompok with no Budget Line, never carrying one over from the last", () => {
    const rows = parse(sheetCsv(changed(12, { Kegiatan: "" }))).kelompok[1].rows;
    expect(rows.map((r) => [r.sheetRow, r.budgetLine])).toEqual([
      [12, ""],
      [13, ""],
      [14, "ATK"],
    ]);
  });

  it.each([
    ["a Sub Blok Anggaran", { "Sub Blok Anggaran": "Pengembalian" }],
    ["a Link label", { Link: "Bukti refund", Link_raw: "" }],
    ["an Alokasi", { Alokasi: "Rp1", Alokasi_formula: "TRUE" }],
  ])("reads a Realisasi row with %s as data, not as the stop row", (_, cells) => {
    const rows = parse(sheetCsv(changed(13, { Link: "", Link_raw: "", ...cells }))).kelompok[1]
      .rows;
    expect(rows.map((r) => r.sheetRow)).toEqual([12, 13, 14]);
  });

  it("reads a Realisasi row with only a Link_raw as data — and refuses it as drift", () => {
    const result = parseKeuanganCsv(sheetCsv(changed(13, { Link: "" })));
    expect(result).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/^Baris 13: .*Link_raw/),
    });
  });
});

describe("parseKeuanganCsv failures", () => {
  const failureOf = (csv: string) => {
    const result = parseKeuanganCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("parsed");
    expect(result.error).toBe("Gagal memuat data keuangan dari spreadsheet");
    return result.detail;
  };

  it.each(["Link_raw", "Alokasi_formula", "Realisasi"] as const)(
    "refuses a missing %s header, naming it",
    (header) => {
      const order = SHEET_ORDER.filter((c) => c !== header);
      expect(failureOf(sheetCsv(ROWS, order))).toContain(`"${header}"`);
    },
  );

  it("refuses a duplicated header, naming it", () => {
    expect(failureOf(sheetCsv(ROWS, [...SHEET_ORDER, "Alokasi"]))).toMatch(
      /"Alokasi" muncul lebih dari sekali/,
    );
  });

  it("refuses a sheet with no Kelompok", () => {
    const rows = ROWS.filter((r) => !r["Sub Blok Anggaran"]?.startsWith("Kelompok"));
    expect(failureOf(sheetCsv(rows))).toContain("Kelompok");
  });

  it("refuses a sheet with no stop row", () => {
    expect(failureOf(sheetCsv(ROWS.slice(0, 12)))).toMatch(/baris total/i);
  });

  it.each(["Alokasi", "Realisasi"] as const)(
    "refuses a Kelompok row carrying an %s, naming the row",
    (column) => {
      expect(failureOf(sheetCsv(changed(11, { [column]: "Rp1" })))).toMatch(/^Baris 11: /);
    },
  );

  it("ignores a Kelompok row's Sisa, even when it is not a number", () => {
    expect(parseKeuanganCsv(sheetCsv(changed(11, { Sisa: "lihat catatan" }))).ok).toBe(true);
  });

  it.each([
    ["Alokasi", "Rp 1 juta"],
    ["Realisasi", "#REF!"],
    ["Sisa", "1.5.6"],
    ["Realisasi", "--5"],
    ["Alokasi", "Rp"],
  ] as const)("refuses %s %j inside a Kelompok, naming the row and column", (column, text) => {
    const detail = failureOf(sheetCsv(changed(5, { [column]: text })));
    expect(detail).toMatch(/^Baris 5: /);
    expect(detail).toContain(`"${column}"`);
  });

  it.each([
    { Tgl: "12", Bln: "", Thn: "" },
    { Tgl: "12", Bln: "10", Thn: "" },
    { Tgl: "", Bln: "Okt", Thn: "2026" },
    { Tgl: "1.5", Bln: "10", Thn: "2026" },
  ])("refuses a bad date %j, naming the row", (date) => {
    expect(failureOf(sheetCsv(changed(5, date)))).toMatch(/^Baris 5: tanggal/);
  });

  it.each(["", "YA", "1", "__proto__", "constructor"])(
    "refuses Alokasi_formula %j beside an Alokasi, naming the row",
    (f) => {
      const detail = failureOf(sheetCsv(changed(7, { Alokasi_formula: f })));
      expect(detail).toMatch(/^Baris 7: /);
      expect(detail).toContain('"Alokasi_formula"');
    },
  );

  it("ignores Alokasi_formula on a row with no Alokasi", () => {
    expect(parseKeuanganCsv(sheetCsv(changed(9, { Alokasi_formula: "?" }))).ok).toBe(true);
  });

  it("refuses a Link_raw URL beside an empty Link — the column has drifted", () => {
    const detail = failureOf(sheetCsv(changed(6, { Link: "", Link_raw: "https://example.com/x" })));
    expect(detail).toMatch(/^Baris 6: /);
    expect(detail).toContain("Link_raw");
  });

  it("refuses a Realisasi total that does not match the stop row", () => {
    expect(failureOf(sheetCsv(changed(15, { Realisasi: "Rp1.840.410" })))).toMatch(/baris 15/);
  });

  it("allows the stop row to differ by CSV rounding, half a rupiah per row with a Realisasi", () => {
    // Six kept rows carry a Realisasi, so up to Rp3 of rounding is accepted, and no more.
    expect(parseKeuanganCsv(sheetCsv(changed(15, { Realisasi: "Rp1.840.403" }))).ok).toBe(true);
    expect(parseKeuanganCsv(sheetCsv(changed(15, { Realisasi: "Rp1.840.404" }))).ok).toBe(false);
  });

  it("refuses rather than shows a total when a data row is mistaken for the stop row", () => {
    // A Realisasi-only row on a line reads exactly like Finance's total row; the totals catch it.
    const rows = changed(13, { Link: "", Link_raw: "" });
    expect(failureOf(sheetCsv(rows))).toMatch(/baris 13/);
  });
});

describe("fetchKeuanganSheet", () => {
  const SOURCE = { sheetId: "made-up-sheet-id", gid: "42" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (impl: () => Promise<Response>) => {
    const fetch = vi.fn(impl);
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  const csvResponse = (body: string, init: ResponseInit = {}) =>
    new Response(body, { status: 200, headers: { "content-type": "text/csv" }, ...init });

  const detailOf = async () => {
    const result = await fetchKeuanganSheet(SOURCE);
    expect(result).toMatchObject({
      ok: false,
      error: "Gagal memuat data keuangan dari spreadsheet",
    });
    return result.ok ? "" : result.detail;
  };

  it("fetches the export URL built from the id and gid, uncached, and parses it", async () => {
    const fetch = stubFetch(async () => csvResponse(sheetCsv(ROWS)));
    const result = await fetchKeuanganSheet(SOURCE);

    expect(fetch).toHaveBeenCalledWith(
      "https://docs.google.com/spreadsheets/d/made-up-sheet-id/export?format=csv&gid=42",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual(parseKeuanganCsv(sheetCsv(ROWS)));
    expect(result.ok).toBe(true);
  });

  it("fails typed when the fetch itself throws", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await detailOf()).toMatch(/tidak dapat dihubungi/);
  });

  it("fails typed, saying so, when the sheet does not answer in time", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(await detailOf()).toMatch(/tidak menjawab/);
  });

  it("fails typed on a non-2xx, naming the status", async () => {
    stubFetch(async () => csvResponse("nope", { status: 404 }));
    expect(await detailOf()).toContain("404");
  });

  it("fails typed on an HTML sign-in page — the copy is not link-shared", async () => {
    stubFetch(async () => csvResponse("<!DOCTYPE html><html><body>Sign in</body></html>"));
    expect(await detailOf()).toMatch(/dibagikan/);
  });

  it("fails typed on a non-CSV content type", async () => {
    stubFetch(async () =>
      csvResponse(sheetCsv(ROWS), { headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    expect(await detailOf()).toMatch(/dibagikan/);
  });

  it("passes a parse failure's detail through", async () => {
    stubFetch(async () =>
      csvResponse(
        sheetCsv(
          ROWS,
          SHEET_ORDER.filter((c) => c !== "Link_raw"),
        ),
      ),
    );
    expect(await detailOf()).toContain('"Link_raw"');
  });
});
