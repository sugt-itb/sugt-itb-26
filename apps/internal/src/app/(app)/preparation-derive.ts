import { longDateId } from "-/app/(app)/_calendar/calendar-grid";
import type { PreparationCard, PreparationChecklistItem } from "@sugt/db/queries";

import type { Warning } from "./dashboard-state";

/**
 * **The pure percentage fold for a Preparation Card**, with no React, no DOM and no
 * database — the same shape as `dashboard-derive.ts`, so the suite drives it with a hand-built
 * array. A Card's completion is `checked ÷ total`, as a whole-number percent (like
 * `activitiesPercent`), and **an empty checklist is 0%**, not a division by zero: a Card with
 * nothing to do has done none of it, which is the reading the tab wants.
 *
 * It takes only what it reads — each item's `checked` flag — so adding or removing an item and
 * re-folding is exactly what recomputes the percentage; nothing here is cached or stored.
 */
export function preparationPercent(
  items: readonly Pick<PreparationChecklistItem, "checked">[],
): number {
  if (items.length === 0) return 0;
  const checked = items.filter((item) => item.checked).length;
  return Math.round((checked / items.length) * 100);
}

/**
 * How many days ahead of `today` a Preparation Card starts warning: a Card whose `starts_on` is
 * within this window (or today, or already past) and is not yet complete raises a warning.
 */
const PREPARATION_WARNING_LEAD_DAYS = 5;

/**
 * Add `days` whole days to a `YYYY-MM-DD` date, in UTC. UTC has no daylight saving, so the horizon
 * never drifts by an hour across a clock change; the result is another `YYYY-MM-DD` that compares
 * lexically against a card's `startsOn` exactly as it compares chronologically.
 */
function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * **The Persiapan due-date warnings**, a pure derivation mirroring `overdueWarnings`
 * (`dashboard-derive.ts`) — no React, no DOM, no database, driven by a hand-built fixture.
 *
 * A Card warns when it is **incomplete** (`preparationPercent < 100`) **and** its `startsOn` is on
 * or before `today + PREPARATION_WARNING_LEAD_DAYS` — i.e. due within the next five days, today,
 * inside its range, or already past. There is **no lower bound**: a past-due incomplete Card keeps
 * warning until it reaches 100%. `endsOn` never affects the trigger — the Card has no separate due
 * date, so `startsOn` is the tenggat in every case. The message names the Card and its `startsOn`
 * in the shared long-Indonesian date form (`15 Oktober 2026`), and the `id` is stable per Card so
 * the dismiss reducer (`dashboard-state.ts`) can set one aside.
 */
export function preparationWarnings(cards: readonly PreparationCard[], today: string): Warning[] {
  const horizon = addDays(today, PREPARATION_WARNING_LEAD_DAYS);
  const warnings: Warning[] = [];
  for (const card of cards) {
    if (preparationPercent(card.items) >= 100) continue;
    if (card.startsOn > horizon) continue;
    warnings.push({
      id: `persiapan-${card.id}`,
      message: `Persiapan "${card.title}" belum selesai, tenggat waktu hingga ${longDateId(card.startsOn)}`,
    });
  }
  return warnings;
}
