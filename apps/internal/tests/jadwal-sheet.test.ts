import { fetchJadwal, parseCsv, parseJadwal } from "-/lib/jadwal-sheet";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **The `/kalender` Google-Sheet data layer, tested with no network (#258).** The parser is pure —
 * CSV in, a per-date schedule out — so the rules the ticket names (dates keyed off row 2, the
 * `Contoh` example dropped, empty cells omitted, multi-line detail kept verbatim) are assertions
 * here. `fetchJadwal`'s guard against a tightened-sharing HTML response is exercised with a stubbed
 * `fetch`, since the one thing that cannot be reached from a test is the live sheet.
 */

/**
 * A realistic slice of the sheet: row 1 weekday labels (ignored), row 2 the dates from column C, a
 * `Contoh` example row to drop, then two schools — one with a multi-line quoted cell and a gap, one
 * with a single mid-week entry.
 */
const SHEET = `,,Kamis,Jumat,Sabtu
No,Nama Sekolah,18-Sep-2026,19-Sep-2026,20-Sep-2026
Contoh,Sekolah A,contoh sesi,,
1,SMAN 1,"Sesi 1
09:00
Bu Rina",,Monev
2,SMAN 2,,Sesi 2,`;

describe("parseJadwal", () => {
  it("maps a normal row to its dates, keyed off row 2", () => {
    const schedule = parseJadwal(SHEET);
    expect(schedule["2026-09-18"]).toEqual([
      { school: "SMAN 1", detail: "Sesi 1\n09:00\nBu Rina" },
    ]);
    expect(schedule["2026-09-19"]).toEqual([{ school: "SMAN 2", detail: "Sesi 2" }]);
    expect(schedule["2026-09-20"]).toEqual([{ school: "SMAN 1", detail: "Monev" }]);
  });

  it("keeps a multi-line cell verbatim, newlines and all", () => {
    const schedule = parseJadwal(SHEET);
    expect(schedule["2026-09-18"]?.[0]?.detail).toBe("Sesi 1\n09:00\nBu Rina");
  });

  it("excludes the Contoh example row on its column-A value, not a row index", () => {
    const schedule = parseJadwal(SHEET);
    // The example carries a cell on 18-Sep, but the row is dropped, so only SMAN 1 remains that day.
    expect(schedule["2026-09-18"]?.some((e) => e.school === "Sekolah A")).toBe(false);
    expect(
      Object.values(schedule)
        .flat()
        .some((e) => e.school === "Sekolah A"),
    ).toBe(false);
  });

  it("omits empty cells rather than emitting blank events", () => {
    const schedule = parseJadwal(SHEET);
    // SMAN 1 has nothing on 19-Sep, SMAN 2 nothing on 18-Sep or 20-Sep.
    expect(schedule["2026-09-19"]?.some((e) => e.school === "SMAN 1")).toBe(false);
    expect(schedule["2026-09-18"]).toHaveLength(1);
    expect(schedule["2026-09-20"]).toHaveLength(1);
  });

  it("preserves sheet order for two schools on the same date", () => {
    const csv = `,,Kamis
No,Nama Sekolah,18-Sep-2026
1,SMAN 1,Sesi 1
2,SMAN 2,Sesi 2`;
    expect(parseJadwal(csv)["2026-09-18"]?.map((e) => e.school)).toEqual(["SMAN 1", "SMAN 2"]);
  });

  it("ignores a column whose row-2 cell is not a date", () => {
    const csv = `,,Kamis,,
No,Nama Sekolah,18-Sep-2026,Catatan
1,SMAN 1,Sesi 1,abaikan`;
    const schedule = parseJadwal(csv);
    expect(schedule["2026-09-18"]).toEqual([{ school: "SMAN 1", detail: "Sesi 1" }]);
    expect(
      Object.values(schedule)
        .flat()
        .some((e) => e.detail === "abaikan"),
    ).toBe(false);
  });

  it("returns an empty schedule for a sheet with no school rows", () => {
    expect(parseJadwal(`,,Kamis\nNo,Nama Sekolah,18-Sep-2026`)).toEqual({});
    expect(parseJadwal("")).toEqual({});
  });
});

describe("parseCsv", () => {
  it("keeps commas inside a quoted field", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsv('"she said ""hi"""')).toEqual([['she said "hi"']]);
  });

  it("keeps newlines inside a quoted field as one cell", () => {
    expect(parseCsv('a,"line 1\nline 2",c')).toEqual([["a", "line 1\nline 2", "c"]]);
  });

  it("treats CRLF as a single row break and drops a trailing newline", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a lone quoted-empty final field as one empty cell, not nothing", () => {
    expect(parseCsv('""')).toEqual([[""]]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("fetchJadwal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const stubFetch = (impl: () => Promise<Response>) => {
    vi.stubEnv("JADWAL_SHEET_CSV_URL", "https://example.test/export?format=csv");
    vi.stubGlobal("fetch", vi.fn(impl));
  };

  it("returns the parsed schedule on a CSV 200", async () => {
    stubFetch(
      async () => new Response(SHEET, { status: 200, headers: { "content-type": "text/csv" } }),
    );
    const result = await fetchJadwal();
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.schedule["2026-09-19"]).toEqual([{ school: "SMAN 2", detail: "Sesi 2" }]);
  });

  it("fails typed on an HTML sign-in body, never parsing it as rows", async () => {
    stubFetch(
      async () =>
        new Response("<!DOCTYPE html><html><body>Sign in</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    expect(await fetchJadwal()).toEqual({
      ok: false,
      error: "Gagal memuat jadwal dari spreadsheet",
    });
  });

  it("fails typed on a non-2xx response", async () => {
    stubFetch(
      async () => new Response("nope", { status: 403, headers: { "content-type": "text/csv" } }),
    );
    expect((await fetchJadwal()).ok).toBe(false);
  });

  it("fails typed on a non-CSV content type even with a plain body", async () => {
    stubFetch(
      async () =>
        new Response("No,Nama Sekolah", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    expect((await fetchJadwal()).ok).toBe(false);
  });

  it("fails typed when the fetch itself throws", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    expect((await fetchJadwal()).ok).toBe(false);
  });
});
