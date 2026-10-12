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
  addSchoolOnTrip,
  addPerson,
  refusedBy,
  resetDatabase,
} from "./support/fixtures";
import { overlappingAtInsert } from "./support/overlap";

/**
 * **The Perjadin Evaluation** — how the trip went, filed **without signing in** through a
 * token link (ADR-0024). The rules under test are the token's — who mints it, that it is never
 * replaced and never expires (ADR-0049), that a dead one lets nobody write — and the write's own:
 * a blank name is refused, the per-Aspect elaboration rule holds application-side and behind a
 * CHECK, and `lodging` is nullable, so a day trip with no hotel drops out of the minimum rather
 * than forcing prose or reaching the concerns list. The old Group-member gate and one-per-filer dedup are gone with the sign-in.
 */

/** Any signed-in Person may mint the token. `perjadin_feedback_token.issued_by_person_id` references one. */
async function staff(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

/** A trip to file against. `addPerjadin` builds a PIC-only Group; the filer needs no membership now. */
async function aTrip(picPersonId: string) {
  return addPerjadin({ picPersonId });
}

/** The resolved-token caller a public submit is checked against — what the app produces, never a Person. */
const asToken = (perjadinId: string): PerjadinToken => ({ kind: "perjadin", perjadinId });

/**
 * Every Rating comfortably above the threshold — an overnight trip that went well, as a Narasumber
 * or a Pimpinan files it: Pendamping Support included.
 */
const FINE: PerjadinEvaluationRatings = {
  lodging: 9,
  transport: 9,
  meals: 9,
  punctuality: 9,
  pendamping_support: 9,
};

/** The same trip as a Pendamping files it: not asked Pendamping Support (ADR-0054). */
const FINE_FROM_PENDAMPING: PerjadinEvaluationRatings = { ...FINE, pendamping_support: null };

/** No Komentar on any Aspect — the common case when nothing was Rated low. */
const NO_COMMENTS: PerjadinEvaluationComments = {
  lodging: null,
  transport: null,
  meals: null,
  punctuality: null,
  pendamping_support: null,
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
      role: "Narasumber",
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
    expect(row?.filedByRole).toBe("Narasumber");
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
      ratings: { ...FINE_FROM_PENDAMPING, lodging: null },
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
      ratings: FINE_FROM_PENDAMPING,
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "name-required" });
    expect(await evaluationCount(trip.id)).toBe(0);
  });

  it("refuses a Rating of 7 or below with no prose, and writes nothing", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);

    const result = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Narasumber",
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
      role: "Narasumber",
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
      ratings: { ...FINE_FROM_PENDAMPING, transport: 4 },
      comments: { ...NO_COMMENTS, meals: "Makan siang enak" },
    });

    expect(refused).toEqual({ outcome: "prose-required" });
    expect(await evaluationCount(trip.id)).toBe(0);

    // The same low Aspect, now with its OWN Komentar, files.
    const filed = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pendamping",
      name: "Dewi",
      ratings: { ...FINE_FROM_PENDAMPING, transport: 4 },
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

  it("a second press returns the same link, so the shared one keeps working", async () => {
    const pic = await staff();
    const colleague = await staff("dewi@ditsama.itb.ac.id");
    const trip = await aTrip(pic.id);

    const first = await issuePerjadinFeedbackToken(pic, trip.id);
    const second = await issuePerjadinFeedbackToken(colleague, trip.id);

    expect(second).toEqual(first);
    expect((await tokenRows(trip.id)).length).toBe(1);
    expect((await resolvePerjadinFeedbackToken(first.token)).outcome).toBe("open");
  });

  it("two presses at the same moment get the same link, and one row", async () => {
    const pic = await staff();
    const colleague = await staff("dewi@ditsama.itb.ac.id");
    const trip = await aTrip(pic.id);

    const presses = await overlappingAtInsert("perjadin_feedback_token", [
      () => issuePerjadinFeedbackToken(pic, trip.id),
      () => issuePerjadinFeedbackToken(colleague, trip.id),
      () => issuePerjadinFeedbackToken(pic, trip.id),
    ]);

    expect(new Set(presses.map((p) => p.token)).size).toBe(1);
    expect((await tokenRows(trip.id)).length).toBe(1);
  });

  it("returns the original of several links — the earliest issued, then the lowest token", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const day = 24 * 60 * 60 * 1000;
    const issuedAt = new Date(Date.now() - 10 * day);
    // Two issued in the same instant, and one reattached today by `db:reattach-links`.
    await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: pic.id,
      token: "b0000000-0000-4000-8000-000000000000",
      issuedAt,
    });
    await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: pic.id,
      token: "a0000000-0000-4000-8000-000000000000",
      issuedAt,
    });
    await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: pic.id,
      token: "00000000-0000-4000-8000-000000000000",
    });

    expect(await issuePerjadinFeedbackToken(pic, trip.id)).toEqual({
      outcome: "issued",
      token: "a0000000-0000-4000-8000-000000000000",
    });
    expect((await tokenRows(trip.id)).length).toBe(3);
  });
});

