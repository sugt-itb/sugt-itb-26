import { randomUUID } from "node:crypto";

import { loadParticipantFeedbackCharts } from "-/app/(app)/feedback/actions";
import { requirePerson } from "-/lib/person";
import {
  NO_PARTICIPANT_FEEDBACK_SCOPE,
  participantFeedbackAverages,
  type FeedbackParticipantType,
  type ParticipantFeedbackScope,
} from "@sugt/db/queries";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addParticipantFeedback,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The Lihat Grafik figures' read, against a seeded database** (#510): one set of figures per Tipe
 * Peserta over the dialog's scope, GTK and MS pooled into GTK-MS, Hands-on RBL averaged over the
 * Siswa rows that have one, and every bar the number its average card shows under the same scope.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));

beforeEach(resetDatabase);

/**
 * SMAN 1 Bontang: two Siswa (instructor 9 and 5, Hands-on RBL 8 and — filed before it existed —
 * none), a GTK (instructor 6) and an MS (instructor 10). SMAN 2 Samarinda: one Siswa (instructor 4,
 * Hands-on RBL 3). SMAN 9 Balikpapan has a Session and no response.
 */
async function scene() {
  const person = await addPerson({
    fullName: "Rina Nurhayati",
    email: "rina@ditsama.itb.ac.id",
    role: "Staff",
  });
  vi.mocked(requirePerson).mockResolvedValue(person);
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "kaltim", name: "Cluster Kaltim" });
  const school = (name: string) =>
    addSchool({ slug: randomUUID(), name, clusterId: cluster.id, provinceCode: "KT" });
  const bontang = await school("SMAN 1 Bontang");
  const samarinda = await school("SMAN 2 Samarinda");
  const balikpapan = await school("SMAN 9 Balikpapan");
  const atBontang = await addSession({ schoolId: bontang.id, heldOn: "2026-10-12" });
  const atSamarinda = await addSession({ schoolId: samarinda.id, heldOn: "2026-10-13" });
  await addSession({ schoolId: balikpapan.id, heldOn: "2026-10-14" });

  await addParticipantFeedback({
    sessionId: atBontang.id,
    classKind: "Student",
    ratings: { instructor: 9, handsOnRbl: 8 },
  });
  await addParticipantFeedback({
    sessionId: atBontang.id,
    classKind: "Student",
    ratings: { instructor: 5 },
  });
  await addParticipantFeedback({
    sessionId: atBontang.id,
    classKind: "GTK",
    ratings: { instructor: 6 },
  });
  await addParticipantFeedback({
    sessionId: atBontang.id,
    classKind: "MS",
    ratings: { instructor: 10 },
  });
  await addParticipantFeedback({
    sessionId: atSamarinda.id,
    classKind: "Student",
    ratings: { instructor: 4, handsOnRbl: 3 },
  });
  return { person, bontang, balikpapan };
}

describe("loadParticipantFeedbackCharts", () => {
  it("returns Siswa, then GTK-MS, programme-wide", async () => {
    await scene();
    const charts = await loadParticipantFeedbackCharts(NO_PARTICIPANT_FEEDBACK_SCOPE);

    expect(charts.map((chart) => chart.participantType)).toEqual(["Siswa", "GTK-MS"]);
    const [siswa, gtkMs] = charts.map((chart) => chart.figures);
    expect(siswa!.responseCount).toBe(3);
    expect(siswa!.instructor).toBe(6);
    // Over the two Siswa rows that have one; the row filed before it existed is not a 0.
    expect(siswa!.handsOnRbl).toBe(5.5);
    // GTK and MS pool: (6 + 10) / 2.
    expect(gtkMs!.responseCount).toBe(2);
    expect(gtkMs!.instructor).toBe(8);
    expect(gtkMs!.handsOnRbl).toBeNull();
  });

  it("returns only the Tipe Peserta picked, within the School", async () => {
    const { bontang } = await scene();
    const charts = await loadParticipantFeedbackCharts({
      ...NO_PARTICIPANT_FEEDBACK_SCOPE,
      schoolId: bontang.id,
      participantType: "Siswa",
    });

    expect(charts).toHaveLength(1);
    expect(charts[0]!.participantType).toBe("Siswa");
    expect(charts[0]!.figures).toMatchObject({ responseCount: 2, instructor: 7, handsOnRbl: 8 });
  });

  it("gives each bar its average card's value for the same scope with that Tipe Peserta picked", async () => {
    const { person, bontang } = await scene();
    for (const scope of [
      NO_PARTICIPANT_FEEDBACK_SCOPE,
      { ...NO_PARTICIPANT_FEEDBACK_SCOPE, schoolId: bontang.id },
    ] satisfies ParticipantFeedbackScope[]) {
      for (const chart of await loadParticipantFeedbackCharts(scope)) {
        const card = await participantFeedbackAverages(person, {
          ...scope,
          participantType: chart.participantType,
        });
        expect(chart.figures).toMatchObject(card);
      }
    }
  });

  it("reports an empty scope raw — no responses, no averages — never the cards' 0", async () => {
    const { balikpapan } = await scene();
    const charts = await loadParticipantFeedbackCharts({
      ...NO_PARTICIPANT_FEEDBACK_SCOPE,
      schoolId: balikpapan.id,
    });

    for (const chart of charts) {
      expect(chart.figures).toEqual({
        responseCount: 0,
        instructor: null,
        materials: null,
        relevance: null,
        handsOnRbl: null,
      });
    }
  });

  it("returns nothing for a Tipe Peserta that names nothing", async () => {
    await scene();
    const charts = await loadParticipantFeedbackCharts({
      ...NO_PARTICIPANT_FEEDBACK_SCOPE,
      participantType: "Guru" as FeedbackParticipantType,
    });
    expect(charts).toEqual([]);
  });
});
