import { db, schema } from "@sugt/db";
import {
  cancelSession,
  isNotStaffError,
  markSessionDelivered,
  moveSessionDate,
  sessionDetail,
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
  addSessionRecord,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Detail Sesi**, and the three writes it offers — Tandai terlaksana, Batalkan Sesi and
 * moving a date.
 *
 * Every block here drives the write function against a real Postgres rather than the
 * screen, because every rule this ticket adds is a rule about *state* rather than about
 * markup: `delivered` is terminal, cancelling is offered only while `arranged`, a moved
 * date re-checks the per-day index, and an arranged offline Session stays inside its
 * Perjadin's window. A test through the form would pass against a function that checks
 * none of them, so long as the form did not offer the button.
 *
 * T3 (#153) retired `session_teacher` and the Teaching Team Role. Detail Sesi no longer names
 * teachers, suggests a Group's Stream assignments or counts Class Records owed; the one Record
 * still owed is the PIC's Session Record, so that is all `owed` carries now.
 */

/** The Staff Person who is PIC of everything below. */
async function staff(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the Staff-only writes below must still
 * reject a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the
 * row. Casting through `unknown` is the only way to name a role the type no longer admits; the id
 * is never read, because the guard fires first.
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

/** One School to hang Sessions off. */
async function oneSchool(slug = "sman-1-bandung") {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  return addSchool({
    slug,
    name: "SMAN 1 Bandung",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
}

/** The status a Session actually holds, read back from the database rather than trusted. */
async function statusOf(sessionId: string) {
  const [row] = await db
    .select({ status: schema.session.status })
    .from(schema.session)
    .where(eq(schema.session.id, sessionId));
  return row?.status ?? null;
}

describe("Detail Sesi", () => {
  beforeEach(resetDatabase);

  it("reports the PIC of an online Session from the Session itself", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    const detail = await sessionDetail(pic, session.id);

    expect(detail?.picFullName).toBe("Rina Nurhayati");
    expect(detail?.schoolName).toBe("SMAN 1 Bandung");
    expect(detail?.perjadin).toBeNull();
  });

  /**
   * The `coalesce` the criterion names. An offline Session carries no PIC columns of its
   * own — the composite foreign key is `MATCH SIMPLE` precisely so it may not — so its
   * PIC has to come from the Perjadin, which makes this a query and not a column.
   */
  it("reports the PIC of an offline Session from its Perjadin", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      advanceIdr: 5_000_000,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const session = await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      perjadinId: perjadin.id,
    });

    const detail = await sessionDetail(pic, session.id);

    expect(detail?.picFullName).toBe("Rina Nurhayati");
    expect(detail?.perjadin).toEqual({
      id: perjadin.id,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
  });

  /** The start time, and the Time Zone it is read in — the School's Province's (#72). */
  it("carries the Session's start time and its School's Time Zone", async () => {
    const pic = await staff();
    await addProvince("PA", "Papua", "WIT");
    const cluster = await addCluster({ slug: "timur", name: "Cluster Timur" });
    const school = await addSchool({
      slug: "sman-jayapura",
      name: "SMAN Jayapura",
      clusterId: cluster.id,
      provinceCode: "PA",
    });
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      startsAt: "09:00",
      onlinePicPersonId: pic.id,
    });

    const detail = await sessionDetail(pic, session.id);

    expect(detail?.startsAt).toBe("09:00:00");
    expect(detail?.timeZone).toBe("WIT");
  });

  it("is open to a non-Staff caller, because a Session carries no money", async () => {
    // `sessionDetail` reads delivery data, not money, so it takes any signed-in caller (ADR-0004)
    // — it never calls `requireStaff`. A hand-built non-Staff caller proves the surface is open;
    // no such Person exists in the database since T3 (#153), so the caller is cast, not invited.
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    await expect(sessionDetail(nonStaff(), session.id)).resolves.not.toBeNull();
  });

  it("is null for an id naming no Session, which is what a stale link is", async () => {
    const pic = await staff();
    await oneSchool();

    expect(await sessionDetail(pic, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  /**
   * `owed` is delivered-only. An arranged Session has not happened, so nothing is owed off it —
   * the overdue-shaped state ADR-0006 exists to prevent. Since T3 (#153) the only thing ever owed
   * is the PIC's Session Record, so `owed` on an arranged Session is simply empty.
   */
  it("owes nothing while a Session is arranged", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    const detail = await sessionDetail(pic, session.id);

    expect(detail?.owed).toEqual([]);
  });

  /**
   * The one Record still owed off a delivered Session: the PIC's Session Record. Class Records
   * went with `session_teacher` (T3, #153), so there is no per-teacher, per-Class-kind debt any
   * more — `owed` is exactly the PIC's Session Record until they file it.
   */
  it("owes the PIC's Session Record once a Session is delivered", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });
    await markSessionDelivered(pic, session.id);

    const detail = await sessionDetail(pic, session.id);

    expect(detail?.owed).toEqual([
      { kind: "session-record", personId: pic.id, fullName: "Rina Nurhayati" },
    ]);
  });

  it("stops owing a Session Record once the PIC files one", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });
    await markSessionDelivered(pic, session.id);
    await addSessionRecord({ sessionId: session.id, filedByPersonId: pic.id });

    const detail = await sessionDetail(pic, session.id);

    expect(detail?.owed).toEqual([]);
  });
});

