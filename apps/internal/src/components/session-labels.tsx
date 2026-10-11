import { formatTripDates } from "-/lib/perjadin-name";
import {
  formatWallClockTime,
  type SessionMode,
  type SessionStatus,
  type TimeZone,
} from "@sugt/domain";
import { Badge } from "@sugt/ui/components/badge";

/**
 * How a Session's mode and status are written on screen, in one place.
 *
 * **One place because there are two screens and they had already drifted.** Detail Sekolah
 * lists Sessions and Detail Sesi opens one; a Session that reads *Terjadwal* in the list
 * and something else on its own page is the same row disagreeing with itself, and the
 * badge is the part a reader checks fastest.
 *
 * The copy is Indonesian and the domain terms are English — `CONTEXT.md` § *Language* —
 * which is why these are a translation at the edge rather than names in `@sugt/domain`.
 * Typed against the domain's unions rather than as loose records, so a status added there
 * fails the build here until somebody writes its Indonesian.
 */
const MODE_LABELS: Record<SessionMode, string> = {
  offline: "Luring",
  online: "Daring",
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  arranged: "Terjadwal",
  delivered: "Terlaksana",
  cancelled: "Dibatalkan",
};

/**
 * The Session's state as one badge.
 *
 * A cancelled Session is the loud one, and that is deliberate: it is the only status that
 * says something did not happen. `arranged` and `delivered` are both ordinary.
 */
function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge variant={status === "cancelled" ? "destructive" : "outline"}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** What a Session's one-line label reads: its Sesi (ADR-0027), mode, date and start time. */
type SesiParts = {
  /** `null` for a cancelled Session, which has no Sesi. */
  sesi: number | null;
  mode: SessionMode;
  heldOn: string;
  startsAt: string;
  /** WIB for an online Session, else the School's zone. */
  timeZone: TimeZone;
};

/**
 * **A Session in one line** (#466): `Sesi 1 · Luring · 12 Okt 2026 · 09.00 WITA`. The `/feedback`
 * Sesi picker and its response cards both print it, so the two agree. A cancelled Session has no
 * Sesi, and reads "Dibatalkan" in its place.
 */
function sesiLabel({ sesi, mode, heldOn, startsAt, timeZone }: SesiParts): string {
  const time = `${formatWallClockTime(startsAt).replace(":", ".")} ${timeZone}`;
  return [
    sesi === null ? "Dibatalkan" : `Sesi ${sesi}`,
    MODE_LABELS[mode],
    formatTripDates(heldOn, heldOn),
    time,
  ].join(" · ");
}

/** The same Session, short — `Sesi 1 Luring` — for naming what an average covers. */
function sesiShortLabel({ sesi, mode, heldOn }: SesiParts): string {
  return sesi === null
    ? `${MODE_LABELS[mode]} ${formatTripDates(heldOn, heldOn)} (dibatalkan)`
    : `Sesi ${sesi} ${MODE_LABELS[mode]}`;
}

export { MODE_LABELS, sesiLabel, sesiShortLabel, SessionStatusBadge, STATUS_LABELS };
