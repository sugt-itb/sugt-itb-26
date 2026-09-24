import {
  activitiesPercent,
  assessmentProgress,
  assessmentTable,
  completedAssessmentUnits,
  deliveryMatrix,
  deliveryProgress,
  deriveDashboard,
  overdueWarnings,
  pivotByCluster,
  type MatrixRow,
} from "-/app/(app)/dashboard-derive";
import type { AssessmentCompletion, MonitoringData, MonitoringSession } from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

/**
 * **The pure Dashboard (`/`) derive seam, tested with no database and no DOM.**
 *
 * Like `dashboard-state.test.ts` (the warning reducer) and `theme-cycle.test.ts`, this file touches
 * neither Postgres nor a browser: it hands `dashboard-derive.ts` hand-built rows and a fixed date
 * and asserts on the matrices, summary percentages, pivots and warnings it returns. Ranking a School's
 * Sessions into Sesi lives in TypeScript precisely so it can be pinned here — the cancelled-skip
 * rule and "X never exceeds Y" are assertions, not a query nobody can drive.
 */

/** The two Clusters every fixture uses as matrix columns. Cluster A holds two Schools, B holds one. */
const CLUSTERS = [
  { id: "a", name: "Klaster A" },
  { id: "b", name: "Klaster B" },
];
const SCHOOLS = [
  { id: "s1", clusterId: "a" },
  { id: "s2", clusterId: "a" },
  { id: "s3", clusterId: "b" },
];

/** Terse Session builder — every field the seam reads, defaulted so a test names only what matters. */
function sess(
  overrides: Partial<MonitoringSession> & Pick<MonitoringSession, "schoolId">,
): MonitoringSession {
  return {
    clusterId: "a",
    mode: "offline",
    heldOn: "2026-10-10",
    startsAt: "09:00",
    id: crypto.randomUUID(),
    status: "delivered",
    ...overrides,
  };
}

describe("deliveryMatrix", () => {
  it("ranks by date, skips a cancelled earlier Session, and never lets X exceed Y", () => {
    const sessions: MonitoringSession[] = [
      // s1 (Cluster A): two delivered offline Sessions — ranks 1 and 2 both delivered.
      sess({ schoolId: "s1", heldOn: "2026-10-10", id: "s1-a" }),
      sess({ schoolId: "s1", heldOn: "2026-10-25", id: "s1-b" }),
      // s2 (Cluster A): an earlier CANCELLED Session then a later delivered one. Skipping the
      // cancelled row makes the delivered one rank 1 — so Sesi 1 for Cluster A must read 2/2.
      sess({ schoolId: "s2", heldOn: "2026-10-01", id: "s2-x", status: "cancelled" }),
      sess({ schoolId: "s2", heldOn: "2026-10-20", id: "s2-b", status: "delivered" }),
      // s3 (Cluster B): one arranged (not delivered) Session — its cell stays 0.
      sess({
        schoolId: "s3",
        clusterId: "b",
        heldOn: "2026-10-12",
        id: "s3-a",
        status: "arranged",
      }),
    ];

    const matrix = deliveryMatrix(CLUSTERS, SCHOOLS, sessions, "offline", 2);

    expect(matrix).toHaveLength(2);
    // Sesi 1: A has both s1 and s2 delivered at rank 1 (2/2); B's only School delivered nothing (0/1).
    expect(matrix[0]).toEqual({ session: "Sesi 1", cells: ["2/2", "0/1"] });
    // Sesi 2: only s1 has a rank-2 delivered Session; s2 has no second, so A reads 1/2, B 0/1.
    expect(matrix[1]).toEqual({ session: "Sesi 2", cells: ["1/2", "0/1"] });
  });

  it("shows 0/Y for a Cluster whose Schools delivered nothing of this mode", () => {
    // Only online Sessions exist; the offline matrix is all zeros over the real denominators.
    const sessions: MonitoringSession[] = [sess({ schoolId: "s1", mode: "online" })];
    const matrix = deliveryMatrix(CLUSTERS, SCHOOLS, sessions, "offline", 1);
    expect(matrix[0]).toEqual({ session: "Sesi 1", cells: ["0/2", "0/1"] });
  });
});

