import {
  MAX_RECEIPTS_PER_TRANSACTION,
  type TransactionCategory,
  type TransactionParticipantType,
} from "@sugt/domain";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { db } from "../client";
import { person } from "../schema/people";
import { subCluster } from "../schema/reference";
import { perjadin, perjadinPimpinan, transaction, transactionEvidence } from "../schema/travel";
import { logActivity } from "./activity-log";
import type { Person } from "./caller";
import { perjadinReportDeadline, todayInDeadlineZone } from "./deadline";
import { tripSchoolNames } from "./perjadin-naming";
import { requirePerjadinWriter, requireStaff } from "./staff-only";

/**
 * **Perjadin Report** — the acquittal of one Perjadin. Reading it is now open to any signed-in
 * Person (ADR-0026 reversed ADR-0004's money-read half, #180); only **writing** it — recording or
 * deleting a transaction, attaching or deleting a receipt, filing — is the trip's Group's,
 * a Perjadin Editor's or an Administrator's (ADR-0048), each write query below opening with its own
 * `requireStaff` and running `requirePerjadinWriter`.
 *
 * There is no `perjadin_report` table: a Perjadin yields exactly one Report, always, so the
 * acquittal is the state already on `perjadin`, plus its line items and their evidence. It is
 * **every transaction on the trip, each with its receipts, reconciled against nothing**: the
 * Advance is not tracked (ADR-0051, #464), so there is no remainder to account for.
 *
 * **Three things on this payload are derived and never stored** — Uang Perjalanan Terpakai, the
 * report deadline and the days left against it. Each follows from something already stored, so
 * none can be typed wrong and each moves by itself when the trip's lines or dates are corrected.
 * Nothing is gated on the deadline: DITSAMA sets it for itself, and the tool is never
 * stricter than the process it serves.
 */

/** One uploaded receipt: `driveFileId` is its file in the company Google Drive (ADR-0040). */
export type AcquittalEvidence = {
  id: string;
  driveFileId: string;
  contentType: string;
  byteSize: number;
  uploadedAt: Date;
};

/**
 * One line item on the trip.
 *
 * `category` and `participantType` are two orthogonal axes: what kind of spend it was, and which
 * cohort it served (`Siswa` or `GTK-MS`). The latter is what the Laporan's per-type subtotals sum.
 */
export type AcquittalTransaction = {
  id: string;
  spentOn: string;
  description: string;
  amountIdr: number;
  category: TransactionCategory;
  participantType: TransactionParticipantType;
  /** The line's Drive folder, link-shared once synced. Null on a line with no receipt yet. */
  driveFolderId: string | null;
  /** When the reconcile last finished the line; null while a receipt is still owed. */
  driveSyncedAt: Date | null;
  evidence: AcquittalEvidence[];
};

/**
 * The whole acquittal screen in one round trip, per the query layer's third convention.
 *
 * `/perjadin/[id]` renders the four figures off the top of this and links onward; the
 * Report screen renders the rest. Both are the same Staff-only payload because the Report
 * *is* the acquittal state on that row — a second, thinner money query would be a second
 * place for the choke point to be forgotten.
 */
