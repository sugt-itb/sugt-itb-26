import { db, schema } from "@sugt/db";
import {
  deleteOnlineSession,
  isNotStaffError,
  markSessionDelivered,
  onlineSessionDetail,
  updateOnlineSession,
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
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Detail Sesi daring** (#152, #318) — the online-only detail surface's read and its writes: editing
 * the Session's School, date, times and two cohort-named Pengajar, and hard-deleting it. Every block
 * drives the query function against a real Postgres, because every rule here is about *state* — the
 * unique index, the born-`delivered` field edit, the cancelled-is-settled guard, the hard delete —
 * that a test through the form would pass against a function checking none of them.
 */

/** A Staff Person. */
async function staff(email = "rina@ditsama.itb.ac.id", fullName = "Rina Nurhayati") {
  return addPerson({ fullName, email, role: "Staff" });
}

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more. `onlineSessionDetail` is open and ignores its
 * caller, so this proves the read admits a non-Staff caller; the writes are Staff-only and
 * `requireStaff` throws on the role alone, before it touches the row. The cast through `unknown` is
 * the only way to name a role the type no longer admits.
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

/** A date no run will ever reach, for the future-date guard. */
const FUTURE = "2999-01-01";

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
      heldOn: schema.session.heldOn,
      startsAt: schema.session.startsAt,
      endsAt: schema.session.endsAt,
      pengajarSiswaName: schema.session.pengajarSiswaName,
      pengajarGtkMsName: schema.session.pengajarGtkMsName,
      status: schema.session.status,
    })
    .from(schema.session)
    .where(eq(schema.session.id, sessionId));
  return row;
}

/** One valid edit payload, overridable field by field. */
function editInput(schoolId: string, overrides: Record<string, unknown> = {}) {
  return {
    schoolId,
    heldOn: "2026-01-17",
    startsAt: "13:30",
    endsAt: "15:00",
    pengajarSiswaName: "Ani Wijaya",
    pengajarGtkMsName: "Budi Hartono",
    ...overrides,
  };
}

