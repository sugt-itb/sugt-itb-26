import { db, schema } from "@sugt/db";
import {
  addOnlineSessionTeacher,
  isNotStaffError,
  markSessionDelivered,
  onlineSessionDetail,
  removeOnlineSessionTeacher,
  renameOnlineSessionTeacher,
  updateOnlineSession,
} from "@sugt/db/queries";
import { MAX_TEACHING_TEAM_PER_ONLINE_SESSION } from "@sugt/domain";
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
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Detail Sesi daring** (#152, ADR-0022) — the online-only detail surface's read and its writes:
 * editing the Session's School, PIC, date, time and Stream, and its `session_teacher_name` Pengajar
 * per item. Every block drives the query function against a real Postgres, because every rule here is
 * about *state* — the widened unique index, the arranged-only field edit, the per-name cap — that a
 * test through the form would pass against a function checking none of them.
 */

/** A Staff Person, PIC of the online Sessions below. */
async function staff(email = "rina@ditsama.itb.ac.id", fullName = "Rina Nurhayati") {
  return addPerson({ fullName, email, role: "Staff" });
}

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more. `onlineSessionDetail` is open and ignores its
 * caller, so this proves the read admits a non-Staff caller; the writes are Staff-only and
 * `requireStaff` throws on the role alone, before it touches the row, so this proves they refuse
 * one. The cast through `unknown` is the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Bagus Prakoso",
    email: "bagus@itb.ac.id",
    role: "Teaching Team" as unknown as Role,
    grants: [],
  };
}

/** Two Schools in one Province, so an edit can move a Session between them. */
async function twoSchools() {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const [first, second] = await Promise.all([
    addSchool({
      slug: "sman-1",
      name: "SMAN 1 Bandung",
      clusterId: cluster.id,
      provinceCode: "JB",
    }),
    addSchool({
      slug: "sman-2",
      name: "SMAN 2 Bandung",
      clusterId: cluster.id,
      provinceCode: "JB",
    }),
  ]);
  return { first, second };
}

/** The Session row as the database holds it, read back rather than trusted. */
async function sessionRow(sessionId: string) {
  const [row] = await db
    .select({
      schoolId: schema.session.schoolId,
      onlinePicPersonId: schema.session.onlinePicPersonId,
      heldOn: schema.session.heldOn,
      startsAt: schema.session.startsAt,
      stream: schema.session.stream,
      status: schema.session.status,
    })
    .from(schema.session)
    .where(eq(schema.session.id, sessionId));
  return row;
}

/** The `session_teacher_name` names a Session actually holds, in id order. */
async function teacherNamesOf(sessionId: string) {
  return db
    .select({ id: schema.sessionTeacherName.id, name: schema.sessionTeacherName.name })
    .from(schema.sessionTeacherName)
    .where(eq(schema.sessionTeacherName.sessionId, sessionId));
}

describe("Detail Sesi daring — read", () => {
  beforeEach(resetDatabase);

  it("returns one online Session with its fields and its Pengajar names in order", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      startsAt: "09:00",
      stream: "Research",
      onlinePicPersonId: pic.id,
    });
    await db.insert(schema.sessionTeacherName).values([
      { sessionId: session.id, name: "Bagus Prakoso" },
      { sessionId: session.id, name: "Ani Wijaya" },
    ]);

    const lookup = await onlineSessionDetail(pic, session.id);

    expect(lookup.outcome).toBe("online");
    if (lookup.outcome !== "online") throw new Error("unreachable");
    expect(lookup.session).toMatchObject({
      schoolId: first.id,
      schoolName: "SMAN 1 Bandung",
      heldOn: "2026-09-10",
      startsAt: "09:00:00",
      stream: "Research",
      picPersonId: pic.id,
      picFullName: "Rina Nurhayati",
    });
    // Name order, so Ani before Bagus regardless of insertion order.
    expect(lookup.session.teachers.map((teacher) => teacher.name)).toEqual([
      "Ani Wijaya",
      "Bagus Prakoso",
    ]);
    // The pickers ride on the payload.
    expect(lookup.session.schools.map((school) => school.id)).toContain(first.id);
    expect(lookup.session.staff.map((entry) => entry.id)).toContain(pic.id);
  });

  it("is open to a non-Staff caller, because a Session carries no money", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    expect((await onlineSessionDetail(nonStaff(), session.id)).outcome).toBe("online");
  });

  /** An offline id belongs on `/sesi/[id]`, so the read reports `offline` for the page to redirect. */
  it("reports offline for an offline Session id", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      advanceIdr: 5_000_000,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const session = await addOfflineSession({
      schoolId: first.id,
      heldOn: "2026-09-02",
      perjadinId: perjadin.id,
    });

    expect((await onlineSessionDetail(pic, session.id)).outcome).toBe("offline");
  });

  it("reports not-found for an id naming no Session", async () => {
    const pic = await staff();
    await twoSchools();

    expect((await onlineSessionDetail(pic, "00000000-0000-0000-0000-000000000000")).outcome).toBe(
      "not-found",
    );
  });
});

