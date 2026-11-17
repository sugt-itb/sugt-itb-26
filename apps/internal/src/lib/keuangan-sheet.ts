import { parseCsv } from "-/lib/csv";

/**
 * **The `/keuangan` Block B reader — a link-shared Google Sheet tab read as CSV (#548).** Finance's
 * Pelaporan SSPT spreadsheet stays the source of truth; `/keuangan` (#550) shows the Block B tab of a
 * **prepared copy** of it (#547), and nothing from it is stored. This module turns that tab into
 * Kelompok, their rows and their totals.
 *
 * It is ADR-0033's `/kalender` route again: a plain `fetch` of the CSV export, no credentials, no
 * Google API, no environment variable. CSV loses two things the reader needs, so the copy carries two
 * helper columns that put them back as text: **`Link_raw`**, each `Link` cell's URL, and
 * **`Alokasi_formula`**, `=ISFORMULA(Alokasi)` — FALSE for new money, TRUE for a carried balance.
 *
 * The **source** (sheet id and gid) is stored and set elsewhere (#549, #571); this module only takes
 * it as an argument. The result is a discriminated union and **never partial data**: a sheet that
 * breaks any rule below is a failure with a generic `error` (what `/keuangan` shows) and a specific
 * Indonesian `detail` naming the row or column (what `/pengaturan` shows when saving a source).
 */

/** Where the Block B tab is: the spreadsheet's id and the tab's gid. Nothing else is ever fetched. */
export type KeuanganSource = { sheetId: string; gid: string };

/** {@link keuanganSourceFromUrl}'s result: the source, or why the pasted text is not one. */
export type KeuanganSourceResult = ({ ok: true } & KeuanganSource) | { ok: false; detail: string };

/** A sheet id as Google writes it in the URL path. */
const SHEET_PATH = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/.*)?$/;

/** A tab's gid: digits only, so the export URL built from it can carry nothing else. */
const GID = /^\d+$/;

/** Longer than any tab address Google writes; the pasted text is stored as-is, so it is bounded. */
const MAX_SOURCE_LENGTH = 2048;

/**
 * Turn the text an Administrator pastes into a {@link KeuanganSource}. Only
 * `https://docs.google.com/spreadsheets/d/{id}/…` with a `gid` is accepted: without a gid the export
 * serves the first tab, which in Finance's spreadsheet is a hidden one. The gid is read from the `#`
 * fragment first — it is what the browser updates when a tab is opened — then from the query.
 * Surrounding whitespace is trimmed; anything else is refused.
 */
export function keuanganSourceFromUrl(text: string): KeuanganSourceResult {
  const refuse = (detail: string): KeuanganSourceResult => ({ ok: false, detail });

  if (text.trim().length > MAX_SOURCE_LENGTH) {
    return refuse(`Alamat terlalu panjang: lebih dari ${MAX_SOURCE_LENGTH} karakter.`);
  }

  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return refuse("Teks yang ditempel bukan alamat (URL).");
  }

  const sheetPath = SHEET_PATH.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "docs.google.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !sheetPath
  ) {
    return refuse(
      "Alamat harus berupa tautan Google Spreadsheet: https://docs.google.com/spreadsheets/d/…",
    );
  }

  const gid =
    new URLSearchParams(url.hash.slice(1)).get("gid") ?? url.searchParams.get("gid") ?? "";
  if (!GID.test(gid)) {
    return refuse(
      "Alamat tidak memuat gid tab. Buka spreadsheet pada tab Blok B, lalu salin alamatnya — alamat itu memuat gid=.",
    );
  }

  // `/d/e/2PACX…` is a "Publish to the web" link: its "id" is the letter `e`, and it exports nothing.
  if (sheetPath[1] === "e") {
    return refuse(
      "Ini alamat hasil “Publikasikan ke web”. Tempel alamat dari bilah alamat browser saat spreadsheet terbuka pada tab Blok B.",
    );
  }

  return { ok: true, sheetId: sheetPath[1], gid };
}

/** A row's receipt: the `Link` label, and its `Link_raw` URL when that is an `http(s)` one. */
export type KeuanganLink = { label: string; url: string | null };

/** A row's date from `Tgl`/`Bln`/`Thn`: all three, or the month and year only (`day: null`). */
export type KeuanganDate = { day: number | null; month: number; year: number };

/** What `Alokasi_formula` says about a row's Alokasi: typed new money, or a balance carried down. */
export type AlokasiKind = "new" | "carried";

/** A row's Alokasi: the amount as read, and whether `Alokasi_formula` marks it new money or carried. */
export type KeuanganAlokasi = { amount: number; kind: AlokasiKind };