describe("resolvePerjadinFeedbackToken", () => {
  beforeEach(resetDatabase);

  it("resolves a live token to a perjadin caller and the trip's display info", async () => {
    const pic = await staff();
    const trip = await addPerjadin({
      picPersonId: pic.id,
      subClusterName: "Kelompok 3",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    await addSchoolOnTrip({ perjadin: trip, name: "SMAN 1 Sleman" });
    const token = await addPerjadinFeedbackToken({ perjadinId: trip.id, issuedByPersonId: pic.id });

    const resolved = await resolvePerjadinFeedbackToken(token.token);

    expect(resolved).toEqual({
      outcome: "open",
      caller: { kind: "perjadin", perjadinId: trip.id },
      perjadin: {
        subClusterName: "Kelompok 3",
        startsOn: "2026-09-01",
        endsOn: "2026-09-03",
        schoolNames: ["SMAN 1 Sleman"],
      },
    });
  });

  it("is gone for an unknown token", async () => {
    expect(await resolvePerjadinFeedbackToken("no-such-token")).toEqual({ outcome: "gone" });
  });

  it("still resolves a token issued months ago — a link never expires", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const day = 24 * 60 * 60 * 1000;
    const token = await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: pic.id,
      issuedAt: new Date(Date.now() - 400 * day),
    });

    expect(await resolvePerjadinFeedbackToken(token.token)).toMatchObject({
      outcome: "open",
      caller: { kind: "perjadin", perjadinId: trip.id },
    });
  });
});

/**
 * The submit Server Action, which is what actually guards the write: it re-resolves the token
 * server-side rather than trusting the page that rendered the form. A form left open while its link
 * is removed by hand in the database (ADR-0049's only remedy for a leaked link) must fail here —
 * the test that would catch a refactor moving resolution to the page alone.
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
      role: "Narasumber",
      name: "Pak Andi",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result.outcome).toBe("filed");
    expect((await evaluationRows(trip.id)).length).toBe(1);
  });

  it("files through a token issued weeks ago", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const day = 24 * 60 * 60 * 1000;
    const token = await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: pic.id,
      issuedAt: new Date(Date.now() - 30 * day),
    });

    const result = await submitPerjadinEvaluationAction(token.token, {
      role: "Pendamping",
      name: "Dewi",
      ratings: FINE_FROM_PENDAMPING,
      comments: NO_COMMENTS,
    });

    expect(result.outcome).toBe("filed");
    expect((await evaluationRows(trip.id)).length).toBe(1);
  });

  it("files through each of a trip's several links against that trip", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const otherTrip = await aTrip(pic.id);
    const issued = await issuePerjadinFeedbackToken(pic, trip.id);
    const reattached = await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: pic.id,
    });
    await addPerjadinFeedbackToken({ perjadinId: otherTrip.id, issuedByPersonId: pic.id });

    for (const [token, name] of [
      [issued.token, "Pak Andi"],
      [reattached.token, "Bu Sri"],
    ] as const) {
      expect(await resolvePerjadinFeedbackToken(token)).toMatchObject({
        outcome: "open",
        caller: { kind: "perjadin", perjadinId: trip.id },
      });
      const result = await submitPerjadinEvaluationAction(token, {
        role: "Narasumber",
        name,
        ratings: FINE,
        comments: NO_COMMENTS,
      });
      expect(result.outcome).toBe("filed");
    }

    expect((await evaluationRows(trip.id)).map((row) => row.filedByName).sort()).toEqual([
      "Bu Sri",
      "Pak Andi",
    ]);
    expect(await evaluationRows(otherTrip.id)).toEqual([]);
  });

  it("writes nothing through a link removed by hand after the form was rendered", async () => {
    const pic = await staff();
    const trip = await aTrip(pic.id);
    const first = await issuePerjadinFeedbackToken(pic, trip.id);
    await db
      .delete(schema.perjadinFeedbackToken)
      .where(eq(schema.perjadinFeedbackToken.token, first.token));

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
        filedByRole: "Narasumber",
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
        filedByRole: "Narasumber",
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
        // Not one of Narasumber / Pendamping / Pimpinan — the CHECK refuses it (ADR-0024).
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

  it("refuses the retired role value 'Pengajar' — it is Narasumber now (#393)", async () => {
    const trip = await aTripToFileAgainst();

    const refusal = await refusedBy(
      db.insert(schema.perjadinEvaluation).values({
        perjadinId: trip.id,
        filedByRole: "Pengajar" as never,
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

/**
 * **Pendamping Support** (#481, ADR-0054) — the fifth Aspect, Rated by a Narasumber or a Pimpinan
 * and never by a Pendamping, who would be Rating themselves. The write holds both directions; the
 * low-Rating rule applies to it exactly as to the other four.
 */
