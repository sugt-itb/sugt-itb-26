import { perjadinFolderName, perjadinName } from "-/lib/perjadin-name";
import { db, schema } from "@sugt/db";
import {
  cancelSession,
  isNotStaffError,
  myPerjadin,
  perjadinAcquittal,
  perjadinDetail,
  perjadinDirectory,
  perjadinDriveFolder,
  perjadinPlan,
  planPerjadin,
  updatePerjadinDates,
  type PlanPerjadinInput,
} from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  withGrant,
  constraintOf,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Rencanakan Perjadin**, and the Perjadin list and detail.
 *
 * The write is the substance. Creating a Perjadin brings its Staff-only Group, its trip-scoped
 * Teaching Team names, its Pimpinan and its Sessions into existence together (ADR-0019, ADR-0020).
 * Several of the rules that govern it are structural in ways a test through the form would never
 * reach: the PIC is on their own Group by a DEFERRABLE foreign key, the caps are checked against the
 * whole payload because no CHECK sees sibling rows, every Session's date has to land inside the trip,
 * and each offline Session records who taught it through `session_teaching_team` links into
 * `perjadin_teacher`. Each block below drives the write function against a real Postgres.
 */

async function staff(fullName = "Rina Nurhayati", email = "rina@ditsama.itb.ac.id") {
  // An Editor, since planning needs the Grant (ADR-0047).
  return withGrant(await addPerson({ fullName, email, role: "Staff" }), "Perjadin Editor");
}

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the Staff-only choke point still has to
 * reject a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the
 * row. The cast through `unknown` is the only way to name a role the type no longer admits. The
 * open surfaces (directory, detail) also take it, to prove they are open to a non-Staff caller.
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
 * Two Schools in one Sub-Cluster, so a trip can carry more than one and the per-School Sessions
 * are visible. A Perjadin goes to exactly one Sub-Cluster and the form picks it, so both Schools
 * belong to the one returned here.
 */
async function twoSchools(kabupatenKota: [string, string] = ["Kota Bandung", "Kota Cimahi"]) {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "alpha-bandung",
    name: "Kelompok Sekolah Bandung",
    clusterId: cluster.id,
  });
  const schools = await Promise.all([
    addSchool({
      slug: "sman-1",
      name: "SMAN 1 Bandung",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "JB",
      kabupatenKota: kabupatenKota[0],
    }),
    addSchool({
      slug: "sman-2",
      name: "SMAN 2 Bandung",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "JB",
      kabupatenKota: kabupatenKota[1],
    }),
  ]);
  return { cluster, subCluster, schools };
}

/**
 * The typed range a valid plan carries (ADR-0041): `starts_on = 2026-09-01`, `ends_on =
 * 2026-09-03`, so every in-window Session below sits between these two dates.
 */
const STARTS_ON = "2026-09-01";
const ENDS_ON = "2026-09-03";

/** Everything a valid trip needs, so each test below can spoil exactly one thing. */
async function validPlan(kabupatenKota?: [string, string]) {
  const pic = await staff();
  const { cluster, subCluster, schools } = await twoSchools(kabupatenKota);

  const input: PlanPerjadinInput = {
    subClusterId: subCluster.id,
    picPersonId: pic.id,
    teacherNames: [],
    pimpinan: [],
    sessions: [
      {
        schoolId: schools[0].id,
        heldOn: "2026-09-01",
        startsAt: "09:00",
        taughtByTeacherIndexes: [],
      },
      {
        schoolId: schools[1].id,
        heldOn: "2026-09-03",
        startsAt: "09:00",
        taughtByTeacherIndexes: [],
      },
    ],
    startsOn: STARTS_ON,
    endsOn: ENDS_ON,
  };

  return { pic, cluster, subCluster, schools, input };
}

/** Every Perjadin row, so "nothing was written" can be asserted rather than assumed. */
async function perjadinRows() {
  return db.select({ id: schema.perjadin.id }).from(schema.perjadin);
}

async function groupOf(perjadinId: string) {
  return db
    .select({
      personId: schema.groupMember.personId,
      role: schema.groupMember.role,
      stream: schema.groupMember.stream,
    })
    .from(schema.groupMember)
    .where(eq(schema.groupMember.perjadinId, perjadinId));
}

async function sessionsOf(perjadinId: string) {
  return db
    .select({
      id: schema.session.id,
      schoolId: schema.session.schoolId,
      heldOn: schema.session.heldOn,
      startsAt: schema.session.startsAt,
      mode: schema.session.mode,
      status: schema.session.status,
    })
    .from(schema.session)
    .where(eq(schema.session.perjadinId, perjadinId));
}

