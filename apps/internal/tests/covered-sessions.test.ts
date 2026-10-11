import { CoveredSessionsNote } from "-/components/covered-sessions-note";
import { perjadinDetail, perjadinPlan, planPerjadin } from "@sugt/db/queries";
import { rankBySchool } from "@sugt/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  addSubCluster,
  asEditor,
  resetDatabase,
} from "./support/fixtures";

/**
 * **What is already covered** (#409): each School's live offline Sessions on other Perjadins, on the
 * plan form (`perjadinPlan`) and in the trip page's add/edit-Session picker (`perjadinDetail`'s
 * `eligibleSchools`, this trip left out). Read-only — nothing new is refused. Against the real
 * database.
 */

/**
 * Kelompok 10 in Kalimantan Timur (WITA), with SMAN 1 Bontang and SMAN 2 Samarinda, and three trips
 * covering it a week apart. Bontang has a live offline Session on each — Sesi 1 on A, 2 on B, 3 on C
 * — plus a cancelled one on A before them all and an online Session, neither of which counts.
 * Samarinda has none.
 */
async function scene() {
  // An Editor: the plan form's read needs the Grant (ADR-0047).
  const pic = await asEditor(
    await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" }),
  );
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "kaltim", name: "Cluster Kaltim" });
  const subCluster = await addSubCluster({
    slug: "kelompok-10",
    name: "Kelompok 10",
    clusterId: cluster.id,
  });
  const school = (slug: string, name: string) =>
    addSchool({
      slug,
      name,
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "KT",
    });
  const bontang = await school("sman-1-bontang", "SMAN 1 Bontang");
  const samarinda = await school("sman-2-samarinda", "SMAN 2 Samarinda");
  const trip = (startsOn: string, endsOn: string) =>
    addPerjadin({
      subClusterId: subCluster.id,
      picPersonId: pic.id,
      startsOn,
      endsOn,
    });
  const a = await trip("2026-10-12", "2026-10-13");
  const b = await trip("2026-10-19", "2026-10-20");
  const c = await trip("2026-10-26", "2026-10-27");
  const offline = (perjadinId: string, heldOn: string, status?: "cancelled") =>
    addOfflineSession({ schoolId: bontang.id, heldOn, startsAt: "08:00", perjadinId, status });
  await offline(a.id, "2026-10-12", "cancelled");
  await offline(a.id, "2026-10-13");
  await offline(b.id, "2026-10-19");
  await offline(c.id, "2026-10-26");
  await addSession({ schoolId: bontang.id, heldOn: "2026-10-01" });
  return { pic, subCluster, bontang, samarinda, a, b, c };
}

const tripParts = (trip: { id: string; startsOn: string; endsOn: string }) => ({
  id: trip.id,
  subClusterName: "Kelompok 10",
  startsOn: trip.startsOn,
  endsOn: trip.endsOn,
});

beforeEach(async () => {
  await resetDatabase();
});

describe("the plan form", () => {
  it("lists each School's live offline Sessions, ranked over all of them, with their trips", async () => {
    const { pic, bontang, samarinda, a, b, c } = await scene();

    const plan = await perjadinPlan(pic);
    const schools = plan.subClusters.flatMap((entry) => entry.schools);

    expect(schools.find((row) => row.id === bontang.id)?.offlineSessionsElsewhere).toEqual([
      {
        sesi: 1,
        heldOn: "2026-10-13",
        startsAt: "08:00:00",
        timeZone: "WITA",
        perjadin: tripParts(a),
      },
      {
        sesi: 2,
        heldOn: "2026-10-19",
        startsAt: "08:00:00",
        timeZone: "WITA",
        perjadin: tripParts(b),
      },
      {
        sesi: 3,
        heldOn: "2026-10-26",
        startsAt: "08:00:00",
        timeZone: "WITA",
        perjadin: tripParts(c),
      },
    ]);
    expect(schools.find((row) => row.id === samarinda.id)?.offlineSessionsElsewhere).toEqual([]);
  });

  it("refuses nothing new: a School with offline Sessions elsewhere can still be planned", async () => {
    const { pic, subCluster, bontang } = await scene();

    await expect(
      planPerjadin(pic, {
        subClusterId: subCluster.id,
        picPersonId: pic.id,
        teacherNames: [],
        pimpinan: [],
        sessions: [
          {
            schoolId: bontang.id,
            heldOn: "2026-11-02",
            startsAt: "08:00",
            taughtByTeacherIndexes: [],
          },
        ],
        startsOn: "2026-11-02",
        endsOn: "2026-11-02",
      }),
    ).resolves.toMatchObject({ outcome: "planned" });
  });
});

describe("the trip page's Session picker", () => {
  it("still offers the whole Sub-Cluster, and leaves this trip's own Sessions out", async () => {
    const { pic, bontang, samarinda, a, b, c } = await scene();

    const detail = await perjadinDetail(pic, b.id);
    const eligible = detail?.eligibleSchools ?? [];

    expect(eligible.map((row) => row.id).sort()).toEqual([bontang.id, samarinda.id].sort());
    // Sesi 2 is B's own — left out — and the others keep the rank they have over all three trips.
    expect(eligible.find((row) => row.id === bontang.id)?.offlineSessionsElsewhere).toEqual([
      {
        sesi: 1,
        heldOn: "2026-10-13",
        startsAt: "08:00:00",
        timeZone: "WITA",
        perjadin: tripParts(a),
      },
      {
        sesi: 3,
        heldOn: "2026-10-26",
        startsAt: "08:00:00",
        timeZone: "WITA",
        perjadin: tripParts(c),
      },
    ]);
    expect(eligible.find((row) => row.id === samarinda.id)?.offlineSessionsElsewhere).toEqual([]);
  });
});

describe("the Sesi number (ADR-0027)", () => {
  it("is one rank per School across trips, skipping nothing it is not given", () => {
    const ranked = rankBySchool([
      { id: "b", schoolId: "s1", heldOn: "2026-10-19", startsAt: "08:00" },
      { id: "a", schoolId: "s1", heldOn: "2026-10-13", startsAt: "08:00" },
      { id: "c", schoolId: "s2", heldOn: "2026-10-01", startsAt: "08:00" },
    ]);

    expect(ranked.get("s1")?.map((row) => row.id)).toEqual(["a", "b"]);
    expect(ranked.get("s2")?.map((row) => row.id)).toEqual(["c"]);
  });
});

describe("the note", () => {
  it("reads Sesi, date and time in the School's zone, and links the trip by its name", () => {
    const html = renderToStaticMarkup(
      createElement(CoveredSessionsNote, {
        sessions: [
          {
            sesi: 1,
            heldOn: "2026-10-12",
            startsAt: "08:00:00",
            timeZone: "WITA",
            perjadin: {
              id: "trip-a",
              subClusterName: "Kelompok 10",
              startsOn: "2026-10-12",
              endsOn: "2026-10-13",
            },
          },
        ],
        empty: "Belum ada Sesi luring",
      }),
    );

    expect(html.replace(/<[^>]+>/g, "")).toBe(
      "Sesi 1 · 12 Okt 2026, 08:00 WITA · Kelompok 10 · 12–13 Okt 2026",
    );
    expect(html).toContain('href="/perjadin/trip-a"');
  });

  it("says so when a School has none", () => {
    const html = renderToStaticMarkup(
      createElement(CoveredSessionsNote, { sessions: [], empty: "Belum ada Sesi luring" }),
    );

    expect(html.replace(/<[^>]+>/g, "")).toBe("Belum ada Sesi luring");
  });
});
