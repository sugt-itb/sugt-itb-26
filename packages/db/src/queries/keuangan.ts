import type { TransactionCategory, TransactionParticipantType } from "@sugt/domain";
import { and, asc, count, desc, eq, exists, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "../client";
import { subCluster } from "../schema/reference";
import { perjadin, transaction, transactionEvidence } from "../schema/travel";
import type { Person } from "./caller";
import { requireGrant } from "./staff-only";

/**
 * **Keuangan** (#472, ADR-0053) — the Programme's money Transactions across every Perjadin, as one
 * table, filtered, sorted and paged on the server, and its CSV export.
 *
 * **A Keuangan holder's, or an Administrator's**: every read opens with `requireGrant(caller,
 * "Keuangan")`, which an Administrator satisfies (ADR-0052). This narrows ADR-0026's "money is open
 * to read" for this programme-wide view only; each Perjadin's Laporan and its export stay open.
 *
 * **The filters** are a Perjadin, and a range on the Perjadin's **start date**, both ends inclusive,
 * either end open. They AND. An id that names nothing — or is not an id — matches no row: it is
 * compared as text, so it never reaches a `uuid` cast.
 */

/** How many rows a page shows. */
export const KEUANGAN_PAGE_SIZE = 50;

/** How many receipt links a row carries; a grandfathered line with more shows its first five. */
export const KEUANGAN_RECEIPT_LINKS = 5;

/** What `/keuangan` narrows to. `null` is no filter. */
export type KeuanganFilters = {
  perjadinId: string | null;
  /** The earliest Perjadin start date kept, `YYYY-MM-DD`. */
  dari: string | null;
  /** The latest Perjadin start date kept, `YYYY-MM-DD`. */
  sampai: string | null;
};

/** The sortable columns. `perjadin` sorts by the trip's start date. */
export const KEUANGAN_SORT_KEYS = [
  "spentOn",
  "category",
  "description",
  "perjadin",
  "participantType",
  "amountIdr",
] as const;
export type KeuanganSortKey = (typeof KEUANGAN_SORT_KEYS)[number];

export type KeuanganSort = { key: KeuanganSortKey; direction: "asc" | "desc" };

/** Newest Tanggal Transaksi first. */
export const DEFAULT_KEUANGAN_SORT: KeuanganSort = { key: "spentOn", direction: "desc" };

/** One transaction, as a row of the table and the export. */
export type KeuanganRow = {
  id: string;
  /** The Tanggal Transaksi, `YYYY-MM-DD`. */
  spentOn: string;
  category: TransactionCategory;
  description: string;
  participantType: TransactionParticipantType;
  amountIdr: number;
  /** The trip, named `{subClusterName} · {dates}` (ADR-0044), linking to its Laporan. */
  perjadin: { id: string; subClusterName: string; startsOn: string; endsOn: string };
  /** Null while the reconcile has not finished the line: its receipts may still be in `_staging`. */
  driveSyncedAt: Date | null;
  /** Up to five receipts' Drive file ids, by upload time then id. */
  receiptFileIds: string[];
};

/** A page of rows, and the whole filtered set's count and total. */
export type KeuanganPage = {
  rows: KeuanganRow[];
  total: number;
  totalIdr: number;
  page: number;
  pageCount: number;
};

/** The filters' predicates, over `transaction` joined to `perjadin`. */
function filterConditions(filters: KeuanganFilters): SQL[] {
  return [
    filters.perjadinId === null ? null : sql`${perjadin.id}::text = ${filters.perjadinId}`,
    filters.dari === null ? null : sql`${perjadin.startsOn} >= ${filters.dari}`,
    filters.sampai === null ? null : sql`${perjadin.startsOn} <= ${filters.sampai}`,
  ].filter((condition): condition is SQL => condition !== null);
}

const SORT_COLUMNS = {
  spentOn: transaction.spentOn,
  category: transaction.category,
  description: transaction.description,
  perjadin: perjadin.startsOn,
  participantType: transaction.participantType,
  amountIdr: transaction.amountIdr,
} satisfies Record<KeuanganSortKey, unknown>;

/**
 * The ORDER BY for a sort: the column, then entry time, then id, all one way — a total order, so a
 * row never moves between pages. Sorting by Perjadin keeps one trip's rows together.
 */
function orderBy(sort: KeuanganSort): SQL[] {
  const direction = sort.direction === "asc" ? asc : desc;
  return [
    direction(SORT_COLUMNS[sort.key]),
    ...(sort.key === "perjadin" ? [direction(perjadin.id)] : []),
    direction(transaction.createdAt),
    direction(transaction.id),
  ];
}

const rowColumns = {
  id: transaction.id,
  spentOn: transaction.spentOn,
  category: transaction.category,
  description: transaction.description,
  participantType: transaction.participantType,
  amountIdr: transaction.amountIdr,
  driveSyncedAt: transaction.driveSyncedAt,
  perjadin: {
    id: perjadin.id,
    subClusterName: subCluster.name,
    startsOn: perjadin.startsOn,
    endsOn: perjadin.endsOn,
  },
};

/** Each row with its first five receipts, by upload time then id. */
async function withReceipts(rows: Omit<KeuanganRow, "receiptFileIds">[]): Promise<KeuanganRow[]> {
  if (rows.length === 0) return [];
  const receipts = await db
    .select({
      transactionId: transactionEvidence.transactionId,
      driveFileId: transactionEvidence.driveFileId,
    })
    .from(transactionEvidence)
    .where(
      inArray(
        transactionEvidence.transactionId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(transactionEvidence.uploadedAt), asc(transactionEvidence.id));
  const byLine = new Map<string, string[]>();
  for (const { transactionId, driveFileId } of receipts) {
    const list = byLine.get(transactionId) ?? [];
    if (list.length < KEUANGAN_RECEIPT_LINKS) list.push(driveFileId);
    byLine.set(transactionId, list);
  }
  return rows.map((row) => ({ ...row, receiptFileIds: byLine.get(row.id) ?? [] }));
}

/**
 * **One page of the table** — the filtered set, sorted, 50 a page — with the count and total of the
 * **whole** filtered set, not the page. A page past the end reads as the last one.
 */
export async function keuanganPage(
  caller: Person,
  args: { filters: KeuanganFilters; sort: KeuanganSort; page: number },
): Promise<KeuanganPage> {
  requireGrant(caller, "Keuangan");
  const where = and(...filterConditions(args.filters));

  const [summary] = await db
    .select({
      total: count(),
      totalIdr: sql<number>`coalesce(sum(${transaction.amountIdr}), 0)`.mapWith(Number),
    })
    .from(transaction)
    .innerJoin(perjadin, eq(perjadin.id, transaction.perjadinId))
    .where(where);
  const total = summary?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / KEUANGAN_PAGE_SIZE));
  const page = Math.min(Math.max(1, args.page), pageCount);

  const rows = await db
    .select(rowColumns)
    .from(transaction)
    .innerJoin(perjadin, eq(perjadin.id, transaction.perjadinId))
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(where)
    .orderBy(...orderBy(args.sort))
    .limit(KEUANGAN_PAGE_SIZE)
    .offset((page - 1) * KEUANGAN_PAGE_SIZE);

  return {
    rows: await withReceipts(rows),
    total,
    totalIdr: summary?.totalIdr ?? 0,
    page,
    pageCount,
  };
}

