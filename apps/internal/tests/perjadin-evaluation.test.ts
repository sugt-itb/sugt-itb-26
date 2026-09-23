import { submitPerjadinEvaluationAction } from "-/app/ep/[token]/actions";
import { resolvePerjadinFeedbackToken } from "-/lib/perjadin-feedback-token";
import { db, schema } from "@sugt/db";
import {
  filePerjadinEvaluation,
  issuePerjadinFeedbackToken,
  type PerjadinEvaluationComments,
  type PerjadinEvaluationRatings,
  type PerjadinToken,
} from "@sugt/db/queries";
import { CONCERN_AT_OR_BELOW } from "@sugt/domain";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addPerjadin,
  addPerjadinFeedbackToken,
  addPerson,
  refusedBy,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The Perjadin Evaluation** — how the trip went, filed **without signing in** through a
 * short-lived token link (ADR-0024). The rules under test are the token's — who mints it, when it
 * dies, that a dead one lets nobody write — and the write's own: a blank name is refused, the
 * per-Aspect elaboration rule holds application-side and behind a CHECK, and `lodging` is nullable,
 * so a day trip with no hotel drops out of the minimum rather than forcing prose or reaching the
 * concerns list. The old Group-member gate and one-per-filer dedup are gone with the sign-in.
 */

/** Any signed-in Person may mint the token. `perjadin_feedback_token.issued_by_person_id` references one. */
async function staff(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

/** A trip to file against. `addPerjadin` builds a PIC-only Group; the filer needs no membership now. */
async function aTrip(picPersonId: string) {
  return addPerjadin({ advanceIdr: 5_000_000, picPersonId });
}

/** The resolved-token caller a public submit is checked against — what the app produces, never a Person. */
const asToken = (perjadinId: string): PerjadinToken => ({ kind: "perjadin", perjadinId });

/** Every Rating comfortably above the threshold — an overnight trip that went well. */
const FINE: PerjadinEvaluationRatings = { lodging: 9, transport: 9, meals: 9, punctuality: 9 };

/** No Komentar on any Aspect — the common case when nothing was Rated low. */
const NO_COMMENTS: PerjadinEvaluationComments = {
  lodging: null,
  transport: null,
  meals: null,
  punctuality: null,
};

/** How many Perjadin Evaluations landed against a trip. */
async function evaluationCount(perjadinId: string) {
  const rows = await db
    .select()
    .from(schema.perjadinEvaluation)
    .where(eq(schema.perjadinEvaluation.perjadinId, perjadinId));
  return rows.length;
}

describe("filePerjadinEvaluation", () => {
  beforeEach(resetDatabase);

  it("files an Evaluation with a self-declared Role and Name", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    const result = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pengajar",
      name: "Pak Andi",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result.outcome).toBe("filed");
    expect(await evaluationCount(trip.id)).toBe(1);
    const [row] = await db
      .select()
      .from(schema.perjadinEvaluation)
      .where(eq(schema.perjadinEvaluation.perjadinId, trip.id));
    expect(row?.filedByRole).toBe("Pengajar");
    expect(row?.filedByName).toBe("Pak Andi");
  });

  it("allows a second Evaluation for the same trip — no dedup any more", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const evaluation = {
      role: "Pimpinan" as const,
      name: "Bu Sri",
      ratings: FINE,
      comments: NO_COMMENTS,
    };

    await filePerjadinEvaluation(asToken(trip.id), evaluation);
    const again = await filePerjadinEvaluation(asToken(trip.id), evaluation);

    expect(again.outcome).toBe("filed");
    expect(await evaluationCount(trip.id)).toBe(2);
  });

  it("files a day trip with no lodging Rating", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    const result = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pendamping",
      name: "Dewi",
      ratings: { ...FINE, lodging: null },
      comments: NO_COMMENTS,
    });

    expect(result.outcome).toBe("filed");
  });

  it("refuses a blank name, and writes nothing", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    const result = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pendamping",
      name: "   ",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "name-required" });
    expect(await evaluationCount(trip.id)).toBe(0);
  });

  it("refuses a Rating of 7 or below with no prose, and writes nothing", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    const result = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pengajar",
      name: "Pak Andi",
      ratings: { ...FINE, transport: 4 },
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "prose-required" });
    expect(await evaluationCount(trip.id)).toBe(0);
  });

  it("files a low Rating once it carries prose", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    const result = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pengajar",
      name: "Pak Andi",
      ratings: { ...FINE, transport: 4 },
      comments: { ...NO_COMMENTS, transport: "Mobil sewaan telat dua jam" },
    });

    expect(result.outcome).toBe("filed");
  });

  it("refuses a low Aspect whose OWN Komentar is blank — a comment on another Aspect does not satisfy it", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    // `transport` is the low Aspect, but the prose sits on `meals`. The per-Aspect rule (#163)
    // refuses it, because a comment about the food cannot explain a low transport score.
    const refused = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pendamping",
      name: "Dewi",
      ratings: { ...FINE, transport: 4 },
      comments: { ...NO_COMMENTS, meals: "Makan siang enak" },
    });

    expect(refused).toEqual({ outcome: "prose-required" });
    expect(await evaluationCount(trip.id)).toBe(0);

    // The same low Aspect, now with its OWN Komentar, files.
    const filed = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pendamping",
      name: "Dewi",
      ratings: { ...FINE, transport: 4 },
      comments: { ...NO_COMMENTS, transport: "Mobil sewaan telat dua jam" },
    });

    expect(filed.outcome).toBe("filed");
    expect(await evaluationCount(trip.id)).toBe(1);
  });
});

