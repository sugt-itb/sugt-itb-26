/**
 * The Programme's settled vocabulary, as fixed sets rather than database rows.
 *
 * Everything here is true independently of where Programme data is stored, so it
 * is safe for both apps to depend on — including the public app, which holds no
 * database credentials (see `docs/adr/0002-two-apps-in-a-pnpm-workspace.md`).
 * Anything that requires reading a Session Record or a Perjadin Report belongs in
 * a data-access package the public app does not declare, not here.
 *
 * Terms follow `CONTEXT.md`. Don't add a name to this file that isn't in the
 * glossary.
 *
 * **One set is here without glossary entries, and it was put here on purpose.**
 * `TRANSACTION_CATEGORIES` holds twelve values a column may take, not twelve terms the
 * Programme's language defines — the difference `CONTEXT.md` draws itself where it declines
 * to gloss them: *"a category is a value a column may hold, not a term this glossary
 * defines."* [#21](https://github.com/mafiefa02/sugt/issues/21) settled the same placement, and
 * `docs/data-model.md` names this file as where the CHECK's list is kept in step.
 *
 * That is a narrow exception and not a general licence. Every other set here — `STREAMS`,
 * `CLASS_KINDS`, `SESSION_MODES`, `SESSION_STATUSES`, `ROLES`, `STORY_KINDS` — names things
 * the glossary defines, and the rule above governs anything new by default. A set of *values*
 * earns this exception only when `CONTEXT.md` has explicitly declined to define them, which
 * is a sentence somebody has to write there first.
 */

/** The two subject-matter divisions inside the STEM & Research Track. */
export const STREAMS = ["STEM", "Research"] as const;
export type Stream = (typeof STREAMS)[number];

/**
 * Which of the three Classes a School runs. A Class is a cohort of people at one
 * School; this names which cohort. Every Class is taught in both Streams, so the
 * division here is by audience, never by Stream.
 */
export const CLASS_KINDS = ["GTK", "MS", "Student"] as const;
export type ClassKind = (typeof CLASS_KINDS)[number];

/**
 * Which cohort a Pretest/Posttest completion was administered to — one of the two Classes taken as
 * a pair. `Siswa` is the Student Class; `GTK-MS` is the GTK and MS Classes together. The values
 * coincide with `TRANSACTION_PARTICIPANT_TYPES` today, but this is a **dedicated** const on purpose
 * (ticket #246): the money axis and the assessment axis must evolve independently, so a CHECK
 * coupled to the other would ripple silently. Like the transaction participant types, these are
 * **values a column may hold, not terms `CONTEXT.md` defines** — mirrored character for character by
 * `assessment_completion_participant_type_check`; see `packages/db/src/schema/monitoring.ts`.
 */
export const PRETEST_PARTICIPANT_TYPES = ["Siswa", "GTK-MS"] as const;
export type PretestParticipantType = (typeof PRETEST_PARTICIPANT_TYPES)[number];

/**
 * The two assessments whose administration this tool tracks — whether a Pretest or Posttest was
 * *administered* to a cohort at a School (yes/no), never scores or outcomes (ADR-0031, reconciling
 * ADR-0009's "delivery, not outcomes"). Only `pretest` is surfaced in the UI this iteration; the
 * column and its CHECK carry `posttest` from the start so surfacing it later is a UI-only change,
 * not a migration. Values a column may hold, mirrored by `assessment_completion_kind_check`.
 */
export const ASSESSMENT_KINDS = ["pretest", "posttest"] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