/**
 * **Every row of the filter, for the export** — no paging, and always oldest to newest: Tanggal
 * Transaksi, then entry time, then id, whatever the page was sorted by.
 */
export async function keuanganExport(
  caller: Person,
  filters: KeuanganFilters,
): Promise<KeuanganRow[]> {
  requireGrant(caller, "Keuangan");
  const rows = await db
    .select(rowColumns)
    .from(transaction)
    .innerJoin(perjadin, eq(perjadin.id, transaction.perjadinId))
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(and(...filterConditions(filters)))
    .orderBy(asc(transaction.spentOn), asc(transaction.createdAt), asc(transaction.id));
  return withReceipts(rows);
}

/** One trip the Perjadin filter offers. */
export type KeuanganPerjadinOption = {
  id: string;
  subClusterName: string;
  startsOn: string;
  endsOn: string;
};

/** **The Perjadin filter's options**: only trips with at least one transaction, earliest first. */
export async function keuanganPerjadinOptions(caller: Person): Promise<KeuanganPerjadinOption[]> {
  requireGrant(caller, "Keuangan");
  return db
    .select({
      id: perjadin.id,
      subClusterName: subCluster.name,
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
    })
    .from(perjadin)
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(
      exists(
        db
          .select({ id: transaction.id })
          .from(transaction)
          .where(eq(transaction.perjadinId, perjadin.id)),
      ),
    )
    .orderBy(asc(perjadin.startsOn), asc(perjadin.id));
}