describe("Detail Sesi daring — read", () => {
  beforeEach(resetDatabase);

  it("returns one online Session with its fields and its two Pengajar", async () => {
    const caller = await staff();
    const { first } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-01-10",
      startsAt: "09:00",
      endsAt: "10:30",
      pengajarSiswaName: "Ani Wijaya",
      pengajarGtkMsName: "Bagus Prakoso",
    });

    const lookup = await onlineSessionDetail(caller, session.id);

    expect(lookup.outcome).toBe("online");
    if (lookup.outcome !== "online") throw new Error("unreachable");
    expect(lookup.session).toMatchObject({
      schoolId: first.id,
      schoolName: "SMAN 1 Bandung",
      heldOn: "2026-01-10",
      startsAt: "09:00:00",
      endsAt: "10:30:00",
      pengajarSiswaName: "Ani Wijaya",
      pengajarGtkMsName: "Bagus Prakoso",
      // Online Sessions are always WIB (#283), regardless of the School's Province.
      timeZone: "WIB",
    });
    // No PIC, Stream, Peserta or teacher list on an online Session any more (#284, #318).
    expect(lookup.session).not.toHaveProperty("picFullName");
    expect(lookup.session).not.toHaveProperty("stream");
    expect(lookup.session).not.toHaveProperty("participantType");
    expect(lookup.session).not.toHaveProperty("teachers");
    // The School picker rides on the payload; there is no Staff roster (no PIC to pick, #284).
    expect(lookup.session.schools.map((school) => school.id)).toContain(first.id);
    expect(lookup.session).not.toHaveProperty("staff");
  });

  it("is open to a non-Staff caller, because a Session carries no money", async () => {
    const { first } = await twoSchools();
    const session = await addSession({ schoolId: first.id, heldOn: "2026-01-10" });

    expect((await onlineSessionDetail(nonStaff(), session.id)).outcome).toBe("online");
  });

  /** An offline id belongs on `/sesi/[id]`, so the read reports `offline` for the page to redirect. */
  it("reports offline for an offline Session id", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      advanceIdr: 5_000_000,
      startsOn: "2026-01-01",
      endsOn: "2026-01-03",
    });
    const session = await addOfflineSession({
      schoolId: first.id,
      heldOn: "2026-01-02",
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

  it("persists a change to School, date, times and both Pengajar", async () => {
    const pic = await staff();
    const { first, second } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-01-10",
      startsAt: "09:00",
    });

    const result = await updateOnlineSession(pic, session.id, editInput(second.id));

    expect(result).toEqual({ outcome: "updated" });
    expect(await sessionRow(session.id)).toEqual({
      schoolId: second.id,
      heldOn: "2026-01-17",
      startsAt: "13:30:00",
      endsAt: "15:00:00",
      pengajarSiswaName: "Ani Wijaya",
      pengajarGtkMsName: "Budi Hartono",
      status: "arranged",
    });
  });

  /** A born-`delivered` Session is the normal case now (#318); its fields stay correctable via Edit. */
  it("edits a delivered Session — the correction path", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({ schoolId: first.id, heldOn: "2026-01-10" });
    await markSessionDelivered(pic, session.id);

    const result = await updateOnlineSession(
      pic,
      session.id,
      editInput(first.id, { heldOn: "2026-01-10", pengajarSiswaName: "Nama Baru" }),
    );

    expect(result).toEqual({ outcome: "updated" });
    const row = await sessionRow(session.id);
    expect(row?.status).toBe("delivered");
    expect(row?.pengajarSiswaName).toBe("Nama Baru");
  });

  /**
   * The unique index the criterion names, asserted **by name** — this row satisfies several CHECKs,
   * so a test that only knew it was refused could pass against the wrong rule. One online Session per
   * School per day now (#284), whatever the hour.
   */
  it("is refused by session_one_online_per_school_per_day when the School holds a Session that day", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const standing = await addSession({ schoolId: first.id, heldOn: "2026-01-17" });
    const moving = await addSession({ schoolId: first.id, heldOn: "2026-01-10" });

    const result = await updateOnlineSession(
      pic,
      moving.id,
      editInput(first.id, { heldOn: "2026-01-17" }),
    );

    expect(result).toEqual({
      outcome: "collided",
      constraint: "session_one_online_per_school_per_day",
    });
    // Unmoved: a refused edit writes nothing.
    expect((await sessionRow(moving.id))?.heldOn).toBe("2026-01-10");
    // The standing Session is untouched too.
    expect((await sessionRow(standing.id))?.heldOn).toBe("2026-01-17");
  });

  /** The row being edited is excluded, so re-saving a Session onto its own slot is not a self-collision. */
  it("excludes the Session being edited from the collision check", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-01-10",
      startsAt: "09:00",
    });

    const result = await updateOnlineSession(
      pic,
      session.id,
      editInput(first.id, { heldOn: "2026-01-10", startsAt: "10:30", endsAt: "12:00" }),
    );

    expect(result).toEqual({ outcome: "updated" });
    expect((await sessionRow(session.id))?.startsAt).toBe("10:30:00");
  });

  it("refuses an end at/before the start, a missing Jam Selesai, a blank Pengajar, and a future date (#318)", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-01-10",
      startsAt: "09:00",
    });

    expect(
      await updateOnlineSession(
        pic,
        session.id,
        editInput(first.id, { startsAt: "09:00", endsAt: "09:00" }),
      ),
    ).toEqual({ outcome: "end-before-start" });
    expect(await updateOnlineSession(pic, session.id, editInput(first.id, { endsAt: "" }))).toEqual(
      { outcome: "end-time-required" },
    );
    expect(
      await updateOnlineSession(pic, session.id, editInput(first.id, { pengajarGtkMsName: "  " })),
    ).toEqual({ outcome: "pengajar-required" });
    expect(
      await updateOnlineSession(pic, session.id, editInput(first.id, { heldOn: FUTURE })),
    ).toMatchObject({ outcome: "future-date" });

    // None of the refused edits wrote — the Session keeps its original time and school.
    expect((await sessionRow(session.id))?.startsAt).toBe("09:00:00");
    expect((await sessionRow(session.id))?.heldOn).toBe("2026-01-10");
  });

  it("refuses to edit a cancelled Session, whose fields are settled", async () => {
    const pic = await staff();
    const { first, second } = await twoSchools();
    const session = await addSession({
      schoolId: first.id,
      heldOn: "2026-01-10",
      status: "cancelled",
    });

    const result = await updateOnlineSession(pic, session.id, editInput(second.id));

    expect(result).toEqual({ outcome: "cancelled" });
    expect((await sessionRow(session.id))?.schoolId).toBe(first.id);
  });

  it("refuses a non-Staff caller", async () => {
    const { first } = await twoSchools();
    const session = await addSession({ schoolId: first.id, heldOn: "2026-01-10" });

    await expect(
      updateOnlineSession(nonStaff(), session.id, editInput(first.id, { heldOn: "2026-01-10" })),
    ).rejects.toSatisfy(isNotStaffError);
  });
});

describe("Detail Sesi daring — hard delete", () => {
  beforeEach(resetDatabase);

  it("removes the Session row", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({ schoolId: first.id, heldOn: "2026-01-10" });

    expect(await deleteOnlineSession(pic, session.id)).toEqual({ outcome: "deleted" });
    expect(await sessionRow(session.id)).toBeUndefined();
  });

  it("deletes a delivered Session too — the correction for one recorded in error", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const session = await addSession({ schoolId: first.id, heldOn: "2026-01-10" });
    await markSessionDelivered(pic, session.id);

    expect(await deleteOnlineSession(pic, session.id)).toEqual({ outcome: "deleted" });
    expect(await sessionRow(session.id)).toBeUndefined();
  });

  it("reports no-such-session for an id already gone", async () => {
    const pic = await staff();
    await twoSchools();

    expect(await deleteOnlineSession(pic, "00000000-0000-0000-0000-000000000000")).toEqual({
      outcome: "no-such-session",
    });
  });

  /** An offline Session blocks deleting its Perjadin and is not deleted here — the match is online-only. */
  it("does not delete an offline Session", async () => {
    const pic = await staff();
    const { first } = await twoSchools();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      advanceIdr: 5_000_000,
      startsOn: "2026-01-01",
      endsOn: "2026-01-03",
    });
    const offline = await addOfflineSession({
      schoolId: first.id,
      heldOn: "2026-01-02",
      perjadinId: perjadin.id,
    });

    expect(await deleteOnlineSession(pic, offline.id)).toEqual({ outcome: "no-such-session" });
    expect(await sessionRow(offline.id)).toBeDefined();
  });

  it("refuses a non-Staff caller", async () => {
    const { first } = await twoSchools();
    const session = await addSession({ schoolId: first.id, heldOn: "2026-01-10" });

    await expect(deleteOnlineSession(nonStaff(), session.id)).rejects.toSatisfy(isNotStaffError);
  });
});
