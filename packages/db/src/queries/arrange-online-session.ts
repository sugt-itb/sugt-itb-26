import { asc, eq } from "drizzle-orm";

import { db } from "../client";
import { ONLINE_SESSION_STILL_STANDS, session } from "../schema/delivery";
import { province, school } from "../schema/reference";
import type { Person } from "./caller";
import type { SelectedSchool } from "./rosters";
import { requireStaff } from "./staff-only";

/**
 * **Catat Sesi daring** — recording **one** online Session, for **one** School, as an event that has
 * **already happened** ([#70](https://github.com/mafiefa02/sugt/issues/70), #318). A third-party LMS
 * runs online delivery, so SUGT does not arrange an online Session and mark it delivered later — it
 * logs a Session that was delivered, in one step. The row is written **`status: 'delivered'`**
 * (#318, ADR-0036), collapsing the old arrange→deliver pair.
 *
 * Six of every ten Sessions are online and have no Perjadin, so this is the entry point for most of
 * the teaching in the Programme. An online Session carries **no PIC and no Stream** (#284, ADR-0035),
 * and its two Pengajar are **cohort-named columns** — one Siswa professor, one GTK-MS professor —
 * rather than a variable-length name list (#318, superseding ADR-0022).
 *
 * Staff-only, by the surface list rather than by ADR-0004 (see `./staff-only.ts`, which carries
 * both reasons). It matters more on a write than on a read: a Next.js layout does not run before
 * a Server Action, so `requireStaff` here is the only thing standing between a Teaching Team
 * member and a recorded Session.
 */

/**
 * What recording one online Session takes: a School, its date, its start and end time, and its two
 * cohort-named Pengajar. **No PIC, no Stream, no Peserta selector (#318): both cohorts are always
 * taught, one Pengajar each.**
 *
 * **`mode`, `perjadinId`, `status` and `cancelledReason` are absent by design** — there is no field
 * to set wrong. The write binds `mode = 'online'`, `status = 'delivered'` and no Perjadin, so
 * `session_offline_iff_perjadin` and `session_cancelled_iff_reason` are satisfied before a value is
 * bound.
 */
export type ArrangeOnlineSessionInput = {
  schoolId: string;
  /** `YYYY-MM-DD`. Must be today or in the past (#318) — an online Session is recorded after it happened. */
  heldOn: string;
  /**
   * Local wall-clock start time (`HH:MM`), always WIB for an online Session (#283) — the Zoom host is
   * in WIB, so the hour is a WIB wall-clock time nationally. `starts_at` is NOT NULL.
   */
  startsAt: string;
  /**
   * Local wall-clock end time (`HH:MM`), in the same zone as `startsAt`. Required for online at this
   * layer — the column is nullable so an offline row may omit it — and must be strictly after
   * `startsAt`, which the `session_ends_after_starts_check` CHECK backstops. `""` when the caller has
   * not chosen one; refused as `end-time-required`.
   */
  endsAt: string;
  /**
   * The Siswa Pengajar's name — one free-text name (#318), the online mirror of a Perjadin's
   * trip-scoped teacher names. Required; a blank one is refused as `pengajar-required`.
   */
  pengajarSiswaName: string;
  /** The GTK-MS Pengajar's name — one free-text name (#318). Required; blank is `pengajar-required`. */
  pengajarGtkMsName: string;
};

/**
 * Why an online Session was not recorded.
 *
 * A collision is a **user state**, not a bug, so it comes back as a value rather than a throw
 * ([#12](https://github.com/mafiefa02/sugt/issues/12)): two Staff recording the same School's day is
 * exactly that. `NotStaffError` is the opposite case and still throws.
 */
export type ArrangeOnlineSessionResult =
  | { outcome: "recorded"; sessionId: string }
  /** This School already has an online Session on this date that was not cancelled (#284: one per day). */
  | { outcome: "collided"; heldOn: string }
  /**
   * A blank Siswa or GTK-MS Pengajar name. Both are required (#318); the not-null-for-online rule
   * lives at this layer (`session_online_pengajar_not_null` backstops it), so this is where a
   * hand-edited payload with a blank name is refused. The form guards both, so an ordinary submit
   * never reaches it.
   */
  | { outcome: "pengajar-required" }
  | { outcome: "end-time-required" }
  /** `ends_at` was not strictly after `starts_at` — the app-layer half of `session_ends_after_starts_check`. */
  | { outcome: "end-before-start" }
  /** `held_on` was in the future — an online Session is recorded after it happened (#318). */
  | { outcome: "future-date"; today: string };

/**
 * Today's date in **WIB** (`YYYY-MM-DD`) — the Programme's zone, the one an online Session's `held_on`
 * is a calendar day in. A future-date guard read in UTC would flip up to seven hours early against a
 * WIB date, so the "no future dates" rule is measured in the same zone the date is written in.
 */
function wibToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

/**
 * Record one delivered online Session. A single insert now (#318) — no side table to write, so no
 * transaction: the two Pengajar are columns on the row.
 *
 * `on conflict do nothing` names `session_one_online_per_school_per_day` as its arbiter and repeats
 * its predicate verbatim from `ONLINE_SESSION_STILL_STANDS` — Postgres refuses to infer an index
 * whose predicate does not match, which is a runtime failure. With no target it would also swallow a
 * violation of the primary key, which is not a user state. The index keys on `(school_id, held_on)`,
 * so a returned collision means the day is taken, whatever the hour — one online Session per School
 * per day.
 */
export async function arrangeOnlineSession(
  caller: Person,
  input: ArrangeOnlineSessionInput,
): Promise<ArrangeOnlineSessionResult> {
  requireStaff(caller);

  // Both Pengajar are required (#318); trimmed here so a name of spaces reads as blank. The
  // not-null-for-online CHECK is the backstop — this gives a value the form renders instead.
  const pengajarSiswaName = input.pengajarSiswaName.trim();
  const pengajarGtkMsName = input.pengajarGtkMsName.trim();
  if (pengajarSiswaName === "" || pengajarGtkMsName === "") return { outcome: "pengajar-required" };

  // `starts_at`/`ends_at` are both zero-padded `HH:MM`, so a lexicographic compare is chronological.
  // The `session_ends_after_starts_check` CHECK is the backstop; refusing here gives a value the form
  // can render rather than a thrown constraint.
  if (input.endsAt === "") return { outcome: "end-time-required" };
  if (input.endsAt <= input.startsAt) return { outcome: "end-before-start" };

  // No future dates (#318): an online Session is recorded after it happened. Measured in WIB, the
  // zone `held_on` is a day in. The form caps its date input at today too; this catches a
  // hand-edited payload.
  const today = wibToday();
  if (input.heldOn > today) return { outcome: "future-date", today };

  const [created] = await db
    .insert(session)
    .values({
      schoolId: input.schoolId,
      mode: "online",
      status: "delivered",
      heldOn: input.heldOn,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      pengajarSiswaName,
      pengajarGtkMsName,
    })
    .onConflictDoNothing({
      target: [session.schoolId, session.heldOn],
      where: ONLINE_SESSION_STILL_STANDS,
    })
    .returning({ id: session.id });

  if (!created) return { outcome: "collided", heldOn: input.heldOn };

  return { outcome: "recorded", sessionId: created.id };
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