/** How a Session is delivered. Offline Sessions happen during a Perjadin; online ones have none. */
export const SESSION_MODES = ["offline", "online"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/**
 * A Session's lifecycle. It comes into existence already `arranged` — never before, see
 * `docs/adr/0006-sessions-are-created-when-arranged.md` — and is then delivered or
 * cancelled. A cancelled Session counts for nothing towards progress but stays visible,
 * because a School that was planned for and missed looks different from one nobody has
 * reached yet.
 */
export const SESSION_STATUSES = ["arranged", "delivered", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** What a Session's Sesi is ranked by — see `rankBySchool`. */
export type RankableSession = { id: string; schoolId: string; heldOn: string; startsAt: string };

/**
 * The Sesi order: by held date, then start time, then id as a stable tie-break. Plain string
 * comparison is correct for both — `heldOn` is `YYYY-MM-DD` and `startsAt` is `HH:MM[:SS]`, both
 * of which sort lexically as they sort chronologically.
 */
function bySesiRank(a: RankableSession, b: RankableSession): number {
  if (a.heldOn !== b.heldOn) return a.heldOn < b.heldOn ? -1 : 1;
  if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * **A Session's Sesi** — its per-School, per-mode date rank
 * (`docs/adr/0027-a-sessions-sesi-is-its-per-school-date-rank.md`), computed on the fly and never
 * stored. Each School's Sessions in Sesi order: index 0 is Sesi 1, index 1 is
 * Sesi 2. The one ranking, shared by the `/monitoring` matrix, the planning note (#409) and
 * `/feedback`'s Sesi line (#466).
 *
 * The caller passes **one mode's live Sessions** — cancelled ones are left out, so the next Session
 * after a cancelled one takes its rank rather than one past it — and **all** of a School's, whichever
 * trip each is on, since the rank is the School's and not a trip's.
 */
export function rankBySchool<T extends RankableSession>(sessions: readonly T[]): Map<string, T[]> {
  const ranked = new Map<string, T[]>();
  for (const s of sessions) {
    const list = ranked.get(s.schoolId);
    if (list) list.push(s);
    else ranked.set(s.schoolId, [s]);
  }
  for (const list of ranked.values()) list.sort(bySesiRank);
  return ranked;
}

/**
 * Indonesia's three Time Zones. A Province keeps exactly one and a School's is its
 * Province's, so this is what makes a Session's start time mean something — 09:00 at a
 * Papua School is not 09:00 to the professor reading the screen in Bandung.
 *
 * The abbreviations rather than IANA names (`Asia/Jakarta` and friends) because that is
 * what goes on an Indonesian screen and because all three are **fixed offsets with no
 * daylight saving anywhere in Indonesia** — WIB +7, WITA +8, WIT +9 — so converting one
 * to another is the arithmetic in `formatSessionStartTime` below, not a job for `Intl`.
 */
export const TIME_ZONES = ["WIB", "WITA", "WIT"] as const;
export type TimeZone = (typeof TIME_ZONES)[number];

/**
 * Each Time Zone's fixed offset east of UTC, in hours. There is no daylight saving
 * anywhere in Indonesia, so these never change and a conversion is subtraction.
 */
const TIME_ZONE_OFFSET_HOURS = { WIB: 7, WITA: 8, WIT: 9 } as const satisfies Record<
  TimeZone,
  number
>;

const MINUTES_PER_DAY = 24 * 60;

/**
 * Read a Postgres `time` value — `"09:00"` or `"09:00:00"` — as minutes since midnight.
 * Seconds are dropped: a Session's start and end times are wall-clock hours and minutes.
 */
function wallClockToMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time);
  const hours = match ? Number(match[1]) : Number.NaN;
  const minutes = match ? Number(match[2]) : Number.NaN;
  if (!match || hours > 23 || minutes > 59) {
    throw new Error(`Not a HH:MM[:SS] time: ${time}`);
  }
  return hours * 60 + minutes;
}

/** Render minutes since midnight as `"HH:MM"`, wrapping across midnight in either direction. */
function minutesToHhMm(minutes: number): string {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * A Postgres `time` value as a bare wall-clock `"HH:MM"`, seconds dropped and no zone — for a place
 * that already names the zone once, such as a column header, where repeating it in every cell would
 * only be noise.
 */
export function formatWallClockTime(time: string): string {
  return minutesToHhMm(wallClockToMinutes(time));
}

/**
 * A Session's start time in its own Time Zone: `"09:00 WIT"`. The `time` is a Postgres
 * `time` value local to the School, and the zone is the School's Province's.
 */
export function formatSessionStartTime(time: string, zone: TimeZone): string {
  return `${formatWallClockTime(time)} ${zone}`;
}

/**
 * The same, followed by the WIB equivalent where the School is not on WIB —
 * `"09:00 WIT · 07:00 WIB"` — so a reader in Jakarta knows when the Session actually is.
 * On WIB it is just `formatSessionStartTime`, since the equivalent would repeat it.
 *
 * The conversion can cross midnight: 00:30 WIT is 22:30 WIB the day before, and the
 * result wraps to `"22:30 WIB"` because only the wall-clock time is shown, not the date.
 */
export function formatSessionStartTimeWithWib(time: string, zone: TimeZone): string {
  const local = formatSessionStartTime(time, zone);
  if (zone === "WIB") return local;
  const wibMinutes =
    wallClockToMinutes(time) - (TIME_ZONE_OFFSET_HOURS[zone] - TIME_ZONE_OFFSET_HOURS.WIB) * 60;
  return `${local} · ${minutesToHhMm(wibMinutes)} WIB`;
}

/** A Postgres `time` value the Indonesian way, with a dot: `"08.00"`. No zone. */
export function formatDottedTime(time: string): string {
  return formatWallClockTime(time).replace(":", ".");
}

/**
 * A wall-clock span in its zone, the Indonesian way — `"08.00–11.30 WITA"` — as a Perjadin
 * Document's Waktu Mulai and Waktu Selesai read (#397). Both are Postgres `time` values local to
 * the School.
 */
export function formatTimeRange(startsAt: string, endsAt: string, zone: TimeZone): string {
  return `${formatDottedTime(startsAt)}–${formatDottedTime(endsAt)} ${zone}`;
}

/**
 * The parenthesised Time Zone tag a time-of-day input label carries so a Staffer knows which
 * zone they are entering — `" (WITA)"`, or `""` when no zone is in scope yet (a Session with
 * no School picked, a legacy Perjadin before its return zone is chosen). Prepend it to a label:
 * `` `Jam Mulai${timeZoneSuffix(zone)}` ``. Named once, like `formatIdr`, so the four internal
 * labels that carry it cannot drift apart on spacing or on the "no zone yet" empty case.
 */
export function timeZoneSuffix(zone: TimeZone | "" | null | undefined): string {
  return zone ? ` (${zone})` : "";
}

/**
 * Group a Rupiah amount the way every screen shows it: `id-ID` locale, dot separators,
 * `formatIdr(1000000) === "1.000.000"`. Returns the grouped digits only, no `Rp` prefix —
 * this is exactly the `n.toLocaleString("id-ID")` the display sites used inline, named once
 * so the masked amount inputs and every read-back amount cannot drift apart. The amount
 * inputs render this directly (the value carries digits only); displays wrap it in
 * {@link formatRupiah}, which is the single place the `Rp` prefix lives.
 */
export function formatIdr(n: number): string {
  return n.toLocaleString("id-ID");
}

/**
 * The one way money is displayed: `Rp` immediately followed by the grouped digits, with no
 * space — `formatRupiah(15000000000) === "Rp15.000.000.000"`. The `Rp` prefix lives here and
 * nowhere else, so no display site carries its own literal `"Rp "`. A negative amount carries
 * its sign before the prefix: `"-Rp50.000"`.
 */
export function formatRupiah(n: number): string {
  return n < 0 ? `-Rp${formatIdr(-n)}` : `Rp${formatIdr(n)}`;
}

/**
 * The two roles in the internal tool. **`Teaching Team` was retired in T3** ([#153](https://github.com/mafiefa02/sugt/issues/153)) —
 * once online Sessions named their teachers as free-text names (ADR-0022; since #318 the two
 * `pengajar_*` columns) that Person role had no purpose — and for a while Staff stood alone.
 * **`Pimpinan` was then added as a
 * second signed-in role** ([#179](https://github.com/mafiefa02/sugt/issues/179)): a read-only
 * principal who reads every non-money delivery surface, writes nothing, and lands on the Dashboard (`/`).
 * It is a Person role and nothing more — the widened CHECK admits it, but every composite `(id, role)`
 * FK still pins `'Staff'`, so a Pimpinan is never a Group member, a PIC, a Session-Record filer or a
 * Story author (see `docs/adr/0025-pimpinan-is-a-second-signed-in-read-only-person-role.md` and the
 * CHECK in `packages/db/src/schema/people.ts`). The Programme's leadership, once folded into senior
 * Staff, now have this signed-in read-only role of their own — see
 * `docs/adr/0004-delivery-data-is-open-internally-money-is-not.md`. The teaching **team** concept
 * lives on too, but as trip-scoped / session-scoped free-text **names**, not People (ADR-0020, ADR-0022).
 */
export const ROLES = ["Staff", "Pimpinan"] as const;
export type Role = (typeof ROLES)[number];

/**
 * How each role is **labelled in the UI**. Presentation only: the stored value stays `"Staff"`
 * everywhere — the DB column, the CHECK constraints, the composite FKs pinned by ADR-0013, and
 * every `role === "Staff"` comparison. The Programme calls its own people "DITSAMA", so that is
 * what the internal screens show; renaming the stored value would be a history-touching migration
 * across the `*_role` columns, deliberately avoided ([#116](https://github.com/mafiefa02/sugt/issues/116)).
 * Route any rendered role string through this map; never through the raw value.
 *
 * Two keys now (#179): `Staff` reads **DITSAMA**, and the second signed-in role `Pimpinan` reads
 * **Pimpinan** — its own name, since a Pimpinan is not one of the organisation's DITSAMA people.
 * The map is `Record<Role, string>`, so adding a role to `ROLES` forces the new key here (a compile
 * error otherwise), which is exactly what keeps the label maps in step with the role set.
 */
export const ROLE_LABELS: Record<Role, string> = {
  Staff: "DITSAMA",
  Pimpinan: "Pimpinan",
};

/**
 * How each role is labelled **on a Perjadin surface** — the same stored role seen from the trip's
 * vantage point. There the DITSAMA people are the ones who **accompany** the (name-based) teaching
 * team on the journey, so they read as **Pendamping** rather than the organisation's name. So the
 * `Staff` role carries two context-dependent labels ([#141](https://github.com/mafiefa02/sugt/issues/141)):
 * **DITSAMA** off a Perjadin via `ROLE_LABELS`, **Pendamping** on one via this map. The second role
 * `Pimpinan` (#179) reads **Pimpinan** on both surfaces — it is not a Pendamping and does not travel
 * as a working member, so the trip has no different name for it. Presentation only, keyed on the
 * stored `Role` exactly like `ROLE_LABELS`, so `[member.role]` render sites resolve; the stored
 * values stay `"Staff"` and `"Pimpinan"`. The PIC tag is orthogonal to this — the PIC is a Pendamping
 * too, but is marked by the more specific fact.
 */
export const PERJADIN_ROLE_LABELS: Record<Role, string> = {
  Staff: "Pendamping",
  Pimpinan: "Pimpinan",
};

/**
 * The Grants a Person may hold — a **second, additive access axis** alongside the write-once
 * `role`. A Role is exactly one and write-once (ADR-0013); a Grant is optional, revocable,
 * **Staff-only**, and a Person may hold several. Grants never touch `person.role` or its composite
 * `(id, role)` foreign keys, and being Staff-only they can never punch through "a Pimpinan writes
 * nothing" (ADR-0025). See `docs/adr/0028-grants-are-a-second-additive-access-axis.md`.
 *
 * Six named Grants (ADR-0052, #469):
 * - **Administrator** — administers Grants (assign/revoke any Grant on any Staff Person, including
 *   making another Administrator) and **implies every other Grant**, so an Administrator satisfies
 *   any grant check without holding that grant's own row.
 * - **Keuangan** — reads every transaction across every Perjadin on `/keuangan`, and exports it (#472).
 * - **Perjadin Editor** — plans a Perjadin and writes every Perjadin, not only those whose Group the
 *   Person is in (ADR-0047, ADR-0048).
 * - **Daring Editor** — `/pretest` and the online Sessions: recording, editing, deleting, Tandai
 *   terlaksana and Batalkan Sesi on one.
 * - **Dashboard Editor** — writes the Persiapan Program tab's Preparation Cards, and **implies
 *   Dashboard Viewer** (`GRANT_IMPLIED_BY`, beside `hasGrant`).
 * - **Dashboard Viewer** — may read the Dashboard, and nothing more. A Pimpinan never holds it —
 *   Grants are Staff-only (ADR-0028); a Pimpinan's Dashboard access comes from their role.
 *
 * **No other Grant implies another**: Perjadin Editor, Daring Editor and Keuangan do not read the
 * Dashboard.
 *
 * Unlike `TRANSACTION_CATEGORIES`, these **are** terms the Programme's language defines — `CONTEXT.md`
 * glosses them under **Access** — so they belong here beside `ROLES`. The list is mirrored by
 * `person_grant_grant_check` character for character (see `packages/db/src/schema/people.ts`); a
 * future Grant widens that CHECK the way `0018_widen_person_role_pimpinan.sql` widened the role one.
 */
export const GRANTS = [
  "Administrator",
  "Keuangan",
  "Perjadin Editor",
  "Daring Editor",
  "Dashboard Editor",
  "Dashboard Viewer",
] as const;
export type Grant = (typeof GRANTS)[number];

/**
 * How each Grant is **labelled in the UI**, keyed on the stored `Grant` exactly like `ROLE_LABELS`.
 * The map is `Record<Grant, string>`, so adding a Grant to `GRANTS` forces a key here — a compile
 * error otherwise — which keeps the label map in step with the Grant set. Presentation only; the
 * stored value stays the English term the CHECK pins.
 */
export const GRANT_LABELS: Record<Grant, string> = {
  Administrator: "Administrator",
  Keuangan: "Keuangan",
  "Perjadin Editor": "Perjadin Editor",
  "Daring Editor": "Daring Editor",
  "Dashboard Editor": "Dashboard Editor",
  "Dashboard Viewer": "Dashboard Viewer",
};

/**
 * **What each Grant gates, in one line** — shown under its label in `/orang`'s Grant picker (#470).
 * Beside `GRANT_LABELS` so a new Grant gets both at once; presentation only.
 */
export const GRANT_DESCRIPTIONS: Record<Grant, string> = {
  Administrator: "semua akses",
  Keuangan: "tabel dan ekspor semua transaksi",
  "Perjadin Editor": "merencanakan dan menulis setiap Perjadin",
  "Daring Editor": "Sesi daring dan Pretest",
  "Dashboard Editor": "termasuk Dashboard Viewer",
  "Dashboard Viewer": "membaca Dashboard",
};

/**
 * The two kinds a Story may be. They share one editor and one upload path; they differ only
 * in where the public site lists them — a Final Project reaches the public this way without
 * becoming a tracked record (see `docs/adr/0009-the-tool-tracks-delivery-not-outcomes.md`).
 */
export const STORY_KINDS = ["field", "final_project"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

/**
 * How many Sessions each School receives, by mode. The same for every School and
 * fixed from the start, which is what lets progress read as "3 of 8 delivered"
 * without any planned Sessions existing
 * (see `docs/adr/0006-sessions-are-created-when-arranged.md`).
 *
 * Offline is **2** per School (a programme fact, #195): the two Luring Sesi in
 * `LURING_SESI_WINDOWS` below. Online stays 6, so a School's total is 8.
 */
export const SESSIONS_PER_SCHOOL = {
  offline: 2,
  online: 6,
} as const satisfies Record<SessionMode, number>;

/** Total Sessions a School receives across both modes. */
export const TOTAL_SESSIONS_PER_SCHOOL = SESSIONS_PER_SCHOOL.offline + SESSIONS_PER_SCHOOL.online;

/**
 * How many **Kegiatan terlaksana** units a School is measured against — the denominator of the
 * `/monitoring` progress KPI (`docs/adr/0031-pretest-posttest-completion-is-tracked-as-delivery-not-outcomes.md`, #249).
 * Its eight Sessions **plus one unit per assessment kind** (pretest + posttest), so **10**. Each
 * assessment unit is all-or-nothing: a School's pretest unit counts only once all four pretest boxes
 * are done, likewise posttest. Derived from `TOTAL_SESSIONS_PER_SCHOOL` and `ASSESSMENT_KINDS.length`
 * so it cannot drift from either. Distinct from `TOTAL_SESSIONS_PER_SCHOOL`, the Session-only total
 * the other progress readouts (school directory/detail, the public figures) still measure against.
 */
export const KEGIATAN_UNITS_PER_SCHOOL = TOTAL_SESSIONS_PER_SCHOOL + ASSESSMENT_KINDS.length;

/**
 * **The programme's total budget, in whole rupiah** (#195). A single constant — there is no schema
 * for it — that `/monitoring` reconciles spend against. Whole IDR, like every money column.
 */
export const PROGRAMME_BUDGET_IDR = 15_000_000_000;

/**
 * **The planned period of each Luring (offline) Sesi** (#195). Two windows, one per offline Sesi,
 * as inclusive `YYYY-MM-DD` date ranges in 2026.
 *
 * They drive `/monitoring`'s timeline stepper and its overdue warnings **only** — they do *not*
 * bucket Sessions into a Sesi. A Session's Sesi is its per-School date **rank**, computed on the fly
 * (ADR-0027), independent of these calendar windows: a Session delivered outside its window is late,
 * not re-ranked.
 */
export const LURING_SESI_WINDOWS = [
  { sesi: 1, startsOn: "2026-10-05", endsOn: "2026-10-23" },
  { sesi: 2, startsOn: "2026-11-02", endsOn: "2026-11-20" },
] as const;

/**
 * What a Class Record Rates — filed by the Teaching Team member who taught that Class.
 *
 * The first three are judgements only the person at the front can make: whether the cohort
 * followed it, took part, and arrived prepared. Deliberately absent from the Participant
 * form, because a room grading its own readiness is not evidence.
 *
 * Note these name **columns**, not values — unlike `CLASS_KINDS` and `STREAMS`, which are
 * stored as strings. The arrays exist so each form and the concerns query are built from
 * the same list the table is.
 */
export const CLASS_RECORD_ASPECTS = [
  "comprehension",
  "participation",
  "readiness",
  "materials",
  "delivery",
  "facilities",
  "timing",
] as const;
export type ClassRecordAspect = (typeof CLASS_RECORD_ASPECTS)[number];

/**
 * What a Session Record Rates — filed by the PIC, who organised the visit and taught none of
 * it. Every one is something an organiser can see from the back of the room; nothing here
 * asks them to judge teaching they did not deliver.
 */
export const SESSION_RECORD_ASPECTS = [
  "facilities",
  "turnout",
  "school_support",
  "timing",
  "coordination",
] as const;
export type SessionRecordAspect = (typeof SESSION_RECORD_ASPECTS)[number];

/**
 * What a Participant Rates. `materials` and `instructor` overlap with the Class Record on
 * purpose — that overlap is what lets the professor's view be set against the room's.
 *
 * **`hands_on_rbl` is the Student Class's alone** ([#446](https://github.com/sugt-itb/sugt-itb-26/issues/446)):
 * how the hands-on **RBL** (Research-Based Learning) module went, asked first. Which Aspects a
 * Participant is asked depends on their Class — `PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS` below — and
 * `participant_feedback_hands_on_rbl_student_check` holds the same rule at the database.
 */
export const PARTICIPANT_FEEDBACK_ASPECTS = [
  "hands_on_rbl",
  "materials",
  "instructor",
  "relevance",
] as const;
export type ParticipantFeedbackAspect = (typeof PARTICIPANT_FEEDBACK_ASPECTS)[number];

/** The Aspects each Class is asked, in the form's order: Hands-on RBL first, and only for Siswa. */
export const PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS: Record<
  ClassKind,
  readonly ParticipantFeedbackAspect[]
> = {
  GTK: ["materials", "instructor", "relevance"],
  MS: ["materials", "instructor", "relevance"],
  Student: ["hands_on_rbl", "materials", "instructor", "relevance"],
};

/**
 * What a Perjadin Evaluation Rates — the logistics of the trip, not the teaching — and, last,
 * **Pendamping Support**: whether the accompanying DITSAMA Staff helped while the activity was
 * under way (#481). Not every filer is asked every one: `PERJADIN_ASPECTS_BY_ROLE` below.
 */
export const PERJADIN_ASPECTS = [
  "lodging",
  "transport",
  "meals",
  "punctuality",
  "pendamping_support",
] as const;
export type PerjadinAspect = (typeof PERJADIN_ASPECTS)[number];

/**
 * Who a Perjadin Evaluation filer says they are — a **self-declared** role, typed alongside a name
 * on the unauthenticated `/ep/{token}` form (ADR-0024). It is not validated against the Group or
 * the Pimpinan roster: the identity is untrusted by design, exactly as `participant_feedback.name`
 * is (ADR-0012). The three cover everyone the evaluation wants to hear from — the name-based
 * **Narasumber** (the Teaching Team's UI label; `Pengajar` until #393), the signed-in DITSAMA
 * **Pendamping** who travel, and the record-only **Pimpinan** — none of whom the old
 * signed-in-Group gate could all admit.
 *
 * These are **values a column may hold**, so `perjadin_evaluation.filed_by_role` CHECKs this list
 * character for character (see `packages/db/src/schema/evaluations.ts`), and the form's Role
 * selector is driven off it — one list behind the schema, the query and the form.
 */
export const PERJADIN_EVALUATION_ROLES = ["Narasumber", "Pendamping", "Pimpinan"] as const;
export type PerjadinEvaluationRole = (typeof PERJADIN_EVALUATION_ROLES)[number];

/**
 * The Aspects each self-declared Role is asked, in the form's order. **A Pendamping is not asked
 * Pendamping Support** — they would be Rating themselves, the reason a Participant is not asked
 * their own readiness
 * (`docs/adr/0054-pendamping-support-is-rated-only-by-narasumber-and-pimpinan.md`).
 * `lodging` is asked of everyone and may still be skipped on a day trip; that is a choice on the
 * form, not a Role's.
 *
 * `filePerjadinEvaluation` holds both directions of this; `perjadin_evaluation_pendamping_support_rater_check`
 * holds only the Pendamping half, because evaluations filed before #481 carry no Pendamping Support
 * from Narasumber and Pimpinan alike.
 */
export const PERJADIN_ASPECTS_BY_ROLE: Record<PerjadinEvaluationRole, readonly PerjadinAspect[]> = {
  Narasumber: PERJADIN_ASPECTS,
  Pendamping: ["lodging", "transport", "meals", "punctuality"],
  Pimpinan: PERJADIN_ASPECTS,
};

/**
 * The bounds of a Rating: the score one person gives one Aspect. Ratings are the only
 * thing in the system anything counts.
 */
export const RATING_MIN = 1;
export const RATING_MAX = 10;

/**
 * An Aspect reaches the concerns list when **any single** Rating of it is at or below
 * this — from a Session Record, a Perjadin Evaluation or Participant Feedback. Never an
 * average: one person scoring something low is the signal, and averaging it away under
 * three cheerful scores defeats the reason more than one person is asked.
 *
 * The same number also decides when prose becomes mandatory, so raising it costs writing
 * as well as screen space. Any threshold is invented; this one is a named constant rather
 * than a literal so it is findable — but note it appears in **index predicates**, so
 * changing it needs a migration and not just an edit here.
 * See `docs/adr/0006-sessions-are-created-when-arranged.md`.
 */
export const CONCERN_AT_OR_BELOW = 7;

/**
 * A Perjadin Report is due this many days after the Group gets back, so the deadline is
 * derived from the Perjadin's end date and never stored. Nothing is gated on it — it is
 * shown as days remaining and that is all.
 */
export const REPORT_DEADLINE_DAYS_AFTER_RETURN = 2;

/**
 * What a transaction on a Perjadin was spent on. A closed set of twelve, and the
 * one fixed set here that was **read off a document rather than agreed in conversation**:
 * the first eleven are the line items the Programme's approved budget repeats across every
 * travel group, and `Lainnya` is the escape hatch.
 *
 * They are in Indonesian because that is what goes on the paperwork. `Uang Harian` stays
 * one category — the budget's split by role is a rate difference, not a different kind of
 * spend.
 *
 * This narrows the amendment to `docs/adr/0007-the-tool-generates-the-acquittal.md`, which
 * ruled out "no category, no cost-centre, no account code, no payee". That clause objected
 * to *inventing* fields for a template nobody has read; a list taken from an approved
 * document answers the objection rather than overriding it. Nothing else came with it — no
 * cost-centre, no account code, no payee, no `Ref Standar Biaya`.
 *
 * The names are not glossary terms, which is why they live here and not in `CONTEXT.md`:
 * a category is a value a column may hold. `transaction.category` CHECKs this list
 * character for character; see `packages/db/src/schema/travel.ts`.
 */
export const TRANSACTION_CATEGORIES = [
  "Tiket Pesawat/Kereta PP",
  "Uang Harian",
  "Honorarium Narasumber",
  "Akomodasi",
  "Transport Bandara/Stasiun",
  "Transport Lokal Dalam Provinsi",
  "Konsumsi",
  "Modul",
  "ATK",
  "Alat dan Bahan Research Project",
  "Seminar kit",
  "Lainnya",
] as const;
export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

/**
 * Which cohort a transaction's spend served — an axis orthogonal to `category`. `category` is what
 * kind of spend it was; `participant_type` is which of the two Classes it was for. `Siswa` is the
 * Student Class; `GTK-MS` is the GTK and MS Classes taken together. Required on every transaction:
 * the Laporan splits each acquittal's spend by cohort, so there is no unset state to carry.
 *
 * There is deliberately **no "Umum" value**: a shared cost is attributed to whichever type it
 * predominantly served rather than parked in a third bucket, because a subtotal that leaves spend
 * unattributed answers the split it exists to make with "some of it".
 *
 * Like `TRANSACTION_CATEGORIES`, these are **values a column may hold, not terms `CONTEXT.md`
 * defines** — Indonesian, a closed set, mirrored by `transaction_participant_type_check` character
 * for character; see `packages/db/src/schema/travel.ts`.
 */
export const TRANSACTION_PARTICIPANT_TYPES = ["Siswa", "GTK-MS"] as const;
export type TransactionParticipantType = (typeof TRANSACTION_PARTICIPANT_TYPES)[number];

/**
 * The **Jenis** a Preparation **Checklist Item** carries — the kind of preparation that item tracks,
 * on the Dashboard (`/`) Persiapan Program tab. Moved down from the Card to each item (#292). A closed set of
 * four, mirrored by `preparation_checklist_item_jenis_check` character for character (see
 * `packages/db/src/schema/monitoring.ts`).
 *
 * **`Pimpinan` here is a category label, not the Person Role.** It names a kind of preparation
 * (leadership-facing), and has nothing to do with the signed-in read-only `Pimpinan` role in `ROLES`
 * or with `requireGrant`/Grants — an item's Jenis never gates access. Like `TRANSACTION_CATEGORIES`,
 * these are **values a column may hold, not terms `CONTEXT.md` defines**, so they live here
 * without a glossary entry; only the Monitoring Preparation *concepts* are glossed.
 */
export const PREPARATION_JENIS = ["Teknis", "Kurikulum", "LAPI", "Pimpinan"] as const;
export type PreparationJenis = (typeof PREPARATION_JENIS)[number];

/** The app-enforced ceiling on a Preparation Card's checklist — a safety cap the DB does not hold. */
export const MAX_PREPARATION_CHECKLIST_ITEMS = 20;

/**
 * The app-enforced caps on the new Perjadin model — ceilings the database deliberately does not
 * hold, in the same spirit as the Group rules that live in the application rather than a CHECK
 * ([ADR-0019](../../../docs/adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md),
 * [ADR-0020](../../../docs/adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)).
 *
 * - `MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN` — a safety ceiling; six or seven is the real
 *   maximum, ten is practically unreachable.
 * - `MAX_TEACHING_TEAM_PER_PERJADIN` — trip-scoped teacher names entered on the trip.
 * - `MAX_EXTRA_STAFF_PER_GROUP` — DITSAMA Staff on a Group besides the PIC; the PIC plus up to ten.
 *
 * `MAX_TEACHING_TEAM_PER_ONLINE_SESSION` is **gone** (#318, ADR-0036): an online Session no longer
 * holds a variable-length Pengajar list to cap — it carries exactly two cohort-named Pengajar as
 * `pengajar_siswa_name` and `pengajar_gtk_ms_name`, one each, both required, so the number is fixed
 * by the schema rather than by an app-layer ceiling.
 */
export const MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN = 10;
export const MAX_TEACHING_TEAM_PER_PERJADIN = 20;
export const MAX_EXTRA_STAFF_PER_GROUP = 10;

/**
 * **Receipts per transaction: at least one, at most this many, in total** ([ADR-0039](../../../docs/adr/0039-every-transaction-is-recorded-with-its-evidence.md)).
 * A product rule, not a guard on an array: it counts the receipts recorded with the line plus every
 * later upload from its row. Held by the application, in the two writes that add evidence
 * (`recordTransaction`, `attachTransactionEvidence`) — no CHECK, because the shared database may
 * already hold lines with none or with more, and those are grandfathered.
 * The floor of one needs no constant of its own.
 */
export const MAX_RECEIPTS_PER_TRANSACTION = 5;

/**
 * **The largest one uploaded file may be: 50 MB**, meaning 50 × 1024 × 1024 bytes
 * ([ADR-0040](../../../docs/adr/0040-transaction-evidence-is-stored-in-the-company-google-drive.md),
 * amended by [#394](https://github.com/sugt-itb/sugt-itb-26/issues/394)). One cap for every upload to
 * Drive — receipts now, and the attendance-sheet uploads [#397](https://github.com/sugt-itb/sugt-itb-26/issues/397)
 * is to add — so it is named for the upload, not the receipt. A product rule beside the count above, read by the
 * browser — which refuses a bigger file after compressing it — and by the server, which declares it
 * to Drive when opening the upload session and checks it again on the file Drive holds.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * **Session Footage** — the photos and videos documenting one offline Session, shown as "Foto &
 * Video" (#424, ADR-0046). Two kinds, each with its own cap, in the same MiB arithmetic as
 * `MAX_UPLOAD_BYTES`. A photo is held to the receipts' 50 MB; a video may be twenty times that.
 * Footage is uploaded untouched, so these caps are on the file as it was taken.
 */
export const SESSION_FOOTAGE_KINDS = ["foto", "video"] as const;
export type SessionFootageKind = (typeof SESSION_FOOTAGE_KINDS)[number];

export const MAX_FOOTAGE_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_FOOTAGE_VIDEO_BYTES = 1000 * 1024 * 1024;

/** The cap on one file of each kind. */
export const MAX_FOOTAGE_BYTES: Record<SessionFootageKind, number> = {
  foto: MAX_FOOTAGE_PHOTO_BYTES,
  video: MAX_FOOTAGE_VIDEO_BYTES,
};

/**
 * The types Session Footage is stored as — the six the server recognises from a file's first bytes
 * (JPEG, PNG, HEIC/HEIF, WebP, MP4, MOV), each with its kind. A HEIF file is stored as `image/heic`:
 * the two share a container and a sniff. Mirrored by `session_footage_content_type_check`.
 */
export const SESSION_FOOTAGE_CONTENT_TYPES = {
  "image/jpeg": "foto",
  "image/png": "foto",
  "image/heic": "foto",
  "image/webp": "foto",
  "video/mp4": "video",
  "video/quicktime": "video",
} as const satisfies Record<string, SessionFootageKind>;
export type SessionFootageContentType = keyof typeof SESSION_FOOTAGE_CONTENT_TYPES;

/**
 * **What an Activity Log entry records**
 * ([#395](https://github.com/sugt-itb/sugt-itb-26/issues/395)): one act on a Perjadin's money,
 * receipts, documents or report. A closed set, mirrored character for character by
 * `activity_log_action_check` (see `packages/db/src/schema/travel.ts`).
 *
 * The two `document_*` values went into the set with the rest, so the Dokumen uploads
 * ([#397](https://github.com/sugt-itb/sugt-itb-26/issues/397)) and Hapus
 * ([#398](https://github.com/sugt-itb/sugt-itb-26/issues/398)) needed no CHECK migration. The two
 * `footage_*` values (Session Footage, #424) came later and widened the CHECK in migration 0044, and
 * `evidence_deleted` and `transaction_deleted` (Hapus bukti, #462, and Hapus transaksi, #463;
 * ADR-0050) widened it again in migration 0049.
 *
 * `advance_set` and `advance_changed` are **history only** (ADR-0051, #464): the Advance is no
 * longer tracked, so nothing writes them, but the entries already in the Log stay readable and
 * searchable.
 */
export const ACTIVITY_LOG_ACTIONS = [
  "advance_set",
  "advance_changed",
  "transaction_recorded",
  "evidence_uploaded",
  "report_filed",
  "document_uploaded",
  "document_deleted",
  "footage_uploaded",
  "footage_deleted",
  "evidence_deleted",
  "transaction_deleted",
] as const;
export type ActivityLogAction = (typeof ACTIVITY_LOG_ACTIONS)[number];

/** The Aksi column of `/log`: what each action reads as on screen. */
export const ACTIVITY_LOG_ACTION_LABELS: Record<ActivityLogAction, string> = {
  advance_set: "Uang Perjalanan ditetapkan",
  advance_changed: "Uang Perjalanan diubah",
  transaction_recorded: "Catat transaksi",
  evidence_uploaded: "Unggah bukti",
  report_filed: "Laporan dikirim",
  document_uploaded: "Dokumen diunggah",
  document_deleted: "Dokumen dihapus",
  footage_uploaded: "Foto/Video diunggah",
  footage_deleted: "Foto/Video dihapus",
  evidence_deleted: "Bukti dihapus",
  transaction_deleted: "Transaksi dihapus",
};

/**
 * **The three levels a Preparation Item is defined at** (ADR-0045): every Perjadin, one Cluster's,
 * or one Perjadin's own. The more specific level wins. Mirrored character for character by
 * `preparation_item_level_check` (see `packages/db/src/schema/travel.ts`).
 */
export const PREPARATION_ITEM_LEVELS = ["semua", "cluster", "perjadin"] as const;
export type PreparationItemLevel = (typeof PREPARATION_ITEM_LEVELS)[number];

/**
 * The longest a Preparation Item's wording may be, in characters, at any level. The company's longest
 * item is under 130; this leaves room without letting a paragraph in.
 */
export const MAX_PREPARATION_ITEM_LABEL_LENGTH = 200;

/**
 * **The four kinds of Perjadin Document**
 * ([#397](https://github.com/sugt-itb/sugt-itb-26/issues/397), ADR-0042): the trip's paperwork, one
 * PDF each — three attendance sheets, and **SPPD**, one School's Surat Perintah Perjalanan Dinas
 * for the trip ([#441](https://github.com/sugt-itb/sugt-itb-26/issues/441)). Indonesian because
 * they are the names of paperwork, on the same footing as `TRANSACTION_CATEGORIES`; each is the
 * stored value, the label and its Drive kind folder's name. Mirrored character for character by
 * `perjadin_document_kind_check` (see `packages/db/src/schema/travel.ts`).
 */
export const PERJADIN_DOCUMENT_KINDS = [
  "Daftar Hadir Peserta",
  "Daftar Hadir Narasumber",
  "Daftar Hadir Pendamping",
  "SPPD",
] as const;
export type PerjadinDocumentKind = (typeof PERJADIN_DOCUMENT_KINDS)[number];

/**
 * Which cohort a Daftar Hadir Peserta is for. The same two values as
 * `TRANSACTION_PARTICIPANT_TYPES` today, but a **dedicated** const, following
 * `PRETEST_PARTICIPANT_TYPES`: a document's cohort and a transaction's are separate columns that
 * may yet diverge. Mirrored by `perjadin_document_participant_type_check`.
 */
export const PERJADIN_DOCUMENT_PARTICIPANT_TYPES = ["Siswa", "GTK-MS"] as const;
export type PerjadinDocumentParticipantType = (typeof PERJADIN_DOCUMENT_PARTICIPANT_TYPES)[number];
