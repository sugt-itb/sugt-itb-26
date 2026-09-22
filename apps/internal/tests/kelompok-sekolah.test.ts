import { db, schema } from "@sugt/db";
import {
  createSubCluster,
  deleteSubCluster,
  isNotStaffError,
  moveSchool,
  renameSubCluster,
  subClusterBoard,
} from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson as seedPerson,
  addProvince,
  addSchool,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the Staff-only choke point still has to
 * reject a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the
 * row. The cast through `unknown` is the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Budi Santoso",
    email: "budi@gmail.com",
    role: "Teaching Team" as unknown as Role,
    grants: [],
  };
}

/**
 * **Kelompok Sekolah** — the Sub-Cluster editing screen, and the two refusals ADR-0016 says are
 * the point of it: a Sub-Cluster that still holds Schools cannot be deleted (the database's own
 * `NO ACTION`, caught and named), and a School cannot be moved out from under an **arranged**
 * trip still going to visit it (the rule no key can hold). Delivered and cancelled Sessions
 * never block a move — the case that must *not* refuse.
 */

async function staffCaller() {
  return seedPerson({ fullName: "Rina Nurhayati", email: "rina@ditsama.itb.ac.id", role: "Staff" });
}

/** A Cluster with a Province behind it, ready for Sub-Clusters and Schools. */
async function oneCluster(slug = "alpha") {
  await addProvince("JB", "Jawa Barat");
  return addCluster({ slug, name: `Cluster ${slug}` });
}

describe("createSubCluster", () => {
  beforeEach(resetDatabase);

  it("creates a Sub-Cluster with a slug inside a Cluster", async () => {
    const staff = await staffCaller();
    const cluster = await oneCluster();

    const result = await createSubCluster(staff, { clusterId: cluster.id, name: "Bandung Raya" });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    const [row] = await db
      .select()
      .from(schema.subCluster)
      .where(eq(schema.subCluster.id, result.subClusterId));
    expect(row).toMatchObject({
      name: "Bandung Raya",
      slug: "bandung-raya",
      clusterId: cluster.id,
    });
  });

  it("gives a colliding name a distinct slug", async () => {
    const staff = await staffCaller();
    const cluster = await oneCluster();
    await addSubCluster({ slug: "bandung-raya", name: "Bandung Raya", clusterId: cluster.id });

    const result = await createSubCluster(staff, { clusterId: cluster.id, name: "Bandung Raya" });

    if (result.outcome !== "created") throw new Error("unreachable");
    const [row] = await db
      .select({ slug: schema.subCluster.slug })
      .from(schema.subCluster)
      .where(eq(schema.subCluster.id, result.subClusterId));
    expect(row?.slug).toBe("bandung-raya-2");
  });

  it("refuses a blank name", async () => {
    const staff = await staffCaller();
    const cluster = await oneCluster();

    expect(await createSubCluster(staff, { clusterId: cluster.id, name: "   " })).toEqual({
      outcome: "incomplete",
    });
  });

  it("refuses an unknown Cluster", async () => {
    const staff = await staffCaller();

    expect(
      await createSubCluster(staff, {
        clusterId: "00000000-0000-0000-0000-000000000000",
        name: "Bandung Raya",
      }),
    ).toEqual({ outcome: "no-such-cluster" });
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const teacher = nonStaff();
    const cluster = await oneCluster();

    const refusal = await createSubCluster(teacher, {
      clusterId: cluster.id,
      name: "Bandung Raya",
    }).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });
});

describe("renameSubCluster", () => {
  beforeEach(resetDatabase);

  it("renames a Sub-Cluster but leaves its slug where it is", async () => {
    const staff = await staffCaller();
    const cluster = await oneCluster();
    const sub = await addSubCluster({
      slug: "bandung-raya",
      name: "Bandung Raya",
      clusterId: cluster.id,
    });

    expect(await renameSubCluster(staff, sub.id, "Bandung Timur")).toEqual({ outcome: "renamed" });
    const [row] = await db
      .select({ name: schema.subCluster.name, slug: schema.subCluster.slug })
      .from(schema.subCluster)
      .where(eq(schema.subCluster.id, sub.id));
    expect(row).toEqual({ name: "Bandung Timur", slug: "bandung-raya" });
  });

  it("refuses a blank name", async () => {
    const staff = await staffCaller();
    const cluster = await oneCluster();
    const sub = await addSubCluster({
      slug: "bandung-raya",
      name: "Bandung Raya",
      clusterId: cluster.id,
    });

    expect(await renameSubCluster(staff, sub.id, "  ")).toEqual({ outcome: "incomplete" });
  });

  it("reports no-such-sub-cluster for an unknown id", async () => {
    const staff = await staffCaller();

    expect(await renameSubCluster(staff, "00000000-0000-0000-0000-000000000000", "Baru")).toEqual({
      outcome: "no-such-sub-cluster",
    });
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const teacher = nonStaff();
    const cluster = await oneCluster();
    const sub = await addSubCluster({
      slug: "bandung-raya",
      name: "Bandung Raya",
      clusterId: cluster.id,
    });

    const refusal = await renameSubCluster(teacher, sub.id, "Baru").catch(
      (error: unknown) => error,
    );

    expect(isNotStaffError(refusal)).toBe(true);
  });
});

