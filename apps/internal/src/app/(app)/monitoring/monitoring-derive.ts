import type { MonitoringData, MonitoringSession } from "@sugt/db/queries";
import {
  LURING_SESI_WINDOWS,
  PROGRAMME_BUDGET_IDR,
  SESSIONS_PER_SCHOOL,
  TOTAL_SESSIONS_PER_SCHOOL,
  type SessionMode,
} from "@sugt/domain";

import type { Warning } from "./monitoring-state";

/**
 * **The pure core of `/monitoring`**, with no React, no DOM and no database — the seam the suite
 * drives directly, the same way `monitoring-state.ts`'s reducer is tested. It takes the raw rows
 * `monitoringData` reads (`@sugt/db/queries`) plus today's date and the programme constants, and
 * returns exactly the props the view renders. Nothing here queries; everything is a fold over its
 * arguments, so a hand-built fixture is a complete test.
 *
 * **Why the rank lives here and not in SQL.** A Session's Sesi is its per-School date **rank**
 * (ADR-0027) — the earliest non-cancelled Session of a mode is Sesi 1, the next is Sesi 2, and a
 * cancelled Session was already dropped upstream so the one after it takes the rank. Computing that
 * in TypeScript is what lets the suite assert "a School whose earlier Session was cancelled has its
 * later Session rank 1" without a database. The calendar windows in `LURING_SESI_WINDOWS` drive the
 * timeline and the overdue warnings but **do not** bucket Sessions into a Sesi: a Session delivered
 * outside its window is late, not re-ranked.
 */

/** A Cluster column — id keys the fold, name is the header the view prints. */
type Cluster = MonitoringData["clusters"][number];
/** A School with the Cluster that owns it; the per-Cluster count is a cell's denominator. */
type School = MonitoringData["schools"][number];

/** One matrix row: a Sesi label and one `"X/Y"` cell per Cluster, in the Clusters' order. */
export type MatrixRow = { session: string; cells: string[] };

/** One step in the delivery timeline: its Sesi label, its date window, and whether it is done. */
export type TimelineStep = { label: string; window: string; status: "completed" | "pending" };

/** A Luring Sesi's calendar window — the shape `LURING_SESI_WINDOWS` holds, accepted read-only. */
type SesiWindow = { sesi: number; startsOn: string; endsOn: string };

/** Everything the `/monitoring` view renders, assembled from the raw data by `deriveMonitoring`. */
export type DerivedMonitoring = {
  activitiesPercent: number;
  budget: { usedIdr: number; totalIdr: number; percent: number };
  clusters: Cluster[];
  luring: MatrixRow[];
  daring: MatrixRow[];
  timeline: TimelineStep[];
  warnings: Warning[];
};

/**
 * Order two Sessions the way rank does: by held date, then start time, then id as a stable
 * tie-break. Plain string comparison is correct for both — `heldOn` is `YYYY-MM-DD` and `startsAt`
 * is `HH:MM[:SS]`, both of which sort lexically as they sort chronologically.
 */
