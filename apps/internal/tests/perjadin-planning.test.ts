import { db, schema } from "@sugt/db";
import {
  cancelSession,
  isNotStaffError,
  perjadinAcquittal,
  perjadinDetail,
  perjadinDirectory,
  perjadinPlan,
  planPerjadin,
  updatePerjadinLogistics,
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
  return addPerson({ fullName, email, role: "Staff" });
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
 * The travel logistics a valid plan carries. The zones are the server's — WIB out, derived back. The
 * leg **dates** are also the trip's range now (ADR-0021): `starts_on = 2026-09-01`, `ends_on =
 * 2026-09-03`, so every in-window Session below sits between these two dates.
 */
const DEPARTURE = { date: "2026-09-01", time: "07:30", mode: "Pesawat" } as const;
const RETURN = { date: "2026-09-03", time: "18:00", mode: "Pesawat" } as const;

/** Everything a valid trip needs, so each test below can spoil exactly one thing. */
async function validPlan(kabupatenKota?: [string, string]) {
  const pic = await staff();
  const { cluster, subCluster, schools } = await twoSchools(kabupatenKota);

  const input: PlanPerjadinInput = {
    subClusterId: subCluster.id,
    advanceIdr: 5_000_000,
    picPersonId: pic.id,
    teacherNames: [],
    pimpinan: [],
    sessions: [
      {
        schoolId: schools[0].id,
        heldOn: "2026-09-01",
        startsAt: "09:00",
        stream: "STEM",
        taughtByTeacherIndexes: [],
      },
      {
        schoolId: schools[1].id,
        heldOn: "2026-09-03",
        startsAt: "09:00",
        stream: "Research",
        taughtByTeacherIndexes: [],
      },
    ],
    departure: DEPARTURE,
    return: RETURN,
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
      stream: schema.session.stream,
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
   * trip-scoped names (ADR-0020) — and every offline Session carries a Stream (ADR-0019).
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
    // Offline by construction, already arranged, and each carrying its Stream.
    expect(sessions.every((row) => row.mode === "offline")).toBe(true);
    expect(sessions.every((row) => row.status === "arranged")).toBe(true);
    expect(sessions.every((row) => row.stream !== null)).toBe(true);
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
   * The rich acceptance scenario: one School with **three** offline Sessions — Research, STEM, STEM
   * — at different times, a two-name Teaching Team each Session draws from, and two Pimpinan. Every
   * piece is asserted: the `session.stream` values, the `session_teaching_team` links, and the
   * `perjadin_teacher` and `perjadin_pimpinan` rows.
   */
  it("persists three Sessions, their Streams, the teaching-team links, the teachers and the Pimpinan", async () => {
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
      advanceIdr: 5_000_000,
      picPersonId: pic.id,
      teacherNames: ["Dr. Andi", "Dr. Bella"],
      pimpinan: [pimpinanA.id, pimpinanB.id],
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-01",
          startsAt: "08:00",
          stream: "Research",
          taughtByTeacherIndexes: [0],
        },
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-01",
          startsAt: "10:00",
          stream: "STEM",
          taughtByTeacherIndexes: [0, 1],
        },
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-01",
          startsAt: "13:00",
          stream: "STEM",
          taughtByTeacherIndexes: [1],
        },
      ],
      departure: DEPARTURE,
      return: RETURN,
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
    // Each Session by its start time, so the Stream and links can be checked against the plan.
    const byTime = new Map(sessions.map((row) => [row.startsAt.slice(0, 5), row]));
    expect(byTime.get("08:00")?.stream).toBe("Research");
    expect(byTime.get("10:00")?.stream).toBe("STEM");
    expect(byTime.get("13:00")?.stream).toBe("STEM");

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
          stream: "STEM",
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
          stream: "STEM",
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
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[1].id,
          heldOn: "2026-09-03",
          startsAt: "09:00",
          stream: "Research",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(result.outcome).toBe("planned");
  });

  /** Each Session keeps its own date, start time and Stream. */
  it("writes each Session's own date, start time and Stream", async () => {
    const { pic, schools, input } = await validPlan();

    const planned = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "08:30",
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[1].id,
          heldOn: "2026-09-02",
          startsAt: "13:15",
          stream: "Research",
          taughtByTeacherIndexes: [],
        },
      ],
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const rows = await sessionsOf(planned.perjadinId);
    const first = rows.find((row) => row.schoolId === schools[0].id);
    const second = rows.find((row) => row.schoolId === schools[1].id);
    expect(first).toMatchObject({ heldOn: "2026-09-02", stream: "STEM" });
    expect(first?.startsAt).toMatch(/^08:30/);
    expect(second).toMatchObject({ heldOn: "2026-09-02", stream: "Research" });
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
          stream: "STEM",
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
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[1].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          stream: "Research",
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
   * The case that changed with ADR-0019: two Sessions at the **same** School and the same moment,
   * different Streams, are now allowed — parallel rooms. Not a clash.
   */
  it("accepts two Sessions at the same School and moment with different Streams", async () => {
    const { pic, schools, input } = await validPlan();

    const planned = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[0].id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          stream: "Research",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(planned.outcome).toBe("planned");
    if (planned.outcome !== "planned") return;
    const streams = (await sessionsOf(planned.perjadinId)).map((row) => row.stream).sort();
    expect(streams).toEqual(["Research", "STEM"]);
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
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: schools[1].id,
          heldOn: "2026-09-02",
          startsAt: "13:00",
          stream: "Research",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    expect(result.outcome).toBe("planned");
  });

  it("refuses a return date earlier than the departure date, and writes nothing", async () => {
    const { pic, input } = await validPlan();

    // The range is the leg dates now (ADR-0021): a return before the departure would derive an
    // inverted range. The departure stays 2026-09-01; the return is pulled back before it.
    const result = await planPerjadin(pic, {
      ...input,
      return: { date: "2026-08-30", time: "18:00", mode: "Pesawat" },
    });

    expect(result).toEqual({ outcome: "return-before-departure" });
    expect(await perjadinRows()).toEqual([]);
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
          destination: "Bandung",
          startsOn: "2026-09-01",
          endsOn: "2026-09-03",
          advanceIdr: 5_000_000,
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
      stream: "STEM" as const,
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

describe("the derived Perjadin destination", () => {
  beforeEach(resetDatabase);

  it("names every Kabupaten/Kota in the Sub-Cluster, not only the visited Schools", async () => {
    const { pic, input, schools } = await validPlan();
    const planned = await planPerjadin(pic, {
      ...input,
      sessions: [
        {
          schoolId: schools[0]!.id,
          heldOn: "2026-09-01",
          startsAt: "09:00",
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
      ],
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const [row] = await db
      .select({ destination: schema.perjadin.destination })
      .from(schema.perjadin);
    expect(row?.destination).toBe("Kelompok Sekolah Bandung: Kota Bandung dan Kota Cimahi");
  });

  it('collapses Schools in one Kabupaten/Kota to a single entry, with no "dan"', async () => {
    const { pic, input } = await validPlan(["Kota Bandung", "Kota Bandung"]);
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const [row] = await db
      .select({ destination: schema.perjadin.destination })
      .from(schema.perjadin);
    expect(row?.destination).toBe("Kelompok Sekolah Bandung: Kota Bandung");
  });

  it('joins three Kabupaten/Kota with commas and a final "dan"', async () => {
    const pic = await staff();
    const { cluster, subCluster, schools } = await twoSchools(["Kota Samarinda", "Kota Bontang"]);
    await addSchool({
      slug: "sman-3",
      name: "SMAN 3 Bandung",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "JB",
      kabupatenKota: "Kota Balikpapan",
    });

    const planned = await planPerjadin(pic, {
      subClusterId: subCluster.id,
      advanceIdr: 5_000_000,
      picPersonId: pic.id,
      teacherNames: [],
      pimpinan: [],
      sessions: [
        {
          schoolId: schools[0]!.id,
          heldOn: "2026-09-01",
          startsAt: "09:00",
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
      ],
      departure: DEPARTURE,
      return: RETURN,
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const [row] = await db
      .select({ destination: schema.perjadin.destination })
      .from(schema.perjadin);
    expect(row?.destination).toBe(
      "Kelompok Sekolah Bandung: Kota Samarinda, Kota Bontang dan Kota Balikpapan",
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
      // The range is the leg dates now (ADR-0021), so a later trip is a later departure/return, not
      // a separately typed range. Its one Session sits inside the new window.
      departure: { date: "2026-10-01", time: "07:30", mode: "Pesawat" },
      return: { date: "2026-10-02", time: "18:00", mode: "Pesawat" },
      sessions: [
        {
          schoolId: input.sessions[0]!.schoolId,
          heldOn: "2026-10-01",
          startsAt: "09:00",
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
      ],
    });

    const trips = await perjadinDirectory(nonStaff());

    expect(trips.map((trip) => trip.destination)).toEqual([
      "Kelompok Sekolah Bandung: Kota Bandung dan Kota Cimahi",
      "Kelompok Sekolah Bandung: Kota Bandung dan Kota Cimahi",
    ]);
    expect(trips[0]?.schoolCount).toBe(1);
    expect(trips[1]?.schoolCount).toBe(2);
  });

  /**
   * No money on this payload, for either role. The Advance and the acquittal are
   * `perjadinAcquittal`'s, a separate read (open to any signed-in Person since #180). The Group is
   * the PIC alone now.
   */
  it("returns the Group, the Schools and no money", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const detail = await perjadinDetail(nonStaff(), planned.perjadinId);

    expect(detail?.destination).toBe("Kelompok Sekolah Bandung: Kota Bandung dan Kota Cimahi");
    expect(detail?.picFullName).toBe("Rina Nurhayati");
    expect(detail?.group).toHaveLength(1);
    expect(detail?.sessions).toHaveLength(2);
    expect(detail).not.toHaveProperty("advanceIdr");
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
          stream: "STEM",
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
      stream: "STEM",
      heldOn: "2026-09-02",
      startsAt: "09:00",
    });

    const [trip] = await perjadinDirectory(pic);

    expect(trip?.schoolCount).toBe(1);
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

describe("extra Staff and travel logistics", () => {
  beforeEach(resetDatabase);

  async function logisticsOf(perjadinId: string) {
    const [row] = await db
      .select({
        departureAt: schema.perjadin.departureAt,
        departureZone: schema.perjadin.departureZone,
        departureMode: schema.perjadin.departureMode,
        returnAt: schema.perjadin.returnAt,
        returnZone: schema.perjadin.returnZone,
        returnMode: schema.perjadin.returnMode,
      })
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

  it("writes the six logistics columns, WIB out and the wall-clock times back", async () => {
    const { pic, input } = await validPlan();

    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const log = await logisticsOf(planned.perjadinId);
    expect(log?.departureAt).toBe("2026-09-01 07:30:00");
    expect(log?.departureZone).toBe("WIB");
    expect(log?.departureMode).toBe("Pesawat");
    expect(log?.returnAt).toBe("2026-09-03 18:00:00");
    expect(log?.returnMode).toBe("Pesawat");
  });

  it("derives return_zone from the last-visited School's Province, not Bandung's", async () => {
    const pic = await staff();
    await addProvince("JB", "Jawa Barat", "WIB");
    await addProvince("KT", "Kalimantan Timur", "WITA");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const subCluster = await addSubCluster({
      slug: "kalimantan",
      name: "Kelompok Kalimantan",
      clusterId: cluster.id,
    });
    const bandung = await addSchool({
      slug: "sman-bandung",
      name: "SMAN Bandung",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "JB",
      kabupatenKota: "Kota Bandung",
    });
    const samarinda = await addSchool({
      slug: "sman-samarinda",
      name: "SMAN Samarinda",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "KT",
      kabupatenKota: "Kota Samarinda",
    });

    const planned = await planPerjadin(pic, {
      subClusterId: subCluster.id,
      advanceIdr: 5_000_000,
      picPersonId: pic.id,
      teacherNames: [],
      pimpinan: [],
      sessions: [
        {
          schoolId: bandung.id,
          heldOn: "2026-09-02",
          startsAt: "09:00",
          stream: "STEM",
          taughtByTeacherIndexes: [],
        },
        {
          schoolId: samarinda.id,
          heldOn: "2026-09-04",
          startsAt: "09:00",
          stream: "Research",
          taughtByTeacherIndexes: [],
        },
      ],
      departure: DEPARTURE,
      return: { date: "2026-09-05", time: "20:00", mode: "Pesawat" },
    });
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const log = await logisticsOf(planned.perjadinId);
    expect(log?.returnZone).toBe("WITA");
    expect(log?.departureZone).toBe("WIB");
  });

  it("updates the logistics, fixing departure to WIB and taking the given return zone", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    const result = await updatePerjadinLogistics(pic, planned.perjadinId, {
      departureDate: "2026-09-01",
      departureTime: "06:00",
      departureMode: "Kereta",
      returnDate: "2026-09-03",
      returnTime: "22:00",
      returnMode: "Travel",
      returnZone: "WIT",
    });

    expect(result).toEqual({ outcome: "updated" });
    const log = await logisticsOf(planned.perjadinId);
    expect(log?.departureAt).toBe("2026-09-01 06:00:00");
    expect(log?.departureZone).toBe("WIB");
    expect(log?.departureMode).toBe("Kereta");
    expect(log?.returnZone).toBe("WIT");
    expect(log?.returnMode).toBe("Travel");
  });

  it("refuses a non-Staff caller on the logistics edit", async () => {
    const { pic, input } = await validPlan();
    const planned = await planPerjadin(pic, input);
    if (planned.outcome !== "planned") throw new Error("fixture failed to plan");

    await expect(
      updatePerjadinLogistics(nonStaff(), planned.perjadinId, {
        departureDate: "2026-09-01",
        departureTime: "06:00",
        departureMode: "Kereta",
        returnDate: "2026-09-03",
        returnTime: "22:00",
        returnMode: "Travel",
        returnZone: "WIT",
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
