import { MAX_TEACHING_TEAM_PER_ONLINE_SESSION, type PretestParticipantType } from "@sugt/domain";
import { asc, eq } from "drizzle-orm";

import { db } from "../client";
import { ONLINE_SESSION_STILL_STANDS, session, sessionTeacherName } from "../schema/delivery";
import { province, school } from "../schema/reference";
import type { Person } from "./caller";
import type { SelectedSchool } from "./rosters";
import { requireStaff } from "./staff-only";

/**
 * **Jadwalkan Sesi daring** — arranging **one** online Session, for **one** School
 * ([#70](https://github.com/mafiefa02/sugt/issues/70)). Each online Session is held at a
 * moment of its own — its own date, its own start and end time — so there is nothing for
 * a batch to share, and a screen that can write seventeen rows at once fails seventeen rows at
 * once. This replaced the batch outright.
 *
 * Six of every ten Sessions are online and have no Perjadin, so this is the entry point for
 * most of the teaching in the Programme. An online Session carries **no PIC and no Stream**
 * (#284, superseding ADR-0022): a third-party LMS runs online delivery, so SUGT tracks neither.
 *
 * Staff-only, by the surface list rather than by ADR-0004 (see `./staff-only.ts`, which carries
 * both reasons). It matters more on a write than on a read: a Next.js layout does not run before
 * a Server Action, so `requireStaff` here is the only thing standing between a Teaching Team
 * member and an arranged Session.
 */

/**
 * What arranging one online Session takes: a School, its own date, start and end time, its Peserta,
 * and its session-scoped Pengajar names. **No PIC and no Stream (#284).**
 *
 * **`mode`, `perjadinId`, `status` and `cancelledReason` are absent by design** — there is no
 * field to set wrong. The write binds `mode = 'online'` with no Perjadin, so
 * `session_offline_iff_perjadin` and `session_cancelled_iff_reason` are satisfied before a value is
 * bound.
 */
export type ArrangeOnlineSessionInput = {
  schoolId: string;
  /** `YYYY-MM-DD`. */
  heldOn: string;
  /**
   * Local wall-clock start time (`HH:MM`), in the School's Time Zone. `starts_at` is NOT NULL. An
   * online Session is always WIB now (#283) — the Zoom host is in WIB, so the hour is a WIB
   * wall-clock time nationally — but the storage is unchanged; only the label and the read-back drop
   * the province-derived zone.
   */
  startsAt: string;
  /**
   * Local wall-clock end time (`HH:MM`), in the same zone as `startsAt`. Required for online at this
   * layer (#283) — the column is nullable so the migration is safe, so the not-null-for-online rule
   * lives here — and must be strictly after `startsAt`, which the `session_ends_after_starts_check`
   * CHECK backstops. `""` when the caller has not chosen one; refused as `end-time-required`.
   */
  endsAt: string;
  /**
   * Which cohort this Session teaches — `'Siswa'` or `'GTK-MS'` (#283). Required for online at this
   * layer, `""` until chosen and refused as `participant-type-required`, the same shape `startsAt`'s
   * required-ness takes on the form.
   */
  participantType: PretestParticipantType | "";
  /**
   * The Pengajar who teach this Session, as **session-scoped free-text names** (ADR-0022) — the
   * online mirror of a Perjadin's trip-scoped teacher names. **Required now (#283): at least one,
   * up to `MAX_TEACHING_TEAM_PER_ONLINE_SESSION` (two).** An empty list is refused as
   * `teachers-required` rather than accepted — a Session with no named professor is no longer an
   * ordinary state.
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
  /** This School already has an online Session on this date that was not cancelled (#284: one per day). */
  | { outcome: "collided"; heldOn: string }
  /**
   * More than `MAX_TEACHING_TEAM_PER_ONLINE_SESSION` Pengajar names — a safety ceiling the
   * database does not hold, so it is refused up front as a value, mirroring `planPerjadin`'s cap
   * refusals. The form's chip input caps at the same number, so this is only reachable through a
   * hand-edited payload.
   */
  | { outcome: "too-many-teachers"; count: number; limit: number }
  /**
   * The three online-required fields (#283), each refused as a value the way `too-many-teachers`
   * is. The form's `incomplete` guard blocks all of them, so like the cap these are reachable only
   * through a hand-edited payload — but the not-null-for-online rule lives at this layer (the
   * columns are nullable for migration safety), so this is where it is enforced rather than assumed.
   */
  | { outcome: "participant-type-required" }
  | { outcome: "end-time-required" }
  | { outcome: "teachers-required" }
  /** `ends_at` was not strictly after `starts_at` — the app-layer half of `session_ends_after_starts_check`. */
  | { outcome: "end-before-start" };

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
 * `(school_id, held_on)`** (#284, superseding ADR-0022): online Sessions are no longer single-Stream,
 * so a returned collision means the day is taken, whatever the hour — one online Session per School
 * per day.
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

  // The online-required fields the nullable columns cannot enforce (#283), refused up front as
  // values exactly like the cap below — the form guards all of them, so these catch a hand-edited
  // payload rather than an ordinary submit.
  if (input.participantType === "") return { outcome: "participant-type-required" };
  if (input.endsAt === "") return { outcome: "end-time-required" };
  if (input.teacherNames.length < 1) return { outcome: "teachers-required" };
  // Capture the narrowed value: TypeScript drops the `!== ""` narrowing inside the transaction
  // callback below, since it cannot prove `input` is unchanged across the closure boundary.
  const participantType = input.participantType;

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

  // `starts_at`/`ends_at` are both zero-padded `HH:MM`, so a lexicographic compare is chronological.
  // The `session_ends_after_starts_check` CHECK is the backstop; refusing it here gives a value the
  // form can render rather than a thrown constraint.
  if (input.endsAt <= input.startsAt) return { outcome: "end-before-start" };

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(session)
      .values({
        schoolId: input.schoolId,
        mode: "online",
        heldOn: input.heldOn,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        participantType,
      })
      .onConflictDoNothing({
        target: [session.schoolId, session.heldOn],
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

/**
 * What the standalone screen renders before anything is written: every School for the picker. **No
 * Staff roster any more (#284): an online Session has no PIC, so there is no person to pick.** Its
 * Pengajar are session-scoped free-text names typed on the form, never People chosen from a list.
 */
export type ArrangeOnlineSessionForm = {
  /** Every School, in name order, for the picker the standalone screen leads with. */
  schools: SchoolOption[];
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
 * The standalone screen's payload: the Schools to pick from. Staff-only, so a non-Staff caller
 * reaching the URL directly is refused server-side rather than shown a form.
 */
export async function arrangeOnlineSessionForm(caller: Person): Promise<ArrangeOnlineSessionForm> {
  requireStaff(caller);

  const schools = await pickableSchools();

  return { schools };
}

/** What the Detail Sekolah entry point renders: the one School it is on. */
export type ArrangeOnlineSessionAt = {
  school: SchoolOption;
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

  return { school: row };
}