describe("activitiesPercent", () => {
  it("is completed units over Schools times ten, rounded", () => {
    // 4 units of 2 Schools × 10 = 20 possible → 20%.
    expect(activitiesPercent(4, 2)).toBe(20);
    // 1 of 3 × 10 = 30 → 3.33… rounds to 3.
    expect(activitiesPercent(1, 3)).toBe(3);
  });

  it("guards a zero School count", () => {
    expect(activitiesPercent(0, 0)).toBe(0);
  });
});

describe("deliveryProgress", () => {
  const sessions: MonitoringSession[] = [
    sess({ schoolId: "s1", mode: "offline", status: "delivered" }),
    sess({ schoolId: "s2", mode: "offline", status: "delivered" }),
    sess({ schoolId: "s3", mode: "offline", status: "arranged" }), // not delivered → not counted
    sess({ schoolId: "s1", mode: "online", status: "delivered" }),
    sess({ schoolId: "s2", mode: "online", status: "cancelled" }), // cancelled → not counted
  ];

  it("counts delivered Sessions of the mode over schoolCount × perSchool", () => {
    // 2 delivered offline of 3 schools × 2 = 6 → 33.33 rounds to 33.
    expect(deliveryProgress(sessions, "offline", 3, 2)).toBe(33);
    // 1 delivered online of 3 schools × 6 = 18 → 5.56 rounds to 6.
    expect(deliveryProgress(sessions, "online", 3, 6)).toBe(6);
  });

  it("guards a zero school count at 0%", () => {
    expect(deliveryProgress(sessions, "offline", 0, 2)).toBe(0);
  });
});

describe("assessmentProgress", () => {
  const box = (
    schoolId: string,
    stream: "STEM" | "Research",
    participantType: "Siswa" | "GTK-MS",
    kind: "pretest" | "posttest",
  ): AssessmentCompletion => ({ schoolId, stream, participantType, kind });

  it("counts ticked boxes of the kind over schoolCount × 4, box-level not all-or-nothing", () => {
    const completions = [
      box("s1", "STEM", "Siswa", "pretest"),
      box("s1", "STEM", "GTK-MS", "pretest"), // s1 partial (2 of 4) still contributes both boxes
      box("s2", "Research", "Siswa", "pretest"),
    ];
    // 3 pretest boxes of 3 schools × 4 = 12 → 25%.
    expect(assessmentProgress(completions, "pretest", 3)).toBe(25);
    // No posttest rows → an honest 0%.
    expect(assessmentProgress(completions, "posttest", 3)).toBe(0);
  });

  it("guards a zero school count at 0%", () => {
    expect(assessmentProgress([box("s1", "STEM", "Siswa", "pretest")], "pretest", 0)).toBe(0);
  });
});

describe("pivotByCluster", () => {
  it("transposes Sesi rows into Klaster rows, cells lined up under each Sesi column", () => {
    const sesiRows: MatrixRow[] = [
      { session: "Sesi 1", cells: ["2/2", "0/1"] },
      { session: "Sesi 2", cells: ["1/2", "1/1"] },
    ];
    expect(pivotByCluster(CLUSTERS, sesiRows)).toEqual({
      columns: ["Sesi 1", "Sesi 2"],
      rows: [
        { label: "Klaster A", cells: ["2/2", "1/2"] },
        { label: "Klaster B", cells: ["0/1", "1/1"] },
      ],
    });
  });
});

