import { randomUUID } from "node:crypto";

import { db, schema } from "@sugt/db";
import {
  addPerjadinSession,
  addPerjadinTeacher,
  cancelSession,
  changePerjadinPic,
  editPerjadinSession,
  isNotStaffError,
  perjadinDetail,
  removePerjadinTeacher,
  renamePerjadinTeacher,
  setPerjadinPimpinan,
  setPerjadinStaff,
} from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  refusedBy,
  resetDatabase,
  revokePerson,
} from "./support/fixtures";

/**
 * **Detail Perjadin's per-item edits** (#138): the trip-scoped Teaching Team, the offline Sessions,
 * the Staff-only Group and its PIC, and the recorded Pimpinan — each changed one piece at a time on
 * `/perjadin/[id]`, against the new model (#136, #137). Every write is Staff-only and every rule the
 * plan form checks against the whole payload is re-checked here against the trip's existing rows plus
 * the one being written. Each block drives the query function against a real Postgres.
 */

async function staff(fullName = "Rina Nurhayati", email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName, email, role: "Staff" });
}

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but every write below is Staff-only, and
 * `requireStaff` throws on the role alone, before it touches the row. The cast through `unknown` is
 * the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Bagus Prakoso",
    email: "bagus@itb.ac.id",
    role: "Teaching Team" as unknown as Role,
  };
}

/**
 * A trip to two Schools in one Sub-Cluster, with a Staff PIC — the common fixture every block below
 * spoils exactly one thing on. `addPerjadin` writes the PIC's own `group_member` row in the same
 * transaction, so the deferred `perjadin_pic_is_a_group_member` holds from the start.
 */
async function trip() {
  const pic = await staff();
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
    }),
    addSchool({
      slug: "sman-2",
      name: "SMAN 2 Bandung",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "JB",
    }),
  ]);
  const perjadin = await addPerjadin({
    subClusterId: subCluster.id,
    picPersonId: pic.id,
    advanceIdr: 5_000_000,
    startsOn: "2026-09-01",
    endsOn: "2026-09-03",
  });
  return { pic, cluster, subCluster, schools, perjadinId: perjadin.id };
}

async function teachersOf(perjadinId: string) {
  return db
    .select({ id: schema.perjadinTeacher.id, name: schema.perjadinTeacher.name })
    .from(schema.perjadinTeacher)
    .where(eq(schema.perjadinTeacher.perjadinId, perjadinId));
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
      status: schema.session.status,
    })
    .from(schema.session)
    .where(eq(schema.session.perjadinId, perjadinId));
}

async function linkedTeacherIds(sessionId: string) {
  return (
    await db
      .select({ id: schema.sessionTeachingTeam.perjadinTeacherId })
      .from(schema.sessionTeachingTeam)
      .where(eq(schema.sessionTeachingTeam.sessionId, sessionId))
  )
    .map((row) => row.id)
    .sort();
}

/** The recorded Pimpinan's names, via the join — a `perjadin_pimpinan` row references a Person now (#181). */
async function pimpinanOf(perjadinId: string) {
  return (
    await db
      .select({ name: schema.person.fullName })
      .from(schema.perjadinPimpinan)
      .innerJoin(schema.person, eq(schema.person.id, schema.perjadinPimpinan.personId))
      .where(eq(schema.perjadinPimpinan.perjadinId, perjadinId))
  )
    .map((row) => row.name)
    .sort();
}

/** A Person on the Pimpinan roster — a real `role='Pimpinan'` row a trip may record (#181). */
async function pimpinan(fullName: string, email: string) {
  return addPerson({ fullName, email, role: "Pimpinan" });
}

/** Put a `perjadin_preparation_item` tick down, so a later mutation's DELETE can be seen. */
async function tick(perjadinId: string, itemKey: string, by: string) {
  await db.insert(schema.perjadinPreparationItem).values({ perjadinId, itemKey, checkedBy: by });
}

async function ticks(perjadinId: string) {
  return (
    await db
      .select({ itemKey: schema.perjadinPreparationItem.itemKey })
      .from(schema.perjadinPreparationItem)
      .where(eq(schema.perjadinPreparationItem.perjadinId, perjadinId))
  )
    .map((row) => row.itemKey)
    .sort();
}

