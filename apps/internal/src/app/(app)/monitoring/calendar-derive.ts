import type { MonitoringData } from "@sugt/db/queries";

/**
 * **The pure core of the `/monitoring` Calendar**, a sibling of `monitoring-derive.ts` and driven
 * the same way: no React, no DOM, no database. It folds the raw `monitoringData` payload into a map
 * of calendar date → the ordered, deduped, priority-sorted markers that day carries, so the sibling
 * UI ticket only renders. Every scheduling rule the calendar shows — which day gets an offline,
 * Monev, online or pretest/posttest marker — lives here as a fold over the arguments, testable
 * against a hand-built fixture rather than a live database.
 */

/**
 * The ten marker types a day can carry. `offline-cluster-N` / `online-cluster-N` name a Cluster by
 * its 1–4 index (the same left-to-right order the Luring/Daring matrices use); `monev` a trip with a
 * Pimpinan; `pretest-posttest` the fixed testing windows. The fill colours are the taxonomy this
 * ticket owns — the UI reads them from `MARKER_FILL` rather than re-typing the hexes.
 */
export type MarkerType =
  | "offline-cluster-1"
  | "offline-cluster-2"
  | "offline-cluster-3"
  | "offline-cluster-4"
  | "monev"
  | "online-cluster-1"
  | "online-cluster-2"
  | "online-cluster-3"
  | "online-cluster-4"
  | "pretest-posttest";

/**
 * Fixed render priority: offline Clusters, then Monev, then online Clusters, then pretest/posttest.
 * Folding a day's marker set in this order dedups and priority-sorts in one pass, and doubles as the
 * truncation order — the first `MAX_MARKERS_PER_DAY` win.
 */
const MARKER_PRIORITY: readonly MarkerType[] = [
  "offline-cluster-1",
  "offline-cluster-2",
  "offline-cluster-3",
  "offline-cluster-4",
  "monev",
  "online-cluster-1",
  "online-cluster-2",
  "online-cluster-3",
  "online-cluster-4",
  "pretest-posttest",
];

/**
 * Two rows of four dots. More than eight distinct markers on one day is practically impossible
 * (it would need every Cluster active offline *and* online plus Monev plus a test window all at
 * once), but truncation is a documented safety rule so the grid never overflows its cell.
 */
export const MAX_MARKERS_PER_DAY = 8;

/** Inner fill per marker; the stroke is always `MARKER_STROKE`. The UI's single source for both. */
export const MARKER_FILL: Record<MarkerType, string> = {
  "offline-cluster-1": "#FF4D4D",
  "offline-cluster-2": "#00BFFF",
  "offline-cluster-3": "#03FF03",
  "offline-cluster-4": "#FFFF00",
  monev: "#888888",
  "online-cluster-1": "#8B0000",
  "online-cluster-2": "#00008B",
  "online-cluster-3": "#006400",
  "online-cluster-4": "#ADAD00",
  "pretest-posttest": "#FFFFFF",
};

/** Every marker is drawn with the same black stroke; only the fill distinguishes them. */
export const MARKER_STROKE = "#000000";

/**
 * The fixed pretest/posttest windows, hardcoded in this one place. Every day in either inclusive
 * range carries a single `pretest-posttest` marker regardless of any scheduling data.
 */
const PRETEST_POSTTEST_RANGES: readonly { startsOn: string; endsOn: string }[] = [
  { startsOn: "2026-09-18", endsOn: "2026-09-20" },
  { startsOn: "2026-12-01", endsOn: "2026-12-05" },
];

/**
 * Each `YYYY-MM-DD` from `startsOn` to `endsOn` inclusive. Dates are parsed as UTC midnight and
 * stepped by whole days in milliseconds — UTC has no daylight saving, so a span never gains or
 * loses a day the way local-time arithmetic can across a clock change.
 */
function* eachDay(startsOn: string, endsOn: string): Generator<string> {
  let cur = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  const DAY_MS = 86_400_000;
  for (; cur <= end; cur += DAY_MS) {
    yield new Date(cur).toISOString().slice(0, 10);
  }
}

/**
 * Map each Cluster id to its 1–4 index by position in `clusters`, which arrives in the same order
 * the Luring/Daring matrix columns render (`monitoringData` orders it once). Reusing that order is
 * what makes a day's calendar colour line up with its "Klaster N" column.
 */
function clusterIndexById(clusters: MonitoringData["clusters"]): Map<string, number> {
  const byId = new Map<string, number>();
  clusters.forEach((c, i) => byId.set(c.id, i + 1));
  return byId;
}

/** Add `marker` to `day`'s set, creating the set on first touch. */
function mark(byDay: Map<string, Set<MarkerType>>, day: string, marker: MarkerType): void {
  const set = byDay.get(day);
  if (set) set.add(marker);
  else byDay.set(day, new Set([marker]));
}

/**
 * Fold the raw `monitoringData` payload into `date → markers`. The result covers **every** date the
 * data touches (not just one month) so the UI can navigate to any month without a refetch, and each
 * day's list is deduped, ordered by `MARKER_PRIORITY`, and truncated to `MAX_MARKERS_PER_DAY`.
 *
 * - **Offline cluster N** — every day within any Perjadin span whose Cluster is N (overlapping spans
 *   union; a gap between two spans stays empty), one marker per Cluster per day.
 * - **Monev** — every day within any Perjadin span with a Pimpinan, one marker per day however many
 *   such spans overlap.
 * - **Online cluster N** — the `heldOn` of any non-cancelled online Session whose School is in
 *   Cluster N, one marker per Cluster per day.
 * - **Pretest/Posttest** — the two fixed windows, injected unconditionally.
 */
export function deriveCalendarMarkers(data: MonitoringData): Record<string, MarkerType[]> {
  const clusterIndex = clusterIndexById(data.clusters);
  const byDay = new Map<string, Set<MarkerType>>();

  // Offline Cluster spans, and Monev over the Pimpinan subset of the same spans.
  for (const span of data.perjadinSpans) {
    const n = clusterIndex.get(span.clusterId);
    for (const day of eachDay(span.startsOn, span.endsOn)) {
      if (n !== undefined) mark(byDay, day, `offline-cluster-${n}` as MarkerType);
      if (span.hasPimpinan) mark(byDay, day, "monev");
    }
  }

  // Online Cluster markers land on the single day each online Session is held.
  for (const s of data.sessions) {
    if (s.mode !== "online" || s.status === "cancelled") continue;
    const n = clusterIndex.get(s.clusterId);
    if (n !== undefined) mark(byDay, s.heldOn, `online-cluster-${n}` as MarkerType);
  }

  // The fixed testing windows, independent of any scheduling data.
  for (const range of PRETEST_POSTTEST_RANGES) {
    for (const day of eachDay(range.startsOn, range.endsOn)) mark(byDay, day, "pretest-posttest");
  }

  // Order each day by fixed priority (which also dedups) and cap it at two rows of four.
  const markers: Record<string, MarkerType[]> = {};
  for (const [day, set] of byDay) {
    markers[day] = MARKER_PRIORITY.filter((m) => set.has(m)).slice(0, MAX_MARKERS_PER_DAY);
  }
  return markers;
}