async function teachersOf(perjadinId: string) {
  return db
    .select({ id: schema.perjadinTeacher.id, name: schema.perjadinTeacher.name })
    .from(schema.perjadinTeacher)
    .where(eq(schema.perjadinTeacher.perjadinId, perjadinId));
}

async function pimpinanOf(perjadinId: string) {
  return db
    .select({ name: schema.person.fullName })
    .from(schema.perjadinPimpinan)
    .innerJoin(schema.person, eq(schema.person.id, schema.perjadinPimpinan.personId))
    .where(eq(schema.perjadinPimpinan.perjadinId, perjadinId));
}

/** The teacher names linked to one Session, joined through `session_teaching_team`. */
async function taughtBy(sessionId: string) {
  const rows = await db
    .select({ name: schema.perjadinTeacher.name })
    .from(schema.sessionTeachingTeam)
    .innerJoin(
      schema.perjadinTeacher,
      eq(schema.perjadinTeacher.id, schema.sessionTeachingTeam.perjadinTeacherId),
    )
    .where(eq(schema.sessionTeachingTeam.sessionId, sessionId));
  return rows.map((row) => row.name).sort();
}

describe("Rencanakan Perjadin", () => {
  beforeEach(resetDatabase);

  /**
   * The core criterion: the trip, its Staff-only Group and its Sessions come into existence
   * together. The Group is now the PIC alone — the Teaching Team have left `group_member` for
   * trip-scoped names (ADR-0020). No offline Session carries a Stream any more (ADR-0038).
   */
  it("writes the Perjadin, a Staff-only Group and a Session per School in one transaction", async () => {
    const { pic, schools, input } = await validPlan();

    const result = await planPerjadin(pic, input);

    expect(result.outcome).toBe("planned");
    if (result.outcome !== "planned") return;

    const group = await groupOf(result.perjadinId);
    // Only the PIC — Staff, no Stream. No Teaching Team rows any more.
    expect(group).toEqual([{ personId: pic.id, role: "Staff", stream: null }]);

    const sessions = await sessionsOf(result.perjadinId);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((row) => row.schoolId).sort()).toEqual(
      schools.map((school) => school.id).sort(),
    );
    // Offline by construction, and already arranged.
    expect(sessions.every((row) => row.mode === "offline")).toBe(true);
    expect(sessions.every((row) => row.status === "arranged")).toBe(true);
  });

  /**
   * The acceptance scenario for an **empty Teaching Team**: a Group's minimum at planning is just
   * the PIC (ADR-0020), so a trip plans with no teacher names and no links at all.
   */
  it("plans with an empty Teaching Team — no perjadin_teacher and no links", async () => {
    const { pic, input } = await validPlan();

    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    expect(await teachersOf(planned.perjadinId)).toEqual([]);
    expect(await db.select().from(schema.sessionTeachingTeam)).toEqual([]);
  });

  /**
   * The rich acceptance scenario: one School with **three** offline Sessions at different times, a
   * two-name Teaching Team each Session draws from, and two Pimpinan. Every piece is asserted: the
   * Sessions, the `session_teaching_team` links, and the `perjadin_teacher` and `perjadin_pimpinan`
   * rows.
   */
  it("persists three Sessions, the teaching-team links, the teachers and the Pimpinan", async () => {
    const pic = await staff();
    const { subCluster, schools } = await twoSchools();
    const pimpinanA = await addPerson({
      fullName: "Fatimah Arofiati Noor",
      email: "fatimah@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    const pimpinanB = await addPerson({
      fullName: "Anton Timur Jaelani",
      email: "anton@ditsama.itb.ac.id",
      role: "Pimpinan",
    });

    const planned = await planPerjadin(pic, {
      subClusterId: subCluster.id,
      picPersonId: pic.id,
      teacherNames: ["Dr. Andi", "Dr. Bella"],
      pimpinan: [pimpinanA.id, pimpinanB.id],
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-01",
          startsAt: "08:00",
          taughtByTeacherIndexes: [0],
        },
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-01",
          startsAt: "10:00",
          taughtByTeacherIndexes: [0, 1],
        },
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-01",
          startsAt: "13:00",
          taughtByTeacherIndexes: [1],
        },
      ],
      startsOn: STARTS_ON,
      endsOn: ENDS_ON,
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    // The Group is the PIC alone; the teachers are trip-scoped names, not members.
    expect(await groupOf(planned.perjadinId)).toEqual([
      { personId: pic.id, role: "Staff", stream: null },
    ]);

    const teachers = await teachersOf(planned.perjadinId);
    expect(teachers.map((row) => row.name).sort()).toEqual(["Dr. Andi", "Dr. Bella"]);

    expect((await pimpinanOf(planned.perjadinId)).map((row) => row.name).sort()).toEqual(
      [pimpinanA.fullName, pimpinanB.fullName].sort(),
    );

    const sessions = await sessionsOf(planned.perjadinId);
    expect(sessions).toHaveLength(3);
    // Each Session by its start time, so the links can be checked against the plan.
    const byTime = new Map(sessions.map((row) => [row.startsAt.slice(0, 5), row]));
    expect([...byTime.keys()].sort()).toEqual(["08:00", "10:00", "13:00"]);

    expect(await taughtBy(byTime.get("08:00")!.id)).toEqual(["Dr. Andi"]);
    expect(await taughtBy(byTime.get("10:00")!.id)).toEqual(["Dr. Andi", "Dr. Bella"]);
    expect(await taughtBy(byTime.get("13:00")!.id)).toEqual(["Dr. Bella"]);
  });

  /** A trip planned with two Pimpinan writes exactly those two `perjadin_pimpinan` rows. */
  it("records the Pimpinan who join, as record-only rows", async () => {
    const { pic, input } = await validPlan();
    const pimpinanA = await addPerson({
      fullName: "Fatimah Arofiati Noor",
      email: "fatimah@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    const pimpinanB = await addPerson({
      fullName: "Anton Timur Jaelani",
      email: "anton@ditsama.itb.ac.id",
      role: "Pimpinan",
    });

    const planned = await planPerjadin(pic, { ...input, pimpinan: [pimpinanA.id, pimpinanB.id] });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    expect((await pimpinanOf(planned.perjadinId)).map((row) => row.name).sort()).toEqual(
      [pimpinanA.fullName, pimpinanB.fullName].sort(),
    );
    // Pimpinan are never Group members.
    expect(await groupOf(planned.perjadinId)).toHaveLength(1);
  });

  /** An id that is not an active Pimpinan is refused before anything is written. */
  it("refuses a Pimpinan id that is not an active Pimpinan, and writes nothing", async () => {
    const { pic, input } = await validPlan();
    // The PIC is a valid Person id, but a Staff — the wrong role for the Pimpinan roster.

    const result = await planPerjadin(pic, { ...input, pimpinan: [pic.id] });

    expect(result).toEqual({ outcome: "unknown-pimpinan", offending: [pic.id] });
    expect(await perjadinRows()).toEqual([]);
  });

  /**
   * "Diajar oleh" names teachers by index into `teacherNames`. The form can never produce an index
   * past the end of that list — it reindexes the Sessions when a name is removed — but the Server
   * Action is a public endpoint, and an out-of-range index would otherwise insert an undefined
   * `perjadin_teacher_id` and surface a NOT NULL violation from inside the transaction. It is
   * refused up front instead, like `unknown-pimpinan`, naming the School and the bad indexes.
   */
  it("refuses a Session whose 'Diajar oleh' names a teacher index that does not exist, and writes nothing", async () => {
    const { pic, schools, input } = await validPlan();

    const result = await planPerjadin(pic, {
      ...input,
      teacherNames: ["Prof. Satu"],
      sessions: [{ ...input.sessions[0]!, taughtByTeacherIndexes: [5] }, input.sessions[1]!],
    });

    expect(result).toEqual({
      outcome: "unknown-teacher-index",
      offending: [{ schoolId: schools[0].id, indexes: [5] }],
    });
    expect(await perjadinRows()).toEqual([]);
  });

  /**
   * The invariant #28 stated, still the second of its three write paths: a Session cannot be
   * **born** outside the trip it is on.
   */
  it("refuses a Session dated outside the trip, and writes nothing", async () => {
    const { pic, schools, input } = await validPlan();

    const result = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-09",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(result).toEqual({
      outcome: "session-outside-perjadin",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
      offending: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-09",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });
    expect(await perjadinRows()).toEqual([]);
  });

  it("accepts Sessions on both the first and the last day of the trip", async () => {
    const { pic, schools, input } = await validPlan();

    const result = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-01",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[1].id,
          heldOn: "2026-09-03",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(result.outcome).toBe("planned");
  });

  /** Each Session keeps its own date and start time. */
  it("writes each Session's own date and start time", async () => {
    const { pic, schools, input } = await validPlan();

    const planned = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "08:30",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[1].id,
          heldOn: "2026-09-02",
          startsAt: "13:15",
          taughtByTeacherIndexes: [],
        },
      ],
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const rows = await sessionsOf(planned.perjadinId);
    const first = rows.find((row) => row.schoolId === schools[0].id);
    const second = rows.find((row) => row.schoolId === schools[1].id);
    expect(first).toMatchObject({ heldOn: "2026-09-02" });
    expect(first?.startsAt).toMatch(/^08:30/);
    expect(second).toMatchObject({ heldOn: "2026-09-02" });
    expect(second?.startsAt).toMatch(/^13:15/);
  });

  /**
   * ADR-0016's rule that a mutable grouping cannot be a foreign key into immutable history, so
   * planning checks it. A School in a sibling Sub-Cluster is refused for the whole payload.
   */
  it("refuses a School that is not in the chosen Sub-Cluster, and writes nothing", async () => {
    const { pic, subCluster, input } = await validPlan();
    const otherSub = await addSubCluster({
      slug: "alpha-cirebon",
      name: "Kelompok Sekolah Cirebon",
      clusterId: subCluster.clusterId,
    });
    const stray = await addSchool({
      slug: "sman-9",
      name: "SMAN 9 Cirebon",
      clusterId: subCluster.clusterId,
      subClusterId: otherSub.id,
      provinceCode: "JB",
    });

    const result = await planPerjadin(pic, {
      ...input,
      sessions: [
        ...input.sessions,
        {
          schoolId: stray.id,
          heldOn: "2026-09-02",
          startsAt: "10:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(result).toEqual({ outcome: "school-outside-sub-cluster", offending: [stray.id] });
    expect(await perjadinRows()).toEqual([]);
  });

  /**
   * Two **different** Schools on the same date and time is the Group in two places at once — refused
   * with the pair named. Since ADR-0019 there is no database backstop, so this app check is the only
   * guard.
   */
  it("refuses two different Schools on the same date and time, naming them, and writes nothing", async () => {
    const { pic, schools, input } = await validPlan();

    const result = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[1].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(result.outcome).toBe("session-time-clash");
    if (result.outcome !== "session-time-clash") return;
    expect(result.clashes).toHaveLength(1);
    expect(result.clashes[0]).toMatchObject({ heldOn: "2026-09-02", startsAt: "09:00" });
    expect([...result.clashes[0]!.schoolIds].sort()).toEqual([schools[0].id, schools[1].id].sort());
    expect(await perjadinRows()).toEqual([]);
  });

  /**
   * The case that changed with ADR-0038, reversing ADR-0019: two Sessions at the **same** School and
   * the same moment are refused. Parallel rooms are one Session now, whose Teaching Team lists
   * everyone who taught — so the second row comes back as a value naming the slot, not as a unique
   * violation thrown from inside the transaction.
   */
  it("refuses two Sessions at the same School and moment as a duplicate, naming the slot, and writes nothing", async () => {
    const { pic, schools, input } = await validPlan();

    const result = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(result).toEqual({
      outcome: "duplicate-session",
      duplicates: [{ schoolId: schools[0].id, heldOn: "2026-09-02", startsAt: "09:00" }],
    });
    expect(await perjadinRows()).toEqual([]);
  });

  /** One School may still hold several Sessions on one day — at different start times. */
  it("accepts two Sessions at the same School on one date at different times", async () => {
    const { pic, schools, input } = await validPlan();

    const planned = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "13:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(planned.outcome).toBe("planned");
    if (planned.outcome !== "planned") return;
    expect(await sessionsOf(planned.perjadinId)).toHaveLength(2);
  });

  /** Two Schools sharing a date but not a time is legal — that is what the per-School time serves. */
  it("accepts two Schools on the same date at different times", async () => {
    const { pic, schools, input } = await validPlan();

    const result = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[1].id,
          heldOn: "2026-09-02",
          startsAt: "13:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(result.outcome).toBe("planned");
  });

  it("plans with the typed range, written straight to starts_on and ends_on", async () => {
    const { pic, input } = await validPlan();

    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const [row] = await db
      .select({ startsOn: schema.perjadin.startsOn, endsOn: schema.perjadin.endsOn })
      .from(schema.perjadin)
      .where(eq(schema.perjadin.id, planned.perjadinId));
    expect(row).toEqual({ startsOn: "2026-09-01", endsOn: "2026-09-03" });
  });

  it("refuses a Tanggal selesai earlier than the Tanggal mulai, and writes nothing", async () => {
    const { pic, input } = await validPlan();

    const result = await planPerjadin(pic, { ...input, endsOn: "2026-08-30" });

    expect(result).toEqual({ outcome: "ends-before-starts" });
    expect(await perjadinRows()).toEqual([]);
  });

  it("allows a one-day trip, Tanggal mulai and Tanggal selesai the same day", async () => {
    const { pic, input } = await validPlan();

    const result = await planPerjadin(pic, {
      ...input,
      endsOn: "2026-09-01",
      sessions: [input.sessions[0]!],
    });

    expect(result.outcome).toBe("planned");
  });

  it("refuses a trip with no Session on it, and writes nothing", async () => {
    const { pic, input } = await validPlan();

    const result = await planPerjadin(pic, { ...input, sessions: [] });

    expect(result).toEqual({ outcome: "no-schools" });
    expect(await perjadinRows()).toEqual([]);
  });

  // The old "refused by perjadin_pic_is_staff when a professor is named PIC" case is gone: T3
  // (#153) retired the Teaching Team Role and the database now refuses `person.role <> 'Staff'`,
  // so a non-Staff Person can no longer be built to name as PIC. The composite foreign key into
  // `person (id, role)` still stands as the guarantee (see `perjadin-planning.ts`); its precondition
  // — a Person who is not Staff — simply can no longer be constructed. The COMMIT-time membership
  // half of the PIC rule stays below.

  /**
   * The other half of the PIC rule, and the reason the whole write is one transaction. Driven at
   * the database rather than through `planPerjadin`, for the reason `arrange-online-session.test.ts`
   * gives about its index. `perjadin_pic_is_a_group_member` is `DEFERRABLE INITIALLY DEFERRED`, so
   * the failure must arrive at COMMIT and not at the INSERT.
   */
  it("is refused by perjadin_pic_is_a_group_member, and at COMMIT rather than at the insert", async () => {
    const pic = await staff();
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const subCluster = await addSubCluster({
      slug: "alpha-bandung",
      name: "Kelompok Sekolah Bandung",
      clusterId: cluster.id,
    });
    let insertSucceeded = false;

    const refusal = await db
      .transaction(async (tx) => {
        await tx.insert(schema.perjadin).values({
          subClusterId: subCluster.id,
          startsOn: "2026-09-01",
          endsOn: "2026-09-03",
          picPersonId: pic.id,
          picRole: "Staff",
        });
        insertSucceeded = true;
      })
      .then(() => null, constraintOf);

    expect(insertSucceeded).toBe(true);
    expect(refusal).toBe("perjadin_pic_is_a_group_member");
    expect(await perjadinRows()).toEqual([]);
  });

  it("refuses a non-Staff caller", async () => {
    const { input } = await validPlan();

    await expect(planPerjadin(nonStaff(), input)).rejects.toSatisfy(isNotStaffError);
  });
});

describe("Rencanakan Perjadin caps", () => {
  beforeEach(resetDatabase);

  /** The Group is the PIC plus up to ten Staff; six (PIC + 5) is well within, and all persist. */
  it("plans with six Staff — the PIC and five extra", async () => {
    const { pic, input } = await validPlan();
    const extra = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        staff(`Staf ${n}`, `staf${n}@ditsama.itb.ac.id`).then((person) => person.id),
      ),
    );

    const planned = await planPerjadin(pic, { ...input, extraStaffPersonIds: extra });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const group = await groupOf(planned.perjadinId);
    expect(group).toHaveLength(6);
    expect(group.every((member) => member.role === "Staff" && member.stream === null)).toBe(true);
  });

  it("refuses more than ten extra Staff, and writes nothing", async () => {
    const { pic, input } = await validPlan();
    const eleven = await Promise.all(
      Array.from({ length: 11 }, (_, n) =>
        staff(`Staf ${n}`, `staf${n}@ditsama.itb.ac.id`).then((person) => person.id),
      ),
    );

    const result = await planPerjadin(pic, { ...input, extraStaffPersonIds: eleven });

    expect(result).toEqual({ outcome: "too-many-extra-staff", count: 11, limit: 10 });
    expect(await perjadinRows()).toEqual([]);
  });

  it("refuses more than twenty Teaching Team names, and writes nothing", async () => {
    const { pic, input } = await validPlan();
    const names = Array.from({ length: 21 }, (_, n) => `Pengajar ${n}`);

    const result = await planPerjadin(pic, { ...input, teacherNames: names });

    expect(result).toEqual({ outcome: "too-many-teachers", count: 21, limit: 20 });
    expect(await perjadinRows()).toEqual([]);
  });

  it("refuses more than ten Sessions at one School, naming the School and its count", async () => {
    const { pic, schools, input } = await validPlan();
    // Eleven Sessions at one School. The per-School cap runs before the transaction, so these are
    // never inserted; a distinct time each keeps them well-formed regardless.
    const eleven = Array.from({ length: 11 }, (_, n) => ({
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: `09:${String(n).padStart(2, "0")}`,
      taughtByTeacherIndexes: [],
    }));

    const result = await planPerjadin(pic, { ...input, sessions: eleven });

    expect(result).toEqual({
      outcome: "too-many-sessions-per-school",
      offending: [{ schoolId: schools[0].id, count: 11 }],
    });
    expect(await perjadinRows()).toEqual([]);
  });
});

