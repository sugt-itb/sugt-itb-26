import type { AssessmentCompletion, MonitoringData, MonitoringSession } from "@sugt/db/queries";
import {
  type AssessmentKind,
  KEGIATAN_UNITS_PER_SCHOOL,
  LURING_SESI_WINDOWS,
  PRETEST_PARTICIPANT_TYPES,
  PROGRAMME_BUDGET_IDR,
  SESSIONS_PER_SCHOOL,
  STREAMS,
  type SessionMode,
  type Stream,
} from "@sugt/domain";

import type { Warning } from "./dashboard-state";
import { completionKey, completionKeySet, PRETEST_COLUMNS } from "./pretest/pretest-derive";

/**
 * **The pure core of the Dashboard (`/`)**, with no React, no DOM and no database — the seam the suite
 * drives directly, the same way `dashboard-state.ts`'s reducer is tested. It takes the raw rows
 * `monitoringData` reads (`@sugt/db/queries`) plus today's date and the programme constants, and
 * returns exactly the props the view renders. Nothing here queries; everything is a fold over its
 * arguments, so a hand-built fixture is a complete test.
 *
 * **Why the rank lives here and not in SQL.** A Session's Sesi is its per-School date **rank**
 * (ADR-0027) — the earliest non-cancelled Session of a mode is Sesi 1, the next is Sesi 2, and a
 * cancelled Session was already dropped upstream so the one after it takes the rank. Computing that
 * in TypeScript is what lets the suite assert "a School whose earlier Session was cancelled has its
 * later Session rank 1" without a database. The calendar windows in `LURING_SESI_WINDOWS` drive the
 * overdue warnings but **do not** bucket Sessions into a Sesi: a Session delivered outside its
 * window is late, not re-ranked.
 */

/** A Cluster column — id keys the fold, name is the header the view prints. */
type Cluster = MonitoringData["clusters"][number];
/** A School with the Cluster that owns it; the per-Cluster count is a cell's denominator. */
type School = MonitoringData["schools"][number];

/** One matrix row: a Sesi label and one `"X/Y"` cell per Cluster, in the Clusters' order. */
export type MatrixRow = { session: string; cells: string[] };

/** One pivoted row: a Cluster's name and one `"X/Y"` cell per column, in the columns' order. */
export type PivotRow = { label: string; cells: string[] };

/**
 * A pivoted table the Pelaksanaan tab renders — Klaster rows down, some other dimension across
 * (#313). `columns` are the header labels left→right; each `rows` entry is one Cluster, its `cells`
 * lining up under `columns` by index. Used for the two delivery tables (columns = Sesi) and the two
 * assessment tables (columns = Stream ∙ Peserta).
 */
export type PivotTable = { columns: string[]; rows: PivotRow[] };

/**
 * The four Pelaksanaan summary percentages (#313), each a whole-number percent rendered `{n}%`.
 * Luring/Daring are delivered Sessions over the per-mode capacity; pretest/posttest are ticked boxes
 * over `schools × 4` (`STREAMS × PRETEST_PARTICIPANT_TYPES`). Posttest reads an honest 0 until
 * posttest rows exist. All four are guarded at a 0-School denominator.
 */
export type ProgressSummary = { pretest: number; daring: number; luring: number; posttest: number };

/** A Luring Sesi's calendar window — the shape `LURING_SESI_WINDOWS` holds, accepted read-only. */
type SesiWindow = { sesi: number; startsOn: string; endsOn: string };