export type PerjadinAcquittal = {
  perjadinId: string;
  /** The trip is named `{subClusterName} · {dates}` (ADR-0044), read live — never stored. */
  subClusterName: string;
  /** The trip's Schools (`tripSchoolNames`), which the CSV export's file name carries. */
  schoolNames: string[];
  startsOn: string;
  endsOn: string;
  /**
   * **Uang Perjalanan Terpakai** (ADR-0051): the sum of **every** transaction on the trip, all
   * categories. Zero when none has been entered. `/perjadin/[id]`, the Laporan, its CSV and the
   * `/pendamping` card all show this one number.
   */
  spentIdr: number;
  /** Of `spentIdr`, the spend attributed to the Siswa cohort — every category, like `spentIdr`. */
  siswaSpentIdr: number;
  /** Of `spentIdr`, the spend attributed to the GTK-MS cohort — every category, like `spentIdr`. */
  gtkMsSpentIdr: number;
  /**
   * **Derived, never stored.** Two days after the Group gets back, so it cannot be typed
   * wrong and it moves by itself if the trip's dates are corrected.
   */
  reportDueOn: string;
  /**
   * Days left against that deadline, negative once it has passed.
   *
   * **"Today" is a zone, and this one is named rather than inherited.** `reportDueOn` needs
   * no zone — it is date arithmetic on two calendar days. This does: it compares the deadline
   * to the current day, and which day that is depends on where you stand. Left as bare
   * `current_date` it would be whatever zone the database session happens to default to, and
   * a Perjadin ending on the 3rd would read `terlambat 1 hari` in one session and `sisa 0
   * hari` in another at the same instant.
   *
   * `Asia/Jakarta` is the zone because the deadline is DITSAMA's own, set for itself, and
   * DITSAMA is in Bandung. It is not the School's zone — Indonesia spans three — and it is
   * not meant to be: what is being counted is how long the PIC has left with their own
   * office, not anything about where the trip went.
   */
  daysRemaining: number;
  transactions: AcquittalTransaction[];
  /**
   * The Pimpinan who joined this trip — record-only, now the names of real Pimpinan-Person rows
   * (#181, joined from `person`), ordered so the Report and its CSV read the same on every load. A
   * printed trip report names who travelled; these carry no money, so they belong on the Laporan
   * rather than a delivery surface ([#142], ADR-0004). Empty when none joined.
   */
  pimpinan: string[];
  reportFiledAt: Date | null;
};

/**
 * One Perjadin's acquittal.
 *
 * **An OPEN read now.** ADR-0004 said reading money was Staff-only; [ADR-0026](../../../../docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md)
 * ([#180](https://github.com/mafiefa02/sugt/issues/180)) reverses that half: the boundary is now
 * **read (any signed-in Person) vs write (Staff)**, so this read no longer opens with the choke
 * point — a Pimpinan reads all money. There is no `requireStaff` here any more.
 *
 * **The receipt writes do not lean on this read's guard.** Every action in
 * `perjadin/[id]/laporan/actions.ts` that reaches Drive — opening upload sessions, recording a line,
 * attaching receipts — calls `requireStaff` explicitly, ahead of this read, because Google is reached
 * before any write query runs (ADR-0040; the same reason the Supabase-era mint and read-back gave,
 * #180). Every money-write query (`recordTransaction`, `attachTransactionEvidence`,
 * `filePerjadinReport`) keeps its own `requireStaff`.
 *
 * Returns `null` when there is no such Perjadin. That is a genuinely reachable state — a
 * stale link to a deleted Perjadin.
 */
export async function perjadinAcquittal(
  _caller: Person,
  perjadinId: string,
): Promise<PerjadinAcquittal | null> {
  // No Staff check: money reads are open to any signed-in Person (ADR-0004 reversed by ADR-0026,
  // #180). The `Person` parameter stays in the signature — the sign-in seam refuses a service
  // caller or token before this runs — but the role no longer gates the read, so it is unused.

  const [trip] = await db
    .select({
      perjadinId: perjadin.id,
      subClusterName: subCluster.name,
      schoolNames: tripSchoolNames(perjadin.id),
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      // Computed in Postgres rather than in JavaScript, so the arithmetic happens in the
      // same calendar the dates are stored in. A `Date` here would introduce a time zone the
      // domain does not have — a Session is a calendar day, and so is a deadline.
      reportDueOn: sql<string>`to_char(${perjadinReportDeadline}, 'YYYY-MM-DD')`,
      // The deadline less today, both in the office's zone: `todayInDeadlineZone` is the shared
      // `(now() at time zone …)::date` fragment (`./deadline.ts`), the calendar day in Bandung's
      // zone rather than the session's default, which nothing in this repository sets.
      daysRemaining: sql<number>`(${perjadinReportDeadline} - ${todayInDeadlineZone})`.mapWith(
        Number,
      ),
      reportFiledAt: perjadin.reportFiledAt,
    })
    .from(perjadin)
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(eq(perjadin.id, perjadinId));

  if (!trip) return null;

  const [transactions, pimpinan] = await Promise.all([
    transactionsOf(perjadinId),
    pimpinanOf(perjadinId),
  ]);

  // Summed here rather than in a second `sum()` round trip: every row is already loaded, and
  // two sources for one figure is a way for the screen's total to disagree with its own list.
  const spentIdr = transactions.reduce((total, line) => total + line.amountIdr, 0);
  // The two cohort subtotals, summed off the same loaded rows for the same reason `spentIdr` is:
  // a second `sum()` round trip is a second place for the screen's split to disagree with its list.
  const siswaSpentIdr = transactions
    .filter((l) => l.participantType === "Siswa")
    .reduce((t, l) => t + l.amountIdr, 0);
  const gtkMsSpentIdr = transactions
    .filter((l) => l.participantType === "GTK-MS")
    .reduce((t, l) => t + l.amountIdr, 0);

  return {
    ...trip,
    spentIdr,
    siswaSpentIdr,
    gtkMsSpentIdr,
    transactions,
    pimpinan,
  };
}