describe("Tandai terlaksana — online", () => {
  beforeEach(resetDatabase);

  async function arrangedOnlineSession() {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });
    return { pic, school, session };
  }

  /**
   * Status only now, for both modes (#152, T3 #153). An online Session names its Pengajar as
   * session-scoped `session_teacher_name` at arrangement and edits them per-item on
   * `/sesi-daring/[id]`, so delivery only flips the status and names no Person per Stream —
   * `session_teacher` is gone entirely.
   */
  it("marks an online Session delivered with status only", async () => {
    const { pic, session } = await arrangedOnlineSession();

    const result = await markSessionDelivered(pic, session.id);

    expect(result).toEqual({ outcome: "delivered" });
    expect(await statusOf(session.id)).toBe("delivered");
  });

  /** `delivered` is terminal, and the second attempt is what proves it. */
  it("refuses to deliver a Session that is already delivered", async () => {
    const { pic, session } = await arrangedOnlineSession();
    await markSessionDelivered(pic, session.id);

    const result = await markSessionDelivered(pic, session.id);

    expect(result).toEqual({ outcome: "not-arranged", status: "delivered" });
  });

  it("refuses to deliver a cancelled Session", async () => {
    const { pic, session } = await arrangedOnlineSession();
    await cancelSession(pic, session.id, "Sekolah meminta penjadwalan ulang");

    const result = await markSessionDelivered(pic, session.id);

    expect(result).toEqual({ outcome: "not-arranged", status: "cancelled" });
  });

  it("refuses a non-Staff caller", async () => {
    const { session } = await arrangedOnlineSession();

    await expect(markSessionDelivered(nonStaff(), session.id)).rejects.toSatisfy(isNotStaffError);
  });
});

describe("Tandai terlaksana — offline", () => {
  beforeEach(resetDatabase);

  async function arrangedOfflineSession() {
    const pic = await staff();
    const school = await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      advanceIdr: 5_000_000,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const session = await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      perjadinId: perjadin.id,
    });
    return { pic, session };
  }

  it("marks an offline Session delivered with status only", async () => {
    const { pic, session } = await arrangedOfflineSession();

    const result = await markSessionDelivered(pic, session.id);

    expect(result).toEqual({ outcome: "delivered" });
    expect(await statusOf(session.id)).toBe("delivered");
  });
});

describe("Batalkan Sesi", () => {
  beforeEach(resetDatabase);

  it("cancels an arranged Session with its reason in the same write", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    const result = await cancelSession(pic, session.id, "Sekolah meminta penjadwalan ulang");

    expect(result.outcome).toBe("cancelled");
    expect(await statusOf(session.id)).toBe("cancelled");
  });

  /**
   * Offered only while `arranged`. Once delivered it happened, and "un-delivering" is a
   * correction rather than a cancellation — conflating the two would put a reason field
   * on an event that already has one.
   */
  it("refuses to cancel a delivered Session", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });
    await markSessionDelivered(pic, session.id);

    const result = await cancelSession(pic, session.id, "Berubah pikiran");

    expect(result).toEqual({ outcome: "not-arranged", status: "delivered" });
    expect(await statusOf(session.id)).toBe("delivered");
  });

  /**
   * `session_cancelled_iff_reason` refuses a cancellation with no reason, so an empty
   * one is caught here rather than reaching the database as an error page.
   */
  it("refuses a blank reason", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    const result = await cancelSession(pic, session.id, "   ");

    expect(result).toEqual({ outcome: "reason-required" });
    expect(await statusOf(session.id)).toBe("arranged");
  });

  it("refuses a non-Staff caller", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    await expect(cancelSession(nonStaff(), session.id, "Tidak jadi")).rejects.toSatisfy(
      isNotStaffError,
    );
  });
});

