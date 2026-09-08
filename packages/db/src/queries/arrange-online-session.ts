import { MAX_TEACHING_TEAM_PER_ONLINE_SESSION, type Stream } from "@sugt/domain";
import { asc, eq } from "drizzle-orm";

import { db } from "../client";
import { ONLINE_SESSION_STILL_STANDS, session, sessionTeacherName } from "../schema/delivery";
import { province, school } from "../schema/reference";
import type { Person } from "./caller";
import { activeRosters, type RosterPerson, type SelectedSchool } from "./rosters";
import { requireStaff } from "./staff-only";

/**
 * **Jadwalkan Sesi daring** — arranging **one** online Session, for **one** School
 * ([#70](https://github.com/mafiefa02/sugt/issues/70)). Each online Session is held at a
 * moment of its own — its own date, its own start time, its own PIC — so there is nothing for
 * a batch to share, and a screen that can write seventeen rows at once fails seventeen rows at
 * once. This replaced the batch outright.
 *
 * Six of every ten Sessions are online and have no Perjadin, so this is the entry point for
 * most of the teaching in the Programme.
 *
 * Staff-only, by the surface list rather than by ADR-0004 (see `./staff-only.ts`, which carries
 * both reasons). It matters more on a write than on a read: a Next.js layout does not run before
 * a Server Action, so `requireStaff` here is the only thing standing between a Teaching Team
 * member and an arranged Session.
 */

/**
 * What arranging one online Session takes: a School, its own date and start time, a Staff PIC,
 * its Stream, and optionally its session-scoped Pengajar names.
 *
 * **`mode`, `perjadinId`, `status` and `cancelledReason` are absent by design** — there is no
 * field to set wrong. The write binds `mode = 'online'` with no Perjadin and a Staff PIC, so
 * `session_offline_iff_perjadin`, `session_online_iff_pic` and `session_cancelled_iff_reason`
 * are satisfied before a value is bound.
 */
export type ArrangeOnlineSessionInput = {
  schoolId: string;
  /** `YYYY-MM-DD`. */
  heldOn: string;
  /** Local wall-clock start time (`HH:MM`), in the School's Time Zone. `starts_at` is NOT NULL. */
  startsAt: string;
  /**
   * The Staff member accountable for this Session. Every online Session has its own, since it
   * has no Perjadin to take one from — otherwise six of every ten Sessions would have nobody to
   * file the Session Record.
   */
  picPersonId: string;
  /**
   * The Session's Stream — STEM or Research. Required now (ADR-0022): an online Session is
   * single-Stream, exactly like an offline one, so `session_stream_not_null` refuses a null and
   * `session_one_online_per_school_per_day` keys on it — a School may hold one STEM and one
   * Research online Session on the same date, but not two of the same Stream.
   */
  stream: Stream;
  /**
   * The Pengajar who teach this Session, as **session-scoped free-text names** (ADR-0022) — the
   * online mirror of a Perjadin's trip-scoped teacher names. Optional and zero-to-cap
   * (`MAX_TEACHING_TEAM_PER_ONLINE_SESSION`): the professors are not yet always fixed at
   * arrangement, so an empty list is ordinary rather than a missing value.
   */
  teacherNames: string[];
};

/**
 * Why an online Session was not arranged.
 *
 * A collision is a **user state**, not a bug, so it comes back as a value rather than a throw
 * ([#12](https://github.com/mafiefa02/sugt/issues/12)): two Staff arranging the same School's
 * month is exactly that. `NotStaffError` is the opposite case and still throws.
 */
export type ArrangeOnlineSessionResult =
  | { outcome: "arranged"; sessionId: string }
  /** This School already has an online Session of this Stream on this date that was not cancelled. */
  | { outcome: "collided"; heldOn: string }
  /**
   * More than `MAX_TEACHING_TEAM_PER_ONLINE_SESSION` Pengajar names — a safety ceiling the
   * database does not hold, so it is refused up front as a value, mirroring `planPerjadin`'s cap
   * refusals. The form's chip input caps at the same number, so this is only reachable through a
   * hand-edited payload.
   */
  | { outcome: "too-many-teachers"; count: number; limit: number };

/**
 * Arrange one online Session, and its optional session-scoped `session_teacher_name` rows, in one
 * transaction.
 *
 * **The transaction is here rather than in the Server Action** (convention 5): a Session and its
 * teacher-name rows are one act, and a Server Action that opened the boundary would put it
 * somewhere a second caller cannot reuse.
 *
 * `on conflict do nothing` names `session_one_online_per_school_per_day` as its arbiter and
 * repeats its predicate verbatim from `ONLINE_SESSION_STILL_STANDS` — Postgres refuses to infer
 * an index whose predicate does not match, which is a runtime failure. With no target it would
 * also swallow a violation of the primary key, which is not a user state. **The index keys on
 * `(school_id, held_on, stream)` and not `starts_at`** (ADR-0022): a School may hold one STEM and
 * one Research online Session on a date, so a returned collision means the day *and Stream* are
 * taken, whatever the hour.
 *
 * Teachers are session-scoped free-text names now (ADR-0022), not `session_teacher` Person rows:
 * this writes `session_teacher_name` only — the Person-based `session_teacher` table is now dropped
 * (T3, #153). The cap is refused before the transaction, mirroring `planPerjadin`.
 */
