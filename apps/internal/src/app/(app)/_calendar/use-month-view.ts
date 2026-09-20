"use client";

import { useState } from "react";

import { addMonths, type CalendarMonth, monthOf } from "./calendar-grid";

/** The month-calendar view state both calendars share: the month on screen, the one selected date,
 *  and the paging actions. */
export type MonthView = {
  /** The month currently rendered. */
  view: CalendarMonth;
  /** The selected date (`YYYY-MM-DD`), or none. */
  selected: string | null;
  /** Select a date. The highlight persists across paging — `goToday`/`prev`/`next` never clear it. */
  select: (date: string) => void;
  /** Reset the view to the month of the server's WIB `today` (the **Hari ini** button). */
  goToday: () => void;
  /** Page one month back / forward — pure `addMonths`, view-state only, never a refetch. */
  prevMonth: () => void;
  nextMonth: () => void;
};

/**
 * **The shared month-view state for both calendars** (`/monitoring` dots and `/kalender` pills). The
 * month on view is seeded from the server's WIB `today` and paged with the pure `addMonths`/`monthOf`
 * seam; because the event/marker feeds already cover every date, paging is view-state only and never
 * refetches. Exactly one date is selected at a time (or none), and the selection persists across
 * paging so a date picked in one month stays lit if the operator returns to it.
 */
export function useMonthView(today: string): MonthView {
  const [view, setView] = useState(() => monthOf(today));
  const [selected, setSelected] = useState<string | null>(null);
  return {
    view,
    selected,
    select: setSelected,
    goToday: () => setView(monthOf(today)),
    prevMonth: () => setView((v) => addMonths(v, -1)),
    nextMonth: () => setView((v) => addMonths(v, 1)),
  };
}
