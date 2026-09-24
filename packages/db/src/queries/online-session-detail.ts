import type { SessionStatus, TimeZone } from "@sugt/domain";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { province, school } from "../schema/reference";
import type { SchoolOption } from "./arrange-online-session";
import type { Person } from "./caller";
import { requireStaff } from "./staff-only";

/**
 * **Detail Sesi daring** — one online Session, and the edits it offers (#152, #318). The online
 * counterpart of `/perjadin/[id]`'s per-item editing: it edits every field the record form set —
 * School, Tanggal (`held_on`), Jam Mulai (`starts_at`), Jam Selesai (`ends_at`) and the two
 * cohort-named Pengajar — and hard-deletes the Session. **No PIC and no Aliran/Stream (#284): a
 * third-party LMS runs online delivery, so an online Session tracks neither.**
 *
 * A separate module from `./session-detail.ts` for convention 3's reason — one module per surface's
 * payload — and because this one is online-only: `/sesi/[id]` stays the offline detail surface and an
 * online id redirects here, so the two reads never overlap. The read is open to anyone signed in (a
 * Session carries no money, ADR-0004); **every write is Staff-only**, by the surface list, gated with
 * `requireStaff` and surfaced only for Staff exactly as `/perjadin/[id]` does.
 *
 * **An online Session is born `delivered` now (#318, ADR-0036)** — a third-party LMS runs delivery,
 * so it is recorded after it happened, not arranged then marked. So the field edit is offered on a
 * `delivered` Session too (it is the correction path that replaced the old teacher-list editor and the
 * arrange→deliver step); only a `cancelled` legacy Session is settled and refuses the edit.
 */

/** Everything Detail Sesi daring renders for one online Session, in one round trip. */
export type OnlineSessionDetail = {
  id: string;
  schoolId: string;
  schoolName: string;
  /** The School's page is where this Session is reached from, and the way back to it. */
  schoolSlug: string;
  heldOn: string;
  /** Wall-clock start time (`HH:MM:SS`), rendered as WIB (#283 — online Sessions are always WIB). */
  startsAt: string;
  /** Wall-clock end time (`HH:MM:SS`), or `null` on a Session recorded before the column existed (#283). */
  endsAt: string | null;
  /**
   * Always `"WIB"` for an online Session (#283): online Sessions are stored and shown as WIB
   * wall-clock nationally, no longer derived from the School's Province. Kept as a `TimeZone` so the
   * surfaces render it through `formatSessionStartTimeWithWib`, which shows `"HH:MM WIB"`.
   */
  timeZone: TimeZone;
  /** The Siswa cohort's Pengajar name (#318). Non-null for an online Session by CHECK. */
  pengajarSiswaName: string;
  /** The GTK-MS cohort's Pengajar name (#318). Non-null for an online Session by CHECK. */
  pengajarGtkMsName: string;
  status: SessionStatus;
  /** Set on a cancelled Session and null on every other, by CHECK. */
  cancelledReason: string | null;
  /** Every School, for the School picker — the record form's set, since a Session may move School. */
  schools: SchoolOption[];
};

/**
 * The read's three answers, so the page can route an id it should not render.
 *
 * `not-found` is a stale link — a pasted URL outlives its row — which the page turns into a 404.
 * `offline` is an id that names an **offline** Session, whose detail surface is `/sesi/[id]`; the
 * page redirects there rather than rendering online controls against it. `online` carries the payload.
 */
export type OnlineSessionLookup =
  | { outcome: "online"; session: OnlineSessionDetail }
  | { outcome: "offline" }
  | { outcome: "not-found" };

/**
 * One online Session and everything the screen renders, or a marker the page routes on.
 *
 * The School picker rides on this open payload — `schools` carries no money, exactly as
 * `perjadinDetail` returns its `eligibleSchools` — so a professor's read fetches it too and the page
 * simply does not render the edit affordances. `Promise.all` keeps the two reads concurrent; the
 * branch on the session row happens after, discarding the schools for a stale or offline id.
 *
 * **No PIC and no Stream (#284):** an online Session tracks neither, so the read joins no `person`
 * for a PIC and fetches no Staff roster, and there is no null-PIC/null-Stream invariant to assert.
 * `mode` off the session row still draws the offline/online line for the page to route on.
 *
 * **The main row does not join `province` (#283)**: an online Session's zone is always WIB, folded
 * in below rather than read from the School's Province. The schools-picker sub-query still joins it,
 * since a `SchoolOption` carries the picker's own zone.
 */
