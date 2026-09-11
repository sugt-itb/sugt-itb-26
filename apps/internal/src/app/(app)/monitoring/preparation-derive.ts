import type { PreparationChecklistItem } from "@sugt/db/queries";

/**
 * **The pure percentage fold for a Monitoring Preparation Card**, with no React, no DOM and no
 * database — the same shape as `monitoring-derive.ts`, so the suite drives it with a hand-built
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
