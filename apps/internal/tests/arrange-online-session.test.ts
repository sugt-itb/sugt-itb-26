import { db, schema } from "@sugt/db";
import {
  arrangeOnlineSession,
  arrangeOnlineSessionAt,
  arrangeOnlineSessionForm,
  isNotStaffError,
} from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
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
 * **Catat Sesi daring** — recording one online Session that has already happened (#70, #318). The
 * write is the substance: exactly one Session, `mode: 'online'`, **`status: 'delivered'`**, its own
 * date, start and end time, and **two cohort-named Pengajar** — one Siswa professor and one GTK-MS
 * professor, one name each, both required — as columns on the row (no side table). **No PIC and no
 * Stream (#284):** a third-party LMS runs online delivery. A collision on
 * `session_one_online_per_school_per_day` comes back as a value; the index keys on `(school_id,
 * held_on)`, so it is **one online Session per School per day** whatever the hour. A future date is
 * refused — an online Session is logged after it happened.
 */

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

async function staffCaller(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

async function oneSchool(slug = "sman-8", name = "SMAN 8") {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: `cluster-${slug}`, name: `Cluster ${slug}` });
  return addSchool({ slug, name, clusterId: cluster.id, provinceCode: "JB" });
}

/** A date comfortably in the past relative to any run — an online Session is recorded after it happened. */
const PAST = "2026-01-15";
/** A date no run will ever reach, for the future-date guard. */
const FUTURE = "2999-01-01";

/** One valid recording payload, overridable field by field. */
function payload(schoolId: string, overrides: Record<string, unknown> = {}) {
  return {
    schoolId,
    heldOn: PAST,
    startsAt: "09:30",
    endsAt: "11:00",
    pengajarSiswaName: "Prof. Bagus",
    pengajarGtkMsName: "Dr. Sari",
    ...overrides,
  };
}

async function sessionsAt(schoolId: string) {
  return db
    .select({
      id: schema.session.id,
      mode: schema.session.mode,
      heldOn: schema.session.heldOn,
      startsAt: schema.session.startsAt,
      endsAt: schema.session.endsAt,
      pengajarSiswaName: schema.session.pengajarSiswaName,
      pengajarGtkMsName: schema.session.pengajarGtkMsName,
      status: schema.session.status,
      perjadinId: schema.session.perjadinId,
    })
    .from(schema.session)
    .where(eq(schema.session.schoolId, schoolId));
}

describe("arrangeOnlineSession", () => {
  beforeEach(resetDatabase);

  it("records one delivered online Session with its date, times and two Pengajar (no PIC, no Stream)", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    const result = await arrangeOnlineSession(staff, payload(school.id, { heldOn: PAST }));

    expect(result.outcome).toBe("recorded");
    const [row] = await sessionsAt(school.id);
    expect(row).toMatchObject({
      mode: "online",
      heldOn: PAST,
      pengajarSiswaName: "Prof. Bagus",
      pengajarGtkMsName: "Dr. Sari",
      // Born delivered (#318): a third party ran delivery, so it is logged after the fact.
      status: "delivered",
      perjadinId: null,
    });
    expect(row?.startsAt).toMatch(/^09:30/);
    expect(row?.endsAt).toMatch(/^11:00/);
  });

  it("trims the Pengajar names on the way in", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    const result = await arrangeOnlineSession(
      staff,
      payload(school.id, { pengajarSiswaName: "  Prof. Bagus  ", pengajarGtkMsName: " Dr. Sari " }),
    );
    expect(result.outcome).toBe("recorded");

    const [row] = await sessionsAt(school.id);
    expect(row?.pengajarSiswaName).toBe("Prof. Bagus");
    expect(row?.pengajarGtkMsName).toBe("Dr. Sari");
  });

  it("refuses when either Pengajar is blank (both required, #318), writing nothing", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    expect(
      await arrangeOnlineSession(staff, payload(school.id, { pengajarSiswaName: "" })),
    ).toEqual({ outcome: "pengajar-required" });
    expect(
      await arrangeOnlineSession(staff, payload(school.id, { pengajarGtkMsName: "   " })),
    ).toEqual({ outcome: "pengajar-required" });

    expect(await db.select().from(schema.session)).toEqual([]);
  });

  it("refuses a missing Jam Selesai, and one at or before Jam Mulai, writing nothing", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    expect(await arrangeOnlineSession(staff, payload(school.id, { endsAt: "" }))).toEqual({
      outcome: "end-time-required",
    });
    expect(
      await arrangeOnlineSession(staff, payload(school.id, { startsAt: "10:00", endsAt: "10:00" })),
    ).toEqual({ outcome: "end-before-start" });

    expect(await db.select().from(schema.session)).toEqual([]);
  });

  it("refuses a future Tanggal (#318: recorded after it happened), writing nothing", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();

    const result = await arrangeOnlineSession(staff, payload(school.id, { heldOn: FUTURE }));

    expect(result.outcome).toBe("future-date");
    expect(await db.select().from(schema.session)).toEqual([]);
  });

  it("the CHECK rejects an end time at or before the start time", async () => {
    const school = await oneSchool();

    // Straight at the table, bypassing the query's own guard — the point is that the database, not
    // just the application, refuses an end that is not after the start (#283).
    const refusal = await refusedBy(
      db.insert(schema.session).values({
        schoolId: school.id,
        mode: "online",
        status: "delivered",
        heldOn: PAST,
        startsAt: "10:00",
        endsAt: "09:00",
        pengajarSiswaName: "Prof. Bagus",
        pengajarGtkMsName: "Dr. Sari",
      }),
    );

    expect(refusal).toBe("session_ends_after_starts_check");
  });

  it("the CHECK rejects an online row missing a Pengajar (#318)", async () => {
    const school = await oneSchool();

    const refusal = await refusedBy(
      db.insert(schema.session).values({
        schoolId: school.id,
        mode: "online",
        status: "delivered",
        heldOn: PAST,
        startsAt: "09:00",
        endsAt: "10:30",
        pengajarSiswaName: "Prof. Bagus",
        // pengajarGtkMsName left null — the not-null-for-online CHECK must refuse it.
      }),
    );

    expect(refusal).toBe("session_online_pengajar_not_null");
  });

  it("refuses a second online Session on the same day, whatever the hour (#284: one per day)", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();
    await addSession({ schoolId: school.id, heldOn: PAST, startsAt: "09:00" });

    const result = await arrangeOnlineSession(
      staff,
      payload(school.id, { heldOn: PAST, startsAt: "15:00", endsAt: "16:30" }),
    );

    expect(result).toEqual({ outcome: "collided", heldOn: PAST });
    // Still just the one pre-existing Session — nothing was written.
    expect(await sessionsAt(school.id)).toHaveLength(1);
  });

  it("lets two different Schools share the same date and time (online has no shared-slot rule)", async () => {
    const staff = await staffCaller();
    const melati = await oneSchool("sdn-melati", "SDN Melati");
    const mawar = await oneSchool("sdn-mawar", "SDN Mawar");

    const first = await arrangeOnlineSession(
      staff,
      payload(melati.id, { heldOn: PAST, startsAt: "09:00", endsAt: "11:00" }),
    );
    const second = await arrangeOnlineSession(
      staff,
      payload(mawar.id, { heldOn: PAST, startsAt: "09:00", endsAt: "11:00" }),
    );

    expect(first.outcome).toBe("recorded");
    expect(second.outcome).toBe("recorded");
    expect(await sessionsAt(melati.id)).toHaveLength(1);
    expect(await sessionsAt(mawar.id)).toHaveLength(1);
  });

  it("does not collide with a cancelled Session on that day", async () => {
    const staff = await staffCaller();
    const school = await oneSchool();
    await addSession({ schoolId: school.id, heldOn: PAST, status: "cancelled" });

    const result = await arrangeOnlineSession(staff, payload(school.id, { heldOn: PAST }));

    expect(result.outcome).toBe("recorded");
    // The cancelled row plus the new one.
    const rows = await sessionsAt(school.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "delivered")).toHaveLength(1);
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const teacher = nonStaff();
    const school = await oneSchool();

    const refusal = await arrangeOnlineSession(teacher, payload(school.id)).catch(
      (error: unknown) => error,
    );

    expect(isNotStaffError(refusal)).toBe(true);
    expect(await db.select().from(schema.session)).toEqual([]);
  });
});

describe("arrangeOnlineSessionForm", () => {
  beforeEach(resetDatabase);

  it("returns every School in name order, and no Staff roster (#284: no PIC to pick)", async () => {
    const staff = await staffCaller();
    await oneSchool("sman-2", "SMAN 2 Bandung");
    await oneSchool("sman-1", "SMAN 1 Bandung");

    const form = await arrangeOnlineSessionForm(staff);

    expect(form.schools.map((entry) => entry.name)).toEqual(["SMAN 1 Bandung", "SMAN 2 Bandung"]);
    // No PIC picker (#284) and no Teaching Team roster: the form carries Schools alone.
    expect(form).not.toHaveProperty("staff");
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

  it("returns the School named by its slug (no roster, #284)", async () => {
    const staff = await staffCaller();
    const school = await oneSchool("sman-8", "SMAN 8");

    const at = await arrangeOnlineSessionAt(staff, "sman-8");

    expect(at?.school).toMatchObject({ id: school.id, name: "SMAN 8", timeZone: "WIB" });
    expect(at).not.toHaveProperty("staff");
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