describe("deleteSubCluster", () => {
  beforeEach(resetDatabase);

  it("deletes an empty Sub-Cluster", async () => {
    const staff = await staffCaller();
    const cluster = await oneCluster();
    const sub = await addSubCluster({ slug: "kosong", name: "Kosong", clusterId: cluster.id });

    expect(await deleteSubCluster(staff, sub.id)).toEqual({ outcome: "deleted" });
    const rows = await db.select().from(schema.subCluster).where(eq(schema.subCluster.id, sub.id));
    expect(rows).toHaveLength(0);
  });

  it("refuses to delete a Sub-Cluster that still holds Schools", async () => {
    const staff = await staffCaller();
    const cluster = await oneCluster();
    const sub = await addSubCluster({ slug: "isi", name: "Isi", clusterId: cluster.id });
    await addSchool({
      slug: "sman-8",
      name: "SMAN 8",
      clusterId: cluster.id,
      provinceCode: "JB",
      subClusterId: sub.id,
    });

    expect(await deleteSubCluster(staff, sub.id)).toEqual({ outcome: "has-schools" });
    // Nothing was deleted — the refusal is the database's, caught rather than duplicated.
    const rows = await db.select().from(schema.subCluster).where(eq(schema.subCluster.id, sub.id));
    expect(rows).toHaveLength(1);
  });

  it("reports no-such-sub-cluster for an unknown id", async () => {
    const staff = await staffCaller();

    expect(await deleteSubCluster(staff, "00000000-0000-0000-0000-000000000000")).toEqual({
      outcome: "no-such-sub-cluster",
    });
  });

  it("refuses, as planned-against, a Sub-Cluster a Perjadin was planned against even with no Schools", async () => {
    // A Perjadin references `sub_cluster` too, with the same `NO ACTION`. An empty Sub-Cluster a
    // trip has visited must not be mislabelled "still holds Schools" — it is history, not a
    // School to move out. Reachable: move every School out once its Sessions are delivered.
    const staff = await staffCaller();
    const cluster = await oneCluster();
    const sub = await addSubCluster({
      slug: "dikunjungi",
      name: "Dikunjungi",
      clusterId: cluster.id,
    });
    await addPerjadin({ advanceIdr: 5_000_000, picPersonId: staff.id, subClusterId: sub.id });

    expect(await deleteSubCluster(staff, sub.id)).toEqual({ outcome: "planned-against" });
    const rows = await db.select().from(schema.subCluster).where(eq(schema.subCluster.id, sub.id));
    expect(rows).toHaveLength(1);
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const teacher = nonStaff();
    const cluster = await oneCluster();
    const sub = await addSubCluster({ slug: "kosong", name: "Kosong", clusterId: cluster.id });

    const refusal = await deleteSubCluster(teacher, sub.id).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });
});

