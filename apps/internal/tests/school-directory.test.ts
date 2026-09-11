import { schoolDirectory } from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { addCluster, addProvince, addSchool, addSession, resetDatabase } from "./support/fixtures";
import { signInAsPerson } from "./support/sign-in";

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
 * **Direktori Sekolah** — every School, filterable, and the route into Detail Sekolah.
 *
 * The filtering itself is not asserted here and deliberately: the payload carries all
 * forty-two and the browser narrows them, so there is no server-side filter to test.
 * What these assertions cover is the payload a filter would run over.
 *
 * The `Person` is a real one, produced the only way the app produces one — see
 * `./support/sign-in.ts`.
 */
describe("the Direktori Sekolah payload", () => {
  beforeEach(resetDatabase);

  /** A Staff Person, signed in for real. Online Sessions need one as their PIC. */
  const signInAsStaff = () => signInAsPerson("Staff", "rina@ditsama.itb.ac.id", "Rina Nurhayati");

  /**
   * Three Schools across two Clusters, one of them carrying a Session of every status.
   *
   * Deliberately not the real forty-two. "All 42" is a property of the seeded database
   * and not of a fixture, and a test whose numbers come from a seed file nobody edits
   * for it is a test whose failures are unreadable.
   */
  async function seedThreeSchools(picPersonId: string) {
    await addProvince("JB", "Jawa Barat");

    const alpha = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const beta = await addCluster({ slug: "beta", name: "Cluster Beta" });

    const busy = await addSchool({
      slug: "sman-1-bandung",
      name: "SMAN 1 Bandung",
      clusterId: alpha.id,
      provinceCode: "JB",
    });
    const untouched = await addSchool({
      slug: "sman-2-bandung",
      name: "SMAN 2 Bandung",
      clusterId: alpha.id,
      provinceCode: "JB",
    });
    const other = await addSchool({
      slug: "sman-3-bogor",
      name: "SMAN 3 Bogor",
      clusterId: beta.id,
      provinceCode: "JB",
      kabupatenKota: "Kota Bogor",
    });

    // Two delivered, plus one of each status that must count for nothing. Every date
    // differs: two online Sessions at one School on one day is a state the schema is
    // meant to refuse, so no fixture should sit on that line.
    for (const [heldOn, status] of [
      ["2026-09-01", "delivered"],
      ["2026-09-08", "delivered"],
      ["2026-09-15", "arranged"],
      ["2026-09-22", "cancelled"],
    ] as const) {
      await addSession({ schoolId: busy.id, heldOn, status, onlinePicPersonId: picPersonId });
    }
    await addSession({
      schoolId: other.id,
      heldOn: "2026-09-02",
      status: "delivered",
      onlinePicPersonId: picPersonId,
    });

    return { alpha, beta, busy, untouched, other };
  }

  it("lists every School with where it is and which Cluster it belongs to", async () => {
    const person = await signInAsStaff();
    const { alpha } = await seedThreeSchools(person.id);

    const schools = await schoolDirectory(person);

    expect(schools.map((school) => school.name)).toEqual([
      "SMAN 1 Bandung",
      "SMAN 2 Bandung",
      "SMAN 3 Bogor",
    ]);
    expect(schools[0]).toMatchObject({
      slug: "sman-1-bandung",
      name: "SMAN 1 Bandung",
      kabupatenKota: "Kota Bandung",
      clusterId: alpha.id,
      clusterName: "Cluster Alpha",
    });
  });

  it("counts delivered Sessions only — arranged and cancelled count for nothing", async () => {
    const person = await signInAsStaff();
    await seedThreeSchools(person.id);

    const schools = await schoolDirectory(person);
    const counts = schools.map((school) => [school.name, school.deliveredSessions] as const);

    expect(Object.fromEntries(counts)).toEqual({
      // Four Sessions: two delivered, one arranged, one cancelled.
      "SMAN 1 Bandung": 2,
      "SMAN 2 Bandung": 0,
      "SMAN 3 Bogor": 1,
    });
  });

  it("lists a School nobody has reached yet, at zero", async () => {
    /**
     * The School with no Sessions at all is one a reader of this screen looks for, so
     * it must not be filtered out. It would be, were the delivered predicate in a
     * WHERE rather than in the JOIN.
     */
    const person = await signInAsStaff();
    const { untouched } = await seedThreeSchools(person.id);

    const schools = await schoolDirectory(person);

    expect(schools.find((school) => school.id === untouched.id)).toMatchObject({
      name: "SMAN 2 Bandung",
      deliveredSessions: 0,
    });
  });

  it("is open to a non-Staff caller, who reads the same payload", async () => {
    /**
     * ADR-0004: delivery data is open to everyone signed in. Nothing here carries
     * money, so the only thing narrowing it is the `Person` arm of the `Caller` union
     * — not a role check. `schoolDirectory` takes an ignored `_caller`, so a hand-built
     * non-Staff caller stands in for the retired Teaching Team member.
     */
    const staff = await signInAsStaff();
    await seedThreeSchools(staff.id);

    await expect(schoolDirectory(nonStaff())).resolves.toEqual(await schoolDirectory(staff));
  });
});