describe("editing a Perjadin's Teaching Team", () => {
  beforeEach(resetDatabase);

  it("adds a trip-scoped teacher name and returns its id", async () => {
    const { pic, perjadinId } = await trip();

    const result = await addPerjadinTeacher(pic, perjadinId, "  Dr. Andi  ");

    expect(result.outcome).toBe("added");
    if (result.outcome !== "added") return;
    const rows = await teachersOf(perjadinId);
    // The name is trimmed on the way in.
    expect(rows).toEqual([{ id: result.teacherId, name: "Dr. Andi" }]);
  });

  it("refuses a blank name, writing nothing", async () => {
    const { pic, perjadinId } = await trip();

    expect(await addPerjadinTeacher(pic, perjadinId, "   ")).toEqual({ outcome: "name-required" });
    expect(await teachersOf(perjadinId)).toEqual([]);
  });

  it("refuses the twenty-first name — the app cap the database does not hold", async () => {
    const { pic, perjadinId } = await trip();
    await db
      .insert(schema.perjadinTeacher)
      .values(Array.from({ length: 20 }, (_, n) => ({ perjadinId, name: `Pengajar ${n}` })));

    const result = await addPerjadinTeacher(pic, perjadinId, "Pengajar 20");

    expect(result).toEqual({ outcome: "too-many-teachers", count: 20, limit: 20 });
    expect(await teachersOf(perjadinId)).toHaveLength(20);
  });

  it("is null-safe about the trip: a stale id is refused", async () => {
    const { pic } = await trip();

    expect(await addPerjadinTeacher(pic, randomUUID(), "Dr. Andi")).toEqual({
      outcome: "no-such-perjadin",
    });
  });

  it("renames a teacher, leaving its id and links intact", async () => {
    const { pic, perjadinId, schools } = await trip();
    const added = await addPerjadinTeacher(pic, perjadinId, "Dr. Andi");
    if (added.outcome !== "added") throw new Error("fixture failed to add");
    const session = await addOfflineSession({
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      perjadinId,
    });
    await db
      .insert(schema.sessionTeachingTeam)
      .values({ sessionId: session.id, perjadinTeacherId: added.teacherId });

    const result = await renamePerjadinTeacher(pic, added.teacherId, "Prof. Andi");

    expect(result).toEqual({ outcome: "renamed" });
    expect(await teachersOf(perjadinId)).toEqual([{ id: added.teacherId, name: "Prof. Andi" }]);
    // The link is glued to the id, not the text, so a rename never disturbs it.
    expect(await linkedTeacherIds(session.id)).toEqual([added.teacherId]);
  });

  it("refuses renaming a teacher that does not exist", async () => {
    const { pic } = await trip();

    expect(await renamePerjadinTeacher(pic, randomUUID(), "Prof. Andi")).toEqual({
      outcome: "no-such-teacher",
    });
  });

  it("removes a teacher and cascades its Session links away", async () => {
    const { pic, perjadinId, schools } = await trip();
    const added = await addPerjadinTeacher(pic, perjadinId, "Dr. Andi");
    if (added.outcome !== "added") throw new Error("fixture failed to add");
    const session = await addOfflineSession({
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      perjadinId,
    });
    await db
      .insert(schema.sessionTeachingTeam)
      .values({ sessionId: session.id, perjadinTeacherId: added.teacherId });

    const result = await removePerjadinTeacher(pic, added.teacherId);

    expect(result).toEqual({ outcome: "removed" });
    expect(await teachersOf(perjadinId)).toEqual([]);
    // `session_teaching_team` cascades from `perjadin_teacher`.
    expect(await linkedTeacherIds(session.id)).toEqual([]);
  });

  it("clears the 'pengajar_lengkap' tick on add, rename and remove, sparing the other boxes", async () => {
    const { pic, perjadinId } = await trip();

    // Add clears it.
    await tick(perjadinId, "pengajar_lengkap", pic.id);
    await tick(perjadinId, "staff", pic.id);
    const added = await addPerjadinTeacher(pic, perjadinId, "Dr. Andi");
    if (added.outcome !== "added") throw new Error("fixture failed to add");
    expect(await ticks(perjadinId)).toEqual(["staff"]);

    // Rename clears it again.
    await tick(perjadinId, "pengajar_lengkap", pic.id);
    await renamePerjadinTeacher(pic, added.teacherId, "Prof. Andi");
    expect(await ticks(perjadinId)).toEqual(["staff"]);

    // Remove clears it a third time.
    await tick(perjadinId, "pengajar_lengkap", pic.id);
    await removePerjadinTeacher(pic, added.teacherId);
    expect(await ticks(perjadinId)).toEqual(["staff"]);
  });

  it("refuses a non-Staff caller on every teacher write", async () => {
    const { perjadinId } = await trip();
    const prof = nonStaff();

    await expect(addPerjadinTeacher(prof, perjadinId, "Dr. Andi")).rejects.toSatisfy(
      isNotStaffError,
    );
    await expect(renamePerjadinTeacher(prof, randomUUID(), "X")).rejects.toSatisfy(isNotStaffError);
    await expect(removePerjadinTeacher(prof, randomUUID())).rejects.toSatisfy(isNotStaffError);
  });
});