describe("issuePerjadinFeedbackToken", () => {
  beforeEach(resetDatabase);

  async function tokenRows(perjadinId: string) {
    return db
      .select()
      .from(schema.perjadinFeedbackToken)
      .where(eq(schema.perjadinFeedbackToken.perjadinId, perjadinId));
  }

  it("issues a token any signed-in Person may mint", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    const result = await issuePerjadinFeedbackToken(pic, trip.id);

    expect(result.outcome).toBe("issued");
    expect((await tokenRows(trip.id)).length).toBe(1);
  });

  it("reissuing replaces the row, so the old token resolves to nothing", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    const first = await issuePerjadinFeedbackToken(pic, trip.id);
    const second = await issuePerjadinFeedbackToken(pic, trip.id);

    expect(second.token).not.toBe(first.token);
    expect((await tokenRows(trip.id)).length).toBe(1);
    expect(await resolvePerjadinFeedbackToken(first.token)).toEqual({ outcome: "gone" });
    expect((await resolvePerjadinFeedbackToken(second.token)).outcome).toBe("open");
  });
});

describe("resolvePerjadinFeedbackToken", () => {
  beforeEach(resetDatabase);

  it("resolves a live token to a perjadin caller and the trip's display info", async () => {
    const pic = await staff();
    const trip = await addPerjadin({
      advanceIdr: 5_000_000,
      picPersonId: pic.id,
      destination: "Kabupaten Sleman",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const token = await addPerjadinFeedbackToken({ perjadinId: trip.id, issuedByPersonId: pic.id });

    const resolved = await resolvePerjadinFeedbackToken(token.token);

    expect(resolved).toEqual({
      outcome: "open",
      caller: { kind: "perjadin", perjadinId: trip.id },
      perjadin: { destination: "Kabupaten Sleman", startsOn: "2026-09-01", endsOn: "2026-09-03" },
    });
  });

  it("is gone for an unknown token", async () => {
    expect(await resolvePerjadinFeedbackToken("no-such-token")).toEqual({ outcome: "gone" });
  });

  it("is gone for an expired token", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const day = 24 * 60 * 60 * 1000;
    const token = await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: pic.id,
      issuedAt: new Date(Date.now() - 20 * day),
      expiresAt: new Date(Date.now() - day),
    });

    expect(await resolvePerjadinFeedbackToken(token.token)).toEqual({ outcome: "gone" });
  });
});

/**
 * The submit Server Action, which is what actually guards the write: it re-resolves the token
 * server-side rather than trusting the page that rendered the form. A form left open past expiry
 * or past a reissue must fail here — the test that would catch a refactor moving resolution to the
 * page alone.
 */