/**
 * The line items with their evidence, oldest spend first.
 *
 * Two selects rather than one aggregate join: a `join` onto evidence multiplies the money
 * rows, and summing a multiplied `amount_idr` is exactly the reconciliation bug this screen
 * exists to prevent.
 */
async function transactionsOf(perjadinId: string): Promise<AcquittalTransaction[]> {
  const lines = await db
    .select({
      id: transaction.id,
      spentOn: transaction.spentOn,
      description: transaction.description,
      amountIdr: transaction.amountIdr,
      category: transaction.category,
      participantType: transaction.participantType,
      driveFolderId: transaction.driveFolderId,
      driveSyncedAt: transaction.driveSyncedAt,
    })
    .from(transaction)
    .where(eq(transaction.perjadinId, perjadinId))
    .orderBy(asc(transaction.spentOn), asc(transaction.createdAt));

  if (lines.length === 0) return [];

  const evidence = await db
    .select({
      id: transactionEvidence.id,
      transactionId: transactionEvidence.transactionId,
      driveFileId: transactionEvidence.driveFileId,
      contentType: transactionEvidence.contentType,
      byteSize: transactionEvidence.byteSize,
      uploadedAt: transactionEvidence.uploadedAt,
    })
    .from(transactionEvidence)
    .where(
      inArray(
        transactionEvidence.transactionId,
        lines.map((line) => line.id),
      ),
    )
    .orderBy(asc(transactionEvidence.uploadedAt));

  const byTransaction = new Map<string, AcquittalEvidence[]>();
  for (const { transactionId, ...file } of evidence) {
    const bucket = byTransaction.get(transactionId);
    if (bucket) bucket.push(file);
    else byTransaction.set(transactionId, [file]);
  }

  return lines.map((line) => ({
    ...line,
    evidence: byTransaction.get(line.id) ?? [],
  }));
}

/**
 * The Pimpinan recorded on the trip, ordered by name. Record-only — a `perjadin_pimpinan` row now
 * references a real Person of role Pimpinan (#181), not a fixed-three name — so this joins `person`
 * for the name and, since the Laporan shows names only, returns the plain strings. Ordering here
 * rather than at the render sites keeps the Report and its CSV in step on every load.
 */
async function pimpinanOf(perjadinId: string): Promise<string[]> {
  const rows = await db
    .select({ name: person.fullName })
    .from(perjadinPimpinan)
    .innerJoin(person, eq(person.id, perjadinPimpinan.personId))
    .where(eq(perjadinPimpinan.perjadinId, perjadinId))
    .orderBy(asc(person.fullName));
  return rows.map((row) => row.name);
}

/**
 * What the acquittal form collects for one line item — its receipts included. A line is recorded
 * with its evidence or not at all (ADR-0039).
 */
