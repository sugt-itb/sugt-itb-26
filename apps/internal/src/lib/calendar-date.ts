/**
 * A real calendar date in `YYYY-MM-DD`, or null — so `?dari=2026-02-30` filters nothing. Shared by the
 * URL parsers of `/log` and `/keuangan`, whose date filters are both lenient.
 */
export function calendarDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}