describe("Detail Sesi daring — editing the fields", () => {
  beforeEach(resetDatabase);

  it("persists a change to School, PIC, date, time and Stream", async () => {
    const pic = await staff();
    const other = await staff("dewi@ditsama.itb.ac.id", "Dewi Lestari");
    const { first, second } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      startsAt: "09:00",
      stream: "STEM",
      onlinePicPersonId: pic.id,
    });

    const result = await updateOnlineSession(pic, session.id, {
      schoolId: second.id,
      picPersonId: other.id,
      heldOn: "2026-09-17",
      startsAt: "13:30",
      stream: "Research",
    });

    expect(result).toEqual({ outcome: "updated" });
    expect(await sessionRow(session.id)).toEqual({
      schoolId: second.id,
      onlinePicPersonId: other.id,
      heldOn: "2026-09-17",
      startsAt: "13:30:00",
      stream: "Research",
      status: "arranged",
    });
  });

  /**
   * The widened unique index the criterion names, asserted **by name** — this row satisfies several
   * CHECKs and two composite foreign keys, so a test that only knew it was refused could pass against
   * the wrong rule.
   */
  it("is refused by session_one_online_per_school_per_day when the School holds that Stream that day", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const standing = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-17",
      stream: "STEM",
      onlinePicPersonId: pic.id,
    });
    const moving = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      stream: "STEM",
      onlinePicPersonId: pic.id,
    });

    const result = await updateOnlineSession(pic, moving.id, {
      schoolId: first.id,
      picPersonId: pic.id,
      heldOn: "2026-09-17",
      startsAt: "09:00",
      stream: "STEM",
    });

    expect(result).toEqual({
      outcome: "collided",
      constraint: "session_one_online_per_school_per_day",
    });
    // Unmoved: a refused edit writes nothing.
    expect((await sessionRow(moving.id))?.heldOn).toBe("2026-09-10");
    // The standing Session is untouched too.
    expect((await sessionRow(standing.id))?.heldOn).toBe("2026-09-17");
  });

  /** A School may hold one STEM and one Research online Session on a date, so a differing Stream is fine. */
  it("does not collide when the other Session that day is a different Stream", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    await addSession({
      schoolId: first.id,
      heldOn: "2026-09-17",
      stream: "Research",
      onlinePicPersonId: pic.id,
    });
    const moving = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      stream: "STEM",
      onlinePicPersonId: pic.id,
    });

    const result = await updateOnlineSession(pic, moving.id, {
      schoolId: first.id,
      picPersonId: pic.id,
      heldOn: "2026-09-17",
      startsAt: "09:00",
      stream: "STEM",
    });

    expect(result).toEqual({ outcome: "updated" });
  });

  /** The row being edited is excluded, so re-saving a Session onto its own slot is not a self-collision. */
  it("excludes the Session being edited from the collision check", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      startsAt: "09:00",
      stream: "STEM",
      onlinePicPersonId: pic.id,
    });

    const result = await updateOnlineSession(pic, session.id, {
      schoolId: first.id,
      picPersonId: pic.id,
      heldOn: "2026-09-10",
      startsAt: "10:30",
      stream: "STEM",
    });

    expect(result).toEqual({ outcome: "updated" });
    expect((await sessionRow(session.id))?.startsAt).toBe("10:30:00");
  });

  it("refuses to edit a delivered Session, whose fields are settled", async () => {
    const pic = await staff();
    const { first, second } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      stream: "STEM",
      onlinePicPersonId: pic.id,
    });
    await markSessionDelivered(pic, session.id);

    const result = await updateOnlineSession(pic, session.id, {
      schoolId: second.id,
      picPersonId: pic.id,
      heldOn: "2026-09-17",
      startsAt: "09:00",
      stream: "Research",
    });

    expect(result).toEqual({ outcome: "not-arranged", status: "delivered" });
    expect((await sessionRow(session.id))?.schoolId).toBe(first.id);
  });

  it("refuses a non-Staff caller", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    await expect(
      updateOnlineSession(nonStaff(), session.id, {
        schoolId: first.id,
        picPersonId: pic.id,
        heldOn: "2026-09-10",
        startsAt: "09:00",
        stream: "STEM",
      }),
    ).rejects.toSatisfy(isNotStaffError);
  });
});