export type NewTransaction = {
  perjadinId: string;
  spentOn: string;
  description: string;
  amountIdr: number;
  category: TransactionCategory;
  /** Which cohort the spend served — `Siswa` or `GTK-MS`. Required, like `category`. */
  participantType: TransactionParticipantType;
  /** The receipts already uploaded, one to `MAX_RECEIPTS_PER_TRANSACTION`. */
  evidence: NewEvidence[];
  /**
   * The id to give the line, when the caller needed it before the insert — Catat transaksi names
   * the line's Drive folder and files after it (ADR-0040). Generated here when absent.
   */
  transactionId?: string;
  /** The line's Drive folder, already built in `_staging` (ADR-0040). */
  driveFolderId?: string;
};

export type RecordTransactionResult =
  | { outcome: "recorded"; transactionId: string }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" }
  /** A zero or negative line item. `transaction_amount_check` refuses it too. */
  | { outcome: "amount-not-positive" }
  /** No receipt came with the line. */
  | { outcome: "evidence-missing" }
  /** More receipts than one line may carry. */
  | { outcome: "too-many-receipts"; limit: number; count: number };

/**
 * Record one line item on the trip, **with its receipts, in one transaction** (ADR-0039).
 *
 * This is the one write path that holds "every transaction has one to five pieces of evidence" —
 * no CHECK does, because the shared database may already hold lines with none or more than five,
 * and those are grandfathered. So the count is refused here, as a value, before anything is
 * written; the dialog's disabled button is only a convenience. The line and its evidence rows
 * commit together, so a receipt the database refuses (an object already attached elsewhere) takes
 * the line down with it rather than leaving it unevidenced.
 *
 * Every refusal here is something a PIC can do honestly, so each comes back as a value and
 * earns a field-level message rather than an error page. `NotStaffError` is the opposite
 * case and still throws.
 */
export async function recordTransaction(
  caller: Person,
  input: NewTransaction,
): Promise<RecordTransactionResult> {
  requireStaff(caller);

  if (input.amountIdr <= 0) return { outcome: "amount-not-positive" };
  if (input.evidence.length === 0) return { outcome: "evidence-missing" };
  if (input.evidence.length > MAX_RECEIPTS_PER_TRANSACTION) {
    return {
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
      count: input.evidence.length,
    };
  }

  return db.transaction(async (tx) => {
    await requirePerjadinWriter(caller, input.perjadinId, tx);

    const [trip] = await tx
      .select({ id: perjadin.id })
      .from(perjadin)
      .where(eq(perjadin.id, input.perjadinId));
    if (!trip) return { outcome: "no-such-perjadin" };

    const [line] = await tx
      .insert(transaction)
      .values({
        ...(input.transactionId ? { id: input.transactionId } : {}),
        driveFolderId: input.driveFolderId ?? null,
        perjadinId: input.perjadinId,
        spentOn: input.spentOn,
        description: input.description,
        amountIdr: input.amountIdr,
        category: input.category,
        participantType: input.participantType,
        createdByPersonId: caller.id,
      })
      .returning({ id: transaction.id });

    await tx.insert(transactionEvidence).values(
      input.evidence.map((file) => ({
        ...(file.id ? { id: file.id } : {}),
        transactionId: line!.id,
        driveFileId: file.driveFileId,
        contentType: file.contentType,
        byteSize: file.byteSize,
        uploadedByPersonId: caller.id,
      })),
    );

    await logActivity(tx, caller, input.perjadinId, {
      action: "transaction_recorded",
      details: {
        transactionId: line!.id,
        category: input.category,
        amountIdr: input.amountIdr,
        participantType: input.participantType,
        spentOn: input.spentOn,
        receiptCount: input.evidence.length,
      },
    });

    return { outcome: "recorded", transactionId: line!.id };
  });
}

/**
 * A receipt whose bytes have already landed in the company Google Drive (`driveFileId`, ADR-0040).
 * The content type and size are read back by the app — sniffed from the first bytes — rather than
 * taken from the browser, which never had to tell the truth about either.
 */
