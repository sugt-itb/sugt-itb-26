import type {
  SessionFootageContentType,
  SessionFootageKind,
  SessionMode,
  SessionStatus,
} from "@sugt/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { person } from "./people";
import { school } from "./reference";
import { perjadin, perjadinTeacher } from "./travel";

/**
 * Which rows `session_one_online_per_school_per_day` covers: an online Session that has
 * not been cancelled.
 *
 * **Exported because a second place has to say the same thing, character for character.**
 * `arrangeOnlineSession` names this index as its `on conflict` arbiter and has to repeat
 * the predicate to do so — and Postgres refuses to infer an index whose predicate does not
 * match, which fails at runtime rather than at typecheck. Two copies of it are two chances
 * to find that out in production.
 *
 * Column names are unqualified deliberately. A `create index … where` clause may not carry
 * a qualified reference, so the form that works in the index is the form that has to be
 * shared.
 *
 * `./index.ts` re-exports this file with `export *`, so this is on the public
 * `@sugt/db/schema` surface rather than schema-internal. That is intended — the query
 * layer is its one consumer and is a separate subpath — but it does mean the fragment is
 * as public as the table it belongs to.
 */
export const ONLINE_SESSION_STILL_STANDS = sql`perjadin_id is null and status <> 'cancelled'`;

/**
 * Delivery: Sessions, and the free-text names of who taught them.
 *
 * A Session exists only once **arranged** — never before — so there are no planned
 * rows, no target dates and nothing is ever overdue. Progress is delivered Sessions
 * against `TOTAL_SESSIONS_PER_SCHOOL`, a constant in `@sugt/domain`.
 */