/** Everything the Dashboard view renders, assembled from the raw data by `deriveDashboard`. */
export type DerivedDashboard = {
  activitiesPercent: number;
  budget: { usedIdr: number; totalIdr: number; percent: number };
  summary: ProgressSummary;
  luring: PivotTable;
  daring: PivotTable;
  pretestTable: PivotTable;
  postestTable: PivotTable;
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
 * How much of the programme is done — **Kegiatan terlaksana** — as a whole-number percent of every
 * School's ten units (`KEGIATAN_UNITS_PER_SCHOOL`: 8 Sessions + a pretest unit + a posttest unit,
 * ADR-0031/#249). `completedUnits` is the numerator the caller assembles — delivered Sessions plus
 * the assessment units from `completedAssessmentUnits`. Guards a zero School count — an empty
 * programme is 0%, not a division by zero.
 */
export function activitiesPercent(completedUnits: number, schoolCount: number): number {
  if (schoolCount === 0) return 0;
  return Math.round((completedUnits / (schoolCount * KEGIATAN_UNITS_PER_SCHOOL)) * 100);
}

/** Every `(stream, participant-type)` box a School must tick for one assessment kind to count. */
const BOXES_PER_ASSESSMENT_UNIT = STREAMS.length * PRETEST_PARTICIPANT_TYPES.length;

/**
 * The **all-or-nothing** assessment units complete across all Schools, summed over both kinds
 * (ADR-0031/#249). A School earns one unit for a kind only when **all four** of that kind's boxes
 * (STREAMS × PRETEST_PARTICIPANT_TYPES) are present; three of four contributes nothing. Written
 * generically over `ASSESSMENT_KINDS`, so **posttest is already counted** — it simply stays 0 until
 * posttest rows exist, which is what caps the KPI near 90% this iteration. The unique constraint on
 * the completion row means a `(school, kind)` count of `BOXES_PER_ASSESSMENT_UNIT` is exactly "all
 * four distinct boxes", so a plain per-`(school, kind)` tally is the rollup.
 */
export function completedAssessmentUnits(completions: AssessmentCompletion[]): number {
  const boxesBySchoolKind = new Map<string, number>();
  for (const c of completions) {
    const key = `${c.schoolId}|${c.kind}`;
    boxesBySchoolKind.set(key, (boxesBySchoolKind.get(key) ?? 0) + 1);
  }
  let units = 0;
  for (const count of boxesBySchoolKind.values()) {
    if (count >= BOXES_PER_ASSESSMENT_UNIT) units++;
  }
  return units;
}

/**
 * A summary percentage for one delivery mode (#313): every `delivered` Session of that mode over the
 * mode's capacity — `schoolCount × perSchool` (2 offline, 6 online). Session-level, not
 * all-or-nothing per School — the same `status === "delivered"` count `deliveryMatrix` sums, just
 * rolled up rather than split by Sesi and Cluster. Guards a 0-School denominator at 0%.
 */
export function deliveryProgress(
  sessions: MonitoringSession[],
  mode: SessionMode,
  schoolCount: number,
  perSchool: number,
): number {
  const denominator = schoolCount * perSchool;
  if (denominator === 0) return 0;
  const delivered = sessions.filter((s) => s.mode === mode && s.status === "delivered").length;
  return Math.round((delivered / denominator) * 100);
}

/**
 * A summary percentage for one assessment kind (#313): every ticked box of that kind over
 * `schoolCount × BOXES_PER_ASSESSMENT_UNIT` (the four `STREAMS × PRETEST_PARTICIPANT_TYPES` boxes a
 * School can tick). Box-level, matching the per-box meters this replaces — a School three-quarters
 * done still contributes its three boxes. Posttest stays 0% until posttest rows exist, by
 * construction. Guards a 0-School denominator at 0%.
 */
export function assessmentProgress(
  completions: AssessmentCompletion[],
  kind: AssessmentKind,
  schoolCount: number,
): number {
  const denominator = schoolCount * BOXES_PER_ASSESSMENT_UNIT;
  if (denominator === 0) return 0;
  const ticked = completions.filter((c) => c.kind === kind).length;
  return Math.round((ticked / denominator) * 100);
}

/**
 * Pivot a Sesi-indexed delivery matrix into the Klaster-row shape the tab renders (#313): columns
 * become the Sesi labels, and each Cluster gets one row whose `i`th cell is its cell from Sesi `i+1`.
 * `deliveryMatrix` builds each row's cells in the Clusters' order, so cluster `ci` reads
 * `row.cells[ci]` across the rows — a transpose, no re-count.
 */
export function pivotByCluster(clusters: Cluster[], sesiRows: MatrixRow[]): PivotTable {
  return {
    columns: sesiRows.map((row) => row.session),
    rows: clusters.map((cluster, ci) => ({
      label: cluster.name,
      cells: sesiRows.map((row) => row.cells[ci]),
    })),
  };
}

/** The stream's on-screen label — English in code (`Stream`), Indonesian on screen: `Research` → "Riset". */
const STREAM_DISPLAY = { STEM: "STEM", Research: "Riset" } as const satisfies Record<
  Stream,
  string
>;

/**
 * One assessment table (#313): Klaster rows down, the four `STREAMS × PRETEST_PARTICIPANT_TYPES`
 * boxes across, each cell `"{schools in the Cluster with that box ticked} / {schools in the Cluster}"`.
 * Reuses `/pretest`'s column order and completion-key helpers so the readout cannot drift from the
 * grid or the CHECK constraints. `kind` selects pretest or posttest; a posttest table reads all
 * `0/Y` until posttest rows exist. Column headers use the "∙" separator and the Indonesian stream
 * label.
 */
export function assessmentTable(
  clusters: Cluster[],
  schools: School[],
  completions: AssessmentCompletion[],
  kind: AssessmentKind,
): PivotTable {
  const ticked = completionKeySet(completions.filter((c) => c.kind === kind));
  const schoolsByCluster = new Map<string, School[]>();
  for (const sc of schools) {
    const list = schoolsByCluster.get(sc.clusterId);
    if (list) list.push(sc);
    else schoolsByCluster.set(sc.clusterId, [sc]);
  }
  return {
    columns: PRETEST_COLUMNS.map((col) => `${STREAM_DISPLAY[col.stream]} ∙ ${col.participantType}`),
    rows: clusters.map((cluster) => {
      const clusterSchools = schoolsByCluster.get(cluster.id) ?? [];
      const cells = PRETEST_COLUMNS.map((col) => {
        let x = 0;
        for (const sc of clusterSchools) {
          if (ticked.has(completionKey(sc.id, col.stream, col.participantType))) x++;
        }
        return `${x}/${clusterSchools.length}`;
      });
      return { label: cluster.name, cells };
    }),
  };
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
 * Assemble the whole view from the raw data, today's date and the assessment completion rows (#313).
 * The delivered total is every `delivered` Session across both modes (the data already excludes
 * cancelled), and the budget percent is spend against `PROGRAMME_BUDGET_IDR` to one decimal — the
 * same tiny fraction the scaffold showed as `0.2`. The two delivery tables are the ranked matrices
 * pivoted to Klaster rows; the two assessment tables count ticked boxes per Cluster; the four
 * summary percentages read against the same always-47 School denominator, posttest honestly 0 until
 * posttest rows exist. The overdue warnings still fold the Sesi-indexed Luring matrix, before it is
 * pivoted for the view.
 */
export function deriveDashboard(
  data: MonitoringData,
  today: string,
  completions: AssessmentCompletion[],
): DerivedDashboard {
  const schoolCount = data.schools.length;
  const deliveredTotal = data.sessions.filter((s) => s.status === "delivered").length;
  // Kegiatan terlaksana now folds the all-or-nothing pretest/posttest units into the numerator, over
  // the ×10 denominator (ADR-0031/#249); posttest stays 0 until posttest rows exist.
  const completedUnits = deliveredTotal + completedAssessmentUnits(completions);
  const luringRows = deliveryMatrix(
    data.clusters,
    data.schools,
    data.sessions,
    "offline",
    SESSIONS_PER_SCHOOL.offline,
  );
  const daringRows = deliveryMatrix(
    data.clusters,
    data.schools,
    data.sessions,
    "online",
    SESSIONS_PER_SCHOOL.online,
  );
  const usedIdr = data.budgetUsedIdr;
  const totalIdr = PROGRAMME_BUDGET_IDR;
  return {
    activitiesPercent: activitiesPercent(completedUnits, schoolCount),
    budget: { usedIdr, totalIdr, percent: Math.round((usedIdr / totalIdr) * 1000) / 10 },
    summary: {
      pretest: assessmentProgress(completions, "pretest", schoolCount),
      daring: deliveryProgress(data.sessions, "online", schoolCount, SESSIONS_PER_SCHOOL.online),
      luring: deliveryProgress(data.sessions, "offline", schoolCount, SESSIONS_PER_SCHOOL.offline),
      posttest: assessmentProgress(completions, "posttest", schoolCount),
    },
    luring: pivotByCluster(data.clusters, luringRows),
    daring: pivotByCluster(data.clusters, daringRows),
    pretestTable: assessmentTable(data.clusters, data.schools, completions, "pretest"),
    postestTable: assessmentTable(data.clusters, data.schools, completions, "posttest"),
    warnings: overdueWarnings(luringRows, LURING_SESI_WINDOWS, today),
  };
}
