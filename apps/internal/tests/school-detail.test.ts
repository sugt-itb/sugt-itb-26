import { schoolDetail } from "@sugt/db/queries";
import { CONCERN_AT_OR_BELOW, type Role } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addParticipantFeedback,
  addPerjadin,
  addProvince,
  addSchool,
  addSession,
  addSessionRecord,
  resetDatabase,
} from "./support/fixtures";
import { signInAsPerson } from "./support/sign-in";

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but `schoolDetail` is open to any signed-in
 * caller (it reads delivery data, not money, ADR-0004; its `_caller` is ignored), and this proves
 * the surface is not Staff-gated. The cast through `unknown` names a role the type no longer admits.
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
 * **Detail Sekolah** — one School's Sessions, how many are delivered against the ten
 * it expects, and which of them carry a concern.
 *
 * The concern assertions are the reason this file is long. A Session's Ratings come
 * from three tables with three different rubrics, and the Aspect names are read out of
 * `@sugt/domain` and used as **column names** — so a name that has drifted from its
 * column fails at runtime and nowhere else. Every *fillable* source therefore gets a test, and
 * `school_support` gets its own, because it is the one Aspect whose column name and
 * Drizzle property differ.
 *
 * The third table, `class_record`, is a dead surface since T3 (#153): no Person can be Teaching
 * Team, so its `filed_by_role = 'Teaching Team'` composite foreign key can never be satisfied and
 * no Class Record can be filed. The query still reads it — it just finds nothing — so the tests
 * below flag Sessions off Participant Feedback and the PIC's Session Record, the two forms that
 * can still land.
 */
describe("the Detail Sekolah payload", () => {
  beforeEach(resetDatabase);

  /** A Staff Person, signed in for real. Online Sessions need one as their PIC. */
  const signInAsStaff = () => signInAsPerson("Staff", "rina@ditsama.itb.ac.id", "Rina Nurhayati");

  /** One School with a Session of every status, and a second School to leak from. */
  async function seedOneSchool(picPersonId: string) {
    await addProvince("JB", "Jawa Barat");
    const cluster = await addCluster({
      slug: "alpha",
      name: "Cluster Alpha",
      topic: "Mitigasi Bencana",
    });
    const school = await addSchool({
      slug: "sman-1-bandung",
      name: "SMAN 1 Bandung",
      clusterId: cluster.id,
      provinceCode: "JB",
    });
    const neighbour = await addSchool({
      slug: "sman-2-bandung",
      name: "SMAN 2 Bandung",
      clusterId: cluster.id,
      provinceCode: "JB",
    });

    // Offline Sessions need a Perjadin: an offline Session has one and an online
    // Session has none, in both directions, by CHECK. `heldOn` sits inside the Perjadin's
    // dates, which is the application's rule rather than the schema's.
    const perjadin = await addPerjadin({ advanceIdr: 5_000_000, picPersonId });
    const onSite = await addOfflineSession({
      schoolId: school.id,
      heldOn: "2026-09-02",
      status: "delivered",
      perjadinId: perjadin.id,
    });

    const online = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-10",
      status: "delivered",
      onlinePicPersonId: picPersonId,
    });
    const upcoming = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-17",
      status: "arranged",
      onlinePicPersonId: picPersonId,
    });
    const calledOff = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-24",
      status: "cancelled",
      onlinePicPersonId: picPersonId,
    });

    return { cluster, school, neighbour, onSite, online, upcoming, calledOff };
  }

  it("returns the School, where it sits, and its Cluster", async () => {
    const person = await signInAsStaff();
    await seedOneSchool(person.id);

    await expect(schoolDetail(person, "sman-1-bandung")).resolves.toMatchObject({
      name: "SMAN 1 Bandung",
      kabupatenKota: "Kota Bandung",
      clusterName: "Cluster Alpha",
    });
  });

  it("lists the School's Sessions in date order, with mode, date and status", async () => {
    const person = await signInAsStaff();
    await seedOneSchool(person.id);

    const detail = await schoolDetail(person, "sman-1-bandung");

    expect(
      detail?.sessions.map((session) => [session.heldOn, session.mode, session.status]),
    ).toEqual([
      ["2026-09-02", "offline", "delivered"],
      ["2026-09-10", "online", "delivered"],
      ["2026-09-17", "online", "arranged"],
      ["2026-09-24", "online", "cancelled"],
    ]);
  });

  it("counts delivered Sessions only — arranged and cancelled count for nothing", async () => {
    const person = await signInAsStaff();
    await seedOneSchool(person.id);

    const detail = await schoolDetail(person, "sman-1-bandung");

    // Four Sessions: two delivered, one arranged, one cancelled.
    expect(detail?.deliveredSessions).toBe(2);
  });

  it("keeps a cancelled Session visible, carrying the reason it was called off", async () => {
    const person = await signInAsStaff();
    const { calledOff } = await seedOneSchool(person.id);

    const detail = await schoolDetail(person, "sman-1-bandung");
    const cancelled = detail?.sessions.find((session) => session.id === calledOff.id);

    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancelledReason: "Sekolah meminta penjadwalan ulang",
    });
  });

  it("returns a School nobody has reached yet, with no Sessions and nothing delivered", async () => {
    /**
     * The School with no Sessions at all is one a reader looks for, so it must not be
     * filtered out. It would be, were the Session join an inner one.
     */
    const person = await signInAsStaff();
    await seedOneSchool(person.id);

    await expect(schoolDetail(person, "sman-2-bandung")).resolves.toMatchObject({
      name: "SMAN 2 Bandung",
      deliveredSessions: 0,
      sessions: [],
    });
  });

  it("does not reach into another School's Sessions", async () => {
    const person = await signInAsStaff();
    const { neighbour } = await seedOneSchool(person.id);
    await addSession({
      schoolId: neighbour.id,
      heldOn: "2026-09-03",
      status: "delivered",
      onlinePicPersonId: person.id,
    });

    const detail = await schoolDetail(person, "sman-1-bandung");

    expect(detail?.sessions).toHaveLength(4);
    expect(detail?.deliveredSessions).toBe(2);
  });

  it("returns null for a slug that names no School", async () => {
    const person = await signInAsStaff();
    await seedOneSchool(person.id);

    await expect(schoolDetail(person, "sman-99-entah-di-mana")).resolves.toBeNull();
  });

  it("flags a Session on Participant Feedback, naming the Aspect that was Rated low", async () => {
    const person = await signInAsStaff();
    const { online } = await seedOneSchool(person.id);
    await addParticipantFeedback({
      sessionId: online.id,
      classKind: "Student",
      ratings: { instructor: 3 },
    });

    const detail = await schoolDetail(person, "sman-1-bandung");
    const flagged = detail?.sessions.find((session) => session.id === online.id);

    expect(flagged?.concern).toEqual({ aspect: "instructor", rating: 3 });
  });

  it("flags a Session on a Session Record, including the Aspect whose column is two words", async () => {
    /**
     * `school_support` is the one Aspect whose `@sugt/domain` name and Drizzle property
     * differ. The query reads the domain name as a column name, so this is where that
     * would break.
     */
    const person = await signInAsStaff();
    const { online } = await seedOneSchool(person.id);
    await addSessionRecord({
      sessionId: online.id,
      filedByPersonId: person.id,
      ratings: { schoolSupport: 6 },
    });

    const detail = await schoolDetail(person, "sman-1-bandung");
    const flagged = detail?.sessions.find((session) => session.id === online.id);

    expect(flagged?.concern).toEqual({ aspect: "school_support", rating: 6 });
  });

  it("flags a Rating of exactly the threshold, and leaves the one above it alone", async () => {
    /**
     * The criterion is *"a Rating of 7 or below"*, so the threshold itself is inside the
     * net. Both sides are asserted in one test because it is the pair that pins the
     * comparison down: a `<` where the code says `<=` passes every other assertion in
     * this file, which uses 3, 4, 5, 6 and 9 and never touches the boundary.
     */
    const person = await signInAsStaff();
    const { onSite, online } = await seedOneSchool(person.id);

    await addParticipantFeedback({
      sessionId: onSite.id,
      classKind: "Student",
      ratings: { relevance: CONCERN_AT_OR_BELOW },
    });
    await addParticipantFeedback({
      sessionId: online.id,
      classKind: "Student",
      ratings: { relevance: CONCERN_AT_OR_BELOW + 1 },
    });

    const detail = await schoolDetail(person, "sman-1-bandung");
    const atTheThreshold = detail?.sessions.find((session) => session.id === onSite.id);
    const justAbove = detail?.sessions.find((session) => session.id === online.id);

    expect(atTheThreshold?.concern).toEqual({ aspect: "relevance", rating: CONCERN_AT_OR_BELOW });
    expect(justAbove).toMatchObject({ ratingsFiled: 3, concern: null });
  });

  it("takes the lowest Rating on a Session, whichever source it came from", async () => {
    /**
     * One low Rating is the signal and is never averaged away, so what a reader is
     * shown is the worst one anybody filed — here the PIC's Session Record 4 rather than the
     * room's 6. Class Records once made a third source, but no Person can file one now (T3, #153),
     * so the worst-of-all is proven across the two forms that can still land.
     */
    const person = await signInAsStaff();
    const { online } = await seedOneSchool(person.id);
    await addParticipantFeedback({
      sessionId: online.id,
      classKind: "Student",
      ratings: { materials: 6 },
    });
    await addSessionRecord({
      sessionId: online.id,
      filedByPersonId: person.id,
      ratings: { facilities: 4 },
    });

    const detail = await schoolDetail(person, "sman-1-bandung");
    const flagged = detail?.sessions.find((session) => session.id === online.id);

    expect(flagged?.concern).toEqual({ aspect: "facilities", rating: 4 });
  });

  it("separates a Session Rated well from one nobody has filed anything about", async () => {
    /**
     * Two states the screen must not conflate. Nothing is required and nothing is
     * blocked (ADR-0009), so a delivered Session with no records at all is ordinary —
     * and saying "no concern" about it would report a judgement nobody made.
     */
    const person = await signInAsStaff();
    const { onSite, online } = await seedOneSchool(person.id);
    await addSessionRecord({ sessionId: onSite.id, filedByPersonId: person.id });

    const detail = await schoolDetail(person, "sman-1-bandung");
    const rated = detail?.sessions.find((session) => session.id === onSite.id);
    const silent = detail?.sessions.find((session) => session.id === online.id);

    expect(rated).toMatchObject({ ratingsFiled: 5, concern: null });
    expect(silent).toMatchObject({ ratingsFiled: 0, concern: null });
  });

  it("is open to a non-Staff caller, who reads the same payload", async () => {
    const staff = await signInAsStaff();
    const { online } = await seedOneSchool(staff.id);
    await addParticipantFeedback({
      sessionId: online.id,
      classKind: "Student",
      ratings: { relevance: 5 },
    });

    // `schoolDetail` ignores its caller's role — a hand-built non-Staff caller reads exactly what
    // Staff does. No such Person exists in the database since T3 (#153), so the caller is cast.
    await expect(schoolDetail(nonStaff(), "sman-1-bandung")).resolves.toEqual(
      await schoolDetail(staff, "sman-1-bandung"),
    );
  });
});
