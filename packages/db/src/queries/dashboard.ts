import { REPORT_DEADLINE_DAYS_AFTER_RETURN } from "@sugt/domain";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { cluster, school } from "../schema/reference";
import { groupMember, perjadin, transaction } from "../schema/travel";
import type { Person } from "./caller";
import { deliveredSessionCount, onDeliveredSessions } from "./delivered-sessions";
import { requireStaff } from "./staff-only";

/**
 * The outer `perjadin` row's id, **qualified by hand**. Drizzle renders `perjadin.id` as bare
 * `"id"` when `perjadin` is the single FROM table, and inside the correlated subqueries below that
 * collides with `transaction.id` — so `tx.perjadin_id = "id"` silently means `= tx.id` and never
 * matches. Writing `"perjadin"."id"` keeps the correlation, the same fix `roster.ts` documents.
 */
const OUTER_PERJADIN_ID = sql.raw(`"perjadin"."id"`);

/**
 * **Beranda** — the Staff dashboard (#40). One use-case function returning one payload, taking a
 * caller, and it **assembles rather than invents** — every figure is a rule that already lives
 * somewhere else in this package, read here through one call.
 *
 * **There is only one dashboard now** (T3, #153). There was a second, money-free landing for
 * Teaching-Team professors, but the `Teaching Team` Person role is retired — every signed-in Person
 * is Staff — so it had no caller and its owed-Class-Record machinery (counted off the dropped
 * `session_teacher`) is gone. Class Records are deferred for both modes.
 *
 * The tone throughout is **counts, not claims** (ADR-0009, `docs/data-model.md`'s *who still
 * owes what*): nothing is overdue and nothing is gated. **Participants are never counted** — there
 * is no attendee list, so a count would have no denominator.
 */

/** One Cluster's delivered-Session count, for the Staff dashboard's reach picture. */
export type ClusterReach = {
  clusterId: string;
  clusterName: string;
  delivered: number;
};

/**
 * One trip this Staff member is PIC of, summarised — the acquittal figures the "Pekerjaan PIC
 * Anda" strip shows, without the full transaction and receipt lists.
 */
export type PicReport = {
  perjadinId: string;
  destination: string;
  startsOn: string;
  endsOn: string;
  groupCount: number;
  transactionCount: number;
  /** Advance minus everything spent. Negative means the Group overspent. */
  remainderIdr: number;
  /**
   * Two days after the Group gets back — derived, never stored. Shown as an absolute date, not a
   * countdown: the Report has a due date (DITSAMA's own), but the dashboard states it rather than
   * counting down to it, so nothing here reads as overdue.
   */
  reportDueOn: string;
};

/**
 * The Staff landing: the same delivery picture the Programme shows, plus this person's PIC work.
 *
 * **Everything here opens with the Staff-only choke point**, because the Advance strip and the PIC
 * work read money (ADR-0004). Reaching this with a Teaching Team `Person` throws — that is the
 * choke point working, not a case to handle. The delivery picture is not money, but it rides the
 * same guard: this is one payload, and there is no Teaching Team caller who should reach it.
 */
export type StaffDashboard = {
  fullName: string;
  /** Distinct Schools with at least one delivered Session. */
  schoolsReached: number;
  deliveredTotal: number;
  perCluster: ClusterReach[];
  /** The Advance still out, unaccounted for: the sum of Advances not yet returned. Money. */
  advanceOutstandingIdr: number;
  /** Trips they are PIC of whose Report is not yet filed. */
  picReports: PicReport[];
};

/**
 * The Staff dashboard, in one call and behind the Staff-only choke point. The reads are
 * independent aggregates — the reach picture, the outstanding Advance and the PIC's trips — kept
 * concurrent with `Promise.all`.
 */
export async function staffDashboard(caller: Person): Promise<StaffDashboard> {
  requireStaff(caller);

  const [perCluster, reached, advance, picReports] = await Promise.all([
    // Delivered count per Cluster, the delivered filter in the JOIN so a Cluster at zero still
    // appears — the rule `./delivered-sessions.ts` owns.
    db
      .select({
        clusterId: cluster.id,
        clusterName: cluster.name,
        delivered: deliveredSessionCount,
      })
      .from(cluster)
      .innerJoin(school, eq(school.clusterId, cluster.id))
      .leftJoin(session, onDeliveredSessions)
      .groupBy(cluster.id, cluster.name)
      .orderBy(asc(cluster.name), asc(cluster.id)),
    // Distinct Schools that have delivered at least one Session.
    db
      .select({ count: sql<number>`count(distinct ${session.schoolId})`.mapWith(Number) })
      .from(session)
      .where(eq(session.status, "delivered")),
    // The Advance still out: every trip whose money has not been returned to the treasurer yet.
    db
      .select({
        total: sql<number>`coalesce(sum(${perjadin.advanceIdr}), 0)`.mapWith(Number),
      })
      .from(perjadin)
      .where(isNull(perjadin.returnedAt)),
    // Trips the caller is PIC of whose Report is not filed, with the acquittal figures the strip
    // shows. `reportDueOn` is derived here the way `perjadinAcquittal` derives it — two days after
    // return — and stated as a date rather than counted down to, so nothing reads as overdue.
    db
      .select({
        perjadinId: perjadin.id,
        destination: perjadin.destination,
        startsOn: perjadin.startsOn,
        endsOn: perjadin.endsOn,
        groupCount:
          sql<number>`(select count(*) from ${groupMember} gm where gm.perjadin_id = ${OUTER_PERJADIN_ID})`.mapWith(
            Number,
          ),
        transactionCount:
          sql<number>`(select count(*) from ${transaction} tx where tx.perjadin_id = ${OUTER_PERJADIN_ID})`.mapWith(
            Number,
          ),
        remainderIdr:
          sql<number>`${perjadin.advanceIdr} - coalesce((select sum(tx.amount_idr) from ${transaction} tx where tx.perjadin_id = ${OUTER_PERJADIN_ID}), 0)`.mapWith(
            Number,
          ),
        // Two calendar days after return, the way `perjadinAcquittal` derives it. The day count is
        // a trusted constant rendered as a literal so `date + int` type-checks rather than binding
        // an untyped param.
        reportDueOn: sql<string>`to_char(${perjadin.endsOn} + ${sql.raw(String(REPORT_DEADLINE_DAYS_AFTER_RETURN))}, 'YYYY-MM-DD')`,
      })
      .from(perjadin)
      .where(and(eq(perjadin.picPersonId, caller.id), isNull(perjadin.reportFiledAt)))
      .orderBy(asc(perjadin.endsOn), asc(perjadin.id)),
  ]);

  return {
    fullName: caller.fullName,
    schoolsReached: reached[0]?.count ?? 0,
    deliveredTotal: perCluster.reduce((sum, row) => sum + row.delivered, 0),
    perCluster,
    advanceOutstandingIdr: advance[0]?.total ?? 0,
    picReports,
  };
}
