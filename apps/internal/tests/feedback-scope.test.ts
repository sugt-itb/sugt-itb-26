import { randomUUID } from "node:crypto";

import {
  DEFAULT_FEEDBACK_SORT,
  NO_FEEDBACK_FILTERS,
  NO_PARTICIPANT_FEEDBACK_SCOPE,
  NO_PERJADIN_FEEDBACK_FILTERS,
  NO_PERJADIN_FEEDBACK_SCOPE,
  participantFeedbackAverages,
  participantFeedbackPage,
  participantFeedbackSchools,
  perjadinFeedbackAverages,
  perjadinFeedbackPage,
  perjadinFeedbackTrips,
  type FeedbackFilters,
  type FeedbackParticipantType,
  type ParticipantFeedbackScope,
  type PerjadinFeedbackFilters,
  type PerjadinFeedbackScope,
} from "@sugt/db/queries";
import type { PerjadinEvaluationRole } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addParticipantFeedback,
  addPerjadin,
  addPerjadinEvaluation,
  addPerson,
  addProvince,
  addSchool,
  addSchoolOnTrip,
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The Feedback tabs' scope** (#466): the Peserta tab narrowed to a School and one of its Sessions,
 * the Perjadin tab to a trip and a Peran pengisi. The scope ANDs with the score filters, and — unlike
 * them — narrows the four averages too. The pickers offer only what has responses, and each Session
 * carries its ADR-0027 Sesi, ranked over all the School's live Sessions of its mode.
 */

beforeEach(resetDatabase);

const signedIn = () =>
  addPerson({ fullName: "Rina Nurhayati", email: "rina@ditsama.itb.ac.id", role: "Staff" });

/**
 * SMAN 1 Bontang (WITA) has, offline: a cancelled Session (10-05) with one response, Sesi 1 (10-12)
 * with two, Sesi 2 (10-14) with none, Sesi 3 (10-16) with one; and online Sesi 1 (10-20) with one.
 * SMAN 2 Samarinda has an online Session with one response. SMAN 9 Balikpapan has a Session and none.
 * Instructor ratings: Bontang 8, 5, 9, 7, 10; Samarinda 3.
 */
async function participantScene() {
  const person = await signedIn();
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "kaltim", name: "Cluster Kaltim" });
  const school = (name: string) =>
    addSchool({ slug: randomUUID(), name, clusterId: cluster.id, provinceCode: "KT" });
  const [bontang, samarinda, balikpapan] = [
    await school("SMAN 1 Bontang"),
    await school("SMAN 2 Samarinda"),
    await school("SMAN 9 Balikpapan"),
  ];
  const trip = await addPerjadin({
    picPersonId: person.id,
    startsOn: "2026-10-05",
    endsOn: "2026-10-16",
  });
  const offline = (
    heldOn: string,
    startsAt: string,
    status: "arranged" | "cancelled" = "arranged",
  ) => addOfflineSession({ schoolId: bontang.id, heldOn, startsAt, status, perjadinId: trip.id });
  const sessions = {
    cancelled: await offline("2026-10-05", "08:00", "cancelled"),
    sesi1: await offline("2026-10-12", "08:00"),
    sesi2: await offline("2026-10-14", "09:00"),
    sesi3: await offline("2026-10-16", "09:00"),
    daring: await addSession({ schoolId: bontang.id, heldOn: "2026-10-20", startsAt: "10:00" }),
    samarinda: await addSession({ schoolId: samarinda.id, heldOn: "2026-10-01" }),
  };
  await addSession({ schoolId: balikpapan.id, heldOn: "2026-10-02" });
  const respond = (sessionId: string, instructor: number, name = "Siti") =>
    addParticipantFeedback({ sessionId, classKind: "GTK", name, ratings: { instructor } });
  await respond(sessions.cancelled.id, 8);
  await respond(sessions.sesi1.id, 5, "Ayu");
  await respond(sessions.sesi1.id, 9, "Budi");
  await respond(sessions.sesi3.id, 7);
  await respond(sessions.daring.id, 10);
  await respond(sessions.samarinda.id, 3);
  return { person, bontang, samarinda, sessions };
}

const page = (
  person: Awaited<ReturnType<typeof signedIn>>,
  scope: ParticipantFeedbackScope,
  filters: FeedbackFilters = NO_FEEDBACK_FILTERS,
) => participantFeedbackPage(person, { scope, filters, cursor: null, sort: DEFAULT_FEEDBACK_SORT });

/**
 * One Session at SMAN 1 Bontang and one at SMAN 2 Samarinda, each answered by every Class. Siswa rows
 * carry Hands-on RBL; GTK and MS rows have none. Instructor ratings: Bontang Siswa 9, GTK 6, MS 8;
 * Samarinda Siswa 4, GTK 10, MS 2.
 */