describe("moving a date", () => {
  beforeEach(resetDatabase);

  it("moves an arranged online Session without demanding a reason", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    const result = await moveSessionDate(pic, session.id, "2026-09-17", "09:00");

    expect(result.outcome).toBe("moved");
    expect(await statusOf(session.id)).toBe("arranged");
  });

  /** Moving a Session is one act: the time moves with the date, in the same dialog (#72). */
  it("moves the start time with the date, in the same write", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      startsAt: "09:00",
      onlinePicPersonId: pic.id,
    });

    expect((await moveSessionDate(pic, session.id, "2026-09-17", "13:30")).outcome).toBe("moved");
    const [after] = await db
      .select({ heldOn: schema.session.heldOn, startsAt: schema.session.startsAt })
      .from(schema.session)
      .where(eq(schema.session.id, session.id));
    expect(after).toEqual({ heldOn: "2026-09-17", startsAt: "13:30:00" });
  });

  /**
   * The per-day index the criterion names, asserted **by name**. Some constraint firing
   * would prove nothing: this row satisfies five CHECKs and a composite foreign key, so
   * a test that only knew it was refused could pass against the wrong rule.
   */
  it("is refused by session_one_online_per_school_per_day when the School is taken that day", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const moving = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });
    await addSession({ schoolId: school.id, heldOn: "2026-09-17", onlinePicPersonId: pic.id });

    const result = await moveSessionDate(pic, moving.id, "2026-09-17", "09:00");

    expect(result).toEqual({
      outcome: "collided",
      constraint: "session_one_online_per_school_per_day",
    });
    // Unmoved, and still arranged — a refused move is not a cancellation.
    const [row] = await db
      .select({ heldOn: schema.session.heldOn })
      .from(schema.session)
      .where(eq(schema.session.id, moving.id));
    expect(row?.heldOn).toBe("2026-09-10");
  });

  /** The index is partial on `status <> 'cancelled'`, so a cancelled row is not in the way. */
  it("moves onto a date whose only other Session was cancelled", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const moving = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });
    await addSession({
      schoolId: school.id,
      heldOn: "2026-09-17",
      onlinePicPersonId: pic.id,
      status: "cancelled",
    });

    expect((await moveSessionDate(pic, moving.id, "2026-09-17", "09:00")).outcome).toBe("moved");
  });

  it("refuses to move a delivered Session", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });
    await markSessionDelivered(pic, session.id);

    expect(await moveSessionDate(pic, session.id, "2026-09-17", "09:00")).toEqual({
      outcome: "not-arranged",
      status: "delivered",
    });
  });

  /**
   * The invariant this ticket states and nothing held before it: an arranged offline
   * Session's `held_on` lies inside its Perjadin's window. No CHECK can carry it — the
   * date range is on another table — so it is held here, beside the write.
   */
  it("refuses to move an offline Session outside its Perjadin's window", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      advanceIdr: 5_000_000,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const session = await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      perjadinId: perjadin.id,
    });

    const result = await moveSessionDate(pic, session.id, "2026-09-09", "09:00");

    expect(result).toEqual({
      outcome: "outside-perjadin",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
  });

  it("moves an offline Session to another day inside the window", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      advanceIdr: 5_000_000,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const session = await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      perjadinId: perjadin.id,
    });

    expect((await moveSessionDate(pic, session.id, "2026-09-03", "09:00")).outcome).toBe("moved");
  });

  /**
   * Both ends of the window are inside it — a trip teaches on the day it arrives and on
   * the day it leaves. Driven through the write rather than against the validator alone,
   * so the boundary is proven where it is actually applied.
   */
  it("counts both ends of the Perjadin's window as inside it", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const perjadin = await addPerjadin({
      picPersonId: pic.id,
      advanceIdr: 5_000_000,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const session = await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      perjadinId: perjadin.id,
    });

    expect((await moveSessionDate(pic, session.id, "2026-09-01", "09:00")).outcome).toBe("moved");
    expect((await moveSessionDate(pic, session.id, "2026-09-03", "09:00")).outcome).toBe("moved");
    // One day outside either end, which is the pair that makes "inclusive" mean something.
    expect((await moveSessionDate(pic, session.id, "2026-08-31", "09:00")).outcome).toBe(
      "outside-perjadin",
    );
    expect((await moveSessionDate(pic, session.id, "2026-09-04", "09:00")).outcome).toBe(
      "outside-perjadin",
    );
  });

  it("refuses a non-Staff caller", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      onlinePicPersonId: pic.id,
    });

    await expect(moveSessionDate(nonStaff(), session.id, "2026-09-17", "09:00")).rejects.toSatisfy(
      isNotStaffError,
    );
  });
});