/** One kept row of a Kelompok, with the sheet's own values as read. */
export type KeuanganRow = {
  /** The row's number in the sheet, counted from 1 — what a failure's `detail` names. */
  sheetRow: number;
  /** The Budget Line the row belongs to: its own Kegiatan, or the last one above it in its Kelompok. */
  budgetLine: string;
  /** The row's own Kegiatan as written; empty where the sheet's merged cell left it empty. */
  kegiatan: string;
  link: KeuanganLink | null;
  date: KeuanganDate | null;
  alokasi: KeuanganAlokasi | null;
  realisasi: number | null;
  sisa: number | null;
};

/** Alokasi (new money only), Realisasi, and Sisa = Alokasi − Realisasi, which can be negative. */
export type KeuanganTotals = { alokasi: number; realisasi: number; sisa: number };

/** One Kelompok: its `Sub Blok Anggaran` text as written, line breaks included, its rows and totals. */
export type KeuanganKelompok = { name: string; rows: KeuanganRow[]; totals: KeuanganTotals };

/** The whole Block B tab: every Kelompok in sheet order, and the grand total across them. */
export type KeuanganSheet = { kelompok: KeuanganKelompok[]; totals: KeuanganTotals };

/** The sentence `/keuangan` shows on any failure; the specific reason is in `detail`. */
export const KEUANGAN_SHEET_ERROR = "Gagal memuat data keuangan dari spreadsheet";

/** The reader's result: the whole sheet, or a failure — never partial data. */
export type KeuanganSheetResult =
  | { ok: true; sheet: KeuanganSheet }
  | { ok: false; error: string; detail: string };

/** The headers the reader looks up, each of which must appear exactly once across rows 1–2. */
const HEADERS = [
  "Sub Blok Anggaran",
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
] as const;

type Header = (typeof HEADERS)[number];

/** A failure the parser throws to stop at the first broken rule; {@link parseKeuanganCsv} catches it. */
class SheetError extends Error {}

const fail = (detail: string): never => {
  throw new SheetError(detail);
};

const atRow = (sheetRow: number, detail: string) => fail(`Baris ${sheetRow}: ${detail}`);

/** Trimmed, non-breaking spaces included (String#trim covers U+00A0). */
const clean = (cell: string | undefined) => (cell ?? "").trim();

/** Map each header to its column index, refusing a missing or duplicated one. */
function findColumns(rows: string[][]): Record<Header, number> {
  const found = new Map<Header, number[]>(HEADERS.map((h) => [h, []]));
  for (const row of rows.slice(0, 2)) {
    row.forEach((cell, column) => found.get(clean(cell) as Header)?.push(column));
  }
  const columns = {} as Record<Header, number>;
  for (const header of HEADERS) {
    const at = found.get(header) ?? [];
    if (at.length === 0) fail(`Kolom "${header}" tidak ditemukan di baris 1–2.`);
    if (at.length > 1) fail(`Kolom "${header}" muncul lebih dari sekali di baris 1–2.`);
    columns[header] = at[0];
  }
  return columns;
}

/**
 * The digits of a displayed amount: groups of exactly three after a `.` or `,` are thousands, and a
 * final `.` or `,` with one or two digits is the decimal point — so both `1,234,500.5` and
 * `1.234.500,5` read, as do `12345` and `9876543.21`.
 */
const AMOUNT = /^(\d+(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/;

/**
 * A displayed amount, as CSV carries it: `Rp12.345.000`, `1,234,500`, `-45,600`, `Rp-45.600`,
 * `9876543.21`. Empty is `null`; anything else is `undefined`, for the caller to refuse.
 */
function parseAmount(text: string): number | null | undefined {
  if (text === "") return null;
  const match = /^(-?)\s*(?:Rp\s*)?(-?)\s*(\d[\d.,]*)$/i.exec(text);
  if (!match || (match[1] && match[2])) return undefined;
  const digits = AMOUNT.exec(match[3]);
  if (!digits) return undefined;
  const value = Number(`${digits[1].replace(/[.,]/g, "")}.${digits[2] ?? "0"}`);
  return match[1] || match[2] ? -value : value;
}

/** What `=ISFORMULA` displays: TRUE or FALSE, or BENAR or SALAH in an Indonesian-locale copy. */
const FORMULA_VALUES = new Map<string, AlokasiKind>([
  ["false", "new"],
  ["salah", "new"],
  ["true", "carried"],
  ["benar", "carried"],
]);

/** Only these become an `href`; anything else in `Link_raw` is ignored. */
const LINK_PROTOCOLS = new Set(["http:", "https:"]);

function linkUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return LINK_PROTOCOLS.has(url.protocol) ? raw : null;
  } catch {
    return null;
  }
}