export async function onlineSessionDetail(
  _caller: Person,
  id: string,
): Promise<OnlineSessionLookup> {
  const [rows, schools] = await Promise.all([
    db
      .select({
        mode: session.mode,
        schoolId: session.schoolId,
        schoolName: school.name,
        schoolSlug: school.slug,
        heldOn: session.heldOn,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        pengajarSiswaName: session.pengajarSiswaName,
        pengajarGtkMsName: session.pengajarGtkMsName,
        status: session.status,
        cancelledReason: session.cancelledReason,
      })
      .from(session)
      .innerJoin(school, eq(school.id, session.schoolId))
      .where(eq(session.id, id)),
    db
      .select({
        id: school.id,
        name: school.name,
        kabupatenKota: school.kabupatenKota,
        timeZone: province.timeZone,
      })
      .from(school)
      .innerJoin(province, eq(province.code, school.provinceCode))
      .orderBy(asc(school.name)),
  ]);

  const [first] = rows;
  if (!first) return { outcome: "not-found" };
  if (first.mode === "offline") return { outcome: "offline" };

  return {
    outcome: "online",
    session: {
      id,
      schoolId: first.schoolId,
      schoolName: first.schoolName,
      schoolSlug: first.schoolSlug,
      heldOn: first.heldOn,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      // Online Sessions are always WIB (#283), so the zone is a constant, not a joined column.
      timeZone: "WIB",
      // Non-null for an online row by `session_online_pengajar_not_null`, and this branch has already
      // established the row is online — so the assertion holds rather than hopes.
      pengajarSiswaName: first.pengajarSiswaName!,
      pengajarGtkMsName: first.pengajarGtkMsName!,
      status: first.status,
      cancelledReason: first.cancelledReason,
      schools,
    },
  };
}

/** The fields the edit dialog sets — everything on the Session row the record form does. */
export type OnlineSessionInput = {
  schoolId: string;
  /** `YYYY-MM-DD`. Today or in the past (#318). */
  heldOn: string;
  /** Local wall-clock start time (`HH:MM`), always WIB for an online Session (#283). */
  startsAt: string;
  /** Local wall-clock end time (`HH:MM`), strictly after `startsAt`. Required for online (#283). */
  endsAt: string;
  /** The Siswa cohort's Pengajar name (#318). Required. */
  pengajarSiswaName: string;
  /** The GTK-MS cohort's Pengajar name (#318). Required. */
  pengajarGtkMsName: string;
};

export type UpdateOnlineSessionResult =
  | { outcome: "updated" }
  /** A cancelled Session is a dead row — its fields are settled, so the edit is refused. */
  | { outcome: "cancelled" }
  /**
   * The School already has an online Session on this date that still stands (#284: one per day), so
   * the unique index refuses the edit. The row being edited is excluded automatically — an `UPDATE`
   * that leaves the keys where they are conflicts with no other row.
   */
  | { outcome: "collided"; constraint: "session_one_online_per_school_per_day" }
  /** A blank Siswa or GTK-MS Pengajar name — both required (#318). */
  | { outcome: "pengajar-required" }
  | { outcome: "end-time-required" }
  | { outcome: "end-before-start" }
  /** `held_on` in the future — an online Session records something that happened (#318). */
  | { outcome: "future-date"; today: string };

/**
 * Today's date in **WIB** (`YYYY-MM-DD`), the zone an online Session's `held_on` is a day in — the
 * same guard `arrangeOnlineSession` applies, so an edit cannot move a Session to a future date any
 * more than recording one can.
 */
function wibToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

