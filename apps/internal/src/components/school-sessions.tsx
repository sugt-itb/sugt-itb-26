import { MODE_LABELS, SessionStatusBadge } from "-/components/session-labels";
import { PARTICIPANT_ASPECT_LABELS } from "-/lib/participant-feedback-copy";
import type { SchoolSession, SessionAspect } from "@sugt/db/queries";
import {
  CONCERN_AT_OR_BELOW,
  formatSessionStartTimeWithWib,
  RATING_MAX,
  RATING_MIN,
} from "@sugt/domain";
import { Rating } from "@sugt/ui/components/rating";
import Link from "next/link";

/**
 * One School's Sessions, oldest first.
 *
 * **Only the Sessions that exist.** A School is due eight, and the eight are part of a
 * denominator rather than a list — a Session comes into existence when it is arranged and
 * never before (ADR-0006), so there are no rows waiting to be filled in. The design handoff
 * lays them all out with *"Belum dijadwalkan"* against the unplanned ones; that is the
 * schedule ADR-0006 rejects, and it is not built here.
 *
 * A cancelled Session stays in the list with the reason it was called off. It counts
 * for nothing, and that is the point of showing it: a School that was planned for and
 * missed looks different from one nobody has reached yet.
 */
function SchoolSessions({ sessions }: { sessions: SchoolSession[] }) {
  if (sessions.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground sm:p-7">
        Belum ada Sesi yang diatur untuk Sekolah ini.
      </p>
    );
  }

  return (
    <ul className="border-t border-border">
      {sessions.map((session) => (
        <li
          key={session.id}
          className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-border px-4 py-3 sm:px-7"
        >
          {/*
            The date is the link, because it is what names a Session — there is no other
            handle, and the School is already the page this list is on. Detail Sesi is
            where a Session is read and written, and this list is the only route to it.
          */}
          <Link
            href={`/sesi/${session.id}`}
            className="text-sm font-medium tabular-nums hover:underline"
          >
            {session.heldOn}
          </Link>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatSessionStartTimeWithWib(session.startsAt, session.timeZone)}
          </span>
          <span className="text-xs text-muted-foreground">{MODE_LABELS[session.mode]}</span>
          <SessionStatusBadge status={session.status} />

          <span className="ml-auto">
            <ConcernChip session={session} />
          </span>

          {session.cancelledReason !== null && (
            <p className="w-full text-xs text-muted-foreground">
              Alasan pembatalan: {session.cancelledReason}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What anybody said about this Session, in one chip.
 *
 * **Three states, not two.** Nothing is required and nothing is blocked (ADR-0009), so
 * a delivered Session nobody has filed anything about is ordinary — and *"Tanpa
 * concern"* on one would report a verdict nobody gave. The absence of Ratings is
 * therefore said out loud rather than read as approval.
 *
 * **A Rating is shown wherever one exists, whatever the Session's status**, and only
 * the two wordings below are held to `delivered`. An arranged or cancelled Session
 * should carry no Ratings at all — a Session may only be cancelled while arranged, so
 * neither ever happened — but if one does, that is worth seeing rather than a reason to
 * hide it. What would be wrong is saying *"Tanpa concern"* about a Session nobody has
 * sat in yet, so those two are absent instead.
 */
function ConcernChip({ session }: { session: SchoolSession }) {
  if (session.concern !== null) {
    return (
      <Rating
        value={session.concern.rating}
        label={ASPECT_LABELS[session.concern.aspect]}
        variant="compact"
        min={RATING_MIN}
        max={RATING_MAX}
        concernAtOrBelow={CONCERN_AT_OR_BELOW}
      />
    );
  }

  if (session.status !== "delivered") return null;

  return (
    <span className="text-xs text-muted-foreground">
      {session.ratingsFiled > 0 ? "Tanpa concern" : "Belum ada Rating"}
    </span>
  );
}

/**
 * The copy is Indonesian and the domain terms are English — `CONTEXT.md` § *Language*,
 * which is why these are a translation at the edge rather than names in `@sugt/domain`.
 *
 * Typed against the domain's unions rather than as loose records, so an Aspect added to
 * a rubric fails the build here until somebody writes its Indonesian.
 */
const ASPECT_LABELS: Record<SessionAspect, string> = {
  comprehension: "Pemahaman",
  participation: "Partisipasi",
  readiness: "Kesiapan",
  materials: "Materi",
  delivery: "Penyampaian",
  facilities: "Fasilitas",
  timing: "Waktu",
  turnout: "Kehadiran",
  school_support: "Dukungan Sekolah",
  coordination: "Koordinasi",
  // Participant Feedback's own Aspects, named as the form and `/feedback` name them (#446).
  instructor: PARTICIPANT_ASPECT_LABELS.instructor,
  relevance: PARTICIPANT_ASPECT_LABELS.relevance,
  hands_on_rbl: PARTICIPANT_ASPECT_LABELS.hands_on_rbl,
};

export { SchoolSessions };
