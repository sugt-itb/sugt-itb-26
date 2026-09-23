import { submitFeedbackAction } from "-/app/f/[token]/actions";
import { resolveFeedbackToken } from "-/lib/feedback-token";
import { db, schema } from "@sugt/db";
import {
  cancelSession,
  issueFeedbackToken,
  submitParticipantFeedback,
  type ParticipantFeedbackComments,
  type ParticipantFeedbackRatings,
} from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addFeedbackToken,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Participant Feedback** — the token a Session hands out, the resolution that turns it into a
 * caller, and the one write it authorises. This is the only write path in either app with no
 * signed-in Person, so the rules under test are all about the token: who may mint it, when it
 * dies, and that a dead one lets nobody write.
 */

async function staff(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

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

async function aSession(
  picPersonId: string,
  status: "arranged" | "delivered" | "cancelled" = "arranged",
) {
  const school = await oneSchool();
  return addSession({
    schoolId: school.id,
    heldOn: "2026-09-10",
    status,
  });
}

const FINE: ParticipantFeedbackRatings = { materials: 9, instructor: 9, relevance: 9 };

/** No comment on any Aspect — the common case, a Participant owing none. */
const NO_COMMENTS: ParticipantFeedbackComments = {
  materials: null,
  instructor: null,
  relevance: null,
};

async function tokenRows(sessionId: string) {
  return db
    .select()
    .from(schema.sessionFeedbackToken)
    .where(eq(schema.sessionFeedbackToken.sessionId, sessionId));
}

async function feedbackRows(sessionId: string) {
  return db
    .select()
    .from(schema.participantFeedback)
    .where(eq(schema.participantFeedback.sessionId, sessionId));
}

describe("issueFeedbackToken", () => {
  beforeEach(resetDatabase);

  it("issues a token on an arranged Session", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "arranged");

    const result = await issueFeedbackToken(pic, session.id);

    expect(result.outcome).toBe("issued");
    expect((await tokenRows(session.id)).length).toBe(1);
  });

  it("issues a token on a delivered Session", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");

    const result = await issueFeedbackToken(pic, session.id);

    expect(result.outcome).toBe("issued");
  });

  // The former "lets anyone signed in issue it, not only Staff" test is gone: `issueFeedbackToken`
  // still skips `requireStaff` (it is deliberately open to any signed-in caller), but it writes
  // `caller.id` as `issued_by_person_id`, a foreign key into `person`. T3 (#153) retired the one
  // non-Staff Role, so there is no non-Staff Person to issue a token as — a cast caller would fail
  // the foreign key rather than exercise the guard, so the non-Staff dimension is no longer
  // expressible. The open path stays covered by the Staff issuers above.

  it("refuses a cancelled Session, and writes no token", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "cancelled");

    const result = await issueFeedbackToken(pic, session.id);

    expect(result).toEqual({ outcome: "session-cancelled" });
    expect((await tokenRows(session.id)).length).toBe(0);
  });

  it("reissuing replaces the row, so the old token resolves to nothing", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "arranged");

    const first = await issueFeedbackToken(pic, session.id);
    const second = await issueFeedbackToken(pic, session.id);

    expect(first.outcome).toBe("issued");
    expect(second.outcome).toBe("issued");
    if (first.outcome !== "issued" || second.outcome !== "issued") throw new Error("unreachable");

    expect(second.token).not.toBe(first.token);
    expect((await tokenRows(session.id)).length).toBe(1);
    expect(await resolveFeedbackToken(first.token)).toEqual({ outcome: "gone" });
    expect((await resolveFeedbackToken(second.token)).outcome).toBe("open");
  });
});

describe("resolveFeedbackToken", () => {
  beforeEach(resetDatabase);

  it("resolves a live token to a participant caller for its Session", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");
    const token = await addFeedbackToken({ sessionId: session.id, issuedByPersonId: pic.id });

    const resolved = await resolveFeedbackToken(token.token);

    expect(resolved).toEqual({
      outcome: "open",
      caller: { kind: "participant", sessionId: session.id },
    });
  });

  it("is gone for an unknown token", async () => {
    expect(await resolveFeedbackToken("no-such-token")).toEqual({ outcome: "gone" });
  });

  it("is gone for an expired token", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");
    const day = 24 * 60 * 60 * 1000;
    const token = await addFeedbackToken({
      sessionId: session.id,
      issuedByPersonId: pic.id,
      issuedAt: new Date(Date.now() - 2 * day),
      expiresAt: new Date(Date.now() - day),
    });

    expect(await resolveFeedbackToken(token.token)).toEqual({ outcome: "gone" });
  });

  it("is gone for a cancelled Session's token", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "arranged");
    const token = await addFeedbackToken({ sessionId: session.id, issuedByPersonId: pic.id });
    await cancelSession(pic, session.id, "Sekolah meminta penjadwalan ulang");

    expect(await resolveFeedbackToken(token.token)).toEqual({ outcome: "gone" });
  });
});