function byRank(a: MonitoringSession, b: MonitoringSession): number {
  if (a.heldOn !== b.heldOn) return a.heldOn < b.heldOn ? -1 : 1;
  if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The delivery matrix for one mode: `sesiCount` rows, one `"X/Y"` cell per Cluster.
 *
 * For each School, its non-cancelled Sessions **of this mode** are ordered by rank — index 0 is
 * Sesi 1, index 1 is Sesi 2, and so on. Then for Sesi n and each Cluster, `Y` is the number of
 * Schools in that Cluster and `X` is how many of them have a rank-n Session of this mode that is
 * `delivered`. `X` counts a subset of the Cluster's Schools, so it can never exceed `Y`.
 */
export function deliveryMatrix(
  clusters: Cluster[],
  schools: School[],
  sessions: MonitoringSession[],
  mode: SessionMode,
  sesiCount: number,
): MatrixRow[] {
  // Rank each School's Sessions of this mode once, so a cell is a lookup rather than a re-sort.
  const rankedBySchool = new Map<string, MonitoringSession[]>();
  for (const s of sessions) {
    // Non-cancelled Sessions of this mode only. The query already drops cancelled rows, but
    // skipping them here too makes the rank's "a cancelled Session does not exist to it" rule hold
    // for any caller — so the next Session after a cancelled one takes its rank, not one past it.
    if (s.mode !== mode || s.status === "cancelled") continue;
    const list = rankedBySchool.get(s.schoolId);
    if (list) list.push(s);
    else rankedBySchool.set(s.schoolId, [s]);
  }
  for (const list of rankedBySchool.values()) list.sort(byRank);

  // Group Schools by Cluster once — the grouping is the same for every Sesi row, so folding it here
  // keeps the per-row work to a single pass over each Cluster's Schools.
  const schoolsByCluster = new Map<string, School[]>();
  for (const sc of schools) {
    const list = schoolsByCluster.get(sc.clusterId);
    if (list) list.push(sc);
    else schoolsByCluster.set(sc.clusterId, [sc]);
  }

  const rows: MatrixRow[] = [];
  for (let n = 1; n <= sesiCount; n++) {
    const cells = clusters.map((c) => {
      const clusterSchools = schoolsByCluster.get(c.id) ?? [];
      let x = 0;
      for (const sc of clusterSchools) {
        const rankN = rankedBySchool.get(sc.id)?.[n - 1];
        if (rankN?.status === "delivered") x++;
      }
      return `${x}/${clusterSchools.length}`;
    });
    rows.push({ session: `Sesi ${n}`, cells });
  }
  return rows;
}

/**
 * How much of the programme has been delivered, as a whole-number percent of every School's eight
 * Sessions (`TOTAL_SESSIONS_PER_SCHOOL`). Guards a zero School count — an empty programme is 0%,
 * not a division by zero.
 */
export function activitiesPercent(deliveredTotal: number, schoolCount: number): number {
  if (schoolCount === 0) return 0;
  return Math.round((deliveredTotal / (schoolCount * TOTAL_SESSIONS_PER_SCHOOL)) * 100);
}

/**
 * One timeline step per Luring window. A window is `"completed"` once today is strictly past its
 * `endsOn` — the calendar has moved on — and `"pending"` until then. `today` is a `YYYY-MM-DD`
 * string, compared lexically against `endsOn` in the same shape.
 */
export function timelineSteps(windows: readonly SesiWindow[], today: string): TimelineStep[] {
  return windows.map((w) => ({
    label: `Luring Sesi ${w.sesi}`,
    window: `${w.startsOn} - ${w.endsOn}`,
    status: today > w.endsOn ? "completed" : "pending",
  }));
}

/** How many Schools a Luring row still owes: the sum over its cells of `(Y - X)`. */
function undeliveredIn(row: MatrixRow): number {
  return row.cells.reduce((sum, cell) => {
    const [x, y] = cell.split("/").map(Number);
    return sum + (y - x);
  }, 0);
}

/**
 * One warning per Luring window that has **already ended** (its `endsOn` is strictly before today)
 * and still has undelivered Schools. The count is that Sesi's row's outstanding total; a window
 * still open, or one fully delivered, raises nothing. Warnings for a Sesi with no matching row are
 * skipped rather than counted as fully overdue.
 */
export function overdueWarnings(
  luringRows: MatrixRow[],
  windows: readonly SesiWindow[],
  today: string,
): Warning[] {
  const warnings: Warning[] = [];
  for (const w of windows) {
    if (!(w.endsOn < today)) continue;
    const row = luringRows[w.sesi - 1];
    if (!row) continue;
    const count = undeliveredIn(row);
    if (count > 0) {
      warnings.push({
        id: `luring-sesi-${w.sesi}-overdue`,
        message: `Periode Luring Sesi ${w.sesi} telah berakhir, namun Sesi ${w.sesi} belum terlaksana pada ${count} sekolah.`,
      });
    }
  }
  return warnings;
}

/**
 * Assemble the whole view from the raw data and today's date. The delivered total is every
 * `delivered` Session across both modes (the data already excludes cancelled), and the budget
 * percent is spend against `PROGRAMME_BUDGET_IDR` to one decimal — the same tiny fraction the
 * scaffold showed as `0.2`. Luring is `SESSIONS_PER_SCHOOL.offline` rows, Daring is `.online`.
 */
export function deriveMonitoring(data: MonitoringData, today: string): DerivedMonitoring {
  const deliveredTotal = data.sessions.filter((s) => s.status === "delivered").length;
  const luring = deliveryMatrix(
    data.clusters,
    data.schools,
    data.sessions,
    "offline",
    SESSIONS_PER_SCHOOL.offline,
  );
  const daring = deliveryMatrix(
    data.clusters,
    data.schools,
    data.sessions,
    "online",
    SESSIONS_PER_SCHOOL.online,
  );
  const usedIdr = data.budgetUsedIdr;
  const totalIdr = PROGRAMME_BUDGET_IDR;
  return {
    activitiesPercent: activitiesPercent(deliveredTotal, data.schools.length),
    budget: { usedIdr, totalIdr, percent: Math.round((usedIdr / totalIdr) * 1000) / 10 },
    clusters: data.clusters,
    luring,
    daring,
    timeline: timelineSteps(LURING_SESI_WINDOWS, today),
    warnings: overdueWarnings(luring, LURING_SESI_WINDOWS, today),
  };
}
