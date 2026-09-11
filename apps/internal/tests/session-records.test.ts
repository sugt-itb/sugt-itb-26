import { db, schema } from "@sugt/db";
import { fileSessionRecord, isNotStaffError, type SessionRecordRatings } from "@sugt/db/queries";
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
 * **The PIC's Session Record**, the one internal evaluation form still filed.
 *
 * The Teaching Team member's Class Record went with `session_teacher` and the Teaching Team
 * Role (T3, #153): no Person can be Teaching Team, so the `class_record` composite foreign key
 * — pinned to `filed_by_role = 'Teaching Team'` — can never be satisfied, and Class Records are
 * deferred for both modes. `fileClassRecord` was removed with them, so this file is the Session
 * Record alone now.
 *
 * Every rule under test is one about *state* or about a row, never about markup: prose is
 * mandatory below the threshold, a Record is owed only on a delivered Session, only Staff may
 * file one, and each filer files at most one per Session. A test through the form would pass
 * against a write that checked none of them, so long as the form declined to offer the button —
 * so these drive the write function against a real Postgres and assert on what came back and
 * what landed.
 *
 * **The elaboration rule is enforced twice**, so it is checked twice here: once as the value
 * the application half returns, and once as the CHECK the database holds behind it.
 */

/** The Staff Person who is PIC of the Sessions below. */
async function staff(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the Staff-only write still has to reject
 * a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the row. The
 * cast through `unknown` is the only way to name a role the type no longer admits.
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

/** One School to hang Sessions off. */
async function oneSchool() {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  return addSchool({
    slug: "sman-1-bandung",
    name: "SMAN 1 Bandung",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
}

/** A delivered online Session, which is the cheap one — no Perjadin, just a School and a PIC. */
async function deliveredSession(picPersonId: string) {
  const school = await oneSchool();
  return addSession({
    schoolId: school.id,
    heldOn: "2026-09-10",
    status: "delivered",
    onlinePicPersonId: picPersonId,
  });
}

const FINE_SESSION: SessionRecordRatings = {
  facilities: 9,
  turnout: 9,
  school_support: 9,
  timing: 9,
  coordination: 9,
};

describe("fileSessionRecord", () => {
  beforeEach(resetDatabase);

  /** How many Session Records landed against a Session. */
  async function sessionRecordCount(sessionId: string) {
    const rows = await db
      .select()
      .from(schema.sessionRecord)
      .where(eq(schema.sessionRecord.sessionId, sessionId));
    return rows.length;
  }

  it("files a Session Record on a delivered Session by Staff", async () => {
    const pic = await staff();
    const session = await deliveredSession(pic.id);

    const result = await fileSessionRecord(pic, {
      sessionId: session.id,
      ratings: FINE_SESSION,
      problems: null,
      suggestions: null,
    });

    expect(result.outcome).toBe("filed");
    expect(await sessionRecordCount(session.id)).toBe(1);
  });

  it("refuses a Rating of 7 or below with no prose, and writes nothing", async () => {
    const pic = await staff();
    const session = await deliveredSession(pic.id);

    const result = await fileSessionRecord(pic, {
      sessionId: session.id,
      ratings: { ...FINE_SESSION, turnout: 3 },
      problems: null,
      suggestions: null,
    });

    expect(result).toEqual({ outcome: "prose-required" });
    expect(await sessionRecordCount(session.id)).toBe(0);
  });

  it("refuses a Record on a Session that is not delivered", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const session = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      status: "arranged",
      onlinePicPersonId: pic.id,
    });

    const result = await fileSessionRecord(pic, {
      sessionId: session.id,
      ratings: FINE_SESSION,
      problems: null,
      suggestions: null,
    });

    expect(result).toEqual({ outcome: "session-not-delivered", status: "arranged" });
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const pic = await staff();
    const session = await deliveredSession(pic.id);

    const refusal = await fileSessionRecord(nonStaff(), {
      sessionId: session.id,
      ratings: FINE_SESSION,
      problems: null,
      suggestions: null,
    }).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
    expect(await sessionRecordCount(session.id)).toBe(0);
  });

  it("refuses a second Record from the same Staff member for the same Session", async () => {
    const pic = await staff();
    const session = await deliveredSession(pic.id);
    const record = {
      sessionId: session.id,
      ratings: FINE_SESSION,
      problems: null,
      suggestions: null,
    };

    await fileSessionRecord(pic, record);
    const again = await fileSessionRecord(pic, record);

    expect(again).toEqual({ outcome: "already-filed" });
    expect(await sessionRecordCount(session.id)).toBe(1);
  });

  it("the database CHECK refuses a low Rating with no prose, behind the application half", async () => {
    const pic = await staff();
    const session = await deliveredSession(pic.id);

    const refusal = await refusedBy(
      db.insert(schema.sessionRecord).values({
        sessionId: session.id,
        filedByPersonId: pic.id,
        filedByRole: "Staff",
        facilities: FINE_SESSION.facilities,
        turnout: 3,
        schoolSupport: FINE_SESSION.school_support,
        timing: FINE_SESSION.timing,
        coordination: FINE_SESSION.coordination,
        problems: null,
      }),
    );

    expect(refusal).toBe("session_record_low_rating_needs_prose");
  });
});
