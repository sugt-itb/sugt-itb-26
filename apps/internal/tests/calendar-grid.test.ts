import {
  addMonths,
  type CalendarMonth,
  monthGrid,
  monthOf,
  monthTitle,
} from "-/app/(app)/monitoring/calendar-grid";
import { describe, expect, it } from "vitest";

/**
 * **The pure `/monitoring` Calendar date arithmetic, tested with no DOM.**
 *
 * `calendar-grid.ts` is the seam the calendar component leans on for its month grid, its title and
 * its ‹ / › navigation — all deterministic functions over `{ year, month }`. Pinning them here (a
 * Sunday-start 6-row grid, the greyed spillover, the year-crossing page) leaves the component with
 * nothing to test but layout. September 2026 is the worked example: the 1st is a Tuesday, so the
 * grid opens on Sunday 30 August.
 */

const SEPT: CalendarMonth = { year: 2026, month: 9 };

describe("monthGrid", () => {
  it("is always a 42-cell, Sunday-first, six-week grid", () => {
    const grid = monthGrid(SEPT);
    expect(grid).toHaveLength(42);
    // The first cell is the Sunday on or before the 1st — 30 Aug, a greyed spillover day.
    expect(grid[0]).toEqual({ date: "2026-08-30", inMonth: false });
    // The 1st of the month is a Tuesday, so it is the third cell, in-month.
    expect(grid[2]).toEqual({ date: "2026-09-01", inMonth: true });
    // The last cell is the trailing spillover into October.
    expect(grid[41]).toEqual({ date: "2026-10-10", inMonth: false });
  });

  it("marks exactly the month's own days in-month and greys the rest", () => {
    const grid = monthGrid(SEPT);
    // September has 30 days; the other 12 cells are the adjacent-month spillover.
    expect(grid.filter((d) => d.inMonth)).toHaveLength(30);
    expect(grid.filter((d) => !d.inMonth)).toHaveLength(12);
    const nine = grid.find((d) => d.date === "2026-09-09");
    expect(nine).toEqual({ date: "2026-09-09", inMonth: true });
  });

  it("has no leading spillover when the 1st is itself a Sunday", () => {
    // 1 Feb 2026 is a Sunday, so the grid opens on it — still 42 cells, trailing into March.
    const grid = monthGrid({ year: 2026, month: 2 });
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ date: "2026-02-01", inMonth: true });
    expect(grid.filter((d) => d.inMonth)).toHaveLength(28);
    expect(grid[41]).toEqual({ date: "2026-03-14", inMonth: false });
  });

  it("yields 42 consecutive calendar days", () => {
    const grid = monthGrid(SEPT);
    for (let i = 1; i < grid.length; i++) {
      const prev = Date.parse(`${grid[i - 1]!.date}T00:00:00Z`);
      const cur = Date.parse(`${grid[i]!.date}T00:00:00Z`);
      expect(cur - prev).toBe(86_400_000);
    }
  });
});

describe("addMonths", () => {
  it("pages forward and back within a year", () => {
    expect(addMonths(SEPT, 1)).toEqual({ year: 2026, month: 10 });
    expect(addMonths(SEPT, -1)).toEqual({ year: 2026, month: 8 });
  });

  it("carries across year boundaries in both directions", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(SEPT, 5)).toEqual({ year: 2027, month: 2 });
    expect(addMonths(SEPT, -9)).toEqual({ year: 2025, month: 12 });
  });
});

describe("monthOf", () => {
  it("reads the month a WIB date string falls in", () => {
    expect(monthOf("2026-09-09")).toEqual({ year: 2026, month: 9 });
    expect(monthOf("2026-01-31")).toEqual({ year: 2026, month: 1 });
  });
});

describe("monthTitle", () => {
  it("names the month in Indonesian with its year", () => {
    expect(monthTitle(SEPT)).toBe("September 2026");
    expect(monthTitle({ year: 2026, month: 1 })).toBe("Januari 2026");
    expect(monthTitle({ year: 2027, month: 12 })).toBe("Desember 2027");
  });
});
