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

/** A trip to file Perjadin Evaluations against. */
async function aTrip(picPersonId: string) {
  return addPerjadin({ picPersonId, startsOn: "2026-09-01", endsOn: "2026-09-02" });
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
    await addPerjadinEvaluation({
      perjadinId: trip.id,
      lodging: null,
      ratings: { transport: 5, meals: 9, punctuality: 8 },
    });

    const { participantFeedback, perjadinFeedback } = await summary();
    const peserta = await participantFeedbackAverages(person, NO_PARTICIPANT_FEEDBACK_SCOPE);
    const perjadin = await perjadinFeedbackAverages(person, NO_PERJADIN_FEEDBACK_SCOPE);
    /** What the card renders, as the number the summary should carry. */
    const card = (value: number | null) => (value === null ? null : Number(value.toFixed(1)));

    expect(participantFeedback).toMatchObject({
      responseCount: 4,
      narasumber: card(peserta.instructor),
      materi: card(peserta.materials),
      relevansi: card(peserta.relevance),
      handsOnRbl: card(peserta.handsOnRbl),
    });
    expect(perjadinFeedback).toMatchObject({
      responseCount: 3,
      penginapan: card(perjadin.lodging),
      transportasi: card(perjadin.transport),
      konsumsi: card(perjadin.meals),
      ketepatanWaktu: card(perjadin.punctuality),
      bantuanPendamping: card(perjadin.pendampingSupport),
    });
    // Hands-on RBL is over the three Student rows, not the GTK one: (7 + 10 + 8) / 3.
    expect(participantFeedback.handsOnRbl).toBe(8.3);
    // Lodging is over the two overnight trips, not the day trip.
    expect(perjadinFeedback.penginapan).toBe(card(perjadin.lodging));
  });

  it("rounds a .x5 average the way the card does", async () => {
    const { person, sessionId } = await aSession();
    // Instructor: (8 + 8 + 8 + 9) / 4 = 8.25. Relevance: (9 + 9 + 9 + 8) / 4 = 8.75.
    for (const [instructor, relevance] of [
      [8, 9],
      [8, 9],
      [8, 9],
      [9, 8],
    ]) {
      await addParticipantFeedback({
        sessionId,
        classKind: "GTK",
        ratings: { instructor, relevance },
      });
    }

    const { participantFeedback } = await summary();
    const peserta = await participantFeedbackAverages(person, NO_PARTICIPANT_FEEDBACK_SCOPE);

    expect(peserta.instructor).toBe(8.25);
    expect(participantFeedback.narasumber).toBe(8.3);
    expect(participantFeedback.narasumber!.toFixed(1)).toBe(peserta.instructor.toFixed(1));
    expect(peserta.relevance).toBe(8.75);
    expect(participantFeedback.relevansi).toBe(8.8);
    expect(participantFeedback.relevansi!.toFixed(1)).toBe(peserta.relevance.toFixed(1));
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
    const trip = await aTrip(staff.id);
    await addPerjadinEvaluation({ perjadinId: trip.id, lodging: null });

    const { perjadinFeedback } = await summary();

    expect(perjadinFeedback.penginapan).toBeNull();
    expect(perjadinFeedback.konsumsi).not.toBeNull();
    // The internal card keeps its "nothing yet" 0.0; only the outside reader gets the null.
    expect((await perjadinFeedbackAverages(person, NO_PERJADIN_FEEDBACK_SCOPE)).lodging).toBe(0);
  });
});
