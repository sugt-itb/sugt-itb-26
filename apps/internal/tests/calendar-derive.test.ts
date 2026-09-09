import {
  deriveCalendarMarkers,
  MAX_MARKERS_PER_DAY,
  type MarkerType,
} from "-/app/(app)/monitoring/calendar-derive";
import type { MonitoringData, MonitoringSession, PerjadinSpan } from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

/**
 * **The pure `/monitoring` Calendar fold, tested with no database and no DOM.**
 *
 * Like `monitoring-derive.test.ts`, this file hands `calendar-derive.ts` a hand-built
 * `monitoringData` payload and asserts on the `date → markers` map it returns — the range unions,
 * the per-Cluster/per-day dedup, the fixed test windows, the priority order and the truncation are
 * assertions here rather than pixels nobody can drive. All dates avoid the two pretest/posttest
 * windows unless the case is about them, so an injected marker never surprises an unrelated assert.
 */

/** Four Clusters in matrix order, so their 1–4 indices are `c1→1 … c4→4`. */
const CLUSTERS = [
  { id: "c1", name: "Klaster 1" },
  { id: "c2", name: "Klaster 2" },
  { id: "c3", name: "Klaster 3" },
  { id: "c4", name: "Klaster 4" },
];

/** A `MonitoringData` with empty scheduling data, overridden with only what a case is about. */
function data(over: Partial<MonitoringData> = {}): MonitoringData {
  return {
    clusters: CLUSTERS,
    schools: [],
    sessions: [],
    perjadinSpans: [],
    budgetUsedIdr: 0,
    ...over,
  };
}

/** A Perjadin span; `hasPimpinan` defaults off so a case names Monev only when it means it. */
function span(
  over: Partial<PerjadinSpan> & Pick<PerjadinSpan, "clusterId" | "startsOn" | "endsOn">,
): PerjadinSpan {
  return { hasPimpinan: false, ...over };
}

/** An online Session held on one day in a Cluster; the fields the fold ignores are defaulted. */
function online(
  clusterId: string,
  heldOn: string,
  over: Partial<MonitoringSession> = {},
): MonitoringSession {
  return {
    schoolId: crypto.randomUUID(),
    clusterId,
    mode: "online",
    heldOn,
    startsAt: "09:00",
    id: crypto.randomUUID(),
    status: "delivered",
    ...over,
  };
}

describe("deriveCalendarMarkers — offline Cluster spans", () => {
  it("unions two spans of one Cluster and leaves the gap between them empty", () => {
    const markers = deriveCalendarMarkers(
      data({
        perjadinSpans: [
          span({ clusterId: "c1", startsOn: "2026-10-13", endsOn: "2026-10-16" }),
          span({ clusterId: "c1", startsOn: "2026-10-18", endsOn: "2026-10-20" }),
        ],
      }),
    );
    expect(markers["2026-10-13"]).toEqual(["offline-cluster-1"]);
    expect(markers["2026-10-16"]).toEqual(["offline-cluster-1"]);
    expect(markers["2026-10-17"]).toBeUndefined(); // the 17th is in neither span
    expect(markers["2026-10-18"]).toEqual(["offline-cluster-1"]);
    expect(markers["2026-10-20"]).toEqual(["offline-cluster-1"]);
    expect(markers["2026-10-21"]).toBeUndefined();
  });

  it("draws one marker per Cluster per day however many perjadin of that Cluster overlap", () => {
    const markers = deriveCalendarMarkers(
      data({
        perjadinSpans: [
          span({ clusterId: "c1", startsOn: "2026-10-10", endsOn: "2026-10-12" }),
          span({ clusterId: "c1", startsOn: "2026-10-11", endsOn: "2026-10-13" }),
        ],
      }),
    );
    expect(markers["2026-10-11"]).toEqual(["offline-cluster-1"]);
    expect(markers["2026-10-12"]).toEqual(["offline-cluster-1"]);
  });
});

