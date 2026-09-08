import { db, schema } from "@sugt/db";
import {
  arrangeOnlineSession,
  arrangeOnlineSessionAt,
  arrangeOnlineSessionForm,
  isNotStaffError,
} from "@sugt/db/queries";
import { MAX_TEACHING_TEAM_PER_ONLINE_SESSION, type Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  refusedBy,
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
  };
}

/**
 * **Jadwalkan Sesi daring** — arranging one online Session at a time (#70, ADR-0022). The write is
 * the substance: exactly one Session, `mode: 'online'`, its own date and start time, a Staff PIC,
 * one **Stream**, and zero-or-more **session-scoped free-text Pengajar names** written to
 * `session_teacher_name` — never a `session_teacher` Person row. A collision on
 * `session_one_online_per_school_per_day` comes back as a value. The index keys on Stream now, so
 * two online Sessions at one School on one date are allowed when the Streams differ and refused
 * when they match — the case these tests have to pin.
 */

async function staffCaller(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

async function oneSchool(slug = "sman-8", name = "SMAN 8") {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: `cluster-${slug}`, name: `Cluster ${slug}` });
  return addSchool({ slug, name, clusterId: cluster.id, provinceCode: "JB" });
}

async function sessionsAt(schoolId: string) {
  return db
    .select({
      id: schema.session.id,
      mode: schema.session.mode,
      stream: schema.session.stream,
      heldOn: schema.session.heldOn,
      startsAt: schema.session.startsAt,
      status: schema.session.status,
      perjadinId: schema.session.perjadinId,
      onlinePicPersonId: schema.session.onlinePicPersonId,
      onlinePicRole: schema.session.onlinePicRole,
    })
    .from(schema.session)
    .where(eq(schema.session.schoolId, schoolId));
}

describe("arrangeOnlineSession", () => {
  beforeEach(resetDatabase);

  it("arranges one online Session with its Stream, date, time and Staff PIC", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    const result = await arrangeOnlineSession(staff, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "09:30",
      picPersonId: staff.id,
      stream: "Research",
      teacherNames: [],
    });

    expect(result.outcome).toBe("arranged");
    const [row] = await sessionsAt(school.id);
    expect(row).toMatchObject({
      mode: "online",
      stream: "Research",
      heldOn: "2026-09-01",
      status: "arranged",
      perjadinId: null,
      onlinePicPersonId: staff.id,
      onlinePicRole: "Staff",
    });
    expect(row?.startsAt).toMatch(/^09:30/);
  });

  it("writes session_teacher_name rows for the named Pengajar", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    const result = await arrangeOnlineSession(staff, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      picPersonId: staff.id,
      stream: "STEM",
      teacherNames: ["Prof. Bagus", "Dr. Sari"],
    });
    if (result.outcome !== "arranged") throw new Error("unreachable");

    // Pengajar are session-scoped free-text names now: T3 (#153) dropped `session_teacher`
    // outright, so there is no Person-based table left even to assert empty.
    const names = await db
      .select({ name: schema.sessionTeacherName.name })
      .from(schema.sessionTeacherName)
      .where(eq(schema.sessionTeacherName.sessionId, result.sessionId));
    expect(names.map((row) => row.name).sort()).toEqual(["Dr. Sari", "Prof. Bagus"]);
  });

  it("writes no session_teacher_name rows when no Pengajar is named", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    await arrangeOnlineSession(staff, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      picPersonId: staff.id,
      stream: "STEM",
      teacherNames: [],
    });

    expect(await db.select().from(schema.sessionTeacherName)).toEqual([]);
  });

  it("allows a second online Session on one day when the Stream differs", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();
    await addSession({
      schoolId: school.id,
      heldOn: "2026-09-01",
      stream: "STEM",
      onlinePicPersonId: staff.id,
    });

    const result = await arrangeOnlineSession(staff, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "13:00",
      picPersonId: staff.id,
      stream: "Research",
      teacherNames: [],
    });

    expect(result.outcome).toBe("arranged");
    expect(await sessionsAt(school.id)).toHaveLength(2);
  });

  it("refuses a second online Session on one day of the same Stream, and writes nothing", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();
    await addSession({
      schoolId: school.id,
      heldOn: "2026-09-01",
      stream: "STEM",
      onlinePicPersonId: staff.id,
    });

    const result = await arrangeOnlineSession(staff, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "13:00",
      picPersonId: staff.id,
      stream: "STEM",
      teacherNames: [],
    });

    expect(result).toEqual({ outcome: "collided", heldOn: "2026-09-01" });
    // Still just the one pre-existing Session — nothing was written.
    expect(await sessionsAt(school.id)).toHaveLength(1);
  });

  it("collides on the day and Stream, not the slot — a different start time is still refused", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();
    await addSession({
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      stream: "STEM",
      onlinePicPersonId: staff.id,
    });

    const result = await arrangeOnlineSession(staff, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "15:00",
      picPersonId: staff.id,
      stream: "STEM",
      teacherNames: [],
    });

    expect(result.outcome).toBe("collided");
    expect(await sessionsAt(school.id)).toHaveLength(1);
  });

  it("does not collide with a cancelled Session of that Stream on that day", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();
    await addSession({
      schoolId: school.id,
      heldOn: "2026-09-01",
      stream: "STEM",
      status: "cancelled",
      onlinePicPersonId: staff.id,
    });

    const result = await arrangeOnlineSession(staff, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      picPersonId: staff.id,
      stream: "STEM",
      teacherNames: [],
    });

    expect(result.outcome).toBe("arranged");
    // The cancelled row plus the new one.
    const rows = await sessionsAt(school.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "arranged")).toHaveLength(1);
  });

  it("refuses more than the Pengajar cap, before writing anything", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    const tooMany = Array.from(
      { length: MAX_TEACHING_TEAM_PER_ONLINE_SESSION + 1 },
      (_, i) => `Pengajar ${i}`,
    );
    const result = await arrangeOnlineSession(staff, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      picPersonId: staff.id,
      stream: "STEM",
      teacherNames: tooMany,
    });

    expect(result).toEqual({
      outcome: "too-many-teachers",
      count: MAX_TEACHING_TEAM_PER_ONLINE_SESSION + 1,
      limit: MAX_TEACHING_TEAM_PER_ONLINE_SESSION,
    });
    // Refused before the transaction — no Session, no names.
    expect(await db.select().from(schema.session)).toEqual([]);
    expect(await db.select().from(schema.sessionTeacherName)).toEqual([]);
  });

  it("the CHECK rejects an online Session with a null Stream", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    // Straight at the table, bypassing the query, which never omits the Stream — the point is that
    // the database, not just the application, refuses a null Stream on either mode now (ADR-0022).
    const refusal = await refusedBy(
      db.insert(schema.session).values({
        schoolId: school.id,
        mode: "online",
        stream: null,
        heldOn: "2026-09-01",
        startsAt: "09:00",
        onlinePicPersonId: staff.id,
        onlinePicRole: "Staff",
      }),
    );

    expect(refusal).toBe("session_stream_not_null");
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const teacher = nonStaff();
    const school = await oneSchool();

    const refusal = await arrangeOnlineSession(teacher, {
      schoolId: school.id,
      heldOn: "2026-09-01",
      startsAt: "09:00",
      picPersonId: teacher.id,
      stream: "STEM",
      teacherNames: [],
    }).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
    expect(await db.select().from(schema.session)).toEqual([]);
  });
});

