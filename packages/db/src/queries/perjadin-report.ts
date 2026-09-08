import {
  REPORT_DEADLINE_DAYS_AFTER_RETURN,
  type TransactionCategory,
  type TransactionParticipantType,
} from "@sugt/domain";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../client";
import { person } from "../schema/people";
import { perjadin, perjadinPimpinan, transaction, transactionEvidence } from "../schema/travel";
import type { Person } from "./caller";
import { todayInDeadlineZone } from "./deadline";
import { requireStaff } from "./staff-only";

/**
 * **Perjadin Report** — the acquittal of one Perjadin. Reading it is now open to any signed-in
 * Person (ADR-0026 reversed ADR-0004's money-read half, #180); only **writing** it — recording a
 * transaction, attaching a receipt, settling, filing — stays Staff-only, each write query below
 * opening with its own `requireStaff`.
 *
 * There is no `perjadin_report` table: a Perjadin yields exactly one Report, always, so the
 * acquittal is the state already on `perjadin`, plus its line items and their evidence.
 *
 * **Three things on this payload are derived and never stored** — the remainder, the report
 * deadline and the days left against it. Each follows from something already on the row, so
 * none can be typed wrong and each moves by itself when the trip's dates are corrected.
 * Nothing is gated on the deadline: DITSAMA sets it for itself, and the tool is never
 * stricter than the process it serves.
 */

/**
 * One uploaded receipt. `storagePath` is an opaque key in the private `receipts` bucket —
 * the app mints a signed URL for it after checking the caller is Staff, so the path travels
 * to the browser but never resolves without that step.
 */
export type AcquittalEvidence = {
  id: string;
  storagePath: string;
  contentType: string;
  byteSize: number;
  uploadedAt: Date;
};

/**
 * One line item against the Advance.
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
  destination: string;
  startsOn: string;
  endsOn: string;
  /** Fixed at planning and transferred before departure, so never null and never absent. */
  advanceIdr: number;
  /** The sum of every transaction against the Advance. Zero when none has been entered. */
  spentIdr: number;
  /** Of `spentIdr`, the spend attributed to the Siswa cohort. */
  siswaSpentIdr: number;
  /** Of `spentIdr`, the spend attributed to the GTK-MS cohort. */
  gtkMsSpentIdr: number;
  /** What is left of the Advance to hand back. Negative means the Group overspent. */
  remainderIdr: number;
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
  returnedToTreasurerIdr: number | null;
  returnedAt: Date | null;
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
 * **Two write actions used to lean on this read's guard, and now do not.** `mintReceiptUploadsAction`
 * and `finalizeReceiptsAction` (`perjadin/[id]/laporan/actions.ts`) had no Staff guard of their own —
 * this read's `requireStaff` was the whole of theirs. Opening the read would have opened those writes
 * (a receipt-upload credential, a service-role Storage read) to a Pimpinan, so each now calls
 * `requireStaff` explicitly, ahead of this read. Every other money-write query (`recordTransaction`,
 * `attachTransactionEvidence`, `filePerjadinReport`) keeps its own `requireStaff`.
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
      destination: perjadin.destination,
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      advanceIdr: perjadin.advanceIdr,
      // Computed in Postgres rather than in JavaScript, so the arithmetic happens in the
      // same calendar the dates are stored in. A `Date` here would introduce a time zone the
      // domain does not have — a Session is a calendar day, and so is a deadline.
      reportDueOn: sql<string>`to_char(
        ${perjadin.endsOn} + ${sql.raw(String(REPORT_DEADLINE_DAYS_AFTER_RETURN))}, 'YYYY-MM-DD'
      )`,
      // The deadline less today, both in the office's zone: `todayInDeadlineZone` is the shared
      // `(now() at time zone …)::date` fragment (`./deadline.ts`), the calendar day in Bandung's
      // zone rather than the session's default, which nothing in this repository sets.
      daysRemaining: sql<number>`(
        ${perjadin.endsOn} + ${sql.raw(String(REPORT_DEADLINE_DAYS_AFTER_RETURN))}
        - ${todayInDeadlineZone}
      )`.mapWith(Number),
      returnedToTreasurerIdr: perjadin.returnedToTreasurerIdr,
      returnedAt: perjadin.returnedAt,
      reportFiledAt: perjadin.reportFiledAt,
    })
    .from(perjadin)
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
    remainderIdr: trip.advanceIdr - spentIdr,
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
    })
    .from(transaction)
    .where(eq(transaction.perjadinId, perjadinId))
    .orderBy(asc(transaction.spentOn), asc(transaction.createdAt));

  if (lines.length === 0) return [];

  const evidence = await db
    .select({
      id: transactionEvidence.id,
      transactionId: transactionEvidence.transactionId,
      storagePath: transactionEvidence.storagePath,
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

/** What the acquittal form collects for one line item. */
export type NewTransaction = {
  perjadinId: string;
  spentOn: string;
  description: string;
  amountIdr: number;
  category: TransactionCategory;
  /** Which cohort the spend served — `Siswa` or `GTK-MS`. Required, like `category`. */
  participantType: TransactionParticipantType;
};

export type RecordTransactionResult =
  | { outcome: "recorded"; transactionId: string }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" }
  /** A zero or negative line item. `transaction_amount_check` refuses it too. */
  | { outcome: "amount-not-positive" };

/**
 * Record one line item against the Advance.
 *
 * Every refusal here is something a PIC can type honestly, so each comes back as a value and
 * earns a field-level message rather than an error page. `NotStaffError` is the opposite
 * case and still throws.
 */
export async function recordTransaction(
  caller: Person,
  input: NewTransaction,
): Promise<RecordTransactionResult> {
  requireStaff(caller);

  if (input.amountIdr <= 0) return { outcome: "amount-not-positive" };

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: perjadin.id })
      .from(perjadin)
      .where(eq(perjadin.id, input.perjadinId));
    if (!trip) return { outcome: "no-such-perjadin" };

    const [line] = await tx
      .insert(transaction)
      .values({
        perjadinId: input.perjadinId,
        spentOn: input.spentOn,
        description: input.description,
        amountIdr: input.amountIdr,
        category: input.category,
        participantType: input.participantType,
        createdByPersonId: caller.id,
      })
      .returning({ id: transaction.id });

    return { outcome: "recorded", transactionId: line!.id };
  });
}