describe("filePerjadinEvaluation — Pendamping Support", () => {
  beforeEach(resetDatabase);

  /** What landed for Pendamping Support on the trip's one evaluation. */
  async function stored(perjadinId: string) {
    const [row] = await db
      .select({
        rating: schema.perjadinEvaluation.pendampingSupport,
        comment: schema.perjadinEvaluation.pendampingSupportComment,
      })
      .from(schema.perjadinEvaluation)
      .where(eq(schema.perjadinEvaluation.perjadinId, perjadinId));
    return row;
  }

  it.each(["Narasumber", "Pimpinan"] as const)(
    "files a %s's Rating and its Komentar",
    async (role) => {
      const trip = await aTrip((await staff()).id);

      const result = await filePerjadinEvaluation(asToken(trip.id), {
        role,
        name: "Pak Andi",
        ratings: { ...FINE, pendamping_support: 10 },
        comments: { ...NO_COMMENTS, pendamping_support: "  Sigap mengurus semuanya  " },
      });

      expect(result.outcome).toBe("filed");
      await expect(stored(trip.id)).resolves.toEqual({
        rating: 10,
        comment: "Sigap mengurus semuanya",
      });
    },
  );

  it.each(["Narasumber", "Pimpinan"] as const)(
    "refuses a %s who left it unrated, and writes nothing",
    async (role) => {
      const trip = await aTrip((await staff()).id);

      const result = await filePerjadinEvaluation(asToken(trip.id), {
        role,
        name: "Pak Andi",
        ratings: FINE_FROM_PENDAMPING,
        comments: NO_COMMENTS,
      });

      expect(result).toEqual({ outcome: "ratings-mismatch" });
      expect(await evaluationCount(trip.id)).toBe(0);
    },
  );

  it("refuses a Pendamping Rating Pendamping Support, and writes nothing", async () => {
    const trip = await aTrip((await staff()).id);

    const result = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pendamping",
      name: "Dewi",
      ratings: FINE,
      comments: NO_COMMENTS,
    });

    expect(result).toEqual({ outcome: "ratings-mismatch" });
    expect(await evaluationCount(trip.id)).toBe(0);
  });

  it("stores a Pendamping's evaluation with neither the Rating nor a Komentar sent for it", async () => {
    const trip = await aTrip((await staff()).id);

    const result = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pendamping",
      name: "Dewi",
      ratings: FINE_FROM_PENDAMPING,
      comments: { ...NO_COMMENTS, pendamping_support: "Tertinggal dari pilihan peran sebelumnya" },
    });

    expect(result.outcome).toBe("filed");
    await expect(stored(trip.id)).resolves.toEqual({ rating: null, comment: null });
  });

  it("refuses a low Pendamping Support without its OWN Komentar — prose on another Aspect does not count", async () => {
    const trip = await aTrip((await staff()).id);
    const low = { ...FINE, pendamping_support: CONCERN_AT_OR_BELOW };

    const refused = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pimpinan",
      name: "Bu Sri",
      ratings: low,
      comments: { ...NO_COMMENTS, punctuality: "Jadwal molor" },
    });
    expect(refused).toEqual({ outcome: "prose-required" });
    expect(await evaluationCount(trip.id)).toBe(0);

    const filed = await filePerjadinEvaluation(asToken(trip.id), {
      role: "Pimpinan",
      name: "Bu Sri",
      ratings: low,
      comments: { ...NO_COMMENTS, pendamping_support: "Pendamping sulit dihubungi" },
    });
    expect(filed.outcome).toBe("filed");
  });

  it("takes a submission from a form loaded before #481 only from a Pendamping", async () => {
    const trip = await aTrip((await staff()).id);
    // What a page left open from before the Aspect existed sends: four Ratings, four Komentar.
    const before481 = (role: "Narasumber" | "Pendamping") =>
      ({
        role,
        name: "Dewi",
        ratings: { lodging: 9, transport: 9, meals: 9, punctuality: 9 },
        comments: { lodging: null, transport: null, meals: null, punctuality: null },
      }) as unknown as Parameters<typeof filePerjadinEvaluation>[1];

    await expect(
      filePerjadinEvaluation(asToken(trip.id), before481("Pendamping")),
    ).resolves.toMatchObject({ outcome: "filed" });
    await expect(
      filePerjadinEvaluation(asToken(trip.id), before481("Narasumber")),
    ).resolves.toEqual({ outcome: "ratings-mismatch" });
  });
});