describe("arrangeOnlineSessionForm", () => {
  beforeEach(resetDatabase);

  it("returns every School in name order and the Staff roster for the PIC", async () => {
    const staff = await staffCaller();
    await oneSchool("sman-2", "SMAN 2 Bandung");
    await oneSchool("sman-1", "SMAN 1 Bandung");

    const form = await arrangeOnlineSessionForm(staff);

    expect(form.schools.map((entry) => entry.name)).toEqual(["SMAN 1 Bandung", "SMAN 2 Bandung"]);
    expect(form.staff.map((entry) => entry.fullName)).toContain("Rina Nurhayati");
    // No Teaching Team roster any more (ADR-0022): Pengajar are session-scoped free-text names.
    expect(form).not.toHaveProperty("teachingTeam");
  });

  it("carries each School's Province Time Zone onto the picker options (#165)", async () => {
    const staff = await staffCaller();
    // A School in a WIT Province beside a School in JB's default WIB, so a hardcoded zone would fail
    // one of the two — the assertion proves the value is joined from `province`, not assumed.
    await addProvince("PA", "Papua", "WIT");
    const papua = await addCluster({ slug: "cluster-papua", name: "Cluster Papua" });
    await addSchool({
      slug: "sman-jayapura",
      name: "SMAN Jayapura",
      clusterId: papua.id,
      provinceCode: "PA",
    });
    await oneSchool("sman-1", "SMAN 1 Bandung");

    const form = await arrangeOnlineSessionForm(staff);

    const zoneByName = new Map(form.schools.map((entry) => [entry.name, entry.timeZone]));
    expect(zoneByName.get("SMAN 1 Bandung")).toBe("WIB");
    expect(zoneByName.get("SMAN Jayapura")).toBe("WIT");
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const teacher = nonStaff();

    const refusal = await arrangeOnlineSessionForm(teacher).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });
});

describe("arrangeOnlineSessionAt", () => {
  beforeEach(resetDatabase);

  it("returns the School named by its slug and the rosters", async () => {
    const staff = await staffCaller();
    const school = await oneSchool("sman-8", "SMAN 8");

    const at = await arrangeOnlineSessionAt(staff, "sman-8");

    expect(at?.school).toMatchObject({ id: school.id, name: "SMAN 8", timeZone: "WIB" });
    expect(at?.staff.map((entry) => entry.fullName)).toContain("Rina Nurhayati");
  });

  it("is null for a slug naming no School", async () => {
    const staff = await staffCaller();

    expect(await arrangeOnlineSessionAt(staff, "tidak-ada")).toBeNull();
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const teacher = nonStaff();
    await oneSchool();

    const refusal = await arrangeOnlineSessionAt(teacher, "sman-8").catch(
      (error: unknown) => error,
    );

    expect(isNotStaffError(refusal)).toBe(true);
  });
});
