import { pretestEditorData, setAssessmentCompletion, type Person } from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { addCluster, addProvince, addSchool, resetDatabase } from "./support/fixtures";

/**
 * **The `/pretest` editor's read** (#247) — `pretestEditorData` returns the Clusters, the Schools
 * with their Cluster, and the already-ticked **Pretest** completions, in one round trip and open to
 * any signed-in Person (the page gates rendering, not the read). The write it composes with
 * (`setAssessmentCompletion`) is guarded and covered in `assessment-completion.test.ts`.
 */
function caller(grants: Grant[], id = "00000000-0000-0000-0000-0000000000e1"): Person {
  return { id, fullName: "Orang", email: "orang@ditsama.itb.ac.id", role: "Staff", grants };
}

/** Two Clusters and three Schools, so grouping and ordering are observable. */
async function seedSchools() {
  const province = await addProvince("32", "Jawa Barat");
  const alpha = await addCluster({ slug: "alpha", name: "Alpha" });
  const beta = await addCluster({ slug: "beta", name: "Beta" });
  const bandung = await addSchool({
    slug: "sma-bandung",
    name: "SMA Bandung",
    clusterId: alpha.id,
    provinceCode: province.code,
  });
  const cimahi = await addSchool({
    slug: "sma-cimahi",
    name: "SMA Cimahi",
    clusterId: alpha.id,
    provinceCode: province.code,
  });
  const depok = await addSchool({
    slug: "sma-depok",
    name: "SMA Depok",
    clusterId: beta.id,
    provinceCode: province.code,
  });
  return { alpha, beta, bandung, cimahi, depok };
}

describe("pretestEditorData", () => {
  beforeEach(resetDatabase);

  it("returns clusters and schools name-ordered, with no completions before any tick", async () => {
    const { alpha, beta, bandung, cimahi, depok } = await seedSchools();
    const data = await pretestEditorData(caller([]));

    expect(data.clusters.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
    expect(data.schools.map((s) => [s.name, s.clusterId])).toEqual([
      ["SMA Bandung", alpha.id],
      ["SMA Cimahi", alpha.id],
      ["SMA Depok", beta.id],
    ]);
    // Referenced so the ids are meaningful in the assertion above.
    expect([bandung.id, cimahi.id, depok.id]).toHaveLength(3);
    expect(data.completions).toEqual([]);
  });

  it("returns the ticked pretest completions and excludes posttest rows", async () => {
    const { bandung } = await seedSchools();
    const editor = caller(["Editor"]);

    await setAssessmentCompletion(editor, {
      schoolId: bandung.id,
      stream: "STEM",
      participantType: "Siswa",
      kind: "pretest",
      done: true,
    });
    // A posttest row exists but must not appear in this pretest-only payload.
    await setAssessmentCompletion(editor, {
      schoolId: bandung.id,
      stream: "STEM",
      participantType: "Siswa",
      kind: "posttest",
      done: true,
    });

    const data = await pretestEditorData(caller([]));
    expect(data.completions).toEqual([
      { schoolId: bandung.id, stream: "STEM", participantType: "Siswa", kind: "pretest" },
    ]);
  });

  it("reflects an un-tick by dropping the row from completions", async () => {
    const { bandung } = await seedSchools();
    const editor = caller(["Editor"]);
    const box = {
      schoolId: bandung.id,
      stream: "Research",
      participantType: "GTK-MS",
      kind: "pretest",
    } as const;

    await setAssessmentCompletion(editor, { ...box, done: true });
    expect((await pretestEditorData(caller([]))).completions).toHaveLength(1);

    await setAssessmentCompletion(editor, { ...box, done: false });
    expect((await pretestEditorData(caller([]))).completions).toEqual([]);
  });
});