describe("the Perjadin's name and its Schools (ADR-0044)", () => {
  beforeEach(resetDatabase);

  /** One planned Session at `school` on the plan's first day, so a trip may hold one School. */
  const oneSession = (schoolId: string) => [
    { schoolId, heldOn: "2026-09-01", startsAt: "09:00", taughtByTeacherIndexes: [] },
  ];

  it("plans two trips on one Sub-Cluster: one name, two School lines", async () => {
    const { pic, input, schools } = await validPlan();
    const first = await planPerjadin(pic, { ...input, sessions: oneSession(schools[0].id) });
    const second = await planPerjadin(pic, { ...input, sessions: oneSession(schools[1].id) });
    if (first.outcome !== "planned" || second.outcome !== "planned") {
      throw new Error("fixture failed to plan");
    }

    const trips = await perjadinDirectory(nonStaff());

    expect(trips.map((trip) => trip.subClusterName)).toEqual([
      "Kelompok Sekolah Bandung",
      "Kelompok Sekolah Bandung",
    ]);
    const byId = new Map(trips.map((trip) => [trip.id, trip.schoolNames]));
    expect(byId.get(first.perjadinId)).toEqual(["SMAN 1 Bandung"]);
    expect(byId.get(second.perjadinId)).toEqual(["SMAN 2 Bandung"]);
  });

  it("lists only Schools with a non-cancelled Session, alphabetically", async () => {
    const { pic, input } = await validPlan();
    // SMAN 2 first in the payload, so the order the read returns is its own.
    const planned = await planPerjadin(pic, { ...input, sessions: [...input.sessions].reverse() });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const live = async () => {
      const [trip] = await perjadinDirectory(nonStaff());
      return trip?.schoolNames;
    };
    expect(await live()).toEqual(["SMAN 1 Bandung", "SMAN 2 Bandung"]);

    // Cancel SMAN 1's only Session: it drops out, from the count and from the line.
    const [session] = await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .innerJoin(schema.school, eq(schema.school.id, schema.session.schoolId))
      .where(eq(schema.school.name, "SMAN 1 Bandung"));
    await cancelSession(pic, session!.id, "Sekolah meminta penjadwalan ulang");

    expect(await live()).toEqual(["SMAN 2 Bandung"]);
    const [trip] = await perjadinDirectory(nonStaff());
    expect(trip?.schoolCount).toBe(1);
  });

  it("follows a Sub-Cluster rename on every read, a past trip's included", async () => {
    const { pic, input, subCluster } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    await db
      .update(schema.subCluster)
      .set({ name: "Kelompok 10" })
      .where(eq(schema.subCluster.id, subCluster.id));

    // A trip in the past: renaming relabels history, by design.
    const named = "Kelompok 10 · 1–3 Sep 2026";
    const [listed] = await perjadinDirectory(nonStaff());
    const detail = await perjadinDetail(nonStaff(), planned.perjadinId);
    const acquittal = await perjadinAcquittal(pic, planned.perjadinId);
    const { previous } = await myPerjadin(pic);
    const folder = await perjadinDriveFolder(pic, planned.perjadinId);
    for (const read of [listed, detail, acquittal, previous[0], folder?.naming]) {
      expect(read && perjadinName(read)).toBe(named);
    }
    expect(folder && perjadinFolderName(folder.naming)).toBe(
      `${named} · SMAN 1 Bandung, SMAN 2 Bandung · P-${planned.perjadinId.slice(0, 8)}`,
    );
  });
});

