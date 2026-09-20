import type { AssessmentCompletion, PretestCluster, PretestSchool } from "@sugt/db/queries";
import { PRETEST_PARTICIPANT_TYPES, STREAMS } from "@sugt/domain";
import type { PretestParticipantType, Stream } from "@sugt/domain";

/**
 * **The `/pretest` grid's pure seam** (ticket #247). Grouping the forty-two Schools under their
 * Clusters, the name-search filter, and the completion-key helpers — all folded here so the client
 * component (`pretest-editor.tsx`) stays a thin optimistic shell and this logic is unit-testable
 * without a DOM, the same split `monitoring-derive.ts` and `_calendar/calendar-derive.ts` follow.
 */

/**
 * The four checkbox columns, in render order: STEM·Siswa, STEM·GTK-MS, Research·Siswa,
 * Research·GTK-MS. Derived from the domain consts (`STREAMS × PRETEST_PARTICIPANT_TYPES`) rather
 * than written out, so the grid cannot drift from the vocabulary the CHECK constraints mirror.
 */
export type PretestColumn = { stream: Stream; participantType: PretestParticipantType };

export const PRETEST_COLUMNS: readonly PretestColumn[] = STREAMS.flatMap((stream) =>
  PRETEST_PARTICIPANT_TYPES.map((participantType) => ({ stream, participantType })),
);

/** A column's stable React key — `stream|participantType`, independent of any School. */
export function columnKey(column: PretestColumn): string {
  return `${column.stream}|${column.participantType}`;
}

/**
 * One box's key — `schoolId|stream|participantType`. The stable identity a completion is looked up
 * and toggled by; `kind` is not part of it because this screen is pretest-only.
 */
export function completionKey(
  schoolId: string,
  stream: Stream,
  participantType: PretestParticipantType,
): string {
  return `${schoolId}|${stream}|${participantType}`;
}

/** The set of ticked box keys from the completion rows — the client's optimistic base. */
export function completionKeySet(completions: AssessmentCompletion[]): Set<string> {
  return new Set(completions.map((c) => completionKey(c.schoolId, c.stream, c.participantType)));
}

/** One Cluster with the Schools that survived the search filter, in name order. */
export type PretestClusterGroup = {
  id: string;
  name: string;
  schools: PretestSchool[];
};

/**
 * Group Schools under their Clusters for rendering, honouring a case-insensitive name-search
 * filter. Clusters keep the order they arrive in (the query sorts them by name); Schools likewise.
 * A Cluster with no matching School after filtering is **dropped**, so the grid collapses to just
 * the Clusters that still have a row — the graceful-collapse the ticket asks for.
 */
export function groupSchoolsByCluster(
  clusters: PretestCluster[],
  schools: PretestSchool[],
  search: string,
): PretestClusterGroup[] {
  const needle = search.trim().toLowerCase();
  const matching = needle ? schools.filter((s) => s.name.toLowerCase().includes(needle)) : schools;

  const byCluster = new Map<string, PretestSchool[]>();
  for (const school of matching) {
    const list = byCluster.get(school.clusterId);
    if (list) list.push(school);
    else byCluster.set(school.clusterId, [school]);
  }

  return clusters
    .map((cluster) => ({
      id: cluster.id,
      name: cluster.name,
      schools: byCluster.get(cluster.id) ?? [],
    }))
    .filter((group) => group.schools.length > 0);
}