const WHOLE = /^\d+$/;

/** `Tgl`/`Bln`/`Thn`: whole numbers, all three or the month and year only, or none at all. */
function parseDate(sheetRow: number, tgl: string, bln: string, thn: string): KeuanganDate | null {
  if (tgl === "" && bln === "" && thn === "") return null;
  if (!WHOLE.test(bln) || !WHOLE.test(thn) || (tgl !== "" && !WHOLE.test(tgl))) {
    atRow(sheetRow, `tanggal tidak valid (Tgl "${tgl}", Bln "${bln}", Thn "${thn}").`);
  }
  return { day: tgl === "" ? null : Number(tgl), month: Number(bln), year: Number(thn) };
}

const KELOMPOK_PREFIX = "Kelompok ";

const emptyTotals = (): KeuanganTotals => ({ alokasi: 0, realisasi: 0, sisa: 0 });

/**
 * Turn the Block B tab's CSV export into its Kelompok, rows and totals — pure, so every rule is
 * testable without a network.
 *
 * - **Columns** are found by header text in rows 1–2, so their order does not matter; other columns
 *   (Finance's hidden ones and side notes) are ignored.
 * - **Kelompok:** a `Sub Blok Anggaran` starting `Kelompok ` opens one. Rows before the first are
 *   ignored. A Kelompok row carries no Alokasi or Realisasi; its Sisa is ignored.
 * - **The stop row** is the first after the first Kelompok with a Realisasi and nothing in
 *   `Sub Blok Anggaran`, `Kegiatan`, `Link`, `Link_raw` or `Alokasi`: Finance's `=SUM(` row. Nothing
 *   from it down is read, and the kept rows' Realisasi must match it to within half a rupiah per row
 *   with a Realisasi (CSV shows rounded values), or the sheet is refused.
 * - **Alokasi** is new money where `Alokasi_formula` is FALSE and a carried balance where TRUE; only
 *   new money counts toward a Kelompok's Alokasi. A row with no Kegiatan, no Link label, no Realisasi
 *   and no new money is dropped as blank.
 */
export function parseKeuanganCsv(csv: string): KeuanganSheetResult {
  try {
    return { ok: true, sheet: readSheet(parseCsv(csv)) };
  } catch (error) {
    if (error instanceof SheetError) {
      return { ok: false, error: KEUANGAN_SHEET_ERROR, detail: error.message };
    }
    throw error;
  }
}