/**
 * The database's half of Pendamping Support (ADR-0054): the bounds, the elaboration rule, a
 * Pendamping filer carrying none, and the concerns index over five Ratings. Asserted against the
 * database directly, behind the write. **Not** that a Narasumber or Pimpinan must give it — rows filed
 * before #481 hold a NULL from them, so that half is the write's alone.
 */
describe("the Pendamping Support invariants", () => {
  let tripId = "";
  beforeEach(async () => {
    await resetDatabase();
    tripId = (await aTrip((await staff()).id)).id;
  });

  /** A row on the test's trip as the write would insert it, every Rating high and no Komentar. */
  function row(values: Partial<typeof schema.perjadinEvaluation.$inferInsert> = {}) {
    return {
      perjadinId: tripId,
      filedByRole: "Narasumber" as const,
      filedByName: "Pak Andi",
      lodging: 9,
      transport: 9,
      meals: 9,
      punctuality: 9,
      pendampingSupport: 9,
      ...values,
    };
  }

  it("accepts a Narasumber with no Pendamping Support — the shape of every row filed before #481", async () => {
    const values = row({ pendampingSupport: null });

    await expect(refusedBy(db.insert(schema.perjadinEvaluation).values(values))).resolves.toBe(
      null,
    );
  });

  it("refuses a Pendamping filer carrying a Pendamping Support Rating, or a Komentar for it", async () => {
    const rated = row({ filedByRole: "Pendamping" });
    const commented = row({
      filedByRole: "Pendamping",
      pendampingSupport: null,
      pendampingSupportComment: "Saya sendiri",
    });

    await expect(refusedBy(db.insert(schema.perjadinEvaluation).values(rated))).resolves.toBe(
      "perjadin_evaluation_pendamping_support_rater_check",
    );
    await expect(refusedBy(db.insert(schema.perjadinEvaluation).values(commented))).resolves.toBe(
      "perjadin_evaluation_pendamping_support_rater_check",
    );
  });

  it("refuses a Rating outside 1–10", async () => {
    const values = row({ pendampingSupport: 11 });

    await expect(refusedBy(db.insert(schema.perjadinEvaluation).values(values))).resolves.toBe(
      "perjadin_evaluation_pendamping_support_check",
    );
  });

  it("refuses a low Pendamping Support whose own Komentar is blank, whatever another Aspect says", async () => {
    const values = row({
      pendampingSupport: CONCERN_AT_OR_BELOW,
      pendampingSupportComment: "   ",
      punctualityComment: "Jadwal molor",
    });

    await expect(refusedBy(db.insert(schema.perjadinEvaluation).values(values))).resolves.toBe(
      "perjadin_evaluation_low_rating_needs_prose",
    );
  });

  it("indexes a low Pendamping Support as a concern, and never a null one", async () => {
    const low = row({ pendampingSupport: 3, pendampingSupportComment: "Tidak ada di lokasi" });
    const unasked = row({ filedByRole: "Pendamping", pendampingSupport: null });
    await db.insert(schema.perjadinEvaluation).values([low, unasked]);

    // The index's own predicate, read from the catalogue rather than restated, run against each row.
    const [index] = await db.execute<{ predicate: string }>(sql`
      select pg_get_expr(indpred, indrelid) as predicate
        from pg_index
       where indexrelid = 'perjadin_evaluation_concerns_idx'::regclass`);
    expect(index?.predicate).toContain("pendamping_support");
    const concerns = await db.execute<{ filed_by_role: string }>(sql`
      select filed_by_role from perjadin_evaluation where ${sql.raw(index!.predicate)}`);

    expect(concerns.map((concern) => concern.filed_by_role)).toEqual(["Narasumber"]);
  });
});
