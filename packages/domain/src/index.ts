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
 * Seconds are dropped: a Session's start time is a wall-clock hour and minute.
 */
function startTimeToMinutes(time: string): number {
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
 * A Session's start time in its own Time Zone: `"09:00 WIT"`. The `time` is a Postgres
 * `time` value local to the School, and the zone is the School's Province's.
 */
export function formatSessionStartTime(time: string, zone: TimeZone): string {
  return `${minutesToHhMm(startTimeToMinutes(time))} ${zone}`;
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
    startTimeToMinutes(time) - (TIME_ZONE_OFFSET_HOURS[zone] - TIME_ZONE_OFFSET_HOURS.WIB) * 60;
  return `${local} · ${minutesToHhMm(wibMinutes)} WIB`;
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
 * `formatIdr(1000000) === "1.000.000"`. Returns the grouped digits only — each call site
 * keeps its own literal `Rp ` prefix, so this is exactly the `n.toLocaleString("id-ID")` the
 * display sites used inline, named once so the plan form's masked input and every read-back
 * amount cannot drift apart.
 */
export function formatIdr(n: number): string {
  return n.toLocaleString("id-ID");
}

/**
 * The two roles in the internal tool. **`Teaching Team` was retired in T3** ([#153](https://github.com/mafiefa02/sugt/issues/153)) —
 * once online Sessions named their teachers as free-text `session_teacher_name` (ADR-0022) that
 * Person role had no purpose — and for a while Staff stood alone. **`Pimpinan` was then added as a
 * second signed-in role** ([#179](https://github.com/mafiefa02/sugt/issues/179)): a read-only
 * principal who reads every non-money delivery surface, writes nothing, and lands on `/monitoring`.
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
 */
export const PARTICIPANT_FEEDBACK_ASPECTS = ["materials", "instructor", "relevance"] as const;
export type ParticipantFeedbackAspect = (typeof PARTICIPANT_FEEDBACK_ASPECTS)[number];

/**
 * What a Perjadin Evaluation Rates — the logistics of the trip, not the teaching.
 */
export const PERJADIN_ASPECTS = ["lodging", "transport", "meals", "punctuality"] as const;
export type PerjadinAspect = (typeof PERJADIN_ASPECTS)[number];

/**
 * Who a Perjadin Evaluation filer says they are — a **self-declared** role, typed alongside a name
 * on the unauthenticated `/ep/{token}` form (ADR-0024). It is not validated against the Group or
 * the Pimpinan roster: the identity is untrusted by design, exactly as `participant_feedback.name`
 * is (ADR-0012). The three cover everyone the evaluation wants to hear from — the name-based
 * **Pengajar** (Teaching Team), the signed-in DITSAMA **Pendamping** who travel, and the
 * record-only **Pimpinan** — none of whom the old signed-in-Group gate could all admit.
 *
 * These are **values a column may hold**, so `perjadin_evaluation.filed_by_role` CHECKs this list
 * character for character (see `packages/db/src/schema/evaluations.ts`), and the form's Role
 * selector is driven off it — one list behind the schema, the query and the form.
 */
export const PERJADIN_EVALUATION_ROLES = ["Pengajar", "Pendamping", "Pimpinan"] as const;
export type PerjadinEvaluationRole = (typeof PERJADIN_EVALUATION_ROLES)[number];

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
 * How long a Session's Participant Feedback link stays open. Counted from when the token
 * is issued, which is at the end of the Session by construction — the link is the QR code
 * shown in the room, so "24 hours after the Session ended" and "24 hours after issue" are
 * the same moment without storing a Session end time.
 */
export const FEEDBACK_TOKEN_LIFETIME_HOURS = 24;

/**
 * How long a Perjadin's Evaluation link stays open — **14 days**, far longer than the Session
 * feedback token's 24 hours. A Participant Feedback QR is held up in the room and scanned on the
 * spot, so a day is generous; a Perjadin link is shared by hand to the Pengajar, Pendamping and
 * Pimpinan after a trip that may have run over a week, and they file when they get to it. Counted
 * from issue, like `FEEDBACK_TOKEN_LIFETIME_HOURS`, and expressed in hours so both tokens set
 * their `expires_at` the same way (`now() + make_interval(hours => …)`).
 */
export const PERJADIN_FEEDBACK_TOKEN_LIFETIME_HOURS = 24 * 14;

/**
 * A Perjadin Report is due this many days after the Group gets back, so the deadline is
 * derived from the Perjadin's end date and never stored. Nothing is gated on it — it is
 * shown as days remaining and that is all.
 */
export const REPORT_DEADLINE_DAYS_AFTER_RETURN = 2;

/**
 * What a transaction against an Advance was spent on. A closed set of twelve, and the
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
 * How a Group travels to and from a Perjadin — the mode on the Keberangkatan and Kepulangan
 * legs. A closed set of four, in Indonesian because that is what goes on the Surat Tugas, the
 * same reasoning as `TRANSACTION_CATEGORIES` above.
 *
 * Like the categories, these are **values a column may hold, not terms `CONTEXT.md` defines** —
 * so they live here and not in the glossary. Both `departure_mode` and `return_mode` on
 * `perjadin` CHECK this list character for character; see `packages/db/src/schema/travel.ts`.
 */
export const TRANSPORT_MODES = ["Pesawat", "Kereta", "Travel", "Mobil Dalam Kota"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/**
 * The app-enforced caps on the new Perjadin model — ceilings the database deliberately does not
 * hold, in the same spirit as the Group rules that live in the application rather than a CHECK
 * ([ADR-0019](../../../docs/adr/0019-offline-sessions-carry-a-stream-and-a-school-gets-many-per-trip.md),
 * [ADR-0020](../../../docs/adr/0020-teaching-team-members-on-a-perjadin-are-trip-scoped-names.md)).
 *
 * - `MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN` — a safety ceiling; six or seven is the real
 *   maximum, ten is practically unreachable.
 * - `MAX_TEACHING_TEAM_PER_PERJADIN` — trip-scoped teacher names entered on the trip.
 * - `MAX_TEACHING_TEAM_PER_ONLINE_SESSION` — session-scoped online Pengajar names, the online
 *   analogue of the trip-scoped cap above (ADR-0022). A single online Session is taught by a small
 *   handful; ten is a safety ceiling, not a target.
 * - `MAX_EXTRA_STAFF_PER_GROUP` — DITSAMA Staff on a Group besides the PIC; the PIC plus up to ten.
 */
export const MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN = 10;
export const MAX_TEACHING_TEAM_PER_PERJADIN = 20;
export const MAX_TEACHING_TEAM_PER_ONLINE_SESSION = 10;
export const MAX_EXTRA_STAFF_PER_GROUP = 10;