describe("deriveCalendarMarkers — Monev", () => {
  it("draws one Monev per day even when two Pimpinan-perjadin cover it", () => {
    const markers = deriveCalendarMarkers(
      data({
        perjadinSpans: [
          span({
            clusterId: "c1",
            startsOn: "2026-10-10",
            endsOn: "2026-10-10",
            hasPimpinan: true,
          }),
          span({
            clusterId: "c2",
            startsOn: "2026-10-10",
            endsOn: "2026-10-10",
            hasPimpinan: true,
          }),
        ],
      }),
    );
    expect(markers["2026-10-10"]).toEqual(["offline-cluster-1", "offline-cluster-2", "monev"]);
  });

  it("carries Monev across a span that crosses a month boundary (28 Sep – 2 Oct)", () => {
    const markers = deriveCalendarMarkers(
      data({
        perjadinSpans: [
          span({
            clusterId: "c3",
            startsOn: "2026-09-28",
            endsOn: "2026-10-02",
            hasPimpinan: true,
          }),
        ],
      }),
    );
    for (const day of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]) {
      expect(markers[day]).toEqual(["offline-cluster-3", "monev"]);
    }
    expect(markers["2026-09-27"]).toBeUndefined();
    expect(markers["2026-10-03"]).toBeUndefined();
  });

  it("draws no Monev for a span without a Pimpinan", () => {
    const markers = deriveCalendarMarkers(
      data({
        perjadinSpans: [span({ clusterId: "c1", startsOn: "2026-10-10", endsOn: "2026-10-10" })],
      }),
    );
    expect(markers["2026-10-10"]).toEqual(["offline-cluster-1"]);
  });
});

describe("deriveCalendarMarkers — online sessions", () => {
  it("draws one online marker per Cluster per day across duplicate sessions", () => {
    const markers = deriveCalendarMarkers(
      data({ sessions: [online("c2", "2026-10-15"), online("c2", "2026-10-15")] }),
    );
    expect(markers["2026-10-15"]).toEqual(["online-cluster-2"]);
  });

  it("ignores a cancelled online session", () => {
    const markers = deriveCalendarMarkers(
      data({ sessions: [online("c2", "2026-10-15", { status: "cancelled" })] }),
    );
    expect(markers["2026-10-15"]).toBeUndefined();
  });
});

describe("deriveCalendarMarkers — pretest/posttest windows", () => {
  it("injects a single pretest-posttest marker across both fixed windows and nowhere else", () => {
    const markers = deriveCalendarMarkers(data());
    for (const day of ["2026-09-18", "2026-09-19", "2026-09-20"]) {
      expect(markers[day]).toEqual(["pretest-posttest"]);
    }
    for (const day of ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]) {
      expect(markers[day]).toEqual(["pretest-posttest"]);
    }
    expect(markers["2026-09-17"]).toBeUndefined();
    expect(markers["2026-09-21"]).toBeUndefined();
    expect(markers["2026-11-30"]).toBeUndefined();
    expect(markers["2026-12-06"]).toBeUndefined();
  });
});

describe("deriveCalendarMarkers — ordering and overflow", () => {
  it("orders a day offline → monev → online → pretest/posttest", () => {
    const markers = deriveCalendarMarkers(
      data({
        perjadinSpans: [
          span({
            clusterId: "c1",
            startsOn: "2026-09-18",
            endsOn: "2026-09-18",
            hasPimpinan: true,
          }),
        ],
        sessions: [online("c1", "2026-09-18")],
      }),
    );
    // 2026-09-18 is also a pretest day, so all four kinds land together.
    expect(markers["2026-09-18"]).toEqual([
      "offline-cluster-1",
      "monev",
      "online-cluster-1",
      "pretest-posttest",
    ]);
  });

  it("truncates a day carrying all ten marker types to the first eight by priority", () => {
    const day = "2026-09-18"; // a pretest day, so pretest-posttest is the tenth
    const markers = deriveCalendarMarkers(
      data({
        perjadinSpans: [
          span({ clusterId: "c1", startsOn: day, endsOn: day, hasPimpinan: true }),
          span({ clusterId: "c2", startsOn: day, endsOn: day }),
          span({ clusterId: "c3", startsOn: day, endsOn: day }),
          span({ clusterId: "c4", startsOn: day, endsOn: day }),
        ],
        sessions: [online("c1", day), online("c2", day), online("c3", day), online("c4", day)],
      }),
    );
    const got = markers[day];
    expect(got).toHaveLength(MAX_MARKERS_PER_DAY);
    const expected: MarkerType[] = [
      "offline-cluster-1",
      "offline-cluster-2",
      "offline-cluster-3",
      "offline-cluster-4",
      "monev",
      "online-cluster-1",
      "online-cluster-2",
      "online-cluster-3",
    ];
    expect(got).toEqual(expected); // online-cluster-4 and pretest-posttest fall off the end
  });
});