describe("editing a Perjadin's Sessions", () => {
  beforeEach(resetDatabase);

  it("adds an offline Session with its Stream and 'Diajar oleh' links", async () => {
    const { pic, perjadinId, schools } = await trip();
    const andi = await addPerjadinTeacher(pic, perjadinId, "Dr. Andi");
    const bella = await addPerjadinTeacher(pic, perjadinId, "Dr. Bella");
    if (andi.outcome !== "added" || bella.outcome !== "added") throw new Error("fixture failed");

    const result = await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "10:00",
      stream: "STEM",
      taughtByTeacherIds: [andi.teacherId, bella.teacherId],
    });

    expect(result.outcome).toBe("added");
    if (result.outcome !== "added") return;
    const [row] = await sessionsOf(perjadinId);
    expect(row).toMatchObject({
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      stream: "STEM",
      status: "arranged",
    });
    expect(row?.startsAt).toMatch(/^10:00/);
    expect(await linkedTeacherIds(result.sessionId)).toEqual(
      [andi.teacherId, bella.teacherId].sort(),
    );
  });

  it("refuses two different Schools at the same date and time, naming the pair", async () => {
    const { pic, perjadinId, schools } = await trip();
    await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "STEM",
      taughtByTeacherIds: [],
    });

    const result = await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[1].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "Research",
      taughtByTeacherIds: [],
    });

    expect(result.outcome).toBe("session-time-clash");
    if (result.outcome !== "session-time-clash") return;
    expect([...result.schoolIds].sort()).toEqual([schools[0].id, schools[1].id].sort());
    // Only the first Session was written.
    expect(await sessionsOf(perjadinId)).toHaveLength(1);
  });

  it("allows two Sessions at the same School and moment with different Streams", async () => {
    const { pic, perjadinId, schools } = await trip();
    await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "STEM",
      taughtByTeacherIds: [],
    });

    const result = await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "Research",
      taughtByTeacherIds: [],
    });

    expect(result.outcome).toBe("added");
    expect(await sessionsOf(perjadinId)).toHaveLength(2);
  });

  it("refuses an exact duplicate Session — same School, date, time and Stream", async () => {
    const { pic, perjadinId, schools } = await trip();
    const input = {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "STEM" as const,
      taughtByTeacherIds: [],
    };
    await addPerjadinSession(pic, perjadinId, input);

    expect(await addPerjadinSession(pic, perjadinId, input)).toEqual({
      outcome: "duplicate-session",
    });
    expect(await sessionsOf(perjadinId)).toHaveLength(1);
  });

  it("refuses a Session dated outside the trip", async () => {
    const { pic, perjadinId, schools } = await trip();

    const result = await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[0].id,
      heldOn: "2026-09-09",
      startsAt: "09:00",
      stream: "STEM",
      taughtByTeacherIds: [],
    });

    expect(result).toEqual({
      outcome: "session-outside-perjadin",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    expect(await sessionsOf(perjadinId)).toEqual([]);
  });

  it("refuses a School outside the trip's Sub-Cluster", async () => {
    const { pic, perjadinId, cluster } = await trip();
    const otherSub = await addSubCluster({
      slug: "alpha-cirebon",
      name: "Kelompok Cirebon",
      clusterId: cluster.id,
    });
    const stray = await addSchool({
      slug: "sman-9",
      name: "SMAN 9 Cirebon",
      clusterId: cluster.id,
      subClusterId: otherSub.id,
      provinceCode: "JB",
    });

    const result = await addPerjadinSession(pic, perjadinId, {
      schoolId: stray.id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "STEM",
      taughtByTeacherIds: [],
    });

    expect(result).toEqual({ outcome: "school-outside-sub-cluster", schoolId: stray.id });
  });

  it("refuses a 'Diajar oleh' id that is not one of the trip's teachers", async () => {
    const { pic, perjadinId, schools } = await trip();
    const stray = randomUUID();

    const result = await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "STEM",
      taughtByTeacherIds: [stray],
    });

    expect(result).toEqual({ outcome: "unknown-teacher", teacherIds: [stray] });
    expect(await sessionsOf(perjadinId)).toEqual([]);
  });

  it("refuses the eleventh Session at one School — the app ceiling", async () => {
    const { pic, perjadinId, schools } = await trip();
    // Ten live Sessions at one School, distinct times so each is well-formed.
    for (let n = 0; n < 10; n++) {
      await addOfflineSession({
        schoolId: schools[0].id,
        heldOn: "2026-09-02",
        startsAt: `08:${String(n).padStart(2, "0")}`,
        perjadinId,
      });
    }

    const result = await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "13:00",
      stream: "STEM",
      taughtByTeacherIds: [],
    });

    expect(result).toEqual({
      outcome: "too-many-sessions",
      schoolId: schools[0].id,
      count: 11,
      limit: 10,
    });
  });

  it("edits a Session's School, date, time, Stream and 'Diajar oleh'", async () => {
    const { pic, perjadinId, schools } = await trip();
    const andi = await addPerjadinTeacher(pic, perjadinId, "Dr. Andi");
    if (andi.outcome !== "added") throw new Error("fixture failed");
    const session = await addOfflineSession({
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      stream: "STEM",
      perjadinId,
    });

    const result = await editPerjadinSession(pic, session.id, {
      schoolId: schools[1].id,
      heldOn: "2026-09-03",
      startsAt: "11:30",
      stream: "Research",
      taughtByTeacherIds: [andi.teacherId],
    });

    expect(result).toEqual({ outcome: "edited" });
    const [row] = await sessionsOf(perjadinId);
    expect(row).toMatchObject({
      schoolId: schools[1].id,
      heldOn: "2026-09-03",
      stream: "Research",
    });
    expect(row?.startsAt).toMatch(/^11:30/);
    expect(await linkedTeacherIds(session.id)).toEqual([andi.teacherId]);
  });

  it("does not clash an edited Session with itself", async () => {
    const { pic, perjadinId, schools } = await trip();
    const session = await addOfflineSession({
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      perjadinId,
    });

    // Re-saving the same slot must not read the row as a clashing sibling.
    const result = await editPerjadinSession(pic, session.id, {
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      stream: "Research",
      taughtByTeacherIds: [],
    });

    expect(result).toEqual({ outcome: "edited" });
  });

  it("does not clash an edited Session with itself when it moves to another School at its own slot", async () => {
    const { pic, perjadinId, schools } = await trip();
    // The only Session at this moment. Moving it to a *different* School at the same date and time is
    // legal precisely because the clash check must exclude the row being edited — otherwise its own
    // stored `(School[0], 09:00)` row would read as a different-School sibling and refuse the move.
    const moving = await addOfflineSession({
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      perjadinId,
    });

    const result = await editPerjadinSession(pic, moving.id, {
      schoolId: schools[1].id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      stream: "STEM",
      taughtByTeacherIds: [],
    });

    expect(result).toEqual({ outcome: "edited" });
  });

  it("refuses an edit that clashes with another School's Session", async () => {
    const { pic, perjadinId, schools } = await trip();
    await addOfflineSession({
      schoolId: schools[1].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      perjadinId,
    });
    const moving = await addOfflineSession({
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      perjadinId,
    });

    const result = await editPerjadinSession(pic, moving.id, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "STEM",
      taughtByTeacherIds: [],
    });

    expect(result.outcome).toBe("session-time-clash");
  });

  it("refuses editing a Session that is no longer arranged", async () => {
    const { pic, perjadinId, schools } = await trip();
    const session = await addOfflineSession({
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      perjadinId,
    });
    await cancelSession(pic, session.id, "Sekolah meminta ulang");

    const result = await editPerjadinSession(pic, session.id, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "09:00",
      stream: "STEM",
      taughtByTeacherIds: [],
    });

    expect(result).toEqual({ outcome: "not-arranged", status: "cancelled" });
  });

  it("removes a Session by cancelling it, keeping it visible", async () => {
    const { pic, perjadinId, schools } = await trip();
    const session = await addOfflineSession({
      schoolId: schools[0].id,
      heldOn: "2026-09-01",
      perjadinId,
    });

    expect(await cancelSession(pic, session.id, "Sekolah libur")).toEqual({ outcome: "cancelled" });
    const [row] = await sessionsOf(perjadinId);
    expect(row?.status).toBe("cancelled");
  });

  it("refuses a non-Staff caller on session writes", async () => {
    const { perjadinId, schools } = await trip();
    const prof = nonStaff();

    await expect(
      addPerjadinSession(prof, perjadinId, {
        schoolId: schools[0].id,
        heldOn: "2026-09-02",
        startsAt: "09:00",
        stream: "STEM",
        taughtByTeacherIds: [],
      }),
    ).rejects.toSatisfy(isNotStaffError);
  });
});