export type NewEvidence = {
  /** The row's id, when the caller needed it first — a Drive file is named after it. */
  id?: string;
  driveFileId: string;
  contentType: string;
  byteSize: number;
};

export type AttachEvidenceResult =
  | { outcome: "attached"; count: number }
  /** The id names no transaction on this Perjadin — a stale screen, which is reachable. */
  | { outcome: "no-such-transaction" }
  /**
   * The batch would take the line past `MAX_RECEIPTS_PER_TRANSACTION`. None of it is attached;
   * `existing` is what the line already carries.
   */
  | { outcome: "too-many-receipts"; limit: number; existing: number };

/**
 * Attach receipts to one line item. Bulk or single — the same insert.
 *
 * The transaction is named **with its Perjadin**, so a caller cannot hang a receipt off a
 * line item belonging to a different trip. A Server Action is a public endpoint, so the pair
 * is checked here rather than assumed from whatever screen sent it.
 *
 * **Five per line, in total** (ADR-0039): what the line already carries plus this batch. The
 * parent `transaction` row is locked `for update` before its receipts are counted, so two uploads
 * racing on one line serialise — the second counts the first's rows once it commits — and cannot
 * both pass the count. A line already over five from before the rule is grandfathered: it keeps
 * what it has and gains nothing.
 *
 * **A new receipt makes the line unsynced** (ADR-0040): `drive_synced_at` goes back to null in
 * the same write, so the reconcile that follows — or the next sweep, if that one fails — knows a
 * file is still waiting in `_staging` to be named and moved into the line's folder.
 */
export async function attachTransactionEvidence(
  caller: Person,
  perjadinId: string,
  transactionId: string,
  evidence: NewEvidence[],
): Promise<AttachEvidenceResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    await requirePerjadinWriter(caller, perjadinId, tx);

    const [line] = await tx
      .select({
        id: transaction.id,
        category: transaction.category,
        amountIdr: transaction.amountIdr,
        spentOn: transaction.spentOn,
      })
      .from(transaction)
      .where(and(eq(transaction.id, transactionId), eq(transaction.perjadinId, perjadinId)))
      .for("update");
    if (!line) return { outcome: "no-such-transaction" };

    if (evidence.length === 0) return { outcome: "attached", count: 0 };

    const [held] = await tx
      .select({ existing: count() })
      .from(transactionEvidence)
      .where(eq(transactionEvidence.transactionId, transactionId));
    const existing = held?.existing ?? 0;
    if (existing + evidence.length > MAX_RECEIPTS_PER_TRANSACTION) {
      return { outcome: "too-many-receipts", limit: MAX_RECEIPTS_PER_TRANSACTION, existing };
    }

    await tx.insert(transactionEvidence).values(
      evidence.map((file) => ({
        ...(file.id ? { id: file.id } : {}),
        transactionId,
        driveFileId: file.driveFileId,
        contentType: file.contentType,
        byteSize: file.byteSize,
        uploadedByPersonId: caller.id,
      })),
    );
    await tx
      .update(transaction)
      .set({ driveSyncedAt: null })
      .where(eq(transaction.id, transactionId));

    await logActivity(tx, caller, perjadinId, {
      action: "evidence_uploaded",
      details: {
        transactionId,
        category: line.category,
        amountIdr: line.amountIdr,
        spentOn: line.spentOn,
        added: evidence.length,
        total: existing + evidence.length,
      },
    });

    return { outcome: "attached", count: evidence.length };
  });
}

/**
 * How many receipts a line on this Perjadin already carries — `null` when there is no such line on
 * it. In one round trip.
 *
 * **Exported though no screen renders it**, the one exception to this layer's third convention: it
 * is the guard the row's Unggah bukti runs **before any Drive call** (ADR-0040), so a line on another
 * trip, or one with no slot left, is refused without Google being asked anything — and that guard has
 * to live in the action, ahead of Drive, not inside the write that follows it.
 * `attachTransactionEvidence` counts again under its lock; this read is the early answer, not the
 * rule.
 */