function readSheet(rows: string[][]): KeuanganSheet {
  const columns = findColumns(rows);
  const cell = (row: string[], header: Header) => clean(row[columns[header]]);

  const amount = (row: string[], sheetRow: number, header: "Alokasi" | "Realisasi" | "Sisa") => {
    const text = cell(row, header);
    const value = parseAmount(text);
    return value === undefined
      ? atRow(sheetRow, `kolom "${header}" berisi "${text}", bukan jumlah uang.`)
      : value;
  };

  const kelompok: KeuanganKelompok[] = [];
  let current: KeuanganKelompok | null = null;
  let budgetLine = "";
  let stop: { sheetRow: number; realisasi: number } | null = null;

  for (let index = 2; index < rows.length; index++) {
    const row = rows[index];
    const sheetRow = index + 1;
    const subBlok = cell(row, "Sub Blok Anggaran");

    if (subBlok.startsWith(KELOMPOK_PREFIX)) {
      if (cell(row, "Alokasi") !== "" || cell(row, "Realisasi") !== "") {
        atRow(sheetRow, `baris Kelompok tidak boleh berisi Alokasi atau Realisasi.`);
      }
      // The name keeps the cell as written — only the prefix test reads it trimmed.
      current = { name: row[columns["Sub Blok Anggaran"]], rows: [], totals: emptyTotals() };
      kelompok.push(current);
      budgetLine = "";
      continue;
    }
    if (!current) continue;

    const kegiatan = cell(row, "Kegiatan");
    const label = cell(row, "Link");
    const raw = cell(row, "Link_raw");
    const realisasi = amount(row, sheetRow, "Realisasi");
    if (
      realisasi !== null &&
      subBlok === "" &&
      kegiatan === "" &&
      label === "" &&
      raw === "" &&
      cell(row, "Alokasi") === ""
    ) {
      stop = { sheetRow, realisasi };
      break;
    }

    const alokasi = amount(row, sheetRow, "Alokasi");
    const sisa = amount(row, sheetRow, "Sisa");

    let alokasiKind: AlokasiKind | null = null;
    if (alokasi !== null) {
      const formula = cell(row, "Alokasi_formula");
      alokasiKind =
        FORMULA_VALUES.get(formula.toLowerCase()) ??
        atRow(
          sheetRow,
          `kolom "Alokasi_formula" berisi "${formula}", padahal baris ini berisi Alokasi — harus TRUE atau FALSE.`,
        );
    }

    if (raw !== "" && label === "") {
      atRow(
        sheetRow,
        `kolom "Link_raw" berisi URL padahal kolom "Link" kosong — Link_raw bergeser terhadap Link.`,
      );
    }

    const date = parseDate(sheetRow, cell(row, "Tgl"), cell(row, "Bln"), cell(row, "Thn"));

    if (kegiatan !== "") budgetLine = kegiatan;
    if (kegiatan === "" && label === "" && realisasi === null && alokasiKind !== "new") continue;

    current.rows.push({
      sheetRow,
      budgetLine,
      kegiatan,
      link: label === "" ? null : { label, url: raw === "" ? null : linkUrl(raw) },
      date,
      alokasi:
        alokasi === null || alokasiKind === null ? null : { amount: alokasi, kind: alokasiKind },
      realisasi,
      sisa,
    });
  }

  if (kelompok.length === 0) {
    fail(`Tidak ada baris Kelompok: tidak ada "Sub Blok Anggaran" yang diawali "Kelompok ".`);
  }
  if (!stop) {
    return fail(
      `Baris total Realisasi di bawah Kelompok terakhir tidak ditemukan — baris berisi Realisasi saja, tanpa Kegiatan, Link, Link_raw dan Alokasi.`,
    );
  }

  const totals = emptyTotals();
  let rowsWithRealisasi = 0;
  for (const k of kelompok) {
    for (const r of k.rows) {
      if (r.alokasi?.kind === "new") k.totals.alokasi += r.alokasi.amount;
      if (r.realisasi !== null) {
        k.totals.realisasi += r.realisasi;
        rowsWithRealisasi++;
      }
    }
    k.totals.sisa = k.totals.alokasi - k.totals.realisasi;
    totals.alokasi += k.totals.alokasi;
    totals.realisasi += k.totals.realisasi;
  }
  totals.sisa = totals.alokasi - totals.realisasi;

  // CSV shows each value rounded to the rupiah, so the sum may drift by up to half a rupiah per term.
  // The small epsilon only absorbs floating-point error at that boundary.
  if (Math.abs(totals.realisasi - stop.realisasi) > 0.5 * rowsWithRealisasi + 1e-6) {
    fail(
      `Total Realisasi baris-baris Kelompok (${totals.realisasi}) tidak sama dengan baris total di baris ${stop.sheetRow} (${stop.realisasi}). Ada baris yang terlewat atau tata letak tab berubah.`,
    );
  }

  return { kelompok, totals };
}

/** How long the sheet has to answer before the read fails rather than holding the page open. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch and parse the Block B tab. The URL is built **only** from the source's id and gid — pasted
 * text is never fetched — and `cache: "no-store"` reads the live sheet on every request, as
 * `fetchJadwal` does. A network error, a timeout, a non-2xx, a non-CSV content type, or an
 * HTML-looking body (the sign-in page a copy that is not link-shared serves) is a typed failure.
 */
export async function fetchKeuanganSheet(source: KeuanganSource): Promise<KeuanganSheetResult> {
  const failure = (detail: string): KeuanganSheetResult => ({
    ok: false,
    error: KEUANGAN_SHEET_ERROR,
    detail,
  });
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(source.sheetId)}/export?format=csv&gid=${encodeURIComponent(source.gid)}`;

  let response: Response;
  let body: string;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    return failure(
      error instanceof DOMException && error.name === "TimeoutError"
        ? `Spreadsheet tidak menjawab dalam ${FETCH_TIMEOUT_MS / 1000} detik.`
        : "Spreadsheet tidak dapat dihubungi.",
    );
  }

  if (!response.ok) {
    return failure(`Spreadsheet menjawab dengan status ${response.status}.`);
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("csv") || body.trimStart().startsWith("<")) {
    return failure(
      `Spreadsheet tidak mengirim CSV — pastikan salinannya dibagikan ke "Siapa saja yang memiliki link" dan alamatnya menunjuk tab Blok B.`,
    );
  }

  return parseKeuanganCsv(body);
}