describe("editing a Perjadin's Staff and PIC", () => {
  beforeEach(resetDatabase);

  it("sets the Group's extra Staff to exactly the set given, keeping the PIC", async () => {
    const { pic, perjadinId } = await trip();
    const dewi = await staff("Dewi Koordinator", "dewi@ditsama.itb.ac.id");
    const budi = await staff("Budi Bendahara", "budi@ditsama.itb.ac.id");

    expect(await setPerjadinStaff(pic, perjadinId, [dewi.id, budi.id])).toEqual({ outcome: "set" });

    const group = await groupOf(perjadinId);
    expect(group.map((m) => m.personId).sort()).toEqual([pic.id, dewi.id, budi.id].sort());
    expect(group.every((m) => m.role === "Staff" && m.stream === null)).toBe(true);
  });

  it("refuses more than ten extra Staff, writing nothing", async () => {
    const { pic, perjadinId } = await trip();
    const eleven = await Promise.all(
      Array.from({ length: 11 }, (_, n) =>
        staff(`Staf ${n}`, `staf${n}@ditsama.itb.ac.id`).then((p) => p.id),
      ),
    );

    expect(await setPerjadinStaff(pic, perjadinId, eleven)).toEqual({
      outcome: "too-many-staff",
      count: 11,
      limit: 10,
    });
    // The Group is still just the PIC.
    expect(await groupOf(perjadinId)).toHaveLength(1);
  });

  it("refuses a repeated Staff id, or one equal to the PIC", async () => {
    const { pic, perjadinId } = await trip();
    const dewi = await staff("Dewi Koordinator", "dewi@ditsama.itb.ac.id");

    expect(await setPerjadinStaff(pic, perjadinId, [dewi.id, dewi.id])).toEqual({
      outcome: "duplicate-staff",
      personIds: [dewi.id],
    });
    expect(await setPerjadinStaff(pic, perjadinId, [pic.id])).toEqual({
      outcome: "duplicate-staff",
      personIds: [pic.id],
    });
  });

  it("reassigns the PIC and keeps the Group valid — the deferred FK holds at COMMIT", async () => {
    const { pic, perjadinId } = await trip();
    const dewi = await staff("Dewi Koordinator", "dewi@ditsama.itb.ac.id");

    // `dewi` is not yet a member; the op updates `perjadin.pic_person_id` before inserting her
    // membership, which only commits because `perjadin_pic_is_a_group_member` is DEFERRED.
    expect(await changePerjadinPic(pic, perjadinId, dewi.id)).toEqual({ outcome: "changed" });

    const [trip_] = await db
      .select({ picPersonId: schema.perjadin.picPersonId })
      .from(schema.perjadin)
      .where(eq(schema.perjadin.id, perjadinId));
    expect(trip_?.picPersonId).toBe(dewi.id);
    const group = await groupOf(perjadinId);
    // The new PIC is a member; the old PIC stays on as an ordinary Staff member.
    expect(group.map((m) => m.personId).sort()).toEqual([pic.id, dewi.id].sort());
    expect(group.find((m) => m.personId === dewi.id)?.role).toBe("Staff");
  });

  it("reassigns the PIC to an existing extra Staff member without duplicating the row", async () => {
    const { pic, perjadinId } = await trip();
    const dewi = await staff("Dewi Koordinator", "dewi@ditsama.itb.ac.id");
    await setPerjadinStaff(pic, perjadinId, [dewi.id]);

    expect(await changePerjadinPic(pic, perjadinId, dewi.id)).toEqual({ outcome: "changed" });

    const group = await groupOf(perjadinId);
    expect(group.filter((m) => m.personId === dewi.id)).toHaveLength(1);
  });

  it("treats reassigning to the current PIC as a no-op", async () => {
    const { pic, perjadinId } = await trip();

    expect(await changePerjadinPic(pic, perjadinId, pic.id)).toEqual({ outcome: "changed" });
    expect(await groupOf(perjadinId)).toHaveLength(1);
  });

  it("refuses staff and PIC writes on a stale trip", async () => {
    const { pic } = await trip();

    expect(await setPerjadinStaff(pic, randomUUID(), [])).toEqual({ outcome: "no-such-perjadin" });
    expect(await changePerjadinPic(pic, randomUUID(), pic.id)).toEqual({
      outcome: "no-such-perjadin",
    });
  });

  it("refuses a non-Staff caller on staff and PIC writes", async () => {
    const { pic, perjadinId } = await trip();
    const prof = nonStaff();

    await expect(setPerjadinStaff(prof, perjadinId, [])).rejects.toSatisfy(isNotStaffError);
    await expect(changePerjadinPic(prof, perjadinId, pic.id)).rejects.toSatisfy(isNotStaffError);
  });
});

