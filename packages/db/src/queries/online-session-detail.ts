import {
  MAX_TEACHING_TEAM_PER_ONLINE_SESSION,
  type PretestParticipantType,
  type SessionStatus,
  type TimeZone,
} from "@sugt/domain";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../client";
import { session, sessionTeacherName } from "../schema/delivery";
import { province, school } from "../schema/reference";
import type { SchoolOption } from "./arrange-online-session";
import type { Person } from "./caller";
import type { PastArranged } from "./session-detail";
import { requireStaff } from "./staff-only";

/**
 * **Detail Sesi daring** — one online Session, and the edits it offers (#152). The online
 * counterpart of `/perjadin/[id]`'s per-item editing (#138): it edits every field the arrange form
 * sets — School, Peserta, Tanggal (`held_on`), Jam Mulai (`starts_at`), Jam Selesai (`ends_at`) — and
 * the `session_teacher_name` Pengajar list, one name at a time. **No PIC and no Aliran/Stream (#284):
 * a third-party LMS runs online delivery, so an online Session tracks neither.**
 *
 * A separate module from `./session-detail.ts` for convention 3's reason — one module per surface's
 * payload — and because this one is online-only: `/sesi/[id]` stays the offline detail surface and an
 * online id redirects here, so the two reads never overlap. The read is open to anyone signed in (a
 * Session carries no money, ADR-0004); **every write is Staff-only**, by the surface list, gated with
 * `requireStaff` and surfaced only for Staff exactly as `/perjadin/[id]` does.
 */

/** One session-scoped Pengajar name, as the per-item editor renders it. */
export type OnlineSessionTeacher = { id: string; name: string };

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
  /** Wall-clock end time (`HH:MM:SS`), or `null` on a Session arranged before the column existed (#283). */
  endsAt: string | null;
  /**
   * Always `"WIB"` for an online Session (#283): online Sessions are stored and shown as WIB
   * wall-clock nationally, no longer derived from the School's Province. Kept as a `TimeZone` so the
   * surfaces render it through `formatSessionStartTimeWithWib`, which shows `"HH:MM WIB"`.
   */
  timeZone: TimeZone;
  /** Which cohort the Session teaches (#283); `null` on a Session arranged before the column existed. */
  participantType: PretestParticipantType | null;
  status: SessionStatus;
  /** Set on a cancelled Session and null on every other, by CHECK. */
  cancelledReason: string | null;
  /** The session-scoped Pengajar names (ADR-0022), in a stable order, for the per-item editor. */
  teachers: OnlineSessionTeacher[];
  /** Every School, for the School picker — the arrange form's set, since a Session may move School. */
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
 * simply does not render the edit affordances. `Promise.all` keeps the three reads concurrent; the
 * branch on the session row happens after, discarding the rest for a stale or offline id.
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
  const [rows, teacherRows, schools] = await Promise.all([
    db
      .select({
        mode: session.mode,
        schoolId: session.schoolId,
        schoolName: school.name,
        schoolSlug: school.slug,
        heldOn: session.heldOn,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        participantType: session.participantType,
        status: session.status,
        cancelledReason: session.cancelledReason,
      })
      .from(session)
      .innerJoin(school, eq(school.id, session.schoolId))
      .where(eq(session.id, id)),
    db
      .select({ id: sessionTeacherName.id, name: sessionTeacherName.name })
      .from(sessionTeacherName)
      .where(eq(sessionTeacherName.sessionId, id))
      // Name order, `id` breaking the tie so the list is totally ordered — `session_teacher_name`
      // carries no timestamp, so this is the stable order the editor renders in.
      .orderBy(asc(sessionTeacherName.name), asc(sessionTeacherName.id)),
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
      participantType: first.participantType,
      status: first.status,
      cancelledReason: first.cancelledReason,
      teachers: teacherRows,
      schools,
    },
  };
}

