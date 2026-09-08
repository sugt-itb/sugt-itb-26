import { db, schema } from "@sugt/db";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  addSubCluster,
  refusedBy,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Pimpinan is record-only, and the database is what makes it so** (#179).
 *
 * The role widened `person_role_check` and nothing else: every composite `(id, role)` foreign key
 * elsewhere in the schema still pins `role = 'Staff'`, so a Pimpinan can be *invited* but can never
 * occupy a working position — Group member, Perjadin PIC, Session-Record filer or Story author. This
 * suite runs against real Postgres, so those constraints actually fire: it proves the widened CHECK
 * admits a Pimpinan, then that the untouched composite keys refuse one wherever a role is denormalised.
 *
 * All four working positions the ticket names are asserted below — `group_member`, `perjadin.pic`,
 * `session_record` (`filed_by_role`) and `story` (`written_by_role`). Each is pinned to `'Staff'` by
 * the *same* composite `(person_id, role) → person(id, role)` foreign key, so each refuses a Pimpinan
 * for one reason: no `(pimpinan.id, 'Staff')` pair exists in `person`. Every other constraint on each
 * insert is satisfied first (a real Session, a real School, non-blank prose where a CHECK needs it),
 * so the composite FK is the only thing left to refuse — which is what the asserted constraint name
 * proves.
 */
describe("Pimpinan is record-only", () => {
  beforeEach(resetDatabase);

  it("admits a Pimpinan into person — the widened person_role_check permits the role", async () => {
    const pimpinan = await addPerson({
      fullName: "Prof. Pimpinan",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });

    expect(pimpinan.role).toBe("Pimpinan");
  });

  it("refuses a Pimpinan as a group_member — the composite (id, role) FK pins Staff", async () => {
    const pic = await addPerson({
      fullName: "Rina Nurhayati",
      email: "rina@ditsama.itb.ac.id",
      role: "Staff",
    });
    const pimpinan = await addPerson({
      fullName: "Prof. Pimpinan",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    const perjadin = await addPerjadin({ advanceIdr: 5_000_000, picPersonId: pic.id });

    // role: "Staff" satisfies group_member_role_check, so the refusal is the composite foreign key
    // itself — no `(pimpinan.id, 'Staff')` pair exists in `person`, because that Person is Pimpinan.
    const refusal = await refusedBy(
      db.insert(schema.groupMember).values({
        perjadinId: perjadin.id,
        personId: pimpinan.id,
        role: "Staff",
        stream: null,
      }),
    );

    expect(refusal).toBe("group_member_person_role_fk");
  });

  it("refuses a Pimpinan as a Perjadin PIC — perjadin_pic_is_staff pins Staff", async () => {
    const pimpinan = await addPerson({
      fullName: "Prof. Pimpinan",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const subCluster = await addSubCluster({
      slug: "kelompok-alpha",
      name: "Kelompok Alpha",
      clusterId: cluster.id,
    });

    // `pic_role` defaults to 'Staff', so the composite FK `perjadin_pic_is_staff` asks for a
    // `(pimpinan.id, 'Staff')` pair that does not exist and refuses the trip.
    const refusal = await refusedBy(
      db.insert(schema.perjadin).values({
        subClusterId: subCluster.id,
        destination: "Bandung",
        startsOn: "2026-09-01",
        endsOn: "2026-09-03",
        advanceIdr: 5_000_000,
        picPersonId: pimpinan.id,
      }),
    );

    expect(refusal).toBe("perjadin_pic_is_staff");
  });

  it("refuses a Pimpinan as a Session-Record filer — session_record_filed_by_staff pins Staff", async () => {
    const pic = await addPerson({
      fullName: "Rina Nurhayati",
      email: "rina@ditsama.itb.ac.id",
      role: "Staff",
    });
    const pimpinan = await addPerson({
      fullName: "Prof. Pimpinan",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    await addProvince("JB", "Jawa Barat");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const school = await addSchool({
      slug: "sman-8",
      name: "SMAN 8",
      clusterId: cluster.id,
      provinceCode: "JB",
    });
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-01",
      onlinePicPersonId: pic.id,
    });

    // The five ratings are in-bounds and `filed_by_role` is 'Staff', so the role CHECK, the rating
    // bounds and the low-rating-needs-prose CHECK all pass — the composite (filed_by_person_id,
    // 'Staff') FK is the only unsatisfiable constraint, because that filer is a Pimpinan.
    const refusal = await refusedBy(
      db.insert(schema.sessionRecord).values({
        sessionId: session.id,
        filedByPersonId: pimpinan.id,
        filedByRole: "Staff",
        facilities: 9,
        turnout: 9,
        schoolSupport: 9,
        timing: 9,
        coordination: 9,
      }),
    );

    expect(refusal).toBe("session_record_filed_by_staff");
  });

  it("refuses a Pimpinan as a Story author — story_written_by_staff pins Staff", async () => {
    const pimpinan = await addPerson({
      fullName: "Prof. Pimpinan",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    await addProvince("JB", "Jawa Barat");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const school = await addSchool({
      slug: "sman-8",
      name: "SMAN 8",
      clusterId: cluster.id,
      provinceCode: "JB",
    });

    // `written_by_role` defaults 'Staff', so the composite (written_by_person_id, 'Staff') FK is the
    // only unsatisfiable constraint — a Pimpinan has no (id, 'Staff') pair in `person`.
    const refusal = await refusedBy(
      db.insert(schema.story).values({
        slug: "cerita-alpha",
        schoolId: school.id,
        title: "Cerita",
        body: "Isi cerita.",
        writtenByPersonId: pimpinan.id,
        writtenByRole: "Staff",
      }),
    );

    expect(refusal).toBe("story_written_by_staff");
  });
});
