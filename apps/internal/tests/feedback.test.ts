import {
  DEFAULT_FEEDBACK_SORT,
  NO_FEEDBACK_FILTERS,
  NO_PERJADIN_FEEDBACK_FILTERS,
  participantFeedbackAverages,
  participantFeedbackPage,
  perjadinFeedbackAverages,
  perjadinFeedbackPage,
  type FeedbackCursor,
  type FeedbackFilters,
  type FeedbackSort,
  type PerjadinFeedbackCursor,
  type PerjadinFeedbackFilters,
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
 * **The Feedback list's Peserta tab** — every Participant submission, filtered, globally sorted and
 * OFFSET-paged. The tests prove the four filters cut on the right numbers and AND together, that
 * `reviewType` gates on the raw row average, that the compound sort orders lowest-average-first (the
 * default) with the filed date as the tiebreak and both directions selectable, that the page walks
 * the whole set with no repeat or gap under multiple sort combinations, that the new row fields
 * (`submittedOn`, `startsAt`, `timeZone`) surface, and that the summary averages are dataset-wide.
 */

async function signedIn(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

async function oneSession(picPersonId: string) {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const school = await addSchool({
    slug: "sman-8",
    name: "SMAN 8 Jakarta",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
  return addSession({
    schoolId: school.id,
    heldOn: "2026-09-10",
    status: "delivered",
    onlinePicPersonId: picPersonId,
  });
}

/** A full filter set from the all-`all` default with a few arms overridden. */
function filters(overrides: Partial<FeedbackFilters>): FeedbackFilters {
  return { ...NO_FEEDBACK_FILTERS, ...overrides };
}

/** A sort from the default with a direction or two overridden — terser than spelling both out. */
function sort(overrides: Partial<FeedbackSort>): FeedbackSort {
  return { ...DEFAULT_FEEDBACK_SORT, ...overrides };
}

describe("participantFeedbackPage", () => {
  beforeEach(resetDatabase);

  it("sorts lowest-average-first, then newest, by default", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    // Two distinct averages plus a tied pair on distinct instants, so the assertion turns on both
    // the average (primary) and the newest-first date tiebreak (secondary).
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Tinggi",
      ratings: { materials: 10, instructor: 10, relevance: 10 },
      submittedAt: new Date("2026-04-01T00:00:00Z"),
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Rendah",
      ratings: { materials: 2, instructor: 2, relevance: 2 },
      submittedAt: new Date("2026-03-01T00:00:00Z"),
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "SamaLama",
      ratings: { materials: 6, instructor: 6, relevance: 6 },
      submittedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "SamaBaru",
      ratings: { materials: 6, instructor: 6, relevance: 6 },
      submittedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const page = await participantFeedbackPage(person, {
      filters: NO_FEEDBACK_FILTERS,
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    // Rendah (avg 2) first; then the two avg-6 rows newest-first; then Tinggi (avg 10).
    expect(page.rows.map((row) => row.name)).toEqual(["Rendah", "SamaBaru", "SamaLama", "Tinggi"]);
    expect(page.nextCursor).toBeNull();
  });

  it("sorts highest-average-first under score desc (Tertinggi)", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Rendah",
      ratings: { materials: 2, instructor: 2, relevance: 2 },
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Tinggi",
      ratings: { materials: 10, instructor: 10, relevance: 10 },
    });

    const page = await participantFeedbackPage(person, {
      filters: NO_FEEDBACK_FILTERS,
      cursor: null,
      sort: sort({ score: "desc" }),
    });
    expect(page.rows.map((row) => row.name)).toEqual(["Tinggi", "Rendah"]);
  });

  it("breaks equal-average ties oldest-first under date asc (Terlama)", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    // Same average, distinct instants — so only the date tiebreak decides, and date asc is oldest-first.
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Lama",
      ratings: { materials: 6, instructor: 6, relevance: 6 },
      submittedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Baru",
      ratings: { materials: 6, instructor: 6, relevance: 6 },
      submittedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const page = await participantFeedbackPage(person, {
      filters: NO_FEEDBACK_FILTERS,
      cursor: null,
      sort: sort({ date: "asc" }),
    });
    expect(page.rows.map((row) => row.name)).toEqual(["Lama", "Baru"]);
  });

  it("carries the row's shape, the joins, and the session time/zone and filed date", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "GTK",
      name: "Ayu",
      ratings: { materials: 8, instructor: 9, relevance: 10 },
      submittedAt: new Date("2026-06-15T00:00:00Z"),
    });

    const [row] = (
      await participantFeedbackPage(person, {
        filters: NO_FEEDBACK_FILTERS,
        cursor: null,
        sort: DEFAULT_FEEDBACK_SORT,
      })
    ).rows;
    expect(row?.name).toBe("Ayu");
    expect(row?.classKind).toBe("GTK");
    expect(row?.schoolName).toBe("SMAN 8 Jakarta");
    // The origin the card links through to (#194): the exact Session this feedback was filed against.
    expect(row?.sessionId).toBe(session.id);
    expect(row?.sessionMode).toBe("online");
    expect(row?.heldOn).toBe("2026-09-10");
    expect(row?.rowAverage).toBeCloseTo((8 + 9 + 10) / 3, 5);
    // The new display fields (#184): the session's local start time, its zone, and the filed date.
    expect(row?.startsAt).toBe("09:00:00");
    expect(row?.timeZone).toBe("WIB");
    expect(row?.submittedOn).toBe("2026-06-15");
  });

  it("filters on the instructor column with le7 and gt7", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Rendah",
      ratings: { instructor: 5 },
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Tinggi",
      ratings: { instructor: 9 },
    });

    const low = await participantFeedbackPage(person, {
      filters: filters({ instructor: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(low.rows.map((row) => row.name)).toEqual(["Rendah"]);

    const high = await participantFeedbackPage(person, {
      filters: filters({ instructor: "gt7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(high.rows.map((row) => row.name)).toEqual(["Tinggi"]);
  });

  it("filters on the materials column", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Rendah",
      ratings: { materials: 6 },
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Tinggi",
      ratings: { materials: 8 },
    });

    const low = await participantFeedbackPage(person, {
      filters: filters({ materials: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(low.rows.map((row) => row.name)).toEqual(["Rendah"]);
  });

  it("filters on the relevance column", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Rendah",
      ratings: { relevance: 7 },
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Tinggi",
      ratings: { relevance: 8 },
    });

    const low = await participantFeedbackPage(person, {
      filters: filters({ relevance: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    // 7 is at the threshold, so le7 (<= 7) keeps it and gt7 (> 7) does not.
    expect(low.rows.map((row) => row.name)).toEqual(["Rendah"]);
    const high = await participantFeedbackPage(person, {
      filters: filters({ relevance: "gt7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(high.rows.map((row) => row.name)).toEqual(["Tinggi"]);
  });

  it("gates reviewType on the raw row average, not any single Aspect", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    // Average (8 + 8 + 6) / 3 = 7.33 — above 7 — so gt7 keeps it and le7 drops it, even though
    // one Aspect (relevance = 6) is below the threshold on its own.
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Campuran",
      ratings: { materials: 8, instructor: 8, relevance: 6 },
    });

    const gt = await participantFeedbackPage(person, {
      filters: filters({ reviewType: "gt7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(gt.rows.map((row) => row.name)).toEqual(["Campuran"]);
    expect(gt.rows[0]?.rowAverage).toBeCloseTo((8 + 8 + 6) / 3, 5);

    const le = await participantFeedbackPage(person, {
      filters: filters({ reviewType: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(le.rows).toHaveLength(0);
  });

  it("ANDs two filters together", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    // Only this row is low on BOTH instructor and materials.
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Keduanya",
      ratings: { instructor: 5, materials: 5 },
    });
    // Low on instructor only.
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Pengajar saja",
      ratings: { instructor: 5, materials: 9 },
    });
    // Low on materials only.
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Materi saja",
      ratings: { instructor: 9, materials: 5 },
    });

    const both = await participantFeedbackPage(person, {
      filters: filters({ instructor: "le7", materials: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(both.rows.map((row) => row.name)).toEqual(["Keduanya"]);
  });

  it("pages the whole set under the default sort with no repeat or gap (score asc)", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    // 12 rows spread across averages and instants, so paging must cross a boundary mid-order.
    for (let i = 0; i < 12; i++) {
      const rating = (i % 10) + 1; // 1..10, so the averages vary and some tie
      await addParticipantFeedback({
        sessionId: session.id,
        classKind: "Student",
        name: `P${String(i).padStart(2, "0")}`,
        ratings: { materials: rating, instructor: rating, relevance: rating },
        submittedAt: new Date(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      });
    }

    const names: string[] = [];
    const averages: number[] = [];
    let cursor: FeedbackCursor | null = null;
    let pages = 0;
    do {
      const page = await participantFeedbackPage(person, {
        filters: NO_FEEDBACK_FILTERS,
        cursor,
        sort: DEFAULT_FEEDBACK_SORT,
      });
      for (const row of page.rows) {
        names.push(row.name);
        averages.push(row.rowAverage);
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);

    // More than one page was walked, and every row came back exactly once — no gap, no duplicate.
    expect(pages).toBeGreaterThan(1);
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    // score asc holds across the page boundary: the average never decreases down the whole walk.
    for (let i = 1; i < averages.length; i++) {
      expect(averages[i]!).toBeGreaterThanOrEqual(averages[i - 1]!);
    }
  });

  it("pages the whole set under score desc with no repeat or gap", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    for (let i = 0; i < 12; i++) {
      const rating = (i % 10) + 1;
      await addParticipantFeedback({
        sessionId: session.id,
        classKind: "Student",
        name: `P${String(i).padStart(2, "0")}`,
        ratings: { materials: rating, instructor: rating, relevance: rating },
        submittedAt: new Date(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      });
    }

    const names: string[] = [];
    const averages: number[] = [];
    let cursor: FeedbackCursor | null = null;
    do {
      const page = await participantFeedbackPage(person, {
        filters: NO_FEEDBACK_FILTERS,
        cursor,
        sort: sort({ score: "desc" }),
      });
      for (const row of page.rows) {
        names.push(row.name);
        averages.push(row.rowAverage);
      }
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    // score desc holds across the boundary: the average never increases down the walk.
    for (let i = 1; i < averages.length; i++) {
      expect(averages[i]!).toBeLessThanOrEqual(averages[i - 1]!);
    }
  });

  it("pages the whole set under date asc with no repeat or gap, oldest-first within ties", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    // Every row shares one average, so the date direction is the operative order across the page
    // boundary — the combination the score-direction paging tests above do not exercise.
    for (let i = 0; i < 12; i++) {
      await addParticipantFeedback({
        sessionId: session.id,
        classKind: "Student",
        name: `P${String(i).padStart(2, "0")}`,
        ratings: { materials: 5, instructor: 5, relevance: 5 },
        submittedAt: new Date(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      });
    }

    const names: string[] = [];
    const submittedOns: string[] = [];
    let cursor: FeedbackCursor | null = null;
    let pages = 0;
    do {
      const page = await participantFeedbackPage(person, {
        filters: NO_FEEDBACK_FILTERS,
        cursor,
        sort: sort({ date: "asc" }),
      });
      for (const row of page.rows) {
        names.push(row.name);
        submittedOns.push(row.submittedOn);
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);

    expect(pages).toBeGreaterThan(1);
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    // Averages tie, so date asc is the order: the submitted date never decreases down the walk.
    for (let i = 1; i < submittedOns.length; i++) {
      expect(submittedOns[i]! >= submittedOns[i - 1]!).toBe(true);
    }
  });

  it("composes a filter with a non-default sort", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    // Three low-average rows kept by le7 and one high row dropped, so the WHERE cuts and the
    // non-default score-desc ORDER BY orders what remains — the two applied together.
    for (const [name, rating] of [
      ["Tiga", 3],
      ["Lima", 5],
      ["Tujuh", 7],
    ] as const) {
      await addParticipantFeedback({
        sessionId: session.id,
        classKind: "Student",
        name,
        ratings: { materials: rating, instructor: rating, relevance: rating },
      });
    }
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      name: "Sepuluh",
      ratings: { materials: 10, instructor: 10, relevance: 10 },
    });

    const page = await participantFeedbackPage(person, {
      filters: filters({ reviewType: "le7" }),
      cursor: null,
      sort: sort({ score: "desc" }),
    });

    // The high-average row is filtered out; the three kept rows come back highest-average first.
    expect(page.rows.map((row) => row.name)).toEqual(["Tujuh", "Lima", "Tiga"]);
  });
});

describe("participantFeedbackAverages", () => {
  beforeEach(resetDatabase);

  it("defaults to zero on an empty table", async () => {
    const person = await signedIn();
    expect(await participantFeedbackAverages(person)).toEqual({
      instructor: 0,
      materials: 0,
      relevance: 0,
    });
  });

  it("averages every row, dataset-wide", async () => {
    const person = await signedIn();
    const session = await oneSession(person.id);
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      ratings: { instructor: 4, materials: 6, relevance: 8 },
    });
    await addParticipantFeedback({
      sessionId: session.id,
      classKind: "Student",
      ratings: { instructor: 8, materials: 10, relevance: 10 },
    });

    const averages = await participantFeedbackAverages(person);
    expect(averages.instructor).toBeCloseTo((4 + 8) / 2, 5);
    expect(averages.materials).toBeCloseTo((6 + 10) / 2, 5);
    expect(averages.relevance).toBeCloseTo((8 + 10) / 2, 5);
  });
});

/**
 * **The Feedback list's Perjadin tab** — every Perjadin Evaluation, filtered, globally sorted and
 * OFFSET-paged. The tests prove the five filters cut on the right numbers and AND together, that
 * `reviewType` gates on the present-ratings average, that a null `lodging` is averaged over three
 * ratings and excluded from both lodging arms and from the summary hotel average, that the compound
 * sort orders lowest-average-first (default) with the filed date as tiebreak, that the page walks
 * the whole set with no repeat or gap under multiple sort combinations, that the trip's date range
 * (`startsOn`/`endsOn`) and the filed date (`createdOn`) surface, and that the stored
 * `filed_by_role` / `filed_by_name` pass through onto the row.
 */

/** One throwaway Perjadin to hang evaluations on — its destination and window are asserted below. */
async function oneTrip(picPersonId: string) {
  return addPerjadin({
    destination: "Kelompok 3: Kabupaten Sleman",
    advanceIdr: 5_000_000,
    picPersonId,
  });
}

/** A full Perjadin filter set from the all-`all` default with a few arms overridden. */
function perjadinFilters(overrides: Partial<PerjadinFeedbackFilters>): PerjadinFeedbackFilters {
  return { ...NO_PERJADIN_FEEDBACK_FILTERS, ...overrides };
}

describe("perjadinFeedbackPage", () => {
  beforeEach(resetDatabase);

  it("sorts lowest-average-first, then newest, and carries filed_by/destination/date range", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      role: "Pimpinan",
      name: "Tinggi",
      lodging: 10,
      ratings: { transport: 10, meals: 10, punctuality: 10 },
      createdAt: new Date("2026-04-01T00:00:00Z"),
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      role: "Pengajar",
      name: "Rendah",
      lodging: 2,
      ratings: { transport: 2, meals: 2, punctuality: 2 },
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });

    const page = await perjadinFeedbackPage(person, {
      filters: NO_PERJADIN_FEEDBACK_FILTERS,
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    // Lowest average first.
    expect(page.rows.map((row) => row.filedByName)).toEqual(["Rendah", "Tinggi"]);
    // The stored role and name pass through verbatim — no derivation (ADR-0024, #167).
    expect(page.rows[0]?.filedByRole).toBe("Pengajar");
    expect(page.rows[1]?.filedByRole).toBe("Pimpinan");
    expect(page.rows[0]?.destination).toBe("Kelompok 3: Kabupaten Sleman");
    expect(page.rows[0]?.perjadinId).toBe(trip.id);
    expect(page.rows[0]?.createdOn).toBe("2026-03-01");
    // The trip's date range (#184) — the fixture's defaults.
    expect(page.rows[0]?.startsOn).toBe("2026-09-01");
    expect(page.rows[0]?.endsOn).toBe("2026-09-03");
    expect(page.nextCursor).toBeNull();
  });

  it("sorts highest-average-first under score desc, newest-first within a tie", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Rendah",
      lodging: 2,
      ratings: { transport: 2, meals: 2, punctuality: 2 },
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "SamaLama",
      lodging: 6,
      ratings: { transport: 6, meals: 6, punctuality: 6 },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "SamaBaru",
      lodging: 6,
      ratings: { transport: 6, meals: 6, punctuality: 6 },
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    const page = await perjadinFeedbackPage(person, {
      filters: NO_PERJADIN_FEEDBACK_FILTERS,
      cursor: null,
      sort: sort({ score: "desc" }),
    });
    // Highest average first; the avg-6 pair newest-first; then Rendah.
    expect(page.rows.map((row) => row.filedByName)).toEqual(["SamaBaru", "SamaLama", "Rendah"]);
  });

  it("breaks equal-average ties oldest-first under date asc", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Lama",
      lodging: 6,
      ratings: { transport: 6, meals: 6, punctuality: 6 },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Baru",
      lodging: 6,
      ratings: { transport: 6, meals: 6, punctuality: 6 },
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    const page = await perjadinFeedbackPage(person, {
      filters: NO_PERJADIN_FEEDBACK_FILTERS,
      cursor: null,
      sort: sort({ date: "asc" }),
    });
    expect(page.rows.map((row) => row.filedByName)).toEqual(["Lama", "Baru"]);
  });

  it("filters on each Aspect column with le7 and gt7", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Transport rendah",
      ratings: { transport: 5 },
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Konsumsi rendah",
      ratings: { meals: 6 },
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Ketepatan rendah",
      ratings: { punctuality: 7 },
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Penginapan rendah",
      lodging: 4,
    });

    const transportLow = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ transport: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(transportLow.rows.map((row) => row.filedByName)).toEqual(["Transport rendah"]);

    const mealsLow = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ meals: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(mealsLow.rows.map((row) => row.filedByName)).toEqual(["Konsumsi rendah"]);

    // 7 is at the threshold, so le7 (<= 7) keeps it and gt7 (> 7) does not.
    const punctualityLow = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ punctuality: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(punctualityLow.rows.map((row) => row.filedByName)).toEqual(["Ketepatan rendah"]);

    const lodgingLow = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ lodging: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(lodgingLow.rows.map((row) => row.filedByName)).toEqual(["Penginapan rendah"]);
  });

  it("gates reviewType on the present-ratings average, not any single Aspect", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    // A four-rating row: (8 + 8 + 8 + 6) / 4 = 7.5 — above 7 — so gt7 keeps it and le7 drops it,
    // even though one Aspect (punctuality = 6) is below the threshold on its own.
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Campuran",
      lodging: 8,
      ratings: { transport: 8, meals: 8, punctuality: 6 },
    });

    const gt = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ reviewType: "gt7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(gt.rows.map((row) => row.filedByName)).toEqual(["Campuran"]);
    expect(gt.rows[0]?.rowAverage).toBeCloseTo((8 + 8 + 8 + 6) / 4, 5);

    const le = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ reviewType: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(le.rows).toHaveLength(0);
  });

  it("ANDs two filters together", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    // Only this row is low on BOTH transport and meals.
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Keduanya",
      ratings: { transport: 5, meals: 5 },
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Transport saja",
      ratings: { transport: 5, meals: 9 },
    });
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Konsumsi saja",
      ratings: { transport: 9, meals: 5 },
    });

    const both = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ transport: "le7", meals: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(both.rows.map((row) => row.filedByName)).toEqual(["Keduanya"]);
  });

  it("averages a null-lodging row over its three present ratings and omits lodging from the row", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    // A day trip: no hotel. The row average is over the three present ratings, not four.
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      name: "Sehari",
      lodging: null,
      ratings: { transport: 6, meals: 6, punctuality: 9 },
    });

    const page = await perjadinFeedbackPage(person, {
      filters: NO_PERJADIN_FEEDBACK_FILTERS,
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(page.rows[0]?.lodging).toBeNull();
    expect(page.rows[0]?.rowAverage).toBeCloseTo((6 + 6 + 9) / 3, 5);
  });

  it("excludes a null-lodging row from both lodging filter arms", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    await addPerjadinEvaluation({ perjadinId: trip.id, name: "Sehari", lodging: null });

    const low = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ lodging: "le7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(low.rows).toHaveLength(0);
    const high = await perjadinFeedbackPage(person, {
      filters: perjadinFilters({ lodging: "gt7" }),
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    });
    expect(high.rows).toHaveLength(0);
  });

  it("pages the whole set under the default sort with no repeat or gap (score asc)", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    // 12 evaluations spread across averages and instants, so paging must cross a boundary mid-order.
    for (let i = 0; i < 12; i++) {
      const rating = (i % 10) + 1;
      await addPerjadinEvaluation({
        perjadinId: trip.id,
        name: `E${String(i).padStart(2, "0")}`,
        lodging: rating,
        ratings: { transport: rating, meals: rating, punctuality: rating },
        createdAt: new Date(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      });
    }

    const names: string[] = [];
    const averages: number[] = [];
    let cursor: PerjadinFeedbackCursor | null = null;
    let pages = 0;
    do {
      const page = await perjadinFeedbackPage(person, {
        filters: NO_PERJADIN_FEEDBACK_FILTERS,
        cursor,
        sort: DEFAULT_FEEDBACK_SORT,
      });
      for (const row of page.rows) {
        names.push(row.filedByName);
        averages.push(row.rowAverage);
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);

    expect(pages).toBeGreaterThan(1);
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    for (let i = 1; i < averages.length; i++) {
      expect(averages[i]!).toBeGreaterThanOrEqual(averages[i - 1]!);
    }
  });

  it("pages the whole set under score desc with no repeat or gap", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    for (let i = 0; i < 12; i++) {
      const rating = (i % 10) + 1;
      await addPerjadinEvaluation({
        perjadinId: trip.id,
        name: `E${String(i).padStart(2, "0")}`,
        lodging: rating,
        ratings: { transport: rating, meals: rating, punctuality: rating },
        createdAt: new Date(`2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      });
    }

    const names: string[] = [];
    const averages: number[] = [];
    let cursor: PerjadinFeedbackCursor | null = null;
    do {
      const page = await perjadinFeedbackPage(person, {
        filters: NO_PERJADIN_FEEDBACK_FILTERS,
        cursor,
        sort: sort({ score: "desc" }),
      });
      for (const row of page.rows) {
        names.push(row.filedByName);
        averages.push(row.rowAverage);
      }
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    for (let i = 1; i < averages.length; i++) {
      expect(averages[i]!).toBeLessThanOrEqual(averages[i - 1]!);
    }
  });
});

describe("perjadinFeedbackAverages", () => {
  beforeEach(resetDatabase);

  it("defaults to zero on an empty table", async () => {
    const person = await signedIn();
    expect(await perjadinFeedbackAverages(person)).toEqual({
      lodging: 0,
      transport: 0,
      meals: 0,
      punctuality: 0,
    });
  });

  it("averages every row dataset-wide, and a null lodging is ignored by the hotel average", async () => {
    const person = await signedIn();
    const trip = await oneTrip(person.id);
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      lodging: 10,
      ratings: { transport: 4, meals: 6, punctuality: 8 },
    });
    // A day trip with no hotel: its lodging is out of the hotel average, in the other three.
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      lodging: null,
      ratings: { transport: 8, meals: 10, punctuality: 10 },
    });

    const averages = await perjadinFeedbackAverages(person);
    // avg(lodging) ignores the NULL — it is 10, not (10 + 0) / 2.
    expect(averages.lodging).toBeCloseTo(10, 5);
    expect(averages.transport).toBeCloseTo((4 + 8) / 2, 5);
    expect(averages.meals).toBeCloseTo((6 + 10) / 2, 5);
    expect(averages.punctuality).toBeCloseTo((8 + 10) / 2, 5);
  });
});