describe("moveSchool", () => {
  beforeEach(resetDatabase);

  /** A Cluster with two Sub-Clusters and a School in the first. */
  async function twoSubClusters() {
    const cluster = await oneCluster();
    const from = await addSubCluster({
      slug: "from",
      name: "Kelompok Asal",
      clusterId: cluster.id,
    });
    const to = await addSubCluster({ slug: "to", name: "Kelompok Tujuan", clusterId: cluster.id });
    const school = await addSchool({
      slug: "sman-8",
      name: "SMAN 8",
      clusterId: cluster.id,
      provinceCode: "JB",
      subClusterId: from.id,
    });
    return { cluster, from, to, school };
  }

  it("moves a School into another Sub-Cluster in the same Cluster", async () => {
    const staff = await staffCaller();
    const { to, school } = await twoSubClusters();

    expect(await moveSchool(staff, school.id, to.id)).toEqual({ outcome: "moved" });
    const [row] = await db
      .select({ subClusterId: schema.school.subClusterId })
      .from(schema.school)
      .where(eq(schema.school.id, school.id));
    expect(row?.subClusterId).toBe(to.id);
  });

  it("refuses the move while an arranged Session sits on a trip against the old Sub-Cluster", async () => {
    const staff = await staffCaller();
    const { from, to, school } = await twoSubClusters();
    // A trip planned against the Sub-Cluster the School is leaving, with an arranged Session there.
    const perjadin = await addPerjadin({
      advanceIdr: 5_000_000,
      picPersonId: staff.id,
      subClusterId: from.id,
      destination: "Kunjungan Bandung",
    });
    await addOfflineSession({ schoolId: school.id, heldOn: "2026-09-02", perjadinId: perjadin.id });

    const result = await moveSchool(staff, school.id, to.id);

    expect(result.outcome).toBe("still-visited");
    if (result.outcome !== "still-visited") throw new Error("unreachable");
    expect(result.perjadins).toEqual([
      {
        id: perjadin.id,
        destination: "Kunjungan Bandung",
        startsOn: "2026-09-01",
        endsOn: "2026-09-03",
      },
    ]);
    // The School did not move.
    const [row] = await db
      .select({ subClusterId: schema.school.subClusterId })
      .from(schema.school)
      .where(eq(schema.school.id, school.id));
    expect(row?.subClusterId).toBe(from.id);
  });

  it("allows the move when the only Sessions on the old Sub-Cluster are delivered or cancelled", async () => {
    const staff = await staffCaller();
    const { from, to, school } = await twoSubClusters();
    const perjadin = await addPerjadin({
      advanceIdr: 5_000_000,
      picPersonId: staff.id,
      subClusterId: from.id,
      destination: "Kunjungan selesai",
    });
    await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      status: "delivered",
      perjadinId: perjadin.id,
    });
    await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      startsAt: "13:00",
      status: "cancelled",
      perjadinId: perjadin.id,
    });

    expect(await moveSchool(staff, school.id, to.id)).toEqual({ outcome: "moved" });
    const [row] = await db
      .select({ subClusterId: schema.school.subClusterId })
      .from(schema.school)
      .where(eq(schema.school.id, school.id));
    expect(row?.subClusterId).toBe(to.id);
  });

  it("refuses a target Sub-Cluster in a different Cluster", async () => {
    const staff = await staffCaller();
    const { school } = await twoSubClusters();
    const other = await addCluster({ slug: "beta", name: "Cluster beta" });
    const elsewhere = await addSubCluster({ slug: "elsewhere", name: "Lain", clusterId: other.id });

    expect(await moveSchool(staff, school.id, elsewhere.id)).toEqual({
      outcome: "different-cluster",
    });
  });

  it("reports no-such-school and no-such-target", async () => {
    const staff = await staffCaller();
    const { to, school } = await twoSubClusters();

    expect(await moveSchool(staff, "00000000-0000-0000-0000-000000000000", to.id)).toEqual({
      outcome: "no-such-school",
    });
    expect(await moveSchool(staff, school.id, "00000000-0000-0000-0000-000000000000")).toEqual({
      outcome: "no-such-target",
    });
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const teacher = nonStaff();
    const { to, school } = await twoSubClusters();

    const refusal = await moveSchool(teacher, school.id, to.id).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });
});

describe("subClusterBoard", () => {
  beforeEach(resetDatabase);

  it("groups Sub-Clusters under their Cluster, each with its Schools", async () => {
    const staff = await staffCaller();
    const cluster = await oneCluster();
    const filled = await addSubCluster({
      slug: "isi",
      name: "Kelompok Isi",
      clusterId: cluster.id,
    });
    await addSubCluster({ slug: "kosong", name: "Kelompok Kosong", clusterId: cluster.id });
    await addSchool({
      slug: "sman-8",
      name: "SMAN 8",
      clusterId: cluster.id,
      provinceCode: "JB",
      subClusterId: filled.id,
    });
    // A second Cluster with no Sub-Clusters at all still appears, to be filled.
    await addCluster({ slug: "beta", name: "Cluster beta" });

    const tree = await subClusterBoard(staff);

    const alpha = tree.find((entry) => entry.id === cluster.id);
    expect(alpha?.subClusters).toHaveLength(2);
    const isi = alpha?.subClusters.find((entry) => entry.id === filled.id);
    expect(isi?.schools).toEqual([{ id: expect.any(String), name: "SMAN 8" }]);
    const kosong = alpha?.subClusters.find((entry) => entry.name === "Kelompok Kosong");
    expect(kosong?.schools).toEqual([]);
    const beta = tree.find((entry) => entry.name === "Cluster beta");
    expect(beta?.subClusters).toEqual([]);
  });
});