export async function receiptsOnLine(
  caller: Person,
  perjadinId: string,
  transactionId: string,
): Promise<number | null> {
  requireStaff(caller);
  await requirePerjadinWriter(caller, perjadinId);

  const [line] = await db
    .select({ held: count(transactionEvidence.id) })
    .from(transaction)
    .leftJoin(transactionEvidence, eq(transactionEvidence.transactionId, transaction.id))
    .where(and(eq(transaction.id, transactionId), eq(transaction.perjadinId, perjadinId)))
    .groupBy(transaction.id);
  return line ? line.held : null;
}

/** What Hapus needs before it reaches Drive: the receipt's file, its line, and the line's count. */
export type ReceiptDeleteTarget = {
  perjadinId: string;
  transactionId: string;
  driveFileId: string;
  /** The receipts the line holds now, this one included. */
  held: number;
};

/**
 * **The receipt Hapus is about to delete, read before any Drive call** (ADR-0050, #462). `null` when
 * there is no such receipt — a second Hapus, or a stale screen.
 *
 * Exported for the same reason `receiptsOnLine` is: it is the guard the action runs **ahead of
 * Drive** — Staff, then the trip's writer (ADR-0048), then the count — so a non-writer causes no
 * Drive call and a line's only receipt is refused before its file is trashed.
 * `deleteTransactionEvidence` counts again under the line's lock; this read is the early answer,
 * not the rule.
 */
export async function receiptDeleteTarget(
  caller: Person,
  evidenceId: string,
): Promise<ReceiptDeleteTarget | null> {
  requireStaff(caller);

  const [found] = await db
    .select({
      perjadinId: transaction.perjadinId,
      transactionId: transactionEvidence.transactionId,
      driveFileId: transactionEvidence.driveFileId,
    })
    .from(transactionEvidence)
    .innerJoin(transaction, eq(transaction.id, transactionEvidence.transactionId))
    .where(sql`${transactionEvidence.id}::text = ${evidenceId}`);
  if (!found) return null;
  await requirePerjadinWriter(caller, found.perjadinId);

  const [line] = await db
    .select({ held: count() })
    .from(transactionEvidence)
    .where(eq(transactionEvidence.transactionId, found.transactionId));
  return { ...found, held: line?.held ?? 0 };
}

export type DeleteEvidenceResult =
  | { outcome: "deleted"; perjadinId: string }
  /** No such receipt — deleted already, by this Hapus pressed twice or by another. */
  | { outcome: "no-such-evidence" }
  /** The line's only receipt (ADR-0039): a line keeps at least one. Nothing is deleted. */
  | { outcome: "only-receipt" };

/**
 * **Delete one receipt and log `evidence_deleted`, in one transaction** (ADR-0050, #462). The action
 * has already trashed its file in Drive.
 *
 * **A line keeps at least one receipt.** The parent `transaction` row is locked `for update` before
 * its receipts are counted — the same lock `attachTransactionEvidence` counts under — so two Hapus
 * on a two-receipt line serialise: the second counts once the first has committed, finds its own
 * receipt the only one left, and is refused. A line grandfathered with more than five may lose any of
 * them, down to one.
 *
 * Nothing about filing gates it: a filed Laporan's `report_filed` entry keeps the totals as filed.
 * The Log entry is a copy of what went, since the row is gone after.
 */
