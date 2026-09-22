import type { PretestParticipantType, SessionStatus, TimeZone } from "@sugt/domain";
import { desc, eq } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { school } from "../schema/reference";
import type { Person } from "./caller";

/**
 * **The online Session list** — every online Session, open to anyone signed in.
 *
 * The online counterpart to `./perjadin-directory.ts`: offline Sessions are reached through the
 * Perjadin they sit on, but an online Session has no Perjadin, so without this there is no screen
 * that lists them together. A separate module from `./session-detail.ts` for the same reason the
 * Perjadin list and detail are separate — convention 3 is one module per surface's payload.
 *
 * No role check: an online Session's School, date, start time, Peserta and status are delivery data,
 * and ADR-0004 opens that to everyone signed in. Arranging one stays Staff-only, on the form.
 */

/** One online Session, as the list shows it. */
export type DirectoryOnlineSession = {
  id: string;
  schoolName: string;
  schoolSlug: string;
  heldOn: string;
  startsAt: string;
  /**
   * Always `"WIB"` for an online Session (#283). Online Sessions are scheduled and stored as WIB
   * wall-clock nationally — the Zoom host is in WIB — so the row no longer derives the zone from the
   * School's Province the way offline surfaces do. Kept as a `TimeZone` field so the page renders it
   * through the same `formatSessionStartTimeWithWib` helper, which simply shows `"HH:MM WIB"`.
   */
  timeZone: TimeZone;
  /** Which cohort the Session teaches (#283); `null` on a Session arranged before the column existed. */
  participantType: PretestParticipantType | null;
  status: SessionStatus;
};

/**
 * Every online Session, newest first — `held_on` then `starts_at`, with `id` breaking the tie so
 * the order is total, the same shape `./perjadin-directory.ts` orders on. Every status is here,
 * including cancelled: this is the calendar of what was scheduled, not a count of what happened.
 *
 * The School join is inner and NOT NULL by construction, so it cannot drop an online row. **No PIC
 * join any more (#284):** an online Session tracks no PIC, so nothing here reads `person`. **The
 * Province join is gone too (#283)**: an online Session's zone is always WIB, not derived from the
 * School's Province.
 *
 * **`where mode = 'online'` is the explicit exclusion of offline Sessions** — the readable statement
 * of intent, and now the only thing that excludes them (there is no PIC-null side effect to lean on).
 *
 * `timeZone` is folded in afterwards as the constant `"WIB"` rather than selected — it is no longer
 * a column of any joined table.
 */
export async function onlineSessionDirectory(_caller: Person): Promise<DirectoryOnlineSession[]> {
  const rows = await db
    .select({
      id: session.id,
      schoolName: school.name,
      schoolSlug: school.slug,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
      participantType: session.participantType,
      status: session.status,
    })
    .from(session)
    .innerJoin(school, eq(school.id, session.schoolId))
    .where(eq(session.mode, "online"))
    .orderBy(desc(session.heldOn), desc(session.startsAt), desc(session.id));

  return rows.map((row) => ({ ...row, timeZone: "WIB" as const }));
}
