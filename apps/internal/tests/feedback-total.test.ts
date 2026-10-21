import {
  DEFAULT_FEEDBACK_SORT,
  NO_FEEDBACK_FILTERS,
  NO_PARTICIPANT_FEEDBACK_SCOPE,
  NO_PERJADIN_FEEDBACK_FILTERS,
  NO_PERJADIN_FEEDBACK_SCOPE,
  participantFeedbackExport,
  participantFeedbackPage,
  perjadinFeedbackExport,
  perjadinFeedbackPage,
  type FeedbackFilters,
  type FeedbackSort,
  type ParticipantFeedbackScope,
  type PerjadinFeedbackFilters,
  type PerjadinFeedbackScope,
} from "@sugt/db/queries";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addParticipantFeedback,
  addPerjadin,
  addPerjadinEvaluation,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Each `/feedback` tab's response count** (#519): a page's `total` is every row the tab's scope
 * and filters match — what the CSV holds, not the batch on screen — read by the same query as the
 * rows, so the count, the list and the file never disagree. Sorting never moves it.
 */

async function signedIn() {
  return addPerson({ fullName: "Rina Nurhayati", email: "rina@ditsama.itb.ac.id", role: "Staff" });
}

const DESC: FeedbackSort = { score: "desc", date: "asc" };

describe("participantFeedbackPage's total", () => {
  beforeEach(resetDatabase);

  /** Two Schools; Bontang has two Sessions. 13 responses at the first, so more than one batch. */
  async function seed() {
    const person = await signedIn();
    await addProvince("KT", "Kalimantan Timur");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const [bontang, samarinda] = await Promise.all(
      (["sman-1-bontang", "sman-1-samarinda"] as const).map((slug) =>
        addSchool({ slug, name: slug, clusterId: cluster.id, provinceCode: "KT" }),
      ),
    );
    const first = await addSession({
      schoolId: bontang!.id,
      heldOn: "2026-09-10",
      status: "delivered",
    });
    const second = await addSession({
      schoolId: bontang!.id,
      heldOn: "2026-09-17",
      status: "delivered",
    });
    const elsewhere = await addSession({
      schoolId: samarinda!.id,
      heldOn: "2026-09-11",
      status: "delivered",
    });
    // 13 Siswa at the first Session, 6 low on Narasumber; 4 GTK at the second; 2 MS at Samarinda.
    for (let i = 0; i < 13; i++) {
      await addParticipantFeedback({
        sessionId: first.id,
        classKind: "Student",
        name: `S${i}`,
        ratings: { instructor: i < 6 ? 5 : 9 },
      });
    }
    for (let i = 0; i < 4; i++) {
      await addParticipantFeedback({ sessionId: second.id, classKind: "GTK", name: `G${i}` });
    }
    for (let i = 0; i < 2; i++) {
      await addParticipantFeedback({ sessionId: elsewhere.id, classKind: "MS", name: `M${i}` });
    }
    return { person, bontang: bontang!, first };
  }

  const page = async (
    person: Awaited<ReturnType<typeof signedIn>>,
    over: { scope?: Partial<ParticipantFeedbackScope>; filters?: Partial<FeedbackFilters> } = {},
    sort: FeedbackSort = DEFAULT_FEEDBACK_SORT,
  ) => {
    const args = {
      scope: { ...NO_PARTICIPANT_FEEDBACK_SCOPE, ...over.scope },
      filters: { ...NO_FEEDBACK_FILTERS, ...over.filters },
      sort,
    };
    const result = await participantFeedbackPage(person, { ...args, cursor: null });
    const all = await participantFeedbackExport(person, args);
    return { ...result, exported: all.length };
  };

  it("counts every matching row, past the first batch, as the CSV does", async () => {
    const { person } = await seed();
    const first = await page(person);
    expect(first.rows).toHaveLength(10);
    expect(first.total).toBe(19);
    expect(first.exported).toBe(19);
  });

  it("follows the School, the Sesi and the Tipe Peserta", async () => {
    const { person, bontang, first } = await seed();
    expect((await page(person, { scope: { schoolId: bontang.id } })).total).toBe(17);
    expect(
      (await page(person, { scope: { schoolId: bontang.id, sessionId: first.id } })).total,
    ).toBe(13);
    expect((await page(person, { scope: { participantType: "GTK-MS" } })).total).toBe(6);
  });

  it("follows the score filters, the way the list and the CSV do", async () => {
    const { person } = await seed();
    const low = await page(person, { filters: { instructor: "le7" } });
    expect(low.total).toBe(6);
    expect(low.exported).toBe(6);
    expect((await page(person, { filters: { instructor: "gt7" } })).total).toBe(13);
    expect((await page(person, { filters: { reviewType: "le7" } })).total).toBe(0);
  });

  it("is unchanged by the sort, and carried by a later page", async () => {
    const { person } = await seed();
    const asc = await page(person);
    expect((await page(person, {}, DESC)).total).toBe(19);
    const next = await participantFeedbackPage(person, {
      scope: NO_PARTICIPANT_FEEDBACK_SCOPE,
      filters: NO_FEEDBACK_FILTERS,
      sort: DEFAULT_FEEDBACK_SORT,
      cursor: asc.nextCursor,
    });
    expect(next.rows).toHaveLength(9);
    expect(next.total).toBe(19);
  });

  it("is 0 on an empty result", async () => {
    const empty = await page(await signedIn());
    expect(empty).toMatchObject({ rows: [], total: 0, nextCursor: null });
  });
});