describe("assessmentTable", () => {
  const box = (
    schoolId: string,
    stream: "STEM" | "Research",
    participantType: "Siswa" | "GTK-MS",
    kind: "pretest" | "posttest",
  ): AssessmentCompletion => ({ schoolId, stream, participantType, kind });

  it("counts, per Cluster, schools with each box ticked over the Cluster's school count", () => {
    // Cluster A holds s1, s2; Cluster B holds s3.
    const completions = [
      box("s1", "STEM", "Siswa", "pretest"),
      box("s2", "STEM", "Siswa", "pretest"),
      box("s3", "Research", "GTK-MS", "pretest"),
    ];
    const table = assessmentTable(CLUSTERS, SCHOOLS, completions, "pretest");
    // Columns are the four STEM/Research × Siswa/GTK-MS boxes, "Research" shown as "Riset".
    expect(table.columns).toEqual([
      "STEM ∙ Siswa",
      "STEM ∙ GTK-MS",
      "Riset ∙ Siswa",
      "Riset ∙ GTK-MS",
    ]);
    // Klaster A: both schools ticked STEM·Siswa (2/2), nothing else. Klaster B: s3 ticked Riset·GTK-MS (1/1).
    expect(table.rows).toEqual([
      { label: "Klaster A", cells: ["2/2", "0/2", "0/2", "0/2"] },
      { label: "Klaster B", cells: ["0/1", "0/1", "0/1", "1/1"] },
    ]);
  });

  it("reads all 0/Y for posttest until posttest rows exist", () => {
    const completions = [box("s1", "STEM", "Siswa", "pretest")];
    const table = assessmentTable(CLUSTERS, SCHOOLS, completions, "posttest");
    expect(table.rows).toEqual([
      { label: "Klaster A", cells: ["0/2", "0/2", "0/2", "0/2"] },
      { label: "Klaster B", cells: ["0/1", "0/1", "0/1", "0/1"] },
    ]);
  });
});

describe("overdueWarnings", () => {
  const windows = [
    { sesi: 1, startsOn: "2026-10-05", endsOn: "2026-10-23" },
    { sesi: 2, startsOn: "2026-11-02", endsOn: "2026-11-20" },
  ];
  // Sesi 1 owes one School (0/1 undelivered in Cluster B); Sesi 2 owes three.
  const luring: MatrixRow[] = [
    { session: "Sesi 1", cells: ["2/2", "0/1"] },
    { session: "Sesi 2", cells: ["0/2", "0/1"] },
  ];

  it("fires only for ended windows, with the outstanding count", () => {
    const warnings = overdueWarnings(luring, windows, "2026-10-24");
    // Window 1 has ended and owes one School; window 2 has not ended, so it stays silent.
    expect(warnings).toEqual([
      {
        id: "luring-sesi-1-overdue",
        message:
          "Periode Luring Sesi 1 telah berakhir, namun Sesi 1 belum terlaksana pada 1 sekolah.",
      },
    ]);
  });

  it("stays silent for an ended window that is fully delivered", () => {
    const done: MatrixRow[] = [{ session: "Sesi 1", cells: ["2/2", "1/1"] }];
    expect(overdueWarnings(done, windows, "2026-10-24")).toEqual([]);
  });

  it("raises nothing while a window is still open", () => {
    expect(overdueWarnings(luring, windows, "2026-10-06")).toEqual([]);
  });

  it("skips an ended window whose Sesi has no matching row rather than counting it overdue", () => {
    // Only Sesi 1 has a row; window 2 has ended but indexes past the matrix, so it is skipped.
    const onlySesi1: MatrixRow[] = [{ session: "Sesi 1", cells: ["2/2", "1/1"] }];
    expect(overdueWarnings(onlySesi1, windows, "2026-11-21")).toEqual([]);
  });
});

