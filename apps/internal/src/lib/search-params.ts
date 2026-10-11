/**
 * **The pieces the app's lenient URL parsers share** — `/log`, `/keuangan` and Pengaturan Perjadin's
 * level. Each parser drops anything malformed rather than refusing it; these say what malformed is.
 */

/** A query value as Next hands it over: a repeated key is an array, and its first value counts. */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value when it is shaped like a row id, else null — so a bad id never reaches a `uuid` cast. */
export function uuidOrNull(value: string | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

/** A real calendar date in `YYYY-MM-DD`, or null — so `?dari=2026-02-30` filters nothing. */
export function calendarDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}
