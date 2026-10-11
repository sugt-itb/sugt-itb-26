import {
  ACTIVITY_LOG_ACTION_LABELS,
  formatRupiah,
  formatTimeRange,
  MAX_RECEIPTS_PER_TRANSACTION,
  type ActivityLogAction,
  type PerjadinDocumentKind,
  type PerjadinDocumentParticipantType,
  type SessionFootageKind,
  type TimeZone,
  type TransactionCategory,
  type TransactionParticipantType,
} from "@sugt/domain";
import { and, count, desc, eq, ilike, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../client";
import { sessionFootage } from "../schema/delivery";
import { person } from "../schema/people";
import { subCluster } from "../schema/reference";
import { activityLog, perjadin, perjadinDocument, transaction } from "../schema/travel";
import type { Person } from "./caller";
import { tripSchoolNames } from "./perjadin-naming";
import { requireGrant } from "./staff-only";

/**
 * **The Activity Log** (#395) — the append-only record of who changed money, evidence or documents
 * on a Perjadin, and when. This module holds both halves, so every writer renders an entry the same
 * way:
 *
 * - **`logActivity`**, which each write calls **inside its own database transaction**, so a refused
 *   or failed write logs nothing. It is not a query a surface calls — it takes the writer's
 *   transaction, not a caller of its own — so `./index.ts` does not export it.
 * - **`activityLogPage`**, `/log`'s one read: Administrator only.
 */

/**
 * What a `document_uploaded` entry records of its Perjadin Document (#397): enough to say which
 * document it was after the document itself is gone. The four Peserta fields are present on a
 * Daftar Hadir Peserta only; `timeZone` is its School's, which its two times are read in. An SPPD
 * (#441) has `schoolName` and no date.
 */
export type DocumentLogDetails = {
  documentId: string;
  kind: PerjadinDocumentKind;
  documentDate: string | null;
  schoolName?: string;
  participantType?: PerjadinDocumentParticipantType;
  startsAt?: string;
  endsAt?: string;
  timeZone?: TimeZone;
};

/**
 * What a `footage_*` entry records of one file of Session Footage (#424, ADR-0046): which file, and
 * which Session — its date and School — since a Perjadin may hold several Sessions.
 */
export type FootageLogDetails = {
  footageId: string;
  sessionId: string;
  kind: SessionFootageKind;
  originalFilename: string;
  heldOn: string;
  schoolName: string;
};

/**
 * What `details` holds for each action. `document_deleted` is the same snapshot as
 * `document_uploaded`, taken of the row as it is deleted (#398), since the row is then gone. The two
 * money deletes (ADR-0050) are snapshots for the same reason: `evidence_deleted` of the receipt and
 * its line (#462), `transaction_deleted` of the whole line (#463).
 */
export type ActivityLogDetails = {
  advance_set: { amountIdr: number };
  advance_changed: { fromIdr: number; toIdr: number };
  transaction_recorded: {
    transactionId: string;
    category: TransactionCategory;
    amountIdr: number;
    participantType: TransactionParticipantType;
    spentOn: string;
    receiptCount: number;
  };
  evidence_uploaded: {
    transactionId: string;
    category: TransactionCategory;
    amountIdr: number;
    spentOn: string;
    /** The receipts this batch added. */
    added: number;
    /** What the line holds after it. */
    total: number;
  };
  report_filed: { transactionCount: number; totalIdr: number };
  document_uploaded: DocumentLogDetails;
  document_deleted: DocumentLogDetails;
  footage_uploaded: FootageLogDetails;
  footage_deleted: FootageLogDetails;
  evidence_deleted: {
    transactionId: string;
    evidenceId: string;
    category: TransactionCategory;
    amountIdr: number;
    spentOn: string;
    /** What the line holds after it — never zero, since the only receipt cannot be deleted. */
    left: number;
  };
  transaction_deleted: {
    transactionId: string;
    category: TransactionCategory;
    amountIdr: number;
    participantType: TransactionParticipantType;
    spentOn: string;
    description: string;
    /** The receipts the line held, trashed with it. */
    receiptCount: number;
  };
};

/** One act: its action and the details shaped for it. */
export type ActivityLogEntry = {
  [A in ActivityLogAction]: { action: A; details: ActivityLogDetails[A] };
}[ActivityLogAction];

/** The Aksi column: the action's label, and "(dari data lama)" after it on a backfilled row. */
export function activityLogAksi(action: ActivityLogAction, backfilled: boolean): string {
  const label = ACTIVITY_LOG_ACTION_LABELS[action];
  return backfilled ? `${label} (dari data lama)` : label;
}

/**
 * The Rincian column as text. "tgl" is the date the money was spent, not when the act happened.
 * Migration 0039 renders the backfilled rows' `search_text` in SQL to match this character for
 * character; change one and the other goes with it.
 */
export function activityLogRincian(entry: ActivityLogEntry): string {
  switch (entry.action) {
    case "advance_set":
      return formatRupiah(entry.details.amountIdr);
    case "advance_changed":
      return `${formatRupiah(entry.details.fromIdr)} → ${formatRupiah(entry.details.toIdr)}`;
    case "transaction_recorded": {
      const { category, amountIdr, participantType, spentOn, receiptCount } = entry.details;
      return `${category} · ${formatRupiah(amountIdr)} · ${participantType} · tgl ${spentOn} · ${receiptCount} bukti`;
    }
    case "evidence_uploaded": {
      const { category, amountIdr, spentOn, added, total } = entry.details;
      return `${category} · ${formatRupiah(amountIdr)} · tgl ${spentOn} · +${added} bukti (kini ${total}/${MAX_RECEIPTS_PER_TRANSACTION})`;
    }
    case "evidence_deleted": {
      const { category, amountIdr, spentOn, left } = entry.details;
      return `${category} · ${formatRupiah(amountIdr)} · tgl ${spentOn} · -1 bukti (kini ${left}/${MAX_RECEIPTS_PER_TRANSACTION})`;
    }
    case "transaction_deleted": {
      const { category, amountIdr, participantType, spentOn, description, receiptCount } =
        entry.details;
      return `${category} · ${formatRupiah(amountIdr)} · ${participantType} · tgl ${spentOn} · ${description} · ${receiptCount} bukti`;
    }
    case "report_filed":
      return `${entry.details.transactionCount} transaksi · total ${formatRupiah(entry.details.totalIdr)}`;
    case "document_uploaded":
    case "document_deleted":
      return documentRincian(entry.details);
    case "footage_uploaded":
    case "footage_deleted":
      return footageRincian(entry.details);
  }
}

/**
 * A Perjadin Document as one line — `Daftar Hadir Peserta · 2026-10-14 · SMA Y · Siswa ·
 * 08.00–11.30 WITA`, just its kind and date for the other two attendance kinds, and
 * `SPPD · SMAN 1 Bontang` for an SPPD (#441).
 */
function documentRincian(details: DocumentLogDetails): string {
  const { kind, documentDate, schoolName, participantType, startsAt, endsAt, timeZone } = details;
  const parts: string[] = [kind];
  if (documentDate) parts.push(documentDate);
  if (schoolName) parts.push(schoolName);
  if (participantType && startsAt && endsAt && timeZone) {
    parts.push(participantType, formatTimeRange(startsAt, endsAt, timeZone));
  }
  return parts.join(" · ");
}

/** One file of footage as one line — `Foto · IMG_1234.JPG · 2026-10-14 · SMAN 1 Bontang`. */
function footageRincian(details: FootageLogDetails): string {
  const kind = details.kind === "foto" ? "Foto" : "Video";
  return [kind, details.originalFilename, details.heldOn, details.schoolName].join(" · ");
}

/** `search_text`: the Aksi and Rincian as the screen shows them, lower-cased once at write time. */
function activityLogSearchText(entry: ActivityLogEntry, backfilled: boolean): string {
  return `${activityLogAksi(entry.action, backfilled)} · ${activityLogRincian(entry)}`.toLowerCase();
}

/** The transaction a write already holds open. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * **Write one entry, in the writer's transaction.** The actor is the calling Person: their id, and
 * a copy of their email as it is now, so the row stays true if the email later changes.
 */
export async function logActivity(
  tx: Tx,
  actor: Person,
  perjadinId: string,
  entry: ActivityLogEntry,
): Promise<void> {
  await tx.insert(activityLog).values({
    actorPersonId: actor.id,
    actorEmail: actor.email,
    perjadinId,
    action: entry.action,
    details: entry.details,
    searchText: activityLogSearchText(entry, false),
  });
}

/** `/log` shows this many rows a page. */
export const ACTIVITY_LOG_PAGE_SIZE = 50;

/**
 * The Aksi dropdown's choices besides Semua, keyed by their `?aksi=` value. Every one but Laporan
 * dikirim covers two actions: Catat transaksi and Unggah bukti each carry their own Hapus
 * (ADR-0050).
 */
export const ACTIVITY_LOG_AKSI_FILTERS = {
  "uang-perjalanan": { label: "Uang Perjalanan", actions: ["advance_set", "advance_changed"] },
  "catat-transaksi": {
    label: "Catat transaksi",
    actions: ["transaction_recorded", "transaction_deleted"],
  },
  "unggah-bukti": { label: "Unggah bukti", actions: ["evidence_uploaded", "evidence_deleted"] },
  dokumen: { label: "Dokumen", actions: ["document_uploaded", "document_deleted"] },
  "foto-video": { label: "Foto & Video", actions: ["footage_uploaded", "footage_deleted"] },
  laporan: { label: "Laporan dikirim", actions: ["report_filed"] },
} as const satisfies Record<string, { label: string; actions: readonly ActivityLogAction[] }>;
export type ActivityLogAksiFilter = keyof typeof ACTIVITY_LOG_AKSI_FILTERS;

/** What `/log`'s URL asks for. Every filter is optional, and they combine with AND. */
export type ActivityLogFilters = {
  /**
   * Matched, case-insensitively, against the actor's email, the trip's Sub-Cluster name and its
   * Schools (ADR-0044), its PIC and `search_text`.
   */
  q: string;
  aksi: ActivityLogAksiFilter | null;
  /** A WIB calendar date, `YYYY-MM-DD`, inclusive. */
  dari: string | null;
  /** A WIB calendar date, `YYYY-MM-DD`, inclusive. */
  sampai: string | null;
  /** 1-based. */
  page: number;
};

export type ActivityLogRow = ActivityLogEntry & {
  id: string;
  occurredAt: Date;
  actorEmail: string;
  backfilled: boolean;
  /** The trip is named `{subClusterName} · {dates}`, with `schoolNames` as its School line (ADR-0044). */
  perjadin: {
    id: string;
    subClusterName: string;
    schoolNames: string[];
    startsOn: string;
    endsOn: string;
    picName: string;
  };
  /** The Drive folder of the transaction the entry names, when it has one. */
  driveFolderId: string | null;
  /** The Drive file of the Perjadin Document the entry names, while the document stands. */
  documentFileId: string | null;
  /** The Drive file of the Session Footage the entry names, while the footage stands. */
  footageFileId: string | null;
};

export type ActivityLogPage = {
  rows: ActivityLogRow[];
  /** Every entry the filters match, across all pages. */
  total: number;
  page: number;
  pageCount: number;
};

/** `%` and `_` typed into the search box are matched literally. */
function containing(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * **`/log`: one page of the Activity Log, newest first, with the count of all that matches.**
 * Administrator only. Never loads all rows: filtering and search run in SQL, and the read is one
 * page (`limit 50 offset …`) plus one `count(*)`. The `(occurred_at desc, id desc)` index serves
 * the order. A page past the last is the last.
 *
 * The Perjadin's PIC is joined live, so the column names the **current** PIC. The date range is in
 * WIB calendar days: `dari` from its midnight, `sampai` up to the next one.
 */
export async function activityLogPage(
  caller: Person,
  filters: ActivityLogFilters,
): Promise<ActivityLogPage> {
  requireGrant(caller, "Administrator");

  const pic = alias(person, "pic");
  const conditions: (SQL | undefined)[] = [];

  const q = filters.q.trim().toLowerCase();
  if (q) {
    const pattern = containing(q);
    conditions.push(
      or(
        ilike(activityLog.actorEmail, pattern),
        // The trip's name is its Sub-Cluster's and its dates (ADR-0044); the dates are the date
        // filter's, so the search reads the Kelompok — and the School line under it.
        ilike(subCluster.name, pattern),
        ilike(sql`array_to_string(${tripSchoolNames(perjadin.id)}, ', ')`, pattern),
        ilike(pic.fullName, pattern),
        like(activityLog.searchText, pattern),
      ),
    );
  }
  if (filters.aksi) {
    conditions.push(
      inArray(activityLog.action, [...ACTIVITY_LOG_AKSI_FILTERS[filters.aksi].actions]),
    );
  }
  if (filters.dari) {
    conditions.push(
      sql`${activityLog.occurredAt} >= (${filters.dari}::date)::timestamp at time zone 'Asia/Jakarta'`,
    );
  }
  if (filters.sampai) {
    conditions.push(
      sql`${activityLog.occurredAt} < (${filters.sampai}::date + 1)::timestamp at time zone 'Asia/Jakarta'`,
    );
  }
  const where = and(...conditions);

  // Counted first, so a `?page=` past the last page shows the last page rather than none.
  const [matched] = await db
    .select({ total: count() })
    .from(activityLog)
    .innerJoin(perjadin, eq(perjadin.id, activityLog.perjadinId))
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .innerJoin(pic, eq(pic.id, perjadin.picPersonId))
    .where(where);
  const total = matched?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_LOG_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page)), pageCount);

  const rows = await db
    .select({
      id: activityLog.id,
      occurredAt: activityLog.occurredAt,
      actorEmail: activityLog.actorEmail,
      action: activityLog.action,
      details: activityLog.details,
      backfilled: activityLog.backfilled,
      perjadinId: perjadin.id,
      subClusterName: subCluster.name,
      schoolNames: tripSchoolNames(perjadin.id),
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      picName: pic.fullName,
      driveFolderId: transaction.driveFolderId,
      documentFileId: perjadinDocument.driveFileId,
      footageFileId: sessionFootage.driveFileId,
    })
    .from(activityLog)
    .innerJoin(perjadin, eq(perjadin.id, activityLog.perjadinId))
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .innerJoin(pic, eq(pic.id, perjadin.picPersonId))
    .leftJoin(
      transaction,
      sql`${transaction.id} = (${activityLog.details} ->> 'transactionId')::uuid`,
    )
    .leftJoin(
      perjadinDocument,
      sql`${perjadinDocument.id} = (${activityLog.details} ->> 'documentId')::uuid`,
    )
    .leftJoin(
      sessionFootage,
      sql`${sessionFootage.id} = (${activityLog.details} ->> 'footageId')::uuid`,
    )
    .where(where)
    .orderBy(desc(activityLog.occurredAt), desc(activityLog.id))
    .limit(ACTIVITY_LOG_PAGE_SIZE)
    .offset((page - 1) * ACTIVITY_LOG_PAGE_SIZE);

  return {
    rows: rows.map((row) => ({
      ...({ action: row.action, details: row.details } as ActivityLogEntry),
      id: row.id,
      occurredAt: row.occurredAt,
      actorEmail: row.actorEmail,
      backfilled: row.backfilled,
      perjadin: {
        id: row.perjadinId,
        subClusterName: row.subClusterName,
        schoolNames: row.schoolNames,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        picName: row.picName,
      },
      driveFolderId: row.driveFolderId,
      documentFileId: row.documentFileId,
      footageFileId: row.footageFileId,
    })),
    total,
    page,
    pageCount,
  };
}
