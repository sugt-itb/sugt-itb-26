/**
 * **The pure date arithmetic behind the `/monitoring` Calendar**, kept out of the component the
 * same way `monitoring-derive.ts` keeps the matrix fold out of the view. Building the month grid,
 * naming the month, and paging forward/back are all deterministic functions over a `{ year, month }`
 * — no React, no `Date.now()`, no time zone — so the suite drives them directly and the component is
 * left only rendering. Everything works in **UTC** and steps whole days in milliseconds: UTC has no
 * daylight saving, so a grid never gains or drops a day across a clock change, and the calendar the
 * Programme reads is the WIB calendar the caller passes in as a `YYYY-MM-DD` string.
 */

/** A calendar month, `month` 1–12 (human), so a fixture reads `{ year: 2026, month: 9 }` for September. */
export type CalendarMonth = { year: number; month: number };

/** One grid cell: its `YYYY-MM-DD` date and whether it belongs to the month on display (vs. a greyed
 *  spillover day from the adjacent month). */
export type CalendarDay = { date: string; inMonth: boolean };

/** The seven column headers, Sunday first — the mockup's `S M T W T F S`. Keyed by index in the view
 *  because the letters repeat. */
export const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** Month names as the Indonesian page prints them, indexed by `month - 1`. */
const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

const DAY_MS = 86_400_000;

/** The month a `YYYY-MM-DD` date falls in — used to seed the view from the WIB "today" string. */
export function monthOf(isoDate: string): CalendarMonth {
  const [year, month] = isoDate.split("-");
  return { year: Number(year), month: Number(month) };
}

/**
 * Move `delta` months from `m` (negative pages back), carrying across year boundaries — the ‹ / ›
 * navigation. Works in a flat month count so December → January and January → December are just
 * arithmetic, never a special case.
 */
export function addMonths(m: CalendarMonth, delta: number): CalendarMonth {
  const total = m.year * 12 + (m.month - 1) + delta;
  const year = Math.floor(total / 12);
  return { year, month: total - year * 12 + 1 };
}

/** The header title, e.g. `"September 2026"`. */
export function monthTitle(m: CalendarMonth): string {
  return `${MONTH_NAMES_ID[m.month - 1]} ${m.year}`;
}

/**
 * The always-**six-week** (42-cell) grid for a month, Sunday-first. The first cell is the Sunday on
 * or before the 1st, so the month's leading spillover fills the top row and the trailing spillover
 * fills whatever the last row does not; each cell says whether it is in the displayed month so the
 * component can grey the spillover. Six rows are fixed (not five-or-six) so the grid never changes
 * height as the operator pages.
 */
export function monthGrid(m: CalendarMonth): CalendarDay[] {
  const firstOfMonth = Date.UTC(m.year, m.month - 1, 1);
  const leadingWeekday = new Date(firstOfMonth).getUTCDay(); // 0 = Sunday
  const start = firstOfMonth - leadingWeekday * DAY_MS;
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const at = new Date(start + i * DAY_MS);
    days.push({
      date: at.toISOString().slice(0, 10),
      inMonth: at.getUTCMonth() === m.month - 1,
    });
  }
  return days;
}