export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => school.id),
    // No `onDelete`: an offline Session BLOCKS deleting its Perjadin. A trip that
    // produced teaching cannot be quietly erased.
    perjadinId: uuid("perjadin_id").references(() => perjadin.id),
    // `session_mode_check` and `session_status_check` name exactly the values
    // `SESSION_MODES` and `SESSION_STATUSES` hold, so these narrowings are the database's
    // guarantee rather than this module's hope. `$type<>()` comes before `.default()` so
    // that the default is checked against the set too.
    mode: text("mode").$type<SessionMode>().notNull(),
    // **No Stream (#342, ADR-0038).** An online Session lost its Stream in #284 (ADR-0034), and an
    // offline Session lost its in #342: the material taught in a Session is not specific to the STEM
    // or the Research stream but a combination of both, so a Session has no Stream to record. Stream
    // survives as a Programme concept — on `group_member`, `assessment_completion` and `story` — just
    // not on a Session.
    heldOn: date("held_on").notNull(),
    // A wall-clock start time local to the School, in the School's Time Zone. NOT NULL
    // immediately — no Session exists in any live database, so there is nothing to
    // backfill, and a nullable column would take a null on the first row written and keep
    // it. `time` without a zone by design: the zone is the Province's, joined not stored.
    startsAt: time("starts_at").notNull(),
    // An online Session's end time (#283), a wall-clock `time` local to the School exactly like
    // `starts_at`. **Nullable, and required only for online at the app layer** — every Session that
    // existed before this column had none, and a strict NOT NULL (or a NOT-NULL-for-online CHECK)
    // would fail the migration against that populated data with no correct value to backfill. The
    // one DB rule is a value-range CHECK: an end after its start, or absent. "Required for online"
    // lives in the arrange form's submit guard and `arrangeOnlineSession`, the same layer the other
    // online-required fields are gated at.
    endsAt: time("ends_at"),
    status: text("status").$type<SessionStatus>().notNull().default("arranged"),
    cancelledReason: text("cancelled_reason"),
    // An online Session's two Pengajar, one per cohort — the Siswa professor and the GTK-MS professor,
    // one name each (#318, superseding ADR-0022's variable-length `session_teacher_name` list). Online
    // teaching is one or two named professors, not a room-full, and the two cohorts are fixed, so a
    // pair of columns says it straight where a side table said it loosely. **Nullable in the column
    // type** — an offline Session carries neither — with `session_online_pengajar_not_null` (below)
    // making both required for an online row. There is no online data to migrate (the ticket wipes
    // it), so that CHECK is clean rather than an `is null or …` backstop. Free-text names, never
    // `person` rows, exactly as the offline trip-scoped names are (ADR-0020).
    pengajarSiswaName: text("pengajar_siswa_name"),
    pengajarGtkMsName: text("pengajar_gtk_ms_name"),

    // **No PIC columns any more (#284).** An online Session used to carry its own
    // `online_pic_person_id`/`online_pic_role` because it had no Perjadin to take one from — but a
    // third-party LMS provider now runs online delivery (the Zoom host is in WIB), so SUGT no longer
    // tracks a PIC for online Sessions and they no longer produce a Session Record. Offline Sessions
    // still take their PIC from their Perjadin (`perjadin.pic_person_id`), never from a column here.
    // The Session's own folder under its Perjadin's `Foto & Video/` folder (ADR-0046), claimed by
    // compare-and-set the first time its footage is reconciled. Only an offline Session ever has one.
    driveFootageFolderId: text("drive_footage_folder_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("session_mode_check", sql`${t.mode} in ('offline', 'online')`),
    check("session_status_check", sql`${t.status} in ('arranged', 'delivered', 'cancelled')`),
    // The sharpest rule in the delivery half, and an equivalence in both directions:
    // an offline Session has a Perjadin and an online Session has none. It is also what ties an
    // offline Session to a PIC now the online PIC columns are gone (#284): the PIC of a Session is
    // its Perjadin's, and only an offline Session has a Perjadin.
    check(
      "session_offline_iff_perjadin",
      sql`(${t.mode} = 'offline') = (${t.perjadinId} is not null)`,
    ),
    check(
      "session_cancelled_iff_reason",
      sql`(${t.status} = 'cancelled') = (${t.cancelledReason} is not null)`,
    ),
    // Both Pengajar are required on an online row and left null on an offline one (#318). Written as an
    // implication — an online Session names both its professors — the clean direction, since the ticket
    // wipes the online data so nothing violates it and no offline row would carry either. `ends_at`
    // keeps its `is null or …` range backstop: an offline row leaves it null, so the CHECK must admit a
    // null.
    check(
      "session_online_pengajar_not_null",
      sql`${t.mode} <> 'online' or (${t.pengajarSiswaName} is not null and ${t.pengajarGtkMsName} is not null)`,
    ),
    check(
      "session_ends_after_starts_check",
      sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
    // The gap the online index below cannot close. It keys on `perjadin_id`, which is NULL for
    // every online Session, and Postgres treats NULLs in a unique index as distinct — so
    // nothing stopped two online Sessions for one School on one day. Jadwalkan Sesi
    // daring arranges them from Coverage in a batch, one date across a multi-selection,
    // which moves that from theoretical to one mis-click away.
    //
    // **Keyed on `(school_id, held_on)` only (#284, superseding ADR-0022):** online Sessions are no
    // longer single-Stream, so the rule is the plain one — **one online Session per School per day**,
    // whatever else. It dropped `stream` from the key when Stream was dropped from online delivery.
    //
    // Partial in both the ways it always was, and for the same two reasons:
    // cancelled rows accumulate and must not collide with the Session that replaced
    // them, and offline Sessions are untouched because their `perjadin_id` is not null.
    uniqueIndex("session_one_online_per_school_per_day")
      .on(t.schoolId, t.heldOn)
      .where(ONLINE_SESSION_STILL_STANDS),
    // **One live offline Session per School per moment, across every Perjadin (#408, ADR-0043;
    // #342, ADR-0038).** A School's participants are still too many for one room, so a period still
    // splits into parallel rooms — but those rooms are recorded as **one** Session whose Teaching
    // Team lists everyone who taught. Two Sessions at one School, date and start time would differ by
    // nothing the row records, so the index keys on exactly those and forbids the pair — **whichever
    // trips carry them**. One Sub-Cluster may be covered by several Perjadins and the same School may
    // sit on several (ADR-0043), so a second Session at that School and moment on another trip is a
    // double-booking just as it would be on one trip. It replaced
    // `session_no_duplicate_offline_per_school_per_perjadin`, whose key led with `perjadin_id` and so
    // let two trips book one School at one moment unnoticed; this key is strictly wider. A School
    // may still hold many Sessions at *different* moments; the per-trip count is an app-level cap
    // (`MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN`), not a DB rule, and only an exact match on
    // date and start time collides — overlapping start times do not.
    //
    // "Two DIFFERENT Schools cannot share a date and time" stays the application's, **per trip** —
    // the Group cannot be in two places at once, but two Groups can — and is listed in
    // `data-model.md`'s "what the database does not hold". The writes check this index's rule first
    // (`slotHolder`), so a double-booking comes back as a sentence naming the other trip.
    //
    // Partial in two ways: cancelled rows accumulate and must not collide with their replacements —
    // a cancelled Session never blocks its slot — and `perjadin_id is not null` keeps online
    // Sessions out, as the `perjadin_id` column in the old key did (an online row's is null).
    uniqueIndex("session_no_duplicate_offline_per_school")
      .on(t.schoolId, t.heldOn, t.startsAt)
      .where(sql`status <> 'cancelled' and perjadin_id is not null`),
    // The two partial-unique indexes above both carry a `WHERE` predicate, so the planner cannot use
    // either for a general equality lookup — a `perjadin_id =` or `school_id =` filter that must also
    // see cancelled rows falls through to a seq scan. These two plain indexes serve those paths:
    // `perjadin_id` for a trip's offline Sessions (`perjadin-detail.ts`), `school_id` for a School's
    // Sessions (`school-detail.ts`, `monitoring.ts`). Neither column is otherwise served — the
    // primary key leads with `id` (#270).
    index("session_perjadin_id_idx").on(t.perjadinId),
    index("session_school_id_idx").on(t.schoolId),
  ],
);

