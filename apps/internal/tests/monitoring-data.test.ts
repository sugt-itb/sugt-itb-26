import { monitoringData } from "@sugt/db/queries";
import type { Person } from "@sugt/db/queries";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * **`monitoringData`'s `perjadinSpans`** (#214): the date spans the Calendar draws its offline and
 * Monev markers from. The read carries **every** Perjadin (no cancel concept exists on a trip), each
 * with its Cluster (via `sub_cluster.cluster_id`), its inclusive `starts_on`/`ends_on`, and a
 * `hasPimpinan` boolean that is true iff any Pimpinan is recorded on the trip.
 */

/** A `Person` the query layer accepts; `monitoringData` asks nothing of the caller's role. */
function asPerson(row: { id: string; fullName: string; email: string }): Person {
  return { id: row.id, fullName: row.fullName, email: row.email, role: "Staff", grants: [] };
}

describe("monitoringData returns perjadinSpans", () => {
  beforeEach(resetDatabase);

  it("carries every perjadin with its Cluster, inclusive dates, and hasPimpinan", async () => {
    await addProvince("JB", "Jawa Barat", "WIB");
    const staff = await addPerson({
      fullName: "Rina",
      email: "rina@ditsama.itb.ac.id",
      role: "Staff",
    });
    const pimpinan = await addPerson({
      fullName: "Pak Dir",
      email: "dir@ditsama.itb.ac.id",
      role: "Pimpinan",
    });

    const clusterA = await addCluster({ slug: "cluster-a", name: "Klaster A" });
    const clusterB = await addCluster({ slug: "cluster-b", name: "Klaster B" });
    const subA = await addSubCluster({ slug: "sub-a", name: "Kelompok A", clusterId: clusterA.id });
    const subB = await addSubCluster({ slug: "sub-b", name: "Kelompok B", clusterId: clusterB.id });

    // A trip in Cluster A with a Pimpinan recorded — hasPimpinan true.
    const tripA = await addPerjadin({
      subClusterId: subA.id,
      picPersonId: staff.id,
      startsOn: "2026-10-10",
      endsOn: "2026-10-12",
      advanceIdr: 1_000_000,
      destination: "Kelompok A: Jakarta Selatan",
      pimpinan: [pimpinan.id],
    });
    // A trip in Cluster B with no Pimpinan — hasPimpinan false.
    const tripB = await addPerjadin({
      subClusterId: subB.id,
      picPersonId: staff.id,
      startsOn: "2026-11-01",
      endsOn: "2026-11-01",
      advanceIdr: 500_000,
      destination: "Kelompok B: Bandung",
    });

    const { perjadinSpans } = await monitoringData(asPerson(staff));

    expect(perjadinSpans).toHaveLength(2);
    const a = perjadinSpans.find((s) => s.clusterId === clusterA.id);
    const b = perjadinSpans.find((s) => s.clusterId === clusterB.id);
    expect(a).toEqual({
      id: tripA.id,
      clusterId: clusterA.id,
      destination: "Kelompok A: Jakarta Selatan",
      startsOn: "2026-10-10",
      endsOn: "2026-10-12",
      hasPimpinan: true,
    });
    expect(b).toEqual({
      id: tripB.id,
      clusterId: clusterB.id,
      destination: "Kelompok B: Bandung",
      startsOn: "2026-11-01",
      endsOn: "2026-11-01",
      hasPimpinan: false,
    });
  });

  it("is empty when there are no perjadin", async () => {
    const staff = await addPerson({
      fullName: "Rina",
      email: "rina@ditsama.itb.ac.id",
      role: "Staff",
    });
    const { perjadinSpans } = await monitoringData(asPerson(staff));
    expect(perjadinSpans).toEqual([]);
  });
});

describe("monitoringData carries the School name on each Session", () => {
  beforeEach(resetDatabase);

  it("returns school.name so the Calendar can name a `Sesi Daring {name}` event", async () => {
    await addProvince("JB", "Jawa Barat", "WIB");
    const staff = await addPerson({
      fullName: "Rina",
      email: "rina@ditsama.itb.ac.id",
      role: "Staff",
    });
    const clusterA = await addCluster({ slug: "cluster-a", name: "Klaster A" });
    const school = await addSchool({
      slug: "sdn-merdeka",
      name: "SDN Merdeka",
      clusterId: clusterA.id,
      provinceCode: "JB",
    });
    await addSession({
      schoolId: school.id,
      heldOn: "2026-10-15",
      onlinePicPersonId: staff.id,
    });

    const { sessions } = await monitoringData(asPerson(staff));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.name).toBe("SDN Merdeka");
    expect(sessions[0]?.schoolId).toBe(school.id);
  });
});