export async function deleteTransactionEvidence(
  caller: Person,
  evidenceId: string,
): Promise<DeleteEvidenceResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ transactionId: transactionEvidence.transactionId })
      .from(transactionEvidence)
      .where(sql`${transactionEvidence.id}::text = ${evidenceId}`);
    if (!found) return { outcome: "no-such-evidence" };

    const [line] = await tx
      .select({
        perjadinId: transaction.perjadinId,
        category: transaction.category,
        amountIdr: transaction.amountIdr,
        spentOn: transaction.spentOn,
      })
      .from(transaction)
      .where(eq(transaction.id, found.transactionId))
      .for("update");
    if (!line) return { outcome: "no-such-evidence" };
    await requirePerjadinWriter(caller, line.perjadinId, tx);

    // Read under the lock: a Hapus that committed while this one waited is already gone from it.
    const held = await tx
      .select({ id: transactionEvidence.id })
      .from(transactionEvidence)
      .where(eq(transactionEvidence.transactionId, found.transactionId));
    if (!held.some((receipt) => receipt.id === evidenceId)) return { outcome: "no-such-evidence" };
    if (held.length <= 1) return { outcome: "only-receipt" };

    await tx.delete(transactionEvidence).where(eq(transactionEvidence.id, evidenceId));
    await logActivity(tx, caller, line.perjadinId, {
      action: "evidence_deleted",
      details: {
        transactionId: found.transactionId,
        evidenceId,
        category: line.category,
        amountIdr: line.amountIdr,
        spentOn: line.spentOn,
        left: held.length - 1,
      },
    });

    return { outcome: "deleted", perjadinId: line.perjadinId };
  });
}

/** What a line holds in Drive: its folder, if it has one, and every receipt file on it. */
export type TransactionDriveItems = {
  driveFolderId: string | null;
  driveFileIds: string[];
};

/**
 * **The line Hapus transaksi is about to delete, read before any Drive call** (ADR-0050, #463):
 * what it must trash. `null` when there is no such line — a second Hapus, or a stale screen.
 *
 * Exported as the guard the action runs **ahead of Drive**, like `receiptDeleteTarget`: Staff, then
 * the trip's writer (ADR-0048), so a non-writer causes no Drive call.
 */
export async function transactionDeleteTarget(
  caller: Person,
  transactionId: string,
): Promise<TransactionDriveItems | null> {
  requireStaff(caller);

  const [line] = await db
    .select({ perjadinId: transaction.perjadinId, driveFolderId: transaction.driveFolderId })
    .from(transaction)
    .where(sql`${transaction.id}::text = ${transactionId}`);
  if (!line) return null;
  await requirePerjadinWriter(caller, line.perjadinId);

  const receipts = await db
    .select({ driveFileId: transactionEvidence.driveFileId })
    .from(transactionEvidence)
    .where(eq(transactionEvidence.transactionId, transactionId));
  return {
    driveFolderId: line.driveFolderId,
    driveFileIds: receipts.map((receipt) => receipt.driveFileId),
  };
}

export type DeleteTransactionResult =
  /**
   * Gone, with what it held in Drive **at the commit** — which the action compares with what it
   * trashed, since a reconcile or an Unggah bukti may have added a folder or a receipt in between.
   */
  | ({ outcome: "deleted"; perjadinId: string } & TransactionDriveItems)
  /** No such line — deleted already, by this Hapus pressed twice or by another. */
  | { outcome: "no-such-transaction" };

/**
 * **Delete one line, its receipts with it, and log `transaction_deleted`, in one transaction**
 * (ADR-0050, #463). The action has already trashed the line's folder and receipt files in Drive.
 *
 * The row is locked `for update` first — the lock `attachTransactionEvidence` counts under and a
 * reconcile's folder claim waits on — so what it held is read once nothing more can join it, and
 * answered for the action to trash whatever arrived after its own read. A line with no receipt, or
 * grandfathered with more than five, is deleted like any other; nothing about filing gates it.
 *
 * The Log entry is a copy of the line, since the row is gone after.
 */
