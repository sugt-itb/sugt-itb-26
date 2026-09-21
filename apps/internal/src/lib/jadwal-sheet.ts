import { requireEnv } from "-/lib/env";

/**
 * **The `/kalender` schedule feed — a link-shared Google Sheet read as CSV.** The activity
 * schedule ("Jadwal" tab) lives in an online spreadsheet, published read-only through its CSV
 * export endpoint. This module fetches that CSV per request and parses it into per-date events;
 * the `/kalender` UI that renders them is a separate ticket (#259).
 *
 * See [ADR-0033](../../../../../docs/adr/0033-kalender-schedule-is-a-link-shared-google-sheet.md)
 * for why the source is an external sheet rather than the database, and the trade-offs it carries.
 *
 * No Google API, no `googleapis`, no service account: the sheet is link-shared, so a plain `GET`
 * on the export URL returns CSV with no credentials. If sharing is ever tightened the endpoint
 * serves an HTML sign-in page instead — {@link fetchJadwal} detects that and returns a typed
 * failure rather than parsing HTML as data.
 */

/** One school's entry on one date: the school name (for the in-cell pill) and its verbatim cell. */
export type JadwalEvent = {
  /** The school's name, from column B — trimmed. */
  school: string;
  /** The cell's text **verbatim**, newlines and all — the side panel renders it (#259). */
  detail: string;
};

/** The parsed schedule, keyed by ISO date (`YYYY-MM-DD`); each date lists its events in sheet order. */
export type JadwalSchedule = Record<string, JadwalEvent[]>;

/**
 * The result of {@link fetchJadwal} — a discriminated union so the page branches on a value rather
 * than catching a throw. `ok: false` carries an Indonesian-ready reason the caller may show inline.
 */
export type JadwalResult = { ok: true; schedule: JadwalSchedule } | { ok: false; error: string };

/** The one row to drop: the worked example, keyed on its column-A value so it survives row moves. */
const CONTOH_MARKER = "Contoh";

/** English month abbreviations as they appear in row 2 (`18-Sep-2026`), lower-cased for lookup. */
const MONTH_ABBREV: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * Parse RFC-4180 CSV into a grid of rows of cells. Handles quoted fields containing commas,
 * newlines and doubled-quote (`""`) escapes — Google's export quotes any multi-line cell, so the
 * newlines inside a session's detail survive as part of one field rather than splitting the row.
 * `\r\n` and `\r` line endings are treated as `\n`. A trailing newline does not add an empty row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    sawAny = true;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Collapse a `\r\n` pair into one row break.
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Flush the final field/row unless the text ended exactly on a row break (no dangling empty row).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return sawAny ? rows : [];
}

/** `18-Sep-2026` → `2026-09-18`; `null` for anything that is not a `d-MMM-yyyy` date. */
function toIsoDate(cell: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(cell.trim());
  if (!match) return null;
  const [, day, mon, year] = match;
  const month = MONTH_ABBREV[mon.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

/**
 * Turn the sheet's CSV into a per-date schedule.
 *
 * The shape is keyed off the data, not fixed positions: row 1 is weekday labels (ignored), row 2
 * carries the dates from column C (index 2) onward, and every later row is a school — column A is
 * `No`, column B its name. A column contributes events only if row 2's cell there is a real date, so
 * a stray trailing column is ignored. The `Contoh` example row (column A `Contoh`) and rows with no
 * name are skipped, and an empty cell means no event; a non-empty cell keeps its text verbatim.
 */
export function parseJadwal(csv: string): JadwalSchedule {
  const rows = parseCsv(csv);
  const schedule: JadwalSchedule = {};
  if (rows.length < 3) return schedule;

  const dateRow = rows[1];
  // Map each date column index to its ISO date, so schools read off the same columns.
  const dateByColumn: { column: number; iso: string }[] = [];
  for (let c = 2; c < dateRow.length; c++) {
    const iso = toIsoDate(dateRow[c] ?? "");
    if (iso) dateByColumn.push({ column: c, iso });
  }

  for (let r = 2; r < rows.length; r++) {
    const cells = rows[r];
    const noValue = (cells[0] ?? "").trim();
    if (noValue === CONTOH_MARKER) continue;
    const school = (cells[1] ?? "").trim();
    if (!school) continue;

    for (const { column, iso } of dateByColumn) {
      const detail = cells[column] ?? "";
      if (detail.trim() === "") continue;
      (schedule[iso] ??= []).push({ school, detail });
    }
  }

  return schedule;
}

/**
 * Fetch and parse the Jadwal sheet, reading its CSV export URL from `JADWAL_SHEET_CSV_URL`
 * (declared on `build`/`typecheck`/`dev` in `turbo.json`; strict `envMode` hides an undeclared var).
 *
 * `cache: "no-store"` so every load reads the live sheet. Any non-2xx, a network error, a non-CSV
 * content type, or a body that looks like HTML (a tightened-sharing sign-in page) returns the typed
 * failure — never a parse of HTML as if it were rows.
 */
export async function fetchJadwal(): Promise<JadwalResult> {
  const url = requireEnv("JADWAL_SHEET_CSV_URL");

  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    return { ok: false, error: "Gagal memuat jadwal dari spreadsheet" };
  }

  if (!response.ok) {
    return { ok: false, error: "Gagal memuat jadwal dari spreadsheet" };
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const body = await response.text();

  // Sharing tightened → the endpoint serves an HTML sign-in page, not CSV. Either signal is enough.
  if (!contentType.includes("csv") || body.trimStart().startsWith("<")) {
    return { ok: false, error: "Gagal memuat jadwal dari spreadsheet" };
  }

  return { ok: true, schedule: parseJadwal(body) };
}