describe("submitPerjadinEvaluationAction", () => {
  beforeEach(resetDatabase);

  async function evaluationRows(perjadinId: string) {
    return db
      .select()
      .from(schema.perjadinEvaluation)
      .where(eq(schema.perjadinEvaluation.perjadinId, perjadinId));
  }

  it("files through a live token", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const token = await addPerjadinFeedbackToken({ perjadinId: trip.id, issuedByPersonId: pic.id });

    const result = await submitPerjadinEvaluationAction(token.token, {
      role: "Pengajar",
      name: "Pak Andi",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result.outcome).toBe("filed");
    expect((await evaluationRows(trip.id)).length).toBe(1);
  });

  it("writes nothing when the token expired after the form was rendered", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const day = 24 * 60 * 60 * 1000;
    const token = await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: pic.id,
      issuedAt: new Date(Date.now() - 20 * day),
      expiresAt: new Date(Date.now() - day),
    });

    const result = await submitPerjadinEvaluationAction(token.token, {
      role: "Pendamping",
      name: "Dewi",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "gone" });
    expect((await evaluationRows(trip.id)).length).toBe(0);
  });

  it("writes nothing through a token a reissue replaced", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const first = await issuePerjadinFeedbackToken(pic, trip.id);
    await issuePerjadinFeedbackToken(pic, trip.id);

    const result = await submitPerjadinEvaluationAction(first.token, {
      role: "Pimpinan",
      name: "Bu Sri",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "gone" });
    expect((await evaluationRows(trip.id)).length).toBe(0);
  });
});

/**
 * The one behaviour `docs/data-model.md` marks load-bearing: **Postgres `least()` ignores NULLs**,
 * so a skipped `lodging` neither trips the elaboration CHECK nor reaches the concerns list. Asserted
 * against the database directly, behind the application half. The direct inserts carry
 * `filed_by_role`/`filed_by_name` now (ADR-0024), no `filed_by_person_id`.
 */
describe("the nullable lodging invariant", () => {
  beforeEach(resetDatabase);

  async function aTripToFileAgainst() {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    return trip;
  }

  it("accepts a null lodging with every other Rating high and no prose", async () => {
    const trip = await aTripToFileAgainst();

    const [row] = await db
      .insert(schema.perjadinEvaluation)
      .values({
        perjadinId: trip.id,
        filedByRole: "Pengajar",
        filedByName: "Pak Andi",
        lodging: null,
        transport: 9,
        meals: 9,
        punctuality: 9,
      })
      .returning({ id: schema.perjadinEvaluation.id });

    expect(row?.id).toBeDefined();
  });

  it("still refuses a low non-null Rating with no prose when lodging is null", async () => {
    const trip = await aTripToFileAgainst();

    const refusal = await refusedBy(
      db.insert(schema.perjadinEvaluation).values({
        perjadinId: trip.id,
        filedByRole: "Pengajar",
        filedByName: "Pak Andi",
        lodging: null,
        transport: 4,
        meals: 9,
        punctuality: 9,
      }),
    );

    expect(refusal).toBe("perjadin_evaluation_low_rating_needs_prose");
  });

  it("keeps a null-lodging row off the concerns list — least() over its Ratings is not low", async () => {
    const trip = await aTripToFileAgainst();

    await db.insert(schema.perjadinEvaluation).values({
      perjadinId: trip.id,
      filedByRole: "Pendamping",
      filedByName: "Dewi",
      lodging: null,
      transport: 9,
      meals: 9,
      punctuality: 9,
    });

    // The predicate the concerns index carries, read back against the row, with the threshold from
    // the same constant the schema's index does. A skipped lodging does not drag the minimum to a
    // concern.
    const [row] = await db
      .select({
        concern: sql<boolean>`least(
          ${schema.perjadinEvaluation.lodging},
          ${schema.perjadinEvaluation.transport},
          ${schema.perjadinEvaluation.meals},
          ${schema.perjadinEvaluation.punctuality}
        ) <= ${CONCERN_AT_OR_BELOW}`,
      })
      .from(schema.perjadinEvaluation)
      .where(eq(schema.perjadinEvaluation.perjadinId, trip.id));

    expect(row?.concern).toBe(false);
  });

  it("refuses a filed_by_role outside the three allowed values", async () => {
    const trip = await aTripToFileAgainst();

    const refusal = await refusedBy(
      db.insert(schema.perjadinEvaluation).values({
        perjadinId: trip.id,
        // Not one of Pengajar / Pendamping / Pimpinan — the CHECK refuses it (ADR-0024).
        filedByRole: "Staff" as never,
        filedByName: "Pak Andi",
        lodging: 9,
        transport: 9,
        meals: 9,
        punctuality: 9,
      }),
    );

    expect(refusal).toBe("perjadin_evaluation_filed_by_role_check");
  });
});
