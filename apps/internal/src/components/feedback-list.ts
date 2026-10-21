import type { FeedbackPage } from "@sugt/db/queries";

/**
 * **A `/feedback` tab's card list, as state** (#519): the rows loaded so far, the cursor for the
 * next batch, and `total`, how many rows the tab's choices match in all. Plain functions, tested
 * without a DOM, the way `feedback-scope.ts` sits beside the tab. Types only from
 * `@sugt/db/queries`, as in `feedback-view.tsx`.
 */
export type FeedbackList<Row, Cursor> = { rows: Row[]; cursor: Cursor | null; total: number };

/** The server's first page, as the list's state — the page's first paint. */
export function feedbackList<Row, Cursor>(
  page: FeedbackPage<Row, Cursor>,
): FeedbackList<Row, Cursor> {
  return { rows: page.rows, cursor: page.nextCursor, total: page.total };
}

/**
 * **"Tampilkan lebih banyak"**: the next batch APPENDS, and the count stays — it already counted
 * every matching row, not the cards loaded. A scope, filter or sort change instead REPLACES the
 * whole list, count included, with `feedbackList`.
 */
export function withNextPage<Row, Cursor>(
  list: FeedbackList<Row, Cursor>,
  page: FeedbackPage<Row, Cursor>,
): FeedbackList<Row, Cursor> {
  return { rows: [...list.rows, ...page.rows], cursor: page.nextCursor, total: list.total };
}