/**
 * **`session_teacher` was dropped in T3** ([#153](https://github.com/mafiefa02/sugt/issues/153)), and
 * **`session_teacher_name` in turn was dropped in #318.** `session_teacher` recorded who taught which
 * Stream as one-per-Stream `person` rows; offline teaching went name-based first (ADR-0019, ADR-0020)
 * and ADR-0022 did the same online, replacing `session_teacher` on the online side with
 * `session_teacher_name` — a variable-length list of session-scoped free-text names. #318 (ADR-0036)
 * then collapsed that list to **two cohort-named columns on `session` itself** —
 * `pengajar_siswa_name` and `pengajar_gtk_ms_name`, one each — because an online Session is taught by
 * exactly one Siswa and one GTK-MS professor, so the side table's row-per-name shape held nothing the
 * columns do not. Offline teaching still goes through `session_teaching_team` (below). See
 * `docs/data-model.md`'s Delivery section.
 */

/**
 * "Diajar oleh" — which of a Perjadin's trip-scoped teacher names taught one offline
 * Session, in parallel (ADR-0019, ADR-0020). A set, not one-per-Stream: a Session carries no
 * Stream (ADR-0038), and several `perjadin_teacher` names may have staffed its parallel rooms —
 * which are one Session now — so this is a plain many-to-many with no Stream and no Person.
 *
 * Both sides cascade on delete — a link is meaningless once either the Session or the
 * teacher name is gone. It is the offline analogue of an online Session's Pengajar, which since #318
 * are the two cohort-named columns above rather than a side table; nothing here touches a `person`
 * row, which is the whole point of the name-based model.
 */
export const sessionTeachingTeam = pgTable(
  "session_teaching_team",
  {
    sessionId: uuid("session_id").notNull(),
    perjadinTeacherId: uuid("perjadin_teacher_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.perjadinTeacherId] }),
    // Explicit FK names, like every other foreign key in the schema: the drizzle default here —
    // `session_teaching_team_perjadin_teacher_id_perjadin_teacher_id_fk` — is 63 characters and
    // Postgres truncates it to 62, so the name in the database would not match the one the snapshot
    // holds. Short, intentional names sidestep that and read better.
    foreignKey({
      name: "session_teaching_team_session_fk",
      columns: [t.sessionId],
      foreignColumns: [session.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "session_teaching_team_teacher_fk",
      columns: [t.perjadinTeacherId],
      foreignColumns: [perjadinTeacher.id],
    }).onDelete("cascade"),
  ],
);

/**
 * The **Pimpinan** who attended one offline Session — record-only (ADR-0020, ADR-0056). A leader of
 * DITSAMA ITB who joins part of a trip to monitor it is noted on the Sessions they were at, the
 * same way "Diajar oleh" notes who taught each one; they are **not a working Group member**, file
 * no Perjadin Evaluation and add nothing to the Preparation Checklist, so they are deliberately not
 * a `group_member` row.
 *
 * This replaced the trip-level `perjadin_pimpinan` (#492): a trip covering several Schools and days
 * often has a Pimpinan at only some of them. **A trip's Pimpinan are derived**, never stored —
 * everyone recorded on at least one of its non-cancelled Sessions (`./queries/trip-pimpinan.ts`) —
 * so the trip's list cannot disagree with its Sessions'. A cancelled Session keeps its rows; it
 * just stops contributing to that list.
 *
 * A row references a **real Person of role Pimpinan**: `role` is pinned to `'Pimpinan'` and the
 * composite `(person_id, role)` foreign key into `person (id, role)` refuses anyone else, the
 * guarantee `perjadin_pimpinan_is_pimpinan` held before (#181). It cascades with its Session, like
 * `session_teaching_team`; the primary key records a Pimpinan at most once per Session.
 */
export const sessionPimpinan = pgTable(
  "session_pimpinan",
  {
    sessionId: uuid("session_id").notNull(),
    personId: uuid("person_id").notNull(),
    role: text("role").$type<"Pimpinan">().notNull().default("Pimpinan"),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.personId] }),
    check("session_pimpinan_role_check", sql`${t.role} = 'Pimpinan'`),
    foreignKey({
      name: "session_pimpinan_session_fk",
      columns: [t.sessionId],
      foreignColumns: [session.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "session_pimpinan_is_pimpinan",
      columns: [t.personId, t.role],
      foreignColumns: [person.id, person.role],
    }),
  ],
);