describe("editing a Perjadin's Pimpinan", () => {
  beforeEach(resetDatabase);

  it("sets the recorded Pimpinan to the subset of the roster given", async () => {
    const { pic, perjadinId } = await trip();
    const a = await pimpinan("Fatimah Arofiati Noor", "fatimah@ditsama.itb.ac.id");
    const b = await pimpinan("Anton Timur Jaelani", "anton@ditsama.itb.ac.id");

    expect(await setPerjadinPimpinan(pic, perjadinId, [a.id, b.id])).toEqual({ outcome: "set" });
    expect(await pimpinanOf(perjadinId)).toEqual([a.fullName, b.fullName].sort());
    // They are never Group members.
    expect(await groupOf(perjadinId)).toHaveLength(1);
  });

  it("clears the Pimpinan when given an empty set", async () => {
    const { pic, perjadinId } = await trip();
    const a = await pimpinan("Fatimah Arofiati Noor", "fatimah@ditsama.itb.ac.id");
    await setPerjadinPimpinan(pic, perjadinId, [a.id]);

    expect(await setPerjadinPimpinan(pic, perjadinId, [])).toEqual({ outcome: "set" });
    expect(await pimpinanOf(perjadinId)).toEqual([]);
  });

  it("dedupes a repeated id rather than colliding on the primary key", async () => {
    const { pic, perjadinId } = await trip();
    const a = await pimpinan("Fatimah Arofiati Noor", "fatimah@ditsama.itb.ac.id");

    expect(await setPerjadinPimpinan(pic, perjadinId, [a.id, a.id])).toEqual({ outcome: "set" });
    expect(await pimpinanOf(perjadinId)).toEqual([a.fullName]);
  });

  it("refuses a Staff id, which is not an active Pimpinan, writing nothing", async () => {
    const { pic, perjadinId } = await trip();
    // `pic` is a Staff Person — a valid id, but the wrong role for the Pimpinan roster.
    expect(await setPerjadinPimpinan(pic, perjadinId, [pic.id])).toEqual({
      outcome: "unknown-pimpinan",
      offending: [pic.id],
    });
    expect(await pimpinanOf(perjadinId)).toEqual([]);
  });

  it("refuses a random uuid that names no Person, writing nothing", async () => {
    const { pic, perjadinId } = await trip();
    const stranger = randomUUID();

    expect(await setPerjadinPimpinan(pic, perjadinId, [stranger])).toEqual({
      outcome: "unknown-pimpinan",
      offending: [stranger],
    });
    expect(await pimpinanOf(perjadinId)).toEqual([]);
  });

  it("refuses a revoked Pimpinan, whose id is no longer active, writing nothing", async () => {
    const { pic, perjadinId } = await trip();
    // A once-valid Pimpinan, now revoked (active = false) — the roster check requires active, so a
    // stale id from before the revoke is named rather than recorded.
    const gone = await pimpinan("Fatimah Azzahra", "fatimah@ditsama.itb.ac.id");
    await revokePerson(gone.id);

    expect(await setPerjadinPimpinan(pic, perjadinId, [gone.id])).toEqual({
      outcome: "unknown-pimpinan",
      offending: [gone.id],
    });
    expect(await pimpinanOf(perjadinId)).toEqual([]);
  });

  it("refuses a non-Staff caller", async () => {
    const { perjadinId } = await trip();
    const prof = nonStaff();

    await expect(setPerjadinPimpinan(prof, perjadinId, [])).rejects.toSatisfy(isNotStaffError);
  });

  it("has the DB composite FK refuse a non-Pimpinan personId that bypassed the query", async () => {
    const { pic, perjadinId } = await trip();
    // A direct insert of a Staff person, skipping `setPerjadinPimpinan`'s roster check — the
    // composite `(person_id, role)` FK into `person (id, role)` is the DB backstop that refuses it.
    const refusal = await refusedBy(
      db
        .insert(schema.perjadinPimpinan)
        .values({ perjadinId, personId: pic.id, role: "Pimpinan" as const }),
    );
    expect(refusal).toBe("perjadin_pimpinan_is_pimpinan");
  });
});

