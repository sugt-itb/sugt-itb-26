import { asc, eq } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { cluster, school } from "../schema/reference";
import type { Person } from "./caller";
import { deliveredSessionCount, onDeliveredSessions } from "./delivered-sessions";

/**
 * **Direktori Sekolah** — all forty-seven Schools, and the route into Detail Sekolah.
 *
 * Open to anyone signed in, so the signature takes a `Person` and applies no further
 * check: delivery data carries no money, and ADR-0004 opens it to both roles.
 *
 * **The filtering is not here.** The screen filters by name and by Cluster over the
 * payload it already has, which is what keeps this one function and one round trip:
 * forty-seven rows is a fixed and small set, so narrowing it in the browser costs
 * nothing and a filtered query would cost a round trip per keystroke. It is the same
 * reasoning [#9](https://github.com/mafiefa02/sugt/issues/9) settled for Pencarian on
 * the public site.
 *
 * It overlaps Coverage on purpose and they are not the same screen. Coverage groups
 * Schools under their Cluster and exists to start trip planning from a selection; this
 * is the flat index a reader searches, and the only way into one School's Sessions.
 */

/** One row of the directory: which School, where it is, and how much teaching has happened. */
export type DirectorySchool = {
  id: string;
  /**
   * The School's URL. Detail Sekolah is keyed on it rather than on `id`: `slug` is
   * unique, is what the public site already addresses a School by, and reads in a link.
   *
   * This is the directory's own slug for the directory's own link, and not the one
   * Coverage left an opening for — that one was for a link out of Coverage, and there
   * is none.
   */
  slug: string;
  name: string;
  kabupatenKota: string;
  /**
   * The Cluster, both halves. `clusterId` is what the Cluster filter keys on — nothing
   * makes `cluster.name` unique, so filtering on the name is a rule the schema does not
   * hold up.
   */
  clusterId: string;
  clusterName: string;
  /** Delivered Sessions. **Arranged and cancelled count for nothing.** */
  deliveredSessions: number;
};

/**
 * What the Direktori Sekolah screen renders, in one round trip.
 *
 * Ordered by name, then by id. The tie-break is not decoration: nothing makes
 * `school.name` unique, and two Schools sharing one would otherwise come back in
 * whatever order the plan happened to produce.
 */
export async function schoolDirectory(_caller: Person): Promise<DirectorySchool[]> {
  return (
    db
      .select({
        id: school.id,
        slug: school.slug,
        name: school.name,
        kabupatenKota: school.kabupatenKota,
        clusterId: cluster.id,
        clusterName: cluster.name,
        deliveredSessions: deliveredSessionCount,
      })
      .from(school)
      // Inner, never outer: `school.cluster_id` is NOT NULL, so "a School with no
      // Cluster" is not a state this screen ever has to render.
      .innerJoin(cluster, eq(cluster.id, school.clusterId))
      .leftJoin(session, onDeliveredSessions)
      .groupBy(school.id, cluster.id)
      .orderBy(asc(school.name), asc(school.id))
  );
}
