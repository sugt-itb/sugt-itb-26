import { sesiShortLabel } from "-/components/session-labels";
import { perjadinName } from "-/lib/perjadin-name";
import type {
  FeedbackPerjadinOption,
  FeedbackSchoolOption,
  ParticipantFeedbackScope,
  PerjadinFeedbackScope,
} from "@sugt/db/queries";

/**
 * **The `/feedback` scope's pure rules** (#466): what a School pick does to the Session and the Tipe
 * Peserta, and what the averages' titles say they cover. Plain functions, so they are tested without
 * a DOM, the way `preparation-derive.ts` sits beside its tab. Types only from `@sugt/db/queries`, as
 * in `feedback-view.tsx`.
 */

/**
 * Picking a School — or clearing it — **resets the Session** to Semua Sesi. The Tipe Peserta (#487)
 * is not the School's, so it stays.
 */
export function withSchool(
  scope: ParticipantFeedbackScope,
  schoolId: string | null,
): ParticipantFeedbackScope {
  return { ...scope, schoolId, sessionId: null };
}

/**
 * The School and Session a scope picks, as every Peserta title names them — the School's name and
 * the Session's short label, `Sesi 1 Luring` — each `null` when not picked. The average cards and
 * the Lihat Grafik figures (#518) both read it, so a title and its PNG's file name never drift.
 */
export function participantScopeNames(
  schools: readonly FeedbackSchoolOption[],
  scope: ParticipantFeedbackScope,
): { school: string | null; sesi: string | null } {
  const school = schools.find((option) => option.id === scope.schoolId);
  const session = school?.sessions.find((option) => option.id === scope.sessionId);
  return { school: school?.name ?? null, sesi: session ? sesiShortLabel(session) : null };
}

/**
 * What the Peserta averages cover, for their titles: the School, then the Session, then the Tipe
 * Peserta — `SMAN 1 Bontang · Sesi 1 Luring · GTK-MS` — or `null`, programme-wide, with none picked.
 */
export function participantScopeLabel(
  schools: readonly FeedbackSchoolOption[],
  scope: ParticipantFeedbackScope,
): string | null {
  const { school, sesi } = participantScopeNames(schools, scope);
  const parts = [school, sesi, scope.participantType].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
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