describe("perjadinDetail's new payload", () => {
  beforeEach(resetDatabase);

  it("carries the trip's teacher names, Pimpinan, eligible Schools and each Session's Stream and 'Diajar oleh'", async () => {
    const { pic, perjadinId, schools } = await trip();
    const andi = await addPerjadinTeacher(pic, perjadinId, "Dr. Andi");
    if (andi.outcome !== "added") throw new Error("fixture failed");
    const p0 = await pimpinan("Fatimah Arofiati Noor", "fatimah@ditsama.itb.ac.id");
    await setPerjadinPimpinan(pic, perjadinId, [p0.id]);
    const added = await addPerjadinSession(pic, perjadinId, {
      schoolId: schools[0].id,
      heldOn: "2026-09-02",
      startsAt: "10:00",
      stream: "Research",
      taughtByTeacherIds: [andi.teacherId],
    });
    if (added.outcome !== "added") throw new Error("fixture failed to add session");

    const detail = await perjadinDetail(pic, perjadinId);

    expect(detail?.teachers).toEqual([{ id: andi.teacherId, name: "Dr. Andi" }]);
    expect(detail?.pimpinan).toEqual([{ personId: p0.id, name: p0.fullName }]);
    // The Pimpinan roster carries the active Pimpinan People the editor picks from.
    expect(detail?.pimpinanRoster).toEqual([{ id: p0.id, fullName: p0.fullName }]);
    expect(detail?.eligibleSchools.map((s) => s.id).sort()).toEqual(
      schools.map((s) => s.id).sort(),
    );
    // Each eligible School carries its Province's Time Zone, so the add-Session dialog can label
    // its time input on selection (#165). The trip's Schools are all in JB (WIB).
    expect(detail?.eligibleSchools.every((s) => s.timeZone === "WIB")).toBe(true);
    // The Group is Staff-only, so no People roster of Teaching Team is carried any more.
    expect(detail).not.toHaveProperty("teachingTeam");
    const session = detail?.sessions[0];
    expect(session?.stream).toBe("Research");
    expect(session?.taughtBy).toEqual([{ id: andi.teacherId, name: "Dr. Andi" }]);
  });
});
