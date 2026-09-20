/**
 * **The day-cell overflow fold** for the wide `/kalender` month view, whose cells show a few event
 * names and then a "Lihat lebih banyak (+N)" link when a day carries more than fit. Pure and
 * generic — it slices a day's already-ordered event list to the first `limit` and reports how many
 * were left off, so the cell renders the visible names and the `+N` count from one call. No React,
 * no dates, driven directly by the suite.
 */

/** The first `limit` events a cell shows and how many it hides behind the "+N" link. */
export type EventsOverflow<T> = { shown: T[]; overflow: number };

/**
 * Collapse `events` to the first `limit` plus the count that spilled over. `overflow` is `0` when
 * everything fits (so the cell shows no "+N"); a `limit` at or above the length shows all with no
 * overflow. A `limit` below zero is clamped to zero — it never slices from the end — so a bad cap
 * hides everything rather than silently reordering.
 */
export function eventsOverflow<T>(events: readonly T[], limit: number): EventsOverflow<T> {
  const cap = Math.max(0, limit);
  return { shown: events.slice(0, cap), overflow: Math.max(0, events.length - cap) };
}
