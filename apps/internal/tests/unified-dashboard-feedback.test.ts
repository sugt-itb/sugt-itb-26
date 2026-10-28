import {
  NO_PARTICIPANT_FEEDBACK_SCOPE,
  NO_PERJADIN_FEEDBACK_SCOPE,
  participantFeedbackAverages,
  perjadinFeedbackAverages,
  type Person,
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
import { ORIGIN, summary } from "./support/unified-dashboard";

/**
 * **The Unified Dashboard's two feedback sections (#504)** — Participant Feedback and Perjadin
 * Evaluation averages, beside #503's progress figures, at the same version.
 *
 * What it proves: each average is the number `/feedback`'s card shows at its unscoped view, rounded
 * the way the card rounds it; an Aspect nobody rated is `null` (never the cards' `0`); and nothing
 * but aggregates leaves — no comment, no filer name, no per-row value.
 */

beforeEach(resetDatabase);

/** A Staff Person to read the cards as, and one online Session to file Participant Feedback against. */
async function aSession() {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const school = await addSchool({
    slug: "sman-1",
    name: "SMAN 1",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
  const staff = await addPerson({ fullName: "Rina", email: "rina@gmail.com", role: "Staff" });
  const session = await addSession({
    schoolId: school.id,
    heldOn: "2026-09-01",
    status: "delivered",
  });
  return { person: { ...staff, grants: [] } as Person, staff, sessionId: session.id };
}

/** A trip to file Perjadin Evaluations against — overnight, or a day trip with no hotel. */
async function aTrip(picPersonId: string, { dayTrip = false } = {}) {
  return addPerjadin({
    picPersonId,
    startsOn: "2026-09-01",
    endsOn: dayTrip ? "2026-09-01" : "2026-09-02",
  });
}

describe("the feedback sections", () => {
  it("carry exactly their aggregate keys, at version 1, and nothing anybody wrote", async () => {
    const { staff, sessionId } = await aSession();
    await addParticipantFeedback({
      sessionId,
      classKind: "Student",
      name: "Siti Rahmawati",
      ratings: { materials: 9, instructor: 8, relevance: 10, handsOnRbl: 7 },
      comments: { materials: "KOMENTAR-MATERI-RAHASIA" },
      knowledgeGain: "PENGETAHUAN-RAHASIA",
      suggestions: "SARAN-RAHASIA",
    });
    const trip = await aTrip(staff.id);
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      role: "Narasumber",
      name: "Prof. Bambang Wiryawan",
      ratings: { transport: 6 },
      pendampingSupport: 9,
      comments: { transport: "KOMENTAR-TRANSPORTASI-RAHASIA" },
    });

    const payload = await summary();

    expect(payload.version).toBe(1);
    expect(Object.keys(payload)).toEqual([
      "version",
      "generatedAt",
      "progress",
      "sessions",
      "participantFeedback",
      "perjadinFeedback",
    ]);
    expect(Object.keys(payload.participantFeedback)).toEqual([
      "detailUrl",
      "responseCount",
      "narasumber",
      "materi",
      "relevansi",
      "handsOnRbl",
    ]);
    expect(Object.keys(payload.perjadinFeedback)).toEqual([
      "detailUrl",
      "responseCount",
      "penginapan",
      "transportasi",
      "konsumsi",
      "ketepatanWaktu",
      "bantuanPendamping",
    ]);
    expect(payload.participantFeedback.detailUrl).toBe(`${ORIGIN}/feedback`);
    expect(payload.perjadinFeedback.detailUrl).toBe(`${ORIGIN}/feedback`);

    const wire = JSON.stringify(payload);
    for (const written of [
      "RAHASIA",
      "Siti Rahmawati",
      "Prof. Bambang Wiryawan",
      "Narasumber",
      "Student",
    ]) {
      expect(wire).not.toContain(written);
    }
  });

  it("averages exactly what /feedback's unscoped cards show", async () => {
    const { person, staff, sessionId } = await aSession();
    for (const [materials, instructor, relevance, handsOnRbl] of [
      [9, 8, 10, 7],
      [7, 9, 8, 10],
      [10, 10, 9, 8],
    ]) {
      await addParticipantFeedback({
        sessionId,
        classKind: "Student",
        ratings: { materials, instructor, relevance, handsOnRbl },
      });
    }
    await addParticipantFeedback({ sessionId, classKind: "GTK", ratings: { materials: 6 } });
    const trip = await aTrip(staff.id);
    await addPerjadinEvaluation({ perjadinId: trip.id, role: "Narasumber", pendampingSupport: 10 });
    await addPerjadinEvaluation({ perjadinId: trip.id, role: "Pimpinan", pendampingSupport: 7 });
    const dayTrip = await aTrip(staff.id, { dayTrip: true });
    await addPerjadinEvaluation({
      perjadinId: dayTrip.id,
      lodging: null,
      ratings: { transport: 5, meals: 9, punctuality: 8 },
    });

    const { participantFeedback, perjadinFeedback } = await summary();
    const peserta = await participantFeedbackAverages(person, NO_PARTICIPANT_FEEDBACK_SCOPE);
    const perjadin = await perjadinFeedbackAverages(person, NO_PERJADIN_FEEDBACK_SCOPE);
    expect(participantFeedback).toMatchObject({
      responseCount: 4,
      narasumber: peserta.instructor,
      materi: peserta.materials,
      relevansi: peserta.relevance,
      handsOnRbl: peserta.handsOnRbl,
    });
    expect(perjadinFeedback).toMatchObject({
      responseCount: 3,
      penginapan: perjadin.lodging,
      transportasi: perjadin.transport,
      konsumsi: perjadin.meals,
      ketepatanWaktu: perjadin.punctuality,
      bantuanPendamping: perjadin.pendampingSupport,
    });
    // Hands-on RBL is over the three Student rows, not the GTK one: (7 + 10 + 8) / 3.
    expect(participantFeedback.handsOnRbl).toBe(8.3);
    // Lodging is over the two evaluations that rated it, not the day trip's: (9 + 9) / 2.
    expect(perjadinFeedback.penginapan).toBe(9);
  });

  it("rounds a .x5 average half up, the same number the card shows", async () => {
    const { person, sessionId } = await aSession();
    // Twenty responses. Instructor: (13 × 8 + 7 × 9) / 20 = 8.35. Materials: (15 × 8 + 5 × 9) / 20 =
    // 8.25. Relevance: (17 × 8 + 3 × 9) / 20 = 8.15. 8.35 is the one a float gets wrong: 8.3499…
    for (let i = 0; i < 20; i++) {
      await addParticipantFeedback({
        sessionId,
        classKind: "GTK",
        ratings: {
          instructor: i < 13 ? 8 : 9,
          materials: i < 15 ? 8 : 9,
          relevance: i < 17 ? 8 : 9,
        },
      });
    }

    const { participantFeedback } = await summary();
    const peserta = await participantFeedbackAverages(person, NO_PARTICIPANT_FEEDBACK_SCOPE);

    expect(participantFeedback).toMatchObject({ narasumber: 8.4, materi: 8.3, relevansi: 8.2 });
    // The card renders `toFixed(1)` of the same number, so it reads the same digits.
    expect(
      [peserta.instructor, peserta.materials, peserta.relevance].map((v) => v.toFixed(1)),
    ).toEqual(["8.4", "8.3", "8.2"]);
  });
});

describe("an Aspect nobody rated is null, never 0", () => {
  it("is null everywhere, with no responses, on empty tables", async () => {
    const { participantFeedback, perjadinFeedback } = await summary();

    expect(participantFeedback).toEqual({
      detailUrl: `${ORIGIN}/feedback`,
      responseCount: 0,
      narasumber: null,
      materi: null,
      relevansi: null,
      handsOnRbl: null,
    });
    expect(perjadinFeedback).toEqual({
      detailUrl: `${ORIGIN}/feedback`,
      responseCount: 0,
      penginapan: null,
      transportasi: null,
      konsumsi: null,
      ketepatanWaktu: null,
      bantuanPendamping: null,
    });
  });

  it("gives Hands-on RBL null when only GTK and MS Classes filed", async () => {
    const { sessionId } = await aSession();
    await addParticipantFeedback({ sessionId, classKind: "GTK" });
    await addParticipantFeedback({ sessionId, classKind: "MS" });

    const { participantFeedback } = await summary();

    expect(participantFeedback.responseCount).toBe(2);
    expect(participantFeedback.handsOnRbl).toBeNull();
    expect(participantFeedback.materi).not.toBeNull();
  });

  it("gives Pendamping Support null when only Pendamping filed", async () => {
    const { staff } = await aSession();
    const trip = await aTrip(staff.id);
    await addPerjadinEvaluation({ perjadinId: trip.id, role: "Pendamping" });
    await addPerjadinEvaluation({ perjadinId: trip.id, role: "Pendamping" });

    const { perjadinFeedback } = await summary();

    expect(perjadinFeedback.responseCount).toBe(2);
    expect(perjadinFeedback.bantuanPendamping).toBeNull();
    expect(perjadinFeedback.transportasi).not.toBeNull();
  });

  it("gives Lodging null when only day trips were evaluated, where the card reads 0", async () => {
    const { person, staff } = await aSession();
    const trip = await aTrip(staff.id, { dayTrip: true });
    await addPerjadinEvaluation({ perjadinId: trip.id, lodging: null });

    const { perjadinFeedback } = await summary();

    expect(perjadinFeedback.penginapan).toBeNull();
    expect(perjadinFeedback.konsumsi).not.toBeNull();
    // The internal card keeps its "nothing yet" 0.0; only the outside reader gets the null.
    expect((await perjadinFeedbackAverages(person, NO_PERJADIN_FEEDBACK_SCOPE)).lodging).toBe(0);
  });
});
