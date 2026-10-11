import { sesiShortLabel } from "-/components/session-labels";
import { perjadinName } from "-/lib/perjadin-name";
import type {
  FeedbackPerjadinOption,
  FeedbackSchoolOption,
  ParticipantFeedbackScope,
  PerjadinFeedbackScope,
} from "@sugt/db/queries";

/**
 * **The `/feedback` scope's pure rules** (#466): what a School pick does to the Session, and what the
 * averages' titles say they cover. Plain functions, so they are tested without a DOM, the way
 * `preparation-derive.ts` sits beside its tab. Types only from `@sugt/db/queries`, as in
 * `feedback-view.tsx`.
 */

/** Picking a School — or clearing it — **resets the Session** to Semua Sesi. */
export function withSchool(schoolId: string | null): ParticipantFeedbackScope {
  return { schoolId, sessionId: null };
}

/**
 * What the Peserta averages cover, for their titles: the School, then the Session — `SMAN 1 Bontang ·
 * Sesi 1 Luring` — or `null`, programme-wide, with neither picked.
 */
export function participantScopeLabel(
  schools: readonly FeedbackSchoolOption[],
  scope: ParticipantFeedbackScope,
): string | null {
  const school = schools.find((option) => option.id === scope.schoolId);
  if (!school) return null;
  const session = school.sessions.find((option) => option.id === scope.sessionId);
  return session ? `${school.name} · ${sesiShortLabel(session)}` : school.name;
}

/** What the Perjadin averages cover: the trip's name, then the Peran — or `null` with neither. */
export function perjadinScopeLabel(
  trips: readonly FeedbackPerjadinOption[],
  scope: PerjadinFeedbackScope,
): string | null {
  const trip = trips.find((option) => option.id === scope.perjadinId);
  const parts = [trip ? perjadinName(trip) : null, scope.role].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}