export async function deleteTransaction(
  caller: Person,
  transactionId: string,
): Promise<DeleteTransactionResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const [line] = await tx
      .select({
        perjadinId: transaction.perjadinId,
        category: transaction.category,
        amountIdr: transaction.amountIdr,
        participantType: transaction.participantType,
        spentOn: transaction.spentOn,
        description: transaction.description,
        driveFolderId: transaction.driveFolderId,
      })
      .from(transaction)
      .where(sql`${transaction.id}::text = ${transactionId}`)
      .for("update");
    if (!line) return { outcome: "no-such-transaction" };
    await requirePerjadinWriter(caller, line.perjadinId, tx);

    const receipts = await tx
      .select({ driveFileId: transactionEvidence.driveFileId })
      .from(transactionEvidence)
      .where(eq(transactionEvidence.transactionId, transactionId));

    // The evidence rows go with it (`on delete cascade`).
    await tx.delete(transaction).where(eq(transaction.id, transactionId));
    await logActivity(tx, caller, line.perjadinId, {
      action: "transaction_deleted",
      details: {
        transactionId,
        category: line.category,
        amountIdr: line.amountIdr,
        participantType: line.participantType,
        spentOn: line.spentOn,
        description: line.description,
        receiptCount: receipts.length,
      },
    });

    return {
      outcome: "deleted",
      perjadinId: line.perjadinId,
      driveFolderId: line.driveFolderId,
      driveFileIds: receipts.map((receipt) => receipt.driveFileId),
    };
  });
}

export type FilePerjadinReportResult =
  | { outcome: "filed"; filedAt: Date }
  | { outcome: "no-such-perjadin" }
  /** Filed already. Re-filing would move the timestamp and lose when it actually happened. */
  | { outcome: "already-filed"; filedAt: Date }
  /**
   * At least one line item has no receipt against it. The ids come back so the screen can
   * point at the rows rather than say "something is missing".
   */
  | { outcome: "evidence-missing"; transactionIds: string[] };

/**
 * File the Report.
 *
 * **"Every transaction has at least one piece of evidence" is checked here as a backstop.** Since
 * ADR-0039 `recordTransaction` refuses a line without a receipt, so no line written through the app
 * lacks one — but the shared database may already hold lines from before that rule, and no
 * migration touched them. Those are what this cross-row count, which no CHECK can express, still
 * catches: a PIC fixes one through its row's "Unggah bukti", then files.
 *
 * A Perjadin with no transactions at all files cleanly. A trip that spent nothing is a real
 * trip, and the vacuous truth is the right answer rather than an edge case to refuse.
 *
 * Nothing else is gated. Not the Advance, which is no longer tracked (ADR-0051, #464). Not the
 * deadline, because DITSAMA sets it for itself and the tool is never stricter than the process it
 * serves.
 */
export async function filePerjadinReport(
  caller: Person,
  perjadinId: string,
): Promise<FilePerjadinReportResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    await requirePerjadinWriter(caller, perjadinId, tx);

    const [trip] = await tx
      .select({ reportFiledAt: perjadin.reportFiledAt })
      .from(perjadin)
      .where(eq(perjadin.id, perjadinId))
      .for("update");
    if (!trip) return { outcome: "no-such-perjadin" };
    if (trip.reportFiledAt) return { outcome: "already-filed", filedAt: trip.reportFiledAt };

    const unevidenced = await tx
      .select({ id: transaction.id })
      .from(transaction)
      .leftJoin(transactionEvidence, eq(transactionEvidence.transactionId, transaction.id))
      .where(and(eq(transaction.perjadinId, perjadinId), sql`${transactionEvidence.id} is null`))
      .orderBy(asc(transaction.spentOn));

    if (unevidenced.length > 0) {
      return { outcome: "evidence-missing", transactionIds: unevidenced.map((line) => line.id) };
    }

    const filedAt = new Date();
    await tx.update(perjadin).set({ reportFiledAt: filedAt }).where(eq(perjadin.id, perjadinId));

    // Every category, as the acquittal's totals count them.
    const [lines] = await tx
      .select({
        transactionCount: count(),
        totalIdr: sql<number>`coalesce(sum(${transaction.amountIdr}), 0)`.mapWith(Number),
      })
      .from(transaction)
      .where(eq(transaction.perjadinId, perjadinId));
    await logActivity(tx, caller, perjadinId, {
      action: "report_filed",
      details: { transactionCount: lines?.transactionCount ?? 0, totalIdr: lines?.totalIdr ?? 0 },
    });

    return { outcome: "filed", filedAt };
  });
}