describe("perjadinFeedbackPage's total", () => {
  beforeEach(resetDatabase);

  /** Two trips; 12 evaluations on the first — more than one batch — and 3 on the second. */
  async function seed() {
    const person = await signedIn();
    const [first, second] = [
      await addPerjadin({ subClusterName: "Kelompok 1", picPersonId: person.id }),
      await addPerjadin({ subClusterName: "Kelompok 2", picPersonId: person.id }),
    ];
    for (let i = 0; i < 12; i++) {
      await addPerjadinEvaluation({
        perjadinId: first.id,
        name: `E${i}`,
        role: i < 4 ? "Narasumber" : "Pendamping",
        ratings: { meals: i < 5 ? 4 : 9 },
      });
    }
    for (let i = 0; i < 3; i++) {
      await addPerjadinEvaluation({ perjadinId: second.id, name: `F${i}`, role: "Pimpinan" });
    }
    return { person, first };
  }

  const page = async (
    person: Awaited<ReturnType<typeof signedIn>>,
    over: {
      scope?: Partial<PerjadinFeedbackScope>;
      filters?: Partial<PerjadinFeedbackFilters>;
    } = {},
    sort: FeedbackSort = DEFAULT_FEEDBACK_SORT,
  ) => {
    const args = {
      scope: { ...NO_PERJADIN_FEEDBACK_SCOPE, ...over.scope },
      filters: { ...NO_PERJADIN_FEEDBACK_FILTERS, ...over.filters },
      sort,
    };
    const result = await perjadinFeedbackPage(person, { ...args, cursor: null });
    const all = await perjadinFeedbackExport(person, args);
    return { ...result, exported: all.length };
  };

  it("counts every matching row, past the first batch, as the CSV does", async () => {
    const { person } = await seed();
    const all = await page(person);
    expect(all.rows).toHaveLength(10);
    expect(all.total).toBe(15);
    expect(all.exported).toBe(15);
  });

  it("follows the Perjadin and the Peran pengisi", async () => {
    const { person, first } = await seed();
    expect((await page(person, { scope: { perjadinId: first.id } })).total).toBe(12);
    expect((await page(person, { scope: { role: "Narasumber" } })).total).toBe(4);
    expect((await page(person, { scope: { perjadinId: first.id, role: "Pimpinan" } })).total).toBe(
      0,
    );
  });

  it("follows the score filters, the way the list and the CSV do", async () => {
    const { person } = await seed();
    const low = await page(person, { filters: { meals: "le7" } });
    expect(low.total).toBe(5);
    expect(low.exported).toBe(5);
    expect((await page(person, { filters: { meals: "gt7" } })).total).toBe(10);
  });

  it("is unchanged by the sort, and carried by a later page", async () => {
    const { person } = await seed();
    const asc = await page(person);
    expect((await page(person, {}, DESC)).total).toBe(15);
    const next = await perjadinFeedbackPage(person, {
      scope: NO_PERJADIN_FEEDBACK_SCOPE,
      filters: NO_PERJADIN_FEEDBACK_FILTERS,
      sort: DEFAULT_FEEDBACK_SORT,
      cursor: asc.nextCursor,
    });
    expect(next.rows).toHaveLength(5);
    expect(next.total).toBe(15);
  });

  it("is 0 on an empty result", async () => {
    const person = await signedIn();
    expect(await page(person)).toMatchObject({ rows: [], total: 0, nextCursor: null });
  });
});
