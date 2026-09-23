import type { TransactionCategory, TransactionParticipantType } from "@sugt/domain";

/**
 * **The in-memory sort + filter behind the Transaksi list** (#193).
 *
 * A Perjadin's transactions are bounded and already fully loaded in the client component (no
 * pagination), so — unlike `/feedback`, whose dataset is unbounded and sorts/filters server-side —
 * this is a pure lens over the array the component already holds. It is a plain function rather than
 * a hook so the compound-order and AND-filter rules can be tested without React. It touches nothing
 * but the list: the acquittal's money figures (advance/spent/remainder, the CSV export) are computed
 * upstream from the full set and never routed through this.
 */

export type SortDirection = "asc" | "desc";

/** A filter axis's value: `"Semua"` (no predicate) or one exact member of the closed set. */
export type ParticipantFilter = "Semua" | TransactionParticipantType;
export type CategoryFilter = "Semua" | TransactionCategory;

export type TransactionListControls = {
  /** Primary key: `"desc"` = Termahal (default), `"asc"` = Termurah. */
  amountSort: SortDirection;
  /** Tiebreak key: `"desc"` = Terbaru (default), `"asc"` = Terlama. */
  dateSort: SortDirection;
  participantFilter: ParticipantFilter;
  categoryFilter: CategoryFilter;
};

/** The minimal shape the controls read — a subset of `ViewableTransaction`. */
export type SortableTransaction = {
  id: string;
  spentOn: string;
  amountIdr: number;
  category: TransactionCategory;
  participantType: TransactionParticipantType;
};

/** The controls' resting state: Termahal (amount desc) + Terbaru (date desc), no filter. */
export const DEFAULT_TRANSACTION_LIST_CONTROLS: TransactionListControls = {
  amountSort: "desc",
  dateSort: "desc",
  participantFilter: "Semua",
  categoryFilter: "Semua",
};

/**
 * Filter (both axes ANDed, `"Semua"` meaning no predicate) then sort as one compound order —
 * amount primary, `spent_on` tiebreak, `id` as the final tiebreak so the order is total and
 * stable no matter what order the rows arrived in. `spentOn` is a `YYYY-MM-DD` string, so a
 * lexicographic compare is a date compare.
 */
export function sortAndFilterTransactions<T extends SortableTransaction>(
  transactions: readonly T[],
  controls: TransactionListControls,
): T[] {
  const { amountSort, dateSort, participantFilter, categoryFilter } = controls;

  const filtered = transactions.filter(
    (line) =>
      (participantFilter === "Semua" || line.participantType === participantFilter) &&
      (categoryFilter === "Semua" || line.category === categoryFilter),
  );

  const amountDirection = amountSort === "desc" ? -1 : 1;
  const dateDirection = dateSort === "desc" ? -1 : 1;

  // `filtered` is already a fresh array from `.filter`, so sorting it in place mutates nothing the
  // caller passed in.
  return filtered.sort((a, b) => {
    if (a.amountIdr !== b.amountIdr) return amountDirection * (a.amountIdr - b.amountIdr);
    if (a.spentOn !== b.spentOn) return dateDirection * (a.spentOn < b.spentOn ? -1 : 1);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