/**
 * A receipt whose bytes have already landed in the `receipts` bucket. The content type and
 * size are read back from Storage by the app rather than taken from the browser, which never
 * had to tell the truth about either.
 */
export type NewEvidence = {
  storagePath: string;
  contentType: string;
  byteSize: number;
};

export type AttachEvidenceResult =
  | { outcome: "attached"; count: number }
  /** The id names no transaction on this Perjadin — a stale screen, which is reachable. */
  | { outcome: "no-such-transaction" };

/**
 * Attach receipts to one line item. Bulk or single — the same insert.
 *
 * The transaction is named **with its Perjadin**, so a caller cannot hang a receipt off a
 * line item belonging to a different trip. A Server Action is a public endpoint, so the pair
 * is checked here rather than assumed from whatever screen sent it.
 */
export async function attachTransactionEvidence(
  caller: Person,
  perjadinId: string,
  transactionId: string,
  evidence: NewEvidence[],
): Promise<AttachEvidenceResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const [line] = await tx
      .select({ id: transaction.id })
      .from(transaction)
      .where(and(eq(transaction.id, transactionId), eq(transaction.perjadinId, perjadinId)));
    if (!line) return { outcome: "no-such-transaction" };

    if (evidence.length === 0) return { outcome: "attached", count: 0 };

    await tx.insert(transactionEvidence).values(
      evidence.map((file) => ({
        transactionId,
        storagePath: file.storagePath,
        contentType: file.contentType,
        byteSize: file.byteSize,
        uploadedByPersonId: caller.id,
      })),
    );

    return { outcome: "attached", count: evidence.length };
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
 * **"Every transaction has at least one piece of evidence" is checked here and nowhere
 * else** — a cross-row count no CHECK can express, and one that must not run when a
 * transaction is entered: `product.md` is explicit that a receipt may be attached later, and
 * a PIC logging a taxi fare on the pavement has not photographed the receipt yet.
 *
 * A Perjadin with no transactions at all files cleanly. A trip that spent nothing is a real
 * trip, and the vacuous truth is the right answer rather than an edge case to refuse.
 *
 * Nothing else is gated. The deadline is not checked, because DITSAMA sets it for itself and
 * the tool is never stricter than the process it serves.
 */
export async function filePerjadinReport(
  caller: Person,
  perjadinId: string,
): Promise<FilePerjadinReportResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
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

    return { outcome: "filed", filedAt };
  });
}