describe("submitParticipantFeedback", () => {
  beforeEach(resetDatabase);

  it("inserts one feedback row for the token's Session", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");

    const result = await submitParticipantFeedback(
      { kind: "participant", sessionId: session.id },
      {
        classKind: "Student",
        name: "Siti",
        ratings: FINE,
        comments: { materials: "Bahannya lengkap", instructor: "Seru sekali", relevance: null },
      },
    );

    expect(result).toEqual({ outcome: "submitted" });
    const rows = await feedbackRows(session.id);
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe("Siti");
    // Each comment lands against its own Aspect, and a blank one stays null.
    expect(rows[0]?.materialsComment).toBe("Bahannya lengkap");
    expect(rows[0]?.instructorComment).toBe("Seru sekali");
    expect(rows[0]?.relevanceComment).toBeNull();
  });

  it("stores a blank per-Aspect comment as null", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");

    await submitParticipantFeedback(
      { kind: "participant", sessionId: session.id },
      {
        classKind: "GTK",
        name: "Budi",
        ratings: FINE,
        comments: { materials: "   ", instructor: null, relevance: "  " },
      },
    );

    const rows = await feedbackRows(session.id);
    expect(rows[0]?.materialsComment).toBeNull();
    expect(rows[0]?.instructorComment).toBeNull();
    expect(rows[0]?.relevanceComment).toBeNull();
  });

  it("refuses a blank name, and writes nothing", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");

    const result = await submitParticipantFeedback(
      { kind: "participant", sessionId: session.id },
      { classKind: "MS", name: "   ", ratings: FINE, comments: NO_COMMENTS },
    );

    expect(result).toEqual({ outcome: "name-required" });
    expect((await feedbackRows(session.id)).length).toBe(0);
  });

  it("keeps no elaboration rule — a low Rating with no comment still submits", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");

    const result = await submitParticipantFeedback(
      { kind: "participant", sessionId: session.id },
      {
        classKind: "Student",
        name: "Ayu",
        ratings: { ...FINE, instructor: 2 },
        comments: NO_COMMENTS,
      },
    );

    expect(result).toEqual({ outcome: "submitted" });
    expect((await feedbackRows(session.id)).length).toBe(1);
  });
});

/**
 * The submit Server Action, which is what actually guards the write: it re-resolves the token
 * server-side rather than trusting the page that rendered the form. A form left open past expiry
 * or past a reissue must fail here — this is the test that would catch a refactor moving
 * resolution to the page alone.
 */
describe("submitFeedbackAction", () => {
  beforeEach(resetDatabase);

  it("inserts through a live token", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");
    const token = await addFeedbackToken({ sessionId: session.id, issuedByPersonId: pic.id });

    const result = await submitFeedbackAction(token.token, {
      classKind: "GTK",
      name: "Budi",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "submitted" });
    expect((await feedbackRows(session.id)).length).toBe(1);
  });

  it("writes nothing when the token expired after the form was rendered", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "delivered");
    const day = 24 * 60 * 60 * 1000;
    const token = await addFeedbackToken({
      sessionId: session.id,
      issuedByPersonId: pic.id,
      issuedAt: new Date(Date.now() - 2 * day),
      expiresAt: new Date(Date.now() - day),
    });

    const result = await submitFeedbackAction(token.token, {
      classKind: "Student",
      name: "Siti",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "gone" });
    expect((await feedbackRows(session.id)).length).toBe(0);
  });

  it("writes nothing through a token a reissue replaced", async () => {
    const pic = await staff();
    const session = await aSession(pic.id, "arranged");
    const first = await issueFeedbackToken(pic, session.id);
    if (first.outcome !== "issued") throw new Error("unreachable");
    await issueFeedbackToken(pic, session.id);

    const result = await submitFeedbackAction(first.token, {
      classKind: "Student",
      name: "Siti",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "gone" });
    expect((await feedbackRows(session.id)).length).toBe(0);
  });
});
