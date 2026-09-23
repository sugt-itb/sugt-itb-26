import {
  DEFAULT_TRANSACTION_LIST_CONTROLS,
  sortAndFilterTransactions,
  type SortableTransaction,
  type TransactionListControls,
} from "-/components/laporan-perjadin/acquittal-transactions-sort";
import { describe, expect, it } from "vitest";

/**
 * **The Transaksi list's in-memory sort + filter** (#193). Pure over the bounded, fully-loaded
 * array — no DB, no React — so the compound order (amount primary, date tiebreak, id final) and the
 * ANDed exact-match filters are pinned here where they are cheap to exercise across combinations.
 */

/** A line with just the fields the controls read; ids are chosen so the final tiebreak is visible. */
function line(
  id: string,
  amountIdr: number,
  spentOn: string,
  extra: Partial<SortableTransaction> = {},
): SortableTransaction {
  return {
    id,
    amountIdr,
    spentOn,
    category: extra.category ?? "Konsumsi",
    participantType: extra.participantType ?? "Siswa",
  };
}

const ids = (rows: SortableTransaction[]) => rows.map((row) => row.id);

const withControls = (patch: Partial<TransactionListControls>): TransactionListControls => ({
  ...DEFAULT_TRANSACTION_LIST_CONTROLS,
  ...patch,
});

describe("sortAndFilterTransactions — compound sort", () => {
  it("defaults to Termahal + Terbaru: amount desc, then date desc", () => {
    const rows = [
      line("a", 100_000, "2026-09-01"),
      line("b", 300_000, "2026-09-01"),
      line("c", 300_000, "2026-09-03"),
      line("d", 200_000, "2026-09-02"),
    ];

    // b and c tie on amount (300k) → date desc puts the later (c, 09-03) first.
    expect(ids(sortAndFilterTransactions(rows, DEFAULT_TRANSACTION_LIST_CONTROLS))).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
  });

  it("Termurah reverses the primary key to amount asc", () => {
    const rows = [line("a", 300_000, "2026-09-01"), line("b", 100_000, "2026-09-01")];

    expect(ids(sortAndFilterTransactions(rows, withControls({ amountSort: "asc" })))).toEqual([
      "b",
      "a",
    ]);
  });

  it("Terlama reverses only the date tiebreak, leaving amount primary", () => {
    const rows = [
      line("a", 300_000, "2026-09-03"),
      line("b", 300_000, "2026-09-01"),
      line("c", 100_000, "2026-09-05"),
    ];

    // Amount still primary (both 300k ahead of the 100k); date asc now puts the earlier tie first.
    expect(ids(sortAndFilterTransactions(rows, withControls({ dateSort: "asc" })))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("breaks a full amount+date tie on id ascending, for a total order", () => {
    const rows = [
      line("c", 200_000, "2026-09-02"),
      line("a", 200_000, "2026-09-02"),
      line("b", 200_000, "2026-09-02"),
    ];

    // id is the final tiebreak regardless of sort direction, so the order is stable and total.
    for (const amountSort of ["asc", "desc"] as const) {
      expect(ids(sortAndFilterTransactions(rows, withControls({ amountSort })))).toEqual([
        "a",
        "b",
        "c",
      ]);
    }
  });
});

describe("sortAndFilterTransactions — filters", () => {
  const rows = [
    line("a", 100_000, "2026-09-01", { participantType: "Siswa", category: "Konsumsi" }),
    line("b", 200_000, "2026-09-02", { participantType: "GTK-MS", category: "Konsumsi" }),
    line("c", 300_000, "2026-09-03", { participantType: "Siswa", category: "Akomodasi" }),
    line("d", 400_000, "2026-09-04", { participantType: "GTK-MS", category: "Akomodasi" }),
  ];

  it("Semua on both axes keeps every row", () => {
    expect(sortAndFilterTransactions(rows, DEFAULT_TRANSACTION_LIST_CONTROLS)).toHaveLength(4);
  });

  it("filters by participant type exactly", () => {
    const kept = sortAndFilterTransactions(rows, withControls({ participantFilter: "Siswa" }));
    expect(ids(kept)).toEqual(["c", "a"]);
  });

  it("filters by category exactly", () => {
    const kept = sortAndFilterTransactions(rows, withControls({ categoryFilter: "Akomodasi" }));
    expect(ids(kept)).toEqual(["d", "c"]);
  });

  it("ANDs the two axes together", () => {
    const kept = sortAndFilterTransactions(
      rows,
      withControls({ participantFilter: "GTK-MS", categoryFilter: "Akomodasi" }),
    );
    expect(ids(kept)).toEqual(["d"]);
  });

  it("returns an empty array when the AND of the filters matches nothing", () => {
    const kept = sortAndFilterTransactions(
      rows,
      withControls({ participantFilter: "GTK-MS", categoryFilter: "Modul" }),
    );
    expect(kept).toEqual([]);
  });
});
