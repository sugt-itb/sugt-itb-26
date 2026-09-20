import {
  completionKey,
  completionKeySet,
  groupSchoolsByCluster,
  PRETEST_COLUMNS,
} from "-/app/(app)/pretest/pretest-derive";
import type { AssessmentCompletion, PretestCluster, PretestSchool } from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

/**
 * **The `/pretest` grid's pure seam** (#247) — the four columns, the completion keys and the
 * cluster grouping + name filter, driven without a DOM the way `monitoring-derive.test.ts` drives
 * its fold.
 */

const CLUSTERS: PretestCluster[] = [
  { id: "c1", name: "Alpha" },
  { id: "c2", name: "Beta" },
];

const SCHOOLS: PretestSchool[] = [
  { id: "s1", name: "SMA Bandung", clusterId: "c1" },
  { id: "s2", name: "SMA Cimahi", clusterId: "c1" },
  { id: "s3", name: "SMA Depok", clusterId: "c2" },
];

describe("PRETEST_COLUMNS", () => {
  it("are the four boxes in order: STEM·Siswa, STEM·GTK-MS, Research·Siswa, Research·GTK-MS", () => {
    expect(PRETEST_COLUMNS.map((c) => `${c.stream}·${c.participantType}`)).toEqual([
      "STEM·Siswa",
      "STEM·GTK-MS",
      "Research·Siswa",
      "Research·GTK-MS",
    ]);
  });
});

describe("completion keys", () => {
  it("keys a box by school, stream and participant-type — not kind", () => {
    expect(completionKey("s1", "STEM", "Siswa")).toBe("s1|STEM|Siswa");
  });

  it("builds the ticked-key set from completion rows", () => {
    const completions: AssessmentCompletion[] = [
      { schoolId: "s1", stream: "STEM", participantType: "Siswa", kind: "pretest" },
      { schoolId: "s3", stream: "Research", participantType: "GTK-MS", kind: "pretest" },
    ];
    const set = completionKeySet(completions);
    expect(set.has("s1|STEM|Siswa")).toBe(true);
    expect(set.has("s3|Research|GTK-MS")).toBe(true);
    expect(set.has("s2|STEM|Siswa")).toBe(false);
  });
});

describe("groupSchoolsByCluster", () => {
  it("groups every school under its cluster when the search is empty", () => {
    const groups = groupSchoolsByCluster(CLUSTERS, SCHOOLS, "");
    expect(groups.map((g) => [g.name, g.schools.map((s) => s.name)])).toEqual([
      ["Alpha", ["SMA Bandung", "SMA Cimahi"]],
      ["Beta", ["SMA Depok"]],
    ]);
  });

  it("filters schools by name case-insensitively and keeps them under their cluster", () => {
    const groups = groupSchoolsByCluster(CLUSTERS, SCHOOLS, "cimahi");
    expect(groups.map((g) => [g.name, g.schools.map((s) => s.name)])).toEqual([
      ["Alpha", ["SMA Cimahi"]],
    ]);
  });

  it("drops a cluster with no matching school so the grid collapses gracefully", () => {
    const groups = groupSchoolsByCluster(CLUSTERS, SCHOOLS, "depok");
    expect(groups.map((g) => g.name)).toEqual(["Beta"]);
  });

  it("returns nothing when the search matches no school", () => {
    expect(groupSchoolsByCluster(CLUSTERS, SCHOOLS, "surabaya")).toEqual([]);
  });
});