describe("Detail Sesi daring — Pengajar per item", () => {
  beforeEach(resetDatabase);

  async function arrangedSession() {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });
    return { pic, session };
  }

  it("adds, renames and removes one name at a time", async () => {
    const { pic, session } = await arrangedSession();

    const added = await addOnlineSessionTeacher(pic, session.id, "  Bagus Prakoso  ");
    expect(added.outcome).toBe("added");
    if (added.outcome !== "added") throw new Error("unreachable");
    // Trimmed on the way in.
    expect(await teacherNamesOf(session.id)).toEqual([
      { id: added.teacherId, name: "Bagus Prakoso" },
    ]);

    expect(await renameOnlineSessionTeacher(pic, added.teacherId, "Bagus P.")).toEqual({
      outcome: "renamed",
    });
    expect((await teacherNamesOf(session.id))[0]?.name).toBe("Bagus P.");

    expect(await removeOnlineSessionTeacher(pic, added.teacherId)).toEqual({ outcome: "removed" });
    expect(await teacherNamesOf(session.id)).toEqual([]);
  });

  it("refuses a blank name, writing no row", async () => {
    const { pic, session } = await arrangedSession();

    expect(await addOnlineSessionTeacher(pic, session.id, "   ")).toEqual({
      outcome: "name-required",
    });
    expect(await teacherNamesOf(session.id)).toEqual([]);
  });

  /** The cap is app-enforced (ADR-0022): the database holds no rule, so the query refuses the eleventh. */
  it("refuses the name past the cap", async () => {
    const { pic, session } = await arrangedSession();
    for (let index = 0; index < MAX_TEACHING_TEAM_PER_ONLINE_SESSION; index++) {
      const result = await addOnlineSessionTeacher(pic, session.id, `Pengajar ${index}`);
      expect(result.outcome).toBe("added");
    }

    const result = await addOnlineSessionTeacher(pic, session.id, "Satu lagi");

    expect(result).toEqual({
      outcome: "too-many-teachers",
      count: MAX_TEACHING_TEAM_PER_ONLINE_SESSION,
      limit: MAX_TEACHING_TEAM_PER_ONLINE_SESSION,
    });
    expect(await teacherNamesOf(session.id)).toHaveLength(MAX_TEACHING_TEAM_PER_ONLINE_SESSION);
  });

  /** Pengajar are edited anytime (#152) — the correction path that replaced post-delivery fixes. */
  it("adds a name to a delivered Session", async () => {
    const { pic, session } = await arrangedSession();
    await markSessionDelivered(pic, session.id);

    expect((await addOnlineSessionTeacher(pic, session.id, "Bagus")).outcome).toBe("added");
  });

  it("reports no-such-teacher when renaming or removing a name that is gone", async () => {
    const { pic } = await arrangedSession();
    const ghost = "00000000-0000-0000-0000-000000000000";

    expect(await renameOnlineSessionTeacher(pic, ghost, "Baru")).toEqual({
      outcome: "no-such-teacher",
    });
    expect(await removeOnlineSessionTeacher(pic, ghost)).toEqual({ outcome: "no-such-teacher" });
  });

  it("refuses a non-Staff caller", async () => {
    const { session } = await arrangedSession();

    await expect(addOnlineSessionTeacher(nonStaff(), session.id, "Nama")).rejects.toSatisfy(
      isNotStaffError,
    );
  });
});