export async function arrangeOnlineSession(
  caller: Person,
  input: ArrangeOnlineSessionInput,
): Promise<ArrangeOnlineSessionResult> {
  requireStaff(caller);

  // The app-enforced cap the database does not hold: a count across sibling rows, the same shape
  // as `planPerjadin`'s teacher cap, so it is checked here where the whole list is in hand rather
  // than left to a constraint that cannot see the set.
  if (input.teacherNames.length > MAX_TEACHING_TEAM_PER_ONLINE_SESSION) {
    return {
      outcome: "too-many-teachers",
      count: input.teacherNames.length,
      limit: MAX_TEACHING_TEAM_PER_ONLINE_SESSION,
    };
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(session)
      .values({
        schoolId: input.schoolId,
        mode: "online",
        stream: input.stream,
        heldOn: input.heldOn,
        startsAt: input.startsAt,
        onlinePicPersonId: input.picPersonId,
        onlinePicRole: "Staff",
      })
      .onConflictDoNothing({
        target: [session.schoolId, session.heldOn, session.stream],
        where: ONLINE_SESSION_STILL_STANDS,
      })
      .returning({ id: session.id });

    if (!created) return { outcome: "collided", heldOn: input.heldOn };

    if (input.teacherNames.length > 0) {
      await tx
        .insert(sessionTeacherName)
        .values(input.teacherNames.map((name) => ({ sessionId: created.id, name })));
    }

    return { outcome: "arranged", sessionId: created.id };
  });
}

/** A School the screen can arrange a Session at, as a picker or a heading names it. */
export type SchoolOption = SelectedSchool;

/**
 * The columns a `SchoolOption` renders, selected the same way by both reads below. `timeZone` comes
 * from the School's Province, so both reads join `province` on `province.code = school.province_code`
 * (#165) — the form labels its time input with the zone the moment a School is picked.
 */
const SCHOOL_OPTION_COLUMNS = {
  id: school.id,
  name: school.name,
  kabupatenKota: school.kabupatenKota,
  timeZone: province.timeZone,
};

/** Somebody a picker on this screen can name — the PIC. */
export type ArrangePerson = RosterPerson;

/** What the standalone screen renders before anything is written: every School, and the PIC picker. */
export type ArrangeOnlineSessionForm = {
  /** Every School, in name order, for the picker the standalone screen leads with. */
  schools: SchoolOption[];
  /**
   * Staff, for the PIC. There is no Teaching Team roster here any more (ADR-0022): a Session's
   * Pengajar are session-scoped free-text names typed on the form, not People chosen from a list.
   */
  staff: ArrangePerson[];
};

/** Every School, in name order, for the standalone screen's School picker. */
async function pickableSchools(): Promise<SchoolOption[]> {
  return db
    .select(SCHOOL_OPTION_COLUMNS)
    .from(school)
    .innerJoin(province, eq(province.code, school.provinceCode))
    .orderBy(asc(school.name));
}

/**
 * The standalone screen's payload: the Schools to pick from, and the Staff roster. Staff-only, so
 * a Teaching Team member reaching the URL directly is refused server-side rather than shown a
 * form. `Promise.all` keeps the two reads concurrent. Only the `staff` half of `activeRosters` is
 * kept — the Pengajar are session-scoped names now, not a roster (ADR-0022).
 */
export async function arrangeOnlineSessionForm(caller: Person): Promise<ArrangeOnlineSessionForm> {
  requireStaff(caller);

  const [schools, { staff }] = await Promise.all([pickableSchools(), activeRosters()]);

  return { schools, staff };
}

/** What the Detail Sekolah entry point renders: the one School it is on, and the PIC picker. */
export type ArrangeOnlineSessionAt = {
  school: SchoolOption;
  staff: ArrangePerson[];
};

/**
 * The second entry point, on Detail Sekolah — where you already are when thinking about one
 * School. Keyed on the School's `slug`, the way that page is. Staff-only, so Detail Sekolah calls
 * it only for a Staff caller and renders the affordance only when it returns; `null` when the
 * slug names no School, which its caller has already ruled out but which this read does not
 * assume.
 */
export async function arrangeOnlineSessionAt(
  caller: Person,
  slug: string,
): Promise<ArrangeOnlineSessionAt | null> {
  requireStaff(caller);

  const [row] = await db
    .select(SCHOOL_OPTION_COLUMNS)
    .from(school)
    .innerJoin(province, eq(province.code, school.provinceCode))
    .where(eq(school.slug, slug));
  if (!row) return null;

  const { staff } = await activeRosters();
  return { school: row, staff };
}