/**
 * **Session Footage** (#424, ADR-0046): the photos and videos documenting one offline Session, shown
 * as "Foto & Video". Each row is one file in the company Google Drive under `Foto & Video/`, uploaded
 * untouched and shared on its own; it is uploaded or deleted, never edited.
 *
 * `id` is generated before the insert, because the file's name carries it (`M-{footage8}`). The kind
 * follows from the type the server sniffed, and the size is Drive's: both CHECKs below hold what
 * the upload already checked, so no write path can store a 2 GB "photo".
 *
 * **Offline only, and not cancelled at upload time**, are the application's rules
 * (`recordSessionFootage`); footage of a Session cancelled later stays. The foreign key to `session`
 * has no cascade: offline Sessions are only ever cancelled, never deleted, and a delete that would
 * orphan Drive files is refused rather than followed.
 *
 * The uploader is Staff by the composite `(id, role)` key, as a Perjadin's PIC is.
 * `drive_synced_at` and `drive_sync_failed_at` mean what they mean on `perjadin_document`.
 */
export const sessionFootage = pgTable(
  "session_footage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => session.id),
    kind: text("kind").$type<SessionFootageKind>().notNull(),
    contentType: text("content_type").$type<SessionFootageContentType>().notNull(),
    // As the browser named it, for the list; the Drive name is the app's own.
    originalFilename: text("original_filename").notNull(),
    // Up to 1000 MiB fits an integer; a bigint leaves headroom should the cap ever grow.
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    driveFileId: text("drive_file_id").notNull().unique(),
    uploadedByPersonId: uuid("uploaded_by_person_id").notNull(),
    uploadedByRole: text("uploaded_by_role").notNull().default("Staff"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    driveSyncedAt: timestamp("drive_synced_at", { withTimezone: true }),
    driveSyncFailedAt: timestamp("drive_sync_failed_at", { withTimezone: true }),
  },
  (t) => [
    check("session_footage_kind_check", sql`${t.kind} in ('foto', 'video')`),
    check(
      "session_footage_content_type_check",
      sql`(${t.kind} = 'foto' and ${t.contentType} in ('image/jpeg', 'image/png', 'image/heic', 'image/webp')) or (${t.kind} = 'video' and ${t.contentType} in ('video/mp4', 'video/quicktime'))`,
    ),
    // `MAX_FOOTAGE_PHOTO_BYTES` and `MAX_FOOTAGE_VIDEO_BYTES`, as literals.
    check(
      "session_footage_byte_size_check",
      sql`${t.byteSize} > 0 and ${t.byteSize} <= case ${t.kind} when 'foto' then 52428800 else 1048576000 end`,
    ),
    check("session_footage_original_filename_check", sql`length(${t.originalFilename}) > 0`),
    check("session_footage_uploaded_by_role_check", sql`${t.uploadedByRole} = 'Staff'`),
    foreignKey({
      name: "session_footage_uploaded_by_is_staff",
      columns: [t.uploadedByPersonId, t.uploadedByRole],
      foreignColumns: [person.id, person.role],
    }),
    // A Session's footage is listed by Session; Postgres does not index the FK on its own (#270).
    index("session_footage_session_id_idx").on(t.sessionId),
  ],
);
