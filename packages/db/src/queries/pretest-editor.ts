import { asc } from "drizzle-orm";

import { db } from "../client";
import { cluster, school } from "../schema/reference";
import { assessmentCompletions, type AssessmentCompletion } from "./assessment-completion";
import type { Person } from "./caller";

/**
 * **The `/pretest` editor's payload** (ticket #247). The one round trip behind the grant-gated
 * Pretest completion grid: the four Clusters, all forty-two Schools with their Cluster, and the
 * Pretest completions that are already ticked.
 *
 * **Reading is open** to any signed-in Person, like `/monitoring` — the page gates *rendering* on
 * the Monitoring Editor Grant as a courtesy, but the read itself carries no guard (the write does,
 * via `setAssessmentCompletion`). It reuses the tested `assessmentCompletions` read and keeps only
 * the `pretest` rows: this screen never surfaces `posttest`, so the payload it hands the client is
 * pretest-only and the box grid cannot accidentally reflect a posttest row.
 *
 * The `scope` aggregate returns the same Cluster+School shape, but it takes a `ServiceCaller` (the
 * public wire contract) — an internal page holding a `Person` needs its own read, so this is it,
 * ordered the way the grid renders: Clusters by name, Schools by name within each.
 */
export type PretestCluster = { id: string; name: string };
export type PretestSchool = { id: string; name: string; clusterId: string };

export type PretestEditorData = {
  clusters: PretestCluster[];
  schools: PretestSchool[];
  /** The already-ticked Pretest boxes, as bare tuples. `kind` is always `pretest` here. */
  completions: AssessmentCompletion[];
};

export async function pretestEditorData(caller: Person): Promise<PretestEditorData> {
  const clusters = await db
    .select({ id: cluster.id, name: cluster.name })
    .from(cluster)
    .orderBy(asc(cluster.name), asc(cluster.id));

  const schools = await db
    .select({ id: school.id, name: school.name, clusterId: school.clusterId })
    .from(school)
    .orderBy(asc(school.name), asc(school.id));

  const completions = (await assessmentCompletions(caller)).filter((c) => c.kind === "pretest");

  return { clusters, schools, completions };
}
