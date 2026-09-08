import type { SessionMode, SessionStatus } from "@sugt/domain";
import { asc, eq, ne, sql } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { cluster, school } from "../schema/reference";
import { transaction } from "../schema/travel";
import type { Person } from "./caller";

/**
 * **`/monitoring`'s one round trip** — the four raw shapes the screen's overview reads from, and
 * nothing derived. **Rank, percentages and warnings are computed in TypeScript**, not here
 * (`apps/internal/.../monitoring/monitoring-derive.ts`, ADR-0027): a Session's Sesi is its
 * per-School date **rank**, and keeping that in a pure function is what makes it unit-testable
 * against hand-built fixtures rather than a live database. So this module returns rows and one sum,
 * and the seam above turns them into the matrix.
 *
 * **No Staff choke point.** The budget figure is a money **read**, and money reads are open to any
 * signed-in Person since ADR-0026 (#180) reversed ADR-0004's read half — so `monitoringData` takes
 * a `Person` for the convention's sake (every query says who is asking) but asks no role of them.
 * The `_caller` prefix marks it unread, exactly as the other open reads here do. Writing money
 * stays Staff-only, enforced in each money-write query, not by this read.
 */

/** One Session as `/monitoring` ranks it: enough to place it in a School's per-mode ordering and to
 *  know whether it counts as delivered. Carries `clusterId` from its School so the matrix never
 *  re-joins. */
export type MonitoringSession = {
  schoolId: string;
  clusterId: string;
  mode: SessionMode;
  heldOn: string;
  startsAt: string;
  id: string;
  status: SessionStatus;
};

/**
 * The raw inputs the derive seam folds into the view. **Every figure is a row or a plain sum** —
 * the four Clusters (the matrix columns), every School with its Cluster (the denominators), every
 * non-cancelled Session (the numerators, once ranked), and the programme-wide spend.
 */
export type MonitoringData = {
  /** The four Clusters, ordered as the matrix columns render — the same order `scope` uses. */
  clusters: { id: string; name: string }[];
  /** Every School with its Cluster. The per-Cluster School count is each cell's denominator. */
  schools: { id: string; clusterId: string }[];
  /**
   * Every Session that is **not cancelled** — `arranged` or `delivered`. Cancelled Sessions are
   * excluded here so the rank never counts one: a School whose earlier Session was cancelled has its
   * next Session take rank 1, exactly as the Sesi labelling means it (ADR-0027).
   */
  sessions: MonitoringSession[];
  /** `SUM(transaction.amount_idr)` over every transaction, programme-wide. Coalesced to 0. */
  budgetUsedIdr: number;
};

/**
 * The four raw payloads in one call. Four independent selects because the lists are independent —
 * Clusters and Schools do not nest, the Session list is every non-cancelled row across all Schools,
 * and the budget is a single scalar over the whole `transaction` table.
 */
export async function monitoringData(_caller: Person): Promise<MonitoringData> {
  const clusters = await db
    .select({ id: cluster.id, name: cluster.name })
    .from(cluster)
    // The same ordering `scope` gives its Cluster list, so the matrix columns read left-to-right in
    // a stable order that does not depend on insertion.
    .orderBy(asc(cluster.name), asc(cluster.id));

  const schools = await db.select({ id: school.id, clusterId: school.clusterId }).from(school);

  const sessions = await db
    .select({
      schoolId: session.schoolId,
      // `school.cluster_id` is NOT NULL, so an inner join never drops a Session and its Cluster is
      // always present.
      clusterId: school.clusterId,
      mode: session.mode,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
      id: session.id,
      status: session.status,
    })
    .from(session)
    .innerJoin(school, eq(school.id, session.schoolId))
    // Cancelled Sessions are excluded here, not in the seam, so the rank the seam computes never
    // has one to skip — a cancelled Session simply does not exist to it.
    .where(ne(session.status, "cancelled"));

  const [budget] = await db
    .select({
      budgetUsedIdr: sql<number>`coalesce(sum(${transaction.amountIdr}), 0)`.mapWith(Number),
    })
    .from(transaction);

  return { clusters, schools, sessions, budgetUsedIdr: budget?.budgetUsedIdr ?? 0 };
}