/** The scalar fields the edit dialog sets — everything on the Session row the arrange form does. */
export type OnlineSessionInput = {
  schoolId: string;
  /** `YYYY-MM-DD`. */
  heldOn: string;
  /** Local wall-clock start time (`HH:MM`), always WIB for an online Session (#283). */
  startsAt: string;
  /** Local wall-clock end time (`HH:MM`), strictly after `startsAt`. Required for online (#283). */
  endsAt: string;
  /** Which cohort the Session teaches — `'Siswa'` or `'GTK-MS'` (#283). Required for online. */
  participantType: PretestParticipantType | "";
};

export type UpdateOnlineSessionResult =
  | { outcome: "updated" }
  /** A Session past `arranged` — its fields are settled once it happened. */
  | { outcome: "not-arranged"; status: PastArranged }
  /**
   * The School already has an online Session on this date that still stands (#284: one per day), so
   * the unique index refuses the edit. The row being edited is excluded automatically — an `UPDATE`
   * that leaves the keys where they are conflicts with no other row.
   */
  | { outcome: "collided"; constraint: "session_one_online_per_school_per_day" }
  /**
   * The #283 online-required fields, refused as values before the write — the same rule
   * `arrangeOnlineSession` enforces, since the columns are nullable for migration safety. The edit
   * dialog's `incomplete` and its time guard block all three, so these catch a hand-edited request.
   */
  | { outcome: "participant-type-required" }
  | { outcome: "end-time-required" }
  | { outcome: "end-before-start" };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Edit an online Session's School, date, times and Peserta — the online counterpart of
 * `editPerjadinSession`. Staff-only, and offered only while `arranged`: a delivered Session records
 * something that happened, so its fields are fixed. **No PIC and no Stream (#284).**
 *
 * **Any change to School or date re-checks the unique index**
 * `session_one_online_per_school_per_day` on `(school_id, held_on)` — the same rule
 * `arrangeOnlineSession` and `moveSessionDate` meet — so a School holds at most one still-standing
 * online Session on a date. The index is left to refuse the write rather than
 * pre-read: a pre-read is a race and the index is not. It is caught **by name**, because this row
 * satisfies several CHECKs, and swallowing one as "that date is taken" would report a bug as a user
 * state.
 *
 * A missing or **offline** id **throws** rather than returning a value: Detail Sesi daring 404s an
 * unknown id and redirects an offline one before offering any write, and nothing deletes a Session,
 * so an id that reaches here naming neither an online Session arrived by a hand-edited request — the
 * same disposition `editPerjadinSession` gives one.
 */
export async function updateOnlineSession(
  caller: Person,
  sessionId: string,
  input: OnlineSessionInput,
): Promise<UpdateOnlineSessionResult> {
  requireStaff(caller);

  // The online-required fields the nullable columns cannot enforce (#283), refused before the write
  // exactly as `arrangeOnlineSession` does. The dialog guards all three, so these catch a hand-edited
  // request. Both times are `HH:MM`, so the lexicographic compare is chronological.
  if (input.participantType === "") return { outcome: "participant-type-required" };
  if (input.endsAt === "") return { outcome: "end-time-required" };
  if (input.endsAt <= input.startsAt) return { outcome: "end-before-start" };
  // Capture the narrowed value: the `!== ""` narrowing is dropped inside the transaction callback.
  const participantType = input.participantType;

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
      if (row.status !== "arranged") return { outcome: "not-arranged", status: row.status };

      await tx
        .update(session)
        .set({
          schoolId: input.schoolId,
          heldOn: input.heldOn,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          participantType,
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

/**
 * The online Session, locked for the transaction, or `null` when the id names no still-online row.
 *
 * Shared by the Pengajar add so the cap is a count taken under a lock — two concurrent adds cannot
 * both slip past a count of nine. `mode = 'online'` is part of the match: a hand-edited offline id
 * gets no `session_teacher_name` row, which belongs to online Sessions alone.
 */
async function lockedOnlineSession(tx: Tx, sessionId: string): Promise<{ id: string } | null> {
  const [row] = await tx
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.mode, "online")))
    .for("update");
  return row ?? null;
}

export type AddOnlineSessionTeacherResult =
  | { outcome: "added"; teacherId: string }
  /** A blank name — caught here so it reads as a required field, not an empty `session_teacher_name` row. */
  | { outcome: "name-required" }
  /** The Session already holds `MAX_TEACHING_TEAM_PER_ONLINE_SESSION` names — the app cap, not a DB rule. */
  | { outcome: "too-many-teachers"; count: number; limit: number }
  /** The id names no online Session — a stale link, which is reachable. */
  | { outcome: "no-such-session" };

/**
 * Add one session-scoped Pengajar name. Staff-only, capped at ten
 * (`MAX_TEACHING_TEAM_PER_ONLINE_SESSION`), mirroring `addPerjadinTeacher`.
 *
 * **Not gated on status**, unlike the field edit above: online Pengajar are edited anytime
 * (ADR-0022, #152), and this add/rename/remove trio is the correction path that replaced the retired
 * post-delivery who-taught correction flow (the `session_teacher`-writing `correctSessionTeachers`,
 * dropped with the table in T3/#153) — so a name may be fixed on a delivered Session too.
 * The cap is a count across sibling rows, so it is checked here under the Session's lock rather than
 * by a CHECK that cannot see the set.
 */
export async function addOnlineSessionTeacher(
  caller: Person,
  sessionId: string,
  name: string,
): Promise<AddOnlineSessionTeacherResult> {
  requireStaff(caller);

  const trimmed = name.trim();
  if (trimmed === "") return { outcome: "name-required" };

  return db.transaction(async (tx) => {
    const locked = await lockedOnlineSession(tx, sessionId);
    if (!locked) return { outcome: "no-such-session" };

    const existing = await tx
      .select({ id: sessionTeacherName.id })
      .from(sessionTeacherName)
      .where(eq(sessionTeacherName.sessionId, sessionId));
    if (existing.length >= MAX_TEACHING_TEAM_PER_ONLINE_SESSION) {
      return {
        outcome: "too-many-teachers",
        count: existing.length,
        limit: MAX_TEACHING_TEAM_PER_ONLINE_SESSION,
      };
    }

    const [created] = await tx
      .insert(sessionTeacherName)
      .values({ sessionId, name: trimmed })
      .returning({ id: sessionTeacherName.id });

    return { outcome: "added", teacherId: created!.id };
  });
}

export type RenameOnlineSessionTeacherResult =
  | { outcome: "renamed" }
  | { outcome: "name-required" }
  /** The id names no name — one was removed while this page was open, say. */
  | { outcome: "no-such-teacher" };

/**
 * Rename one session-scoped Pengajar name. Staff-only, mirroring `renamePerjadinTeacher` — no
 * completeness tick to clear, since a Session has none. Keyed on the name's id, so the caller passes
 * only that and the trimmed value.
 */
export async function renameOnlineSessionTeacher(
  caller: Person,
  teacherId: string,
  name: string,
): Promise<RenameOnlineSessionTeacherResult> {
  requireStaff(caller);

  const trimmed = name.trim();
  if (trimmed === "") return { outcome: "name-required" };

  const [updated] = await db
    .update(sessionTeacherName)
    .set({ name: trimmed })
    .where(eq(sessionTeacherName.id, teacherId))
    .returning({ id: sessionTeacherName.id });

  return updated ? { outcome: "renamed" } : { outcome: "no-such-teacher" };
}

export type RemoveOnlineSessionTeacherResult =
  | { outcome: "removed" }
  | { outcome: "no-such-teacher" };

/**
 * Remove one session-scoped Pengajar name. Staff-only. A `DELETE` matching no row comes back as
 * `no-such-teacher` rather than an error — the name was already gone, which a page opened before
 * another Staff removed it can reach.
 */
export async function removeOnlineSessionTeacher(
  caller: Person,
  teacherId: string,
): Promise<RemoveOnlineSessionTeacherResult> {
  requireStaff(caller);

  const [deleted] = await db
    .delete(sessionTeacherName)
    .where(eq(sessionTeacherName.id, teacherId))
    .returning({ id: sessionTeacherName.id });

  return deleted ? { outcome: "removed" } : { outcome: "no-such-teacher" };
}