async function participantTypeScene() {
  const person = await signedIn();
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "kaltim", name: "Cluster Kaltim" });
  const school = (name: string) =>
    addSchool({ slug: randomUUID(), name, clusterId: cluster.id, provinceCode: "KT" });
  const bontang = await school("SMAN 1 Bontang");
  const samarinda = await school("SMAN 2 Samarinda");
  const bontangSession = await addSession({ schoolId: bontang.id, heldOn: "2026-10-12" });
  const samarindaSession = await addSession({ schoolId: samarinda.id, heldOn: "2026-10-13" });
  for (const [sessionId, siswa, gtk, ms] of [
    [bontangSession.id, 9, 6, 8],
    [samarindaSession.id, 4, 10, 2],
  ] as const) {
    await addParticipantFeedback({
      sessionId,
      classKind: "Student",
      name: "Siswa",
      ratings: { instructor: siswa, handsOnRbl: siswa },
    });
    await addParticipantFeedback({
      sessionId,
      classKind: "GTK",
      name: "Guru",
      ratings: { instructor: gtk },
    });
    await addParticipantFeedback({
      sessionId,
      classKind: "MS",
      name: "Kepala",
      ratings: { instructor: ms },
    });
  }
  return { person, bontang, bontangSession };
}

describe("the Peserta tab's Tipe Peserta (#487)", () => {
  const typed = (participantType: FeedbackParticipantType | null): ParticipantFeedbackScope => ({
    ...NO_PARTICIPANT_FEEDBACK_SCOPE,
    participantType,
  });

  it("keeps the Student Class under Siswa, GTK and MS together under GTK-MS, and all under Semua", async () => {
    const { person } = await participantTypeScene();

    const classes = async (participantType: FeedbackParticipantType | null) =>
      (await page(person, typed(participantType))).rows.map((row) => row.classKind).toSorted();

    expect(await classes(null)).toEqual(["GTK", "GTK", "MS", "MS", "Student", "Student"]);
    expect(await classes("Siswa")).toEqual(["Student", "Student"]);
    expect(await classes("GTK-MS")).toEqual(["GTK", "GTK", "MS", "MS"]);
  });

  it("narrows the four averages, and leaves Hands-on RBL unrated under GTK-MS", async () => {
    const { person } = await participantTypeScene();

    const semua = await participantFeedbackAverages(person, typed(null));
    const siswa = await participantFeedbackAverages(person, typed("Siswa"));
    const gtkMs = await participantFeedbackAverages(person, typed("GTK-MS"));

    expect(semua.instructor).toBeCloseTo((9 + 6 + 8 + 4 + 10 + 2) / 6, 5);
    expect(semua.handsOnRbl).toBeCloseTo((9 + 4) / 2, 5);
    expect(siswa.instructor).toBeCloseTo((9 + 4) / 2, 5);
    expect(siswa.handsOnRbl).toBeCloseTo((9 + 4) / 2, 5);
    expect(gtkMs.instructor).toBeCloseTo((6 + 8 + 10 + 2) / 4, 5);
    expect(gtkMs.handsOnRbl).toBeNull();
  });

  it("ANDs with the School, the Session and the score filters, lowest average first", async () => {
    const { person, bontang, bontangSession } = await participantTypeScene();

    const atBontang = await page(person, { ...typed("GTK-MS"), schoolId: bontang.id });
    expect(atBontang.rows.map((row) => [row.classKind, row.instructor])).toEqual([
      ["GTK", 6],
      ["MS", 8],
    ]);
    expect(
      (await participantFeedbackAverages(person, { ...typed("GTK-MS"), schoolId: bontang.id }))
        .instructor,
    ).toBeCloseTo(7, 5);

    const atSesi = await page(person, {
      schoolId: bontang.id,
      sessionId: bontangSession.id,
      participantType: "Siswa",
    });
    expect(atSesi.rows.map((row) => [row.classKind, row.instructor])).toEqual([["Student", 9]]);

    const low = await page(person, typed("GTK-MS"), { ...NO_FEEDBACK_FILTERS, instructor: "le7" });
    expect(low.rows.map((row) => [row.classKind, row.instructor])).toEqual([
      ["MS", 2],
      ["GTK", 6],
    ]);
  });
});

