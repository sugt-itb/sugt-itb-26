/**
 * **The pure date arithmetic behind the `/monitoring` Calendar**, kept out of the component the
 * same way `dashboard-derive.ts` keeps the matrix fold out of the view. Building the month grid,
 * naming the month, and paging forward/back are all deterministic functions over a `{ year, month }`
 * — no React, no `Date.now()`, no time zone — so the suite drives them directly and the component is
 * left only rendering. Everything works in **UTC** and steps whole days in milliseconds: UTC has no
 * daylight saving, so a grid never gains or drops a day across a clock change, and the calendar the
 * Programme reads is the WIB calendar the caller passes in as a `YYYY-MM-DD` string.
 */

/** A calendar month, `month` 1–12 (human), so a fixture reads `{ year: 2026, month: 9 }` for September. */
export type CalendarMonth = { year: number; month: number };

/** One grid cell: its `YYYY-MM-DD` date, the day-of-month number the cell prints, and whether it
 *  belongs to the month on display (vs. a greyed spillover day from the adjacent month). */
export type CalendarDay = { date: string; dayNumber: number; inMonth: boolean };

/** The seven column headers, Sunday first — the `/monitoring` mockup's `S M T W T F S`. Keyed by
 *  index in the view because the letters repeat. */
export const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/**
 * One-letter Indonesian weekday labels, **Monday-first** — Senin, Selasa, Rabu, Kamis, Jumat,
 * Sabtu, Minggu → `S S R K J S M`. Paired with `monthGrid(..., "monday")`; the letters repeat
 * (two `S`), so it is keyed by index like `WEEKDAY_LABELS`.
 */
export const WEEKDAY_LABELS_ID_SHORT = ["S", "S", "R", "K", "J", "S", "M"] as const;

/**
 * Full Indonesian weekday names, **Monday-first** — the wide weekday bar the `/kalender` month view
 * prints across the top. Paired with `monthGrid(..., "monday")`.
 */
export const WEEKDAY_LABELS_ID_FULL = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
] as const;

/**
 * Which weekday a grid's first column is. `"sunday"` is the historical `/monitoring` default (the
 * English `WEEKDAY_LABELS`); `"monday"` is the Indonesian-labelled bar `/kalender` and the flipped
 * `/monitoring` use. Note a label set's order must match the week-start it is paired with — the
 * Indonesian sets above are Monday-first.
 */
export type WeekStart = "sunday" | "monday";

/** The day-of-week index (0 = Sunday, matching `Date#getUTCDay`) each `WeekStart` puts first. */
const WEEK_START_INDEX: Record<WeekStart, number> = { sunday: 0, monday: 1 };

/** Month names as the Indonesian page prints them, indexed by `month - 1`. Exported so the
 *  long-date formatter (and the Peringatan warnings that consume it) name a month the same way the
 *  grid header does. */
export const MONTH_NAMES_ID = [
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
 * A `YYYY-MM-DD` date as the long Indonesian form the human-facing surfaces print, e.g.
 * `"15 Oktober 2026"` — day without a leading zero, the month named from `MONTH_NAMES_ID`, then the
 * year. Pure string arithmetic on the ISO parts (no `Date`, no locale, no time zone), so it names
 * exactly the calendar day it is given. New surfaces only — the calendar event popup and the
 * Peringatan Persiapan warnings; existing ISO `YYYY-MM-DD` displays stay as they are (#166).
 */
export function longDateId(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${Number(day)} ${MONTH_NAMES_ID[Number(month) - 1]} ${year}`;
}

/**
 * The always-**six-week** (42-cell) grid for a month. The first cell is the `weekStart` weekday on
 * or before the 1st (Sunday by default, matching `/monitoring`; Monday for the Indonesian bar), so
 * the month's leading spillover fills the top row and the trailing spillover fills whatever the
 * last row does not; each cell says whether it is in the displayed month so the component can grey
 * the spillover. Six rows are fixed (not five-or-six) so the grid never changes height as the
 * operator pages.
 */
export function monthGrid(m: CalendarMonth, weekStart: WeekStart = "sunday"): CalendarDay[] {
  const firstOfMonth = Date.UTC(m.year, m.month - 1, 1);
  const leadingWeekday = new Date(firstOfMonth).getUTCDay(); // 0 = Sunday
  // How many days to reach back from the 1st to the week-start weekday: 0 when the 1st already is
  // it, wrapping through the week otherwise. `"sunday"` collapses this to the historical
  // `leadingWeekday` offset, so the default grid is byte-for-byte the old Sunday-first one.
  const offset = (leadingWeekday - WEEK_START_INDEX[weekStart] + 7) % 7;
  const start = firstOfMonth - offset * DAY_MS;
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const at = new Date(start + i * DAY_MS);
    days.push({
      date: at.toISOString().slice(0, 10),
      dayNumber: at.getUTCDate(),
      inMonth: at.getUTCMonth() === m.month - 1,
    });
  }
  return days;
}