describe("deriveDashboard", () => {
  it("assembles the whole view — matrices, budget percent, and delivered percent — from raw data", () => {
    const data: MonitoringData = {
      clusters: CLUSTERS,
      schools: SCHOOLS,
      sessions: [
        sess({ schoolId: "s1", mode: "offline", status: "delivered" }),
        sess({ schoolId: "s2", mode: "online", status: "delivered" }),
      ],
      budgetUsedIdr: 29_560_000,
    };

    const derived = deriveDashboard(data, "2026-09-01", []);

    // Delivery tables are pivoted to Klaster rows now: one row per Cluster, Sesi as columns.
    expect(derived.luring.rows).toHaveLength(CLUSTERS.length);
    expect(derived.luring.columns).toEqual(["Sesi 1", "Sesi 2"]);
    expect(derived.daring.columns).toHaveLength(6);
    expect(derived.daring.rows).toHaveLength(CLUSTERS.length);
    // 2 delivered units (no assessment units) of 3 Schools × 10 = 30 possible → 6.67 rounds to 7%.
    expect(derived.activitiesPercent).toBe(7);
    // The budget total is the programme budget; the tiny fraction is 0.2.
    expect(derived.budget.totalIdr).toBe(15_000_000_000);
    expect(derived.budget.usedIdr).toBe(29_560_000);
    expect(derived.budget.percent).toBe(0.2);
    // Summary percentages: no completions → 0% pretest and posttest; 1 delivered online of 18 → 6%,
    // 1 delivered offline of 6 → 17%.
    expect(derived.summary).toEqual({ pretest: 0, daring: 6, luring: 17, posttest: 0 });
    // No completions → both assessment tables read all 0/Y, one row per Cluster.
    expect(derived.postestTable.rows).toEqual([
      { label: "Klaster A", cells: ["0/2", "0/2", "0/2", "0/2"] },
      { label: "Klaster B", cells: ["0/1", "0/1", "0/1", "0/1"] },
    ]);
  });

  it("folds a School's complete pretest unit into Kegiatan terlaksana over the ×10 denominator", () => {
    // No delivered Sessions; s1 has all four pretest boxes → 1 completed unit of 3 × 10 = 30 → 3%.
    const s1FullPretest: AssessmentCompletion[] = [
      { schoolId: "s1", stream: "STEM", participantType: "Siswa", kind: "pretest" },
      { schoolId: "s1", stream: "STEM", participantType: "GTK-MS", kind: "pretest" },
      { schoolId: "s1", stream: "Research", participantType: "Siswa", kind: "pretest" },
      { schoolId: "s1", stream: "Research", participantType: "GTK-MS", kind: "pretest" },
    ];
    const data: MonitoringData = {
      clusters: CLUSTERS,
      schools: SCHOOLS,
      sessions: [],
      budgetUsedIdr: 0,
    };
    expect(deriveDashboard(data, "2026-09-01", s1FullPretest).activitiesPercent).toBe(3);
  });
});

describe("completedAssessmentUnits", () => {
  const box = (
    schoolId: string,
    stream: "STEM" | "Research",
    participantType: "Siswa" | "GTK-MS",
    kind: "pretest" | "posttest",
  ): AssessmentCompletion => ({ schoolId, stream, participantType, kind });

  /** All four boxes of one kind for one School. */
  const allFour = (schoolId: string, kind: "pretest" | "posttest"): AssessmentCompletion[] => [
    box(schoolId, "STEM", "Siswa", kind),
    box(schoolId, "STEM", "GTK-MS", kind),
    box(schoolId, "Research", "Siswa", kind),
    box(schoolId, "Research", "GTK-MS", kind),
  ];

  it("counts a School's kind only when all four boxes are present — three of four is zero", () => {
    expect(completedAssessmentUnits(allFour("s1", "pretest"))).toBe(1);
    // Drop one box → the unit no longer counts.
    expect(completedAssessmentUnits(allFour("s1", "pretest").slice(0, 3))).toBe(0);
  });

  it("counts posttest generically — the same all-four rule, so it is 0 until posttest rows exist", () => {
    expect(completedAssessmentUnits([])).toBe(0);
    // A fully-pretested School plus a fully-posttested School → two units.
    expect(
      completedAssessmentUnits([...allFour("s1", "pretest"), ...allFour("s2", "posttest")]),
    ).toBe(2);
  });

  it("sums independent per-(School, kind) units and ignores a partial one", () => {
    const completions = [
      ...allFour("s1", "pretest"),
      ...allFour("s2", "pretest"),
      ...allFour("s1", "posttest"),
      box("s3", "STEM", "Siswa", "pretest"), // partial → contributes 0
    ];
    expect(completedAssessmentUnits(completions)).toBe(3);
  });
});