describe("the Peserta tab's Sekolah and Sesi", () => {
  it("offers only Schools with responses, by name, each with its responded Sessions by date", async () => {
    const { person, bontang, samarinda, sessions } = await participantScene();

    const schools = await participantFeedbackSchools(person);

    expect(schools.map((school) => [school.id, school.name])).toEqual([
      [bontang.id, "SMAN 1 Bontang"],
      [samarinda.id, "SMAN 2 Samarinda"],
    ]);
    // Sesi 2 has no response, so it is not offered — but it still counts toward Sesi 3's number. The
    // cancelled Session has no Sesi, and the online one is ranked among the online Sessions alone.
    expect(schools[0]!.sessions).toEqual([
      {
        id: sessions.cancelled.id,
        mode: "offline",
        sesi: null,
        heldOn: "2026-10-05",
        startsAt: "08:00:00",
        timeZone: "WITA",
      },
      {
        id: sessions.sesi1.id,
        mode: "offline",
        sesi: 1,
        heldOn: "2026-10-12",
        startsAt: "08:00:00",
        timeZone: "WITA",
      },
      {
        id: sessions.sesi3.id,
        mode: "offline",
        sesi: 3,
        heldOn: "2026-10-16",
        startsAt: "09:00:00",
        timeZone: "WITA",
      },
      // Online is always WIB, whatever the School's Province (#283).
      {
        id: sessions.daring.id,
        mode: "online",
        sesi: 1,
        heldOn: "2026-10-20",
        startsAt: "10:00:00",
        timeZone: "WIB",
      },
    ]);
  });

  it("narrows the list to a School, then to one of its Sessions, each row carrying its Sesi", async () => {
    const { person, bontang, sessions } = await participantScene();

    const school = await page(person, { ...NO_PARTICIPANT_FEEDBACK_SCOPE, schoolId: bontang.id });
    expect(school.rows).toHaveLength(5);
    expect(new Set(school.rows.map((row) => row.schoolName))).toEqual(new Set(["SMAN 1 Bontang"]));
    expect(
      Object.fromEntries(school.rows.map((row) => [row.sessionId, [row.sesi, row.timeZone]])),
    ).toEqual({
      [sessions.cancelled.id]: [null, "WITA"],
      [sessions.sesi1.id]: [1, "WITA"],
      [sessions.sesi3.id]: [3, "WITA"],
      [sessions.daring.id]: [1, "WIB"],
    });

    const sesi1 = await page(person, {
      ...NO_PARTICIPANT_FEEDBACK_SCOPE,
      schoolId: bontang.id,
      sessionId: sessions.sesi1.id,
    });
    expect(sesi1.rows.map((row) => row.name).toSorted()).toEqual(["Ayu", "Budi"]);
  });

  it("ANDs the scope with the score filters", async () => {
    const { person, bontang } = await participantScene();

    const low = await page(
      person,
      { ...NO_PARTICIPANT_FEEDBACK_SCOPE, schoolId: bontang.id },
      { ...NO_FEEDBACK_FILTERS, instructor: "le7" },
    );

    expect(low.rows.map((row) => row.instructor).toSorted()).toEqual([5, 7]);
  });

  it("averages over the scope, and never over the score filters", async () => {
    const { person, bontang, sessions } = await participantScene();

    const everywhere = await participantFeedbackAverages(person, NO_PARTICIPANT_FEEDBACK_SCOPE);
    const school = await participantFeedbackAverages(person, {
      ...NO_PARTICIPANT_FEEDBACK_SCOPE,
      schoolId: bontang.id,
    });
    const sesi1 = await participantFeedbackAverages(person, {
      ...NO_PARTICIPANT_FEEDBACK_SCOPE,
      schoolId: bontang.id,
      sessionId: sessions.sesi1.id,
    });

    expect(everywhere.instructor).toBeCloseTo((8 + 5 + 9 + 7 + 10 + 3) / 6, 5);
    expect(school.instructor).toBeCloseTo((8 + 5 + 9 + 7 + 10) / 5, 5);
    expect(sesi1.instructor).toBeCloseTo(7, 5);
  });

  it("reads an unknown or malformed id, or a Session at another School, as empty — not an error", async () => {
    const { person, bontang, sessions } = await participantScene();
    const empty = { handsOnRbl: null, instructor: 0, materials: 0, relevance: 0 };

    for (const scope of [
      { ...NO_PARTICIPANT_FEEDBACK_SCOPE, schoolId: "bukan-id" },
      { ...NO_PARTICIPANT_FEEDBACK_SCOPE, schoolId: randomUUID() },
      { ...NO_PARTICIPANT_FEEDBACK_SCOPE, schoolId: bontang.id, sessionId: "bukan-id" },
      { ...NO_PARTICIPANT_FEEDBACK_SCOPE, schoolId: bontang.id, sessionId: sessions.samarinda.id },
      // A Tipe Peserta that names nothing, as a forged Server Action call could send (#487).
      { ...NO_PARTICIPANT_FEEDBACK_SCOPE, participantType: "Guru" as FeedbackParticipantType },
    ]) {
      await expect(page(person, scope)).resolves.toEqual({ rows: [], nextCursor: null, total: 0 });
      await expect(participantFeedbackAverages(person, scope)).resolves.toEqual(empty);
    }
  });
});