describe("the Perjadin list and detail", () => {
  beforeEach(resetDatabase);

  it("lists Perjadins for anyone signed in, newest trip first", async () => {
    const { pic, input } = await validPlan();
    await planPerjadin(pic, input);
    await planPerjadin(pic, {
      ...input,
      // A later trip; its one Session sits inside the new window.
      startsOn: "2026-10-01",
      endsOn: "2026-10-02",
      sessions: [
        {
          schoolId: input.sessions[0]!.schoolId,
          heldOn: "2026-10-01",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    const trips = await perjadinDirectory(nonStaff());

    expect(trips.map((trip) => trip.subClusterName)).toEqual([
      "Kelompok Sekolah Bandung",
      "Kelompok Sekolah Bandung",
    ]);
    expect(trips[0]?.schoolCount).toBe(1);
    expect(trips[1]?.schoolCount).toBe(2);
  });

  /**
   * No money on this payload, for either role. The acquittal is
   * `perjadinAcquittal`'s, a separate read (open to any signed-in Person since #180). The Group is
   * the PIC alone now.
   */
  it("returns the Group, the Schools and no money", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const detail = await perjadinDetail(nonStaff(), planned.perjadinId);

    expect(detail?.subClusterName).toBe("Kelompok Sekolah Bandung");
    expect(detail?.picFullName).toBe("Rina Nurhayati");
    expect(detail?.group).toHaveLength(1);
    expect(detail?.sessions).toHaveLength(2);
    expect(detail).not.toHaveProperty("spentIdr");
    expect(detail).not.toHaveProperty("reportDueOn");
  });

  it("reports the Report deadline on the acquittal, where the money is", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    expect((await perjadinAcquittal(pic, planned.perjadinId))?.reportDueOn).toBe("2026-09-05");
  });

  it("counts Schools rather than Sessions, so a re-arranged School counts once", async () => {
    const { pic, schools, input } = await validPlan();
    const planned = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0]!.id,
          heldOn: "2026-09-01",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
      ],
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");
    await cancelSession(
      pic,
      (await sessionsOf(planned.perjadinId))[0]!.id,
      "Sekolah meminta ulang",
    );
    await db.insert(schema.session).values({
      schoolId: schools[0]!.id,
      perjadinId: planned.perjadinId,
      mode: "offline",
      heldOn: "2026-09-02",
      startsAt: "09:00",
    });

    const [trip] = await perjadinDirectory(pic);

    expect(trip?.schoolCount).toBe(1);
  });

  /**
   * The three search axes the list carries but never renders (#334): the trip-scoped Teaching-Team
   * names, the Group (Kelompok Perjalanan) member names, and the Schools the trip visits. Each is a
   * correlated aggregate, so it returns every match without fanning the row out — `schoolCount` still
   * reads 2 beside a two-entry `schoolNames`, and the names come back sorted and School-distinct.
   */
  it("returns pengajar, Group-member and School names for the search to match on", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, {
      ...input,
      teacherNames: ["Dr. Bella", "Dr. Andi"],
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const [trip] = await perjadinDirectory(nonStaff());

    expect(trip?.pengajarNames).toEqual(["Dr. Andi", "Dr. Bella"]);
    // The Group is the PIC alone (ADR-0020), so their name is the one Group-member name.
    expect(trip?.groupMemberNames).toEqual(["Rina Nurhayati"]);
    // Both Schools of the two Sessions, distinct and sorted; `schoolCount` agrees, proving no fan-out.
    expect(trip?.schoolNames).toEqual(["SMAN 1 Bandung", "SMAN 2 Bandung"]);
    expect(trip?.schoolCount).toBe(2);
  });

  /** A trip with an empty Teaching Team carries an empty array, never `null` — the `coalesce`. */
  it("returns an empty pengajar array for a trip with no Teaching Team", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const [trip] = await perjadinDirectory(nonStaff());

    expect(trip?.pengajarNames).toEqual([]);
  });

  it("is null for an id naming no Perjadin, which is what a stale link is", async () => {
    const pic = await staff();

    expect(await perjadinDetail(pic, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("opens the money read to any signed-in caller now (ADR-0026, #180)", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    // ADR-0004 reversed by ADR-0026 (#180): the money read is open to any signed-in Person, so a
    // non-Staff caller reads the acquittal rather than being refused it. Writing money stays
    // Staff-only — see money-read-open.test.ts.
    await expect(perjadinAcquittal(nonStaff(), planned.perjadinId)).resolves.not.toBeNull();
    await expect(perjadinAcquittal(pic, planned.perjadinId)).resolves.not.toBeNull();
  });
});

describe("extra Staff and the date edit", () => {
  beforeEach(resetDatabase);

  async function datesOf(perjadinId: string) {
    const [row] = await db
      .select({ startsOn: schema.perjadin.startsOn, endsOn: schema.perjadin.endsOn })
      .from(schema.perjadin)
      .where(eq(schema.perjadin.id, perjadinId));
    return row;
  }

  it("inserts extra Staff as group_member rows, Staff with no Stream", async () => {
    const { pic, input } = await validPlan();
    const coordinator = await staff("Dewi Koordinator", "dewi@ditsama.itb.ac.id");
    const treasurer = await staff("Budi Bendahara", "budi@ditsama.itb.ac.id");

    const planned = await planPerjadin(pic, {
      ...input,
      extraStaffPersonIds: [coordinator.id, treasurer.id],
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const group = await groupOf(planned.perjadinId);
    // PIC + two extra Staff — no professors in the Group any more.
    expect(group).toHaveLength(3);
    expect(group.every((member) => member.role === "Staff" && member.stream === null)).toBe(true);
    expect(
      group.filter(
        (member) => member.personId === coordinator.id || member.personId === treasurer.id,
      ),
    ).toHaveLength(2);
  });

  it("plans with no extra Staff — the field is optional", async () => {
    const { pic, input } = await validPlan();

    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    // The PIC alone.
    expect(await groupOf(planned.perjadinId)).toHaveLength(1);
  });

  it("refuses an extra Staff equal to the PIC, and writes nothing", async () => {
    const { pic, input } = await validPlan();

    const result = await planPerjadin(pic, { ...input, extraStaffPersonIds: [pic.id] });

    expect(result).toEqual({ outcome: "duplicate-staff", personIds: [pic.id] });
    expect(await perjadinRows()).toEqual([]);
  });

  it("refuses a duplicated extra Staff, and writes nothing", async () => {
    const { pic, input } = await validPlan();
    const coordinator = await staff("Dewi Koordinator", "dewi@ditsama.itb.ac.id");

    const result = await planPerjadin(pic, {
      ...input,
      extraStaffPersonIds: [coordinator.id, coordinator.id],
    });

    expect(result).toEqual({ outcome: "duplicate-staff", personIds: [coordinator.id] });
    expect(await perjadinRows()).toEqual([]);
  });

  it("updates the typed dates and reports whether the dates moved", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const result = await updatePerjadinDates(pic, planned.perjadinId, {
      startsOn: "2026-08-31",
      endsOn: "2026-09-04",
    });

    expect(result).toEqual({ outcome: "updated", datesMoved: true });
    expect(await datesOf(planned.perjadinId)).toEqual({
      startsOn: "2026-08-31",
      endsOn: "2026-09-04",
    });
  });

  it("refuses an inverted range on the date edit, and leaves the dates alone", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const result = await updatePerjadinDates(pic, planned.perjadinId, {
      startsOn: "2026-09-03",
      endsOn: "2026-09-01",
    });

    expect(result).toEqual({ outcome: "ends-before-starts" });
    expect(await datesOf(planned.perjadinId)).toEqual({
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
  });

  it("refuses a non-Staff caller on the date edit", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    await expect(
      updatePerjadinDates(nonStaff(), planned.perjadinId, {
        startsOn: "2026-09-01",
        endsOn: "2026-09-03",
      }),
    ).rejects.toSatisfy(isNotStaffError);
  });
});

describe("perjadinPlan", () => {
  beforeEach(resetDatabase);

  it("carries each Sub-Cluster School's Province Time Zone onto the plan form (#165)", async () => {
    const caller = await staff();
    await twoSchools();

    const plan = await perjadinPlan(caller);
    const schools = plan.subClusters.flatMap((subCluster) => subCluster.schools);

    // The plan form labels a per-School Session's Jam Mulai with the School's zone. Both Schools
    // are in JB (WIB); the field is present on every one, joined from `province`.
    expect(schools.length).toBeGreaterThan(0);
    expect(schools.every((school) => school.timeZone === "WIB")).toBe(true);
  });
});