/**
 * Edit an online Session's School, date, times and two Pengajar — the online counterpart of
 * `editPerjadinSession`, and the correction path for a born-`delivered` Session (#318). Staff-only.
 * Offered on an `arranged` **or** `delivered` Session; a `cancelled` one is a dead row and refuses
 * the edit.
 *
 * **Any change to School or date re-checks the unique index**
 * `session_one_online_per_school_per_day` on `(school_id, held_on)` — the same rule
 * `arrangeOnlineSession` and `moveSessionDate` meet — so a School holds at most one still-standing
 * online Session on a date. The index is left to refuse the write rather than pre-read: a pre-read is
 * a race and the index is not. It is caught **by name**, because this row satisfies several CHECKs,
 * and swallowing one as "that date is taken" would report a bug as a user state.
 *
 * A missing or **offline** id **throws** rather than returning a value: Detail Sesi daring 404s an
 * unknown id and redirects an offline one before offering any write, so an id that reaches here naming
 * neither an online Session arrived by a hand-edited request — the same disposition
 * `editPerjadinSession` gives one.
 */
export async function updateOnlineSession(
  caller: Person,
  sessionId: string,
  input: OnlineSessionInput,
): Promise<UpdateOnlineSessionResult> {
  requireStaff(caller);

  // The online-required fields the nullable columns cannot enforce, refused before the write exactly
  // as `arrangeOnlineSession` does. The dialog guards them, so these catch a hand-edited request.
  const pengajarSiswaName = input.pengajarSiswaName.trim();
  const pengajarGtkMsName = input.pengajarGtkMsName.trim();
  if (pengajarSiswaName === "" || pengajarGtkMsName === "") return { outcome: "pengajar-required" };
  // Both times are `HH:MM`, so the lexicographic compare is chronological.
  if (input.endsAt === "") return { outcome: "end-time-required" };
  if (input.endsAt <= input.startsAt) return { outcome: "end-before-start" };
  const today = wibToday();
  if (input.heldOn > today) return { outcome: "future-date", today };

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: session.status, mode: session.mode })
        .from(session)
        .where(eq(session.id, sessionId))
        .for("update");
      if (!row || row.mode !== "online") {
        throw new Error(
          `No online Session has id ${sessionId}. Detail Sesi daring 404s an unknown id and ` +
            "redirects an offline one before offering a write, so this is a bug or a hand-edited request.",
        );
      }
      if (row.status === "cancelled") return { outcome: "cancelled" };

      await tx
        .update(session)
        .set({
          schoolId: input.schoolId,
          heldOn: input.heldOn,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          pengajarSiswaName,
          pengajarGtkMsName,
        })
        .where(eq(session.id, sessionId));

      return { outcome: "updated" };
    });
  } catch (error) {
    const constraint = (error as { cause?: { constraint_name?: string } }).cause?.constraint_name;
    if (constraint === "session_one_online_per_school_per_day") {
      return { outcome: "collided", constraint };
    }
    throw error;
  }
}

export type DeleteOnlineSessionResult =
  | { outcome: "deleted" }
  /** The id names no online Session — a stale link, or another Staff deleted it first. Reachable. */
  | { outcome: "no-such-session" };

/**
 * **Hard-delete an online Session** (#318). Staff-only, the correction for a mis-recorded Session that
 * replaced the arrange→cancel flow for born-`delivered` rows — a cancelled Session lingered as a dead
 * row, but a recorded-in-error one is simply removed.
 *
 * `mode = 'online'` is part of the match: an offline Session **blocks** deleting its Perjadin and is
 * not deleted here, so a hand-edited offline id deletes nothing. No cascade to clean up now the
 * `session_teacher_name` side table is gone (#318) — the row is the whole Session.
 *
 * A `DELETE` matching no row comes back as `no-such-session` rather than an error — the Session was
 * already gone, which a page opened before another Staff deleted it can reach.
 */
export async function deleteOnlineSession(
  caller: Person,
  sessionId: string,
): Promise<DeleteOnlineSessionResult> {
  requireStaff(caller);

  const [deleted] = await db
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.mode, "online")))
    .returning({ id: session.id });

  return deleted ? { outcome: "deleted" } : { outcome: "no-such-session" };
}