/**
 * Three trips: Kelompok 10 (12–13 Okt, SMAN 1 Bontang) evaluated by a Narasumber (Ketepatan Waktu 4)
 * and a Pendamping (8); Kelompok 3 (1–3 Sep) by a Pimpinan (9); Kelompok 7 by nobody.
 */
async function perjadinScene() {
  const person = await signedIn();
  const trip = (subClusterName: string, startsOn: string, endsOn: string) =>
    addPerjadin({ picPersonId: person.id, subClusterName, startsOn, endsOn });
  const k10 = await trip("Kelompok 10", "2026-10-12", "2026-10-13");
  const k3 = await trip("Kelompok 3", "2026-09-01", "2026-09-03");
  await trip("Kelompok 7", "2026-08-01", "2026-08-02");
  await addSchoolOnTrip({ perjadin: k10, name: "SMAN 1 Bontang" });
  const evaluate = (perjadinId: string, role: PerjadinEvaluationRole, punctuality: number) =>
    addPerjadinEvaluation({ perjadinId, role, ratings: { punctuality } });
  await evaluate(k10.id, "Narasumber", 4);
  await evaluate(k10.id, "Pendamping", 8);
  await evaluate(k3.id, "Pimpinan", 9);
  return { person, k10, k3 };
}

const perjadinPage = (
  person: Awaited<ReturnType<typeof signedIn>>,
  scope: PerjadinFeedbackScope,
  filters: PerjadinFeedbackFilters = NO_PERJADIN_FEEDBACK_FILTERS,
) => perjadinFeedbackPage(person, { scope, filters, cursor: null, sort: DEFAULT_FEEDBACK_SORT });

describe("the Perjadin tab's Perjadin and Peran pengisi", () => {
  it("offers only trips with evaluations, earliest first, with their Schools", async () => {
    const { person, k10, k3 } = await perjadinScene();

    await expect(perjadinFeedbackTrips(person)).resolves.toEqual([
      {
        id: k3.id,
        subClusterName: "Kelompok 3",
        startsOn: "2026-09-01",
        endsOn: "2026-09-03",
        schoolNames: [],
      },
      {
        id: k10.id,
        subClusterName: "Kelompok 10",
        startsOn: "2026-10-12",
        endsOn: "2026-10-13",
        schoolNames: ["SMAN 1 Bontang"],
      },
    ]);
  });

  it("narrows the list to a trip and to a Peran, ANDed with the score filters", async () => {
    const { person, k10 } = await perjadinScene();
    const roles = async (scope: PerjadinFeedbackScope, filters?: PerjadinFeedbackFilters) =>
      (await perjadinPage(person, scope, filters)).rows.map((row) => row.filedByRole).toSorted();

    await expect(roles({ perjadinId: k10.id, role: null })).resolves.toEqual([
      "Narasumber",
      "Pendamping",
    ]);
    await expect(roles({ perjadinId: null, role: "Pimpinan" })).resolves.toEqual(["Pimpinan"]);
    await expect(roles({ perjadinId: k10.id, role: "Pimpinan" })).resolves.toEqual([]);
    await expect(
      roles(
        { perjadinId: k10.id, role: null },
        { ...NO_PERJADIN_FEEDBACK_FILTERS, punctuality: "le7" },
      ),
    ).resolves.toEqual(["Narasumber"]);
  });

  it("averages over the scope, and never over the score filters", async () => {
    const { person, k10 } = await perjadinScene();
    const punctuality = async (scope: PerjadinFeedbackScope) =>
      (await perjadinFeedbackAverages(person, scope)).punctuality;

    await expect(punctuality(NO_PERJADIN_FEEDBACK_SCOPE)).resolves.toBeCloseTo(7, 5);
    await expect(punctuality({ perjadinId: k10.id, role: null })).resolves.toBeCloseTo(6, 5);
    await expect(punctuality({ perjadinId: null, role: "Pimpinan" })).resolves.toBeCloseTo(9, 5);
  });

  it("reads an unknown or malformed trip, or an unknown Peran, as empty — not an error", async () => {
    const { person } = await perjadinScene();
    const empty = { lodging: 0, transport: 0, meals: 0, punctuality: 0, pendampingSupport: null };

    for (const scope of [
      { perjadinId: "bukan-id", role: null },
      { perjadinId: randomUUID(), role: null },
      { perjadinId: null, role: "Bendahara" as PerjadinEvaluationRole },
    ]) {
      await expect(perjadinPage(person, scope)).resolves.toEqual({
        rows: [],
        nextCursor: null,
        total: 0,
      });
      await expect(perjadinFeedbackAverages(person, scope)).resolves.toEqual(empty);
    }
  });
});
