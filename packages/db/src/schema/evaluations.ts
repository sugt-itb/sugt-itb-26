import type { ClassKind, PerjadinEvaluationRole } from "@sugt/domain";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { session } from "./delivery";
import { person } from "./people";
import { perjadin } from "./travel";

/**
 * The four evaluations. A Session is judged from three vantage points and a Perjadin
 * from a fourth, each with its own rubric, because each asks a question only that
 * filer can answer.
 *
 * They share a 1–10 scale, one threshold (`CONCERN_AT_OR_BELOW` = 7) and one rule —
 * **a Rating at or below the threshold cannot be filed without saying what went
 * wrong** — so all four feed one concerns list. Everything else differs.
 *
 * Ratings are COLUMNS beside the prose, not rows in a child table. That is what makes
 * the elaboration rule expressible at all: a CHECK sees only the row being written.
 * It also buys "every Aspect is Rated" for free, as NOT NULL.
 */

/** The one threshold the domain has. Mirrors `CONCERN_AT_OR_BELOW` in `@sugt/domain`. */
const CONCERN = 7;

/** Every Rating column is the same shape. */
const rating = (name: string) => smallint(name).notNull();

/**
 * One CHECK per Rating column rather than one conjunction per table. Both enforce the
 * same thing; per-column means the error names the Aspect that was out of range
 * instead of the table it was in.
 */
const ratingBounds = (table: string, cols: Record<string, AnyPgColumn>) =>
  Object.entries(cols).map(([name, col]) =>
    check(`${table}_${name}_check`, sql`${col} between 1 and 10`),
  );

/**
 * What a Teaching Team member says about **one Class they taught**. Six per Session
 * is the full set: two professors, one per Stream, each filing for all three Classes.
 *
 * **Stream needs no column** — it follows from the filer's Stream assignment on the
 * Group. Two Records for one Class from different professors is not duplication; it
 * is STEM and Research disagreeing about the same cohort, which is real information.
 *
 * The composite foreign key makes **only a Teaching Team member can file one** a fact
 * rather than a convention.
 *
 * **This table is now dead, and deliberately kept ([#153](https://github.com/mafiefa02/sugt/issues/153)).**
 * T3 retired the `Teaching Team` Person role (professors are trip-/session-scoped names who never
 * sign in — ADR-0020, ADR-0022), so `person_role_check` admits only `'Staff'` and the
 * `class_record_filed_by_teaching_team` foreign key below is **unsatisfiable**: no row can be
 * inserted. The table and its constraints stay frozen rather than dropped or relaxed — how teaching
 * delivered by non-signed-in teachers is evaluated is the deferred open question (`CONTEXT.md`), and
 * relaxing this to a new filer would be that redesign, not this teardown. See `docs/data-model.md`.
 */
export const classRecord = pgTable(
  "class_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    // `class_record_class_kind_check` names exactly the values `CLASS_KINDS` holds, as
    // does its twin on `participant_feedback` below.
    classKind: text("class_kind").$type<ClassKind>().notNull(),
    filedByPersonId: uuid("filed_by_person_id").notNull(),
    filedByRole: text("filed_by_role").$type<"Teaching Team">().notNull().default("Teaching Team"),

    comprehension: rating("comprehension"),
    participation: rating("participation"),
    readiness: rating("readiness"),
    materials: rating("materials"),
    delivery: rating("delivery"),
    facilities: rating("facilities"),
    timing: rating("timing"),

    covered: text("covered"),
    problems: text("problems"),
    suggestions: text("suggestions"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("class_record_one_per_filer").on(t.sessionId, t.classKind, t.filedByPersonId),
    check("class_record_class_kind_check", sql`${t.classKind} in ('GTK', 'MS', 'Student')`),
    check("class_record_filed_by_role_check", sql`${t.filedByRole} = 'Teaching Team'`),
    ...ratingBounds("class_record", {
      comprehension: t.comprehension,
      participation: t.participation,
      readiness: t.readiness,
      materials: t.materials,
      delivery: t.delivery,
      facilities: t.facilities,
      timing: t.timing,
    }),
    check(
      "class_record_low_rating_needs_prose",
      sql`least(${t.comprehension}, ${t.participation}, ${t.readiness}, ${t.materials},
                ${t.delivery}, ${t.facilities}, ${t.timing}) > ${sql.raw(String(CONCERN))}
          or btrim(coalesce(${t.problems}, '')) <> ''`,
    ),
    foreignKey({
      name: "class_record_filed_by_teaching_team",
      columns: [t.filedByPersonId, t.filedByRole],
      foreignColumns: [person.id, person.role],
    }),
    index("class_record_concerns_idx")
      .on(
        sql`least(comprehension, participation, readiness, materials, delivery, facilities, timing)`,
      )
      .where(
        sql`least(comprehension, participation, readiness, materials, delivery, facilities, timing) <= ${sql.raw(String(CONCERN))}`,
      ),
  ],
);

/**
 * What the PIC says about **the visit as a whole**. They organised it and taught none
 * of it, so they are asked only what an organiser can see.
 *
 * Mirror of the Class Record's composite key: **only Staff can file one.**
 * `coordination` is the PIC rating their own planning, which people do generously —
 * kept because a low one is then very informative and nobody else could judge it.
 */
export const sessionRecord = pgTable(
  "session_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    filedByPersonId: uuid("filed_by_person_id").notNull(),
    filedByRole: text("filed_by_role").$type<"Staff">().notNull().default("Staff"),

    facilities: rating("facilities"),
    turnout: rating("turnout"),
    schoolSupport: rating("school_support"),
    timing: rating("timing"),
    coordination: rating("coordination"),

    problems: text("problems"),
    suggestions: text("suggestions"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("session_record_one_per_filer").on(t.sessionId, t.filedByPersonId),
    check("session_record_filed_by_role_check", sql`${t.filedByRole} = 'Staff'`),
    ...ratingBounds("session_record", {
      facilities: t.facilities,
      turnout: t.turnout,
      school_support: t.schoolSupport,
      timing: t.timing,
      coordination: t.coordination,
    }),
    check(
      "session_record_low_rating_needs_prose",
      sql`least(${t.facilities}, ${t.turnout}, ${t.schoolSupport}, ${t.timing}, ${t.coordination})
            > ${sql.raw(String(CONCERN))}
          or btrim(coalesce(${t.problems}, '')) <> ''`,
    ),
    foreignKey({
      name: "session_record_filed_by_staff",
      columns: [t.filedByPersonId, t.filedByRole],
      foreignColumns: [person.id, person.role],
    }),
    index("session_record_concerns_idx")
      .on(sql`least(facilities, turnout, school_support, timing, coordination)`)
      .where(
        sql`least(facilities, turnout, school_support, timing, coordination) <= ${sql.raw(String(CONCERN))}`,
      ),
  ],
);

/**
 * One token per Session, shared — a link or QR code shown at the end of it. The
 * primary key is `session_id`, so issuing a new one replaces the old.
 *
 * `expiresAt` defaults 24 hours out and is stored rather than derived: the token is
 * issued at the end of the Session by construction, so "24 hours after the Session
 * ended" needs no Session end time to exist.
 */
export const sessionFeedbackToken = pgTable(
  "session_feedback_token",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => session.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
    issuedByPersonId: uuid("issued_by_person_id")
      .notNull()
      .references(() => person.id),
  },
  (t) => [check("session_feedback_token_expiry_check", sql`${t.expiresAt} > ${t.issuedAt}`)],
);

/**
 * What a Participant says about the Class they sat in. Its own table, deliberately:
 * ADR-0001 rests on an internal record being written for colleagues, and putting a
 * student's submission beside it would mean a professor can no longer be sure who
 * else is in the table.
 *
 * **Three Aspects, none of which ask a Participant to rate themselves.**
 * Comprehension, Participation and Readiness are on the Class Record precisely
 * because they are judgements about the room. `materials` and `instructor` overlap
 * with the Class Record on purpose — that overlap is what lets the professor's view
 * be set against the room's.
 *
 * **No elaboration rule applies here.** A Participant owes nothing and is not signed
 * in; refusing their 3 because they did not justify it would simply lose the 3.
 *
 * `name` is typed by the Participant and referenced by nothing. No `person_id`, no
 * enrolment, no attendee list.
 */
export const participantFeedback = pgTable(
  "participant_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    classKind: text("class_kind").$type<ClassKind>().notNull(),
    name: text("name").notNull(),

    materials: rating("materials"),
    instructor: rating("instructor"),
    relevance: rating("relevance"),

    // One optional comment per Aspect, so a comment belongs to the Rating it explains and the
    // concerns list can show the prose for the Aspect that was actually Rated low — a single
    // shared comment could not say which of the three it was about (#102). All three stay
    // nullable: a Participant owes no elaboration, the CHECK forcing prose lives on
    // `class_record`/`session_record` only, never here.
    materialsComment: text("materials_comment"),
    instructorComment: text("instructor_comment"),
    relevanceComment: text("relevance_comment"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("participant_feedback_class_kind_check", sql`${t.classKind} in ('GTK', 'MS', 'Student')`),
    ...ratingBounds("participant_feedback", {
      materials: t.materials,
      instructor: t.instructor,
      relevance: t.relevance,
    }),
    index("participant_feedback_concerns_idx")
      .on(sql`least(materials, instructor, relevance)`)
      .where(sql`least(materials, instructor, relevance) <= ${sql.raw(String(CONCERN))}`),
  ],
);

/**
 * How the trip went, as against how the teaching went. Same shape as a Class Record
 * on purpose — two evaluation forms that behaved differently would be two things to
 * learn. There is no `covered`: nothing was taught on a journey.
 *
 * **Filed without signing in, through a short-lived token link (ADR-0024).** The filer
 * is not a `person` any more — the old `filed_by_person_id` foreign key and the
 * `perjadin_evaluation_one_per_filer` unique are both gone. The people best placed to
 * say how a trip went include the name-based Pengajar and the record-only Pimpinan,
 * neither of whom has a login, so identity is now **self-declared and untrusted**,
 * exactly as `participant_feedback.name` is: `filed_by_role` is one of three values a
 * CHECK admits, and `filed_by_name` is typed by the filer and referenced by nothing.
 * A duplicate is allowed — there is no dedup, the accepted cost ADR-0012 already pays
 * for the token pattern.
 */
export const perjadinEvaluation = pgTable(
  "perjadin_evaluation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    perjadinId: uuid("perjadin_id")
      .notNull()
      .references(() => perjadin.id, { onDelete: "cascade" }),
    // The self-declared filer. `filed_by_role` CHECKs `PERJADIN_EVALUATION_ROLES` character for
    // character below (the same list the form's selector and the query are driven off), and
    // `filed_by_name` is the name they type — neither is a foreign key, because a Pengajar or a
    // Pimpinan has no `person` row to point at. This is the ADR-0012 identity model applied here.
    filedByRole: text("filed_by_role").$type<PerjadinEvaluationRole>().notNull(),
    filedByName: text("filed_by_name").notNull(),

    // **The one nullable Rating in the system.** Not every Perjadin involves a night away —
    // a School close enough for a day trip has no hotel to rate — so `lodging` is not the
    // `rating()` helper's NOT NULL. It keeps its `between 1 and 10` bound below; `NULL between
    // 1 and 10` is NULL, which a CHECK accepts. Postgres `least()` ignores NULLs, so the
    // elaboration CHECK and the concerns index both still behave: a skipped `lodging` drops
    // out of the minimum rather than forcing prose or reaching the concerns list.
    lodging: smallint("lodging"),
    transport: rating("transport"),
    meals: rating("meals"),
    punctuality: rating("punctuality"),

    // One optional comment per Aspect, so a comment belongs to the Rating it explains and the
    // concerns list can show the prose for the Aspect actually Rated low — the shared `problems`
    // / `suggestions` pair could not say which of the four it was about (#163, ADR-0023). This is
    // the #102 reversal applied here, with one difference: the elaboration CHECK below now *forces*
    // an Aspect's own comment when that Aspect is low, so these are nullable in the column but
    // conditionally-required per Aspect — a discipline `participant_feedback` never owed. The
    // trip-wide `suggestions` / Saran box is retired outright: forward-looking advice with no
    // per-Aspect home now lives inside the relevant Aspect's Komentar, or nowhere.
    lodgingComment: text("lodging_comment"),
    transportComment: text("transport_comment"),
    mealsComment: text("meals_comment"),
    punctualityComment: text("punctuality_comment"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Written out character for character, like every other value-list CHECK in this schema
    // (`transaction_category_check`, `perjadin_pimpinan_name_check`), so the constraint reads the
    // stored values rather than composing them from the domain array — the values `PERJADIN_EVALUATION_ROLES` holds.
    check(
      "perjadin_evaluation_filed_by_role_check",
      sql`${t.filedByRole} in ('Pengajar', 'Pendamping', 'Pimpinan')`,
    ),
    ...ratingBounds("perjadin_evaluation", {
      lodging: t.lodging,
      transport: t.transport,
      meals: t.meals,
      punctuality: t.punctuality,
    }),
    // Per-Aspect elaboration, not trip-wide. Each Aspect is either not-low or carries its OWN
    // Komentar, and all four must hold — so a low `transport` cannot be excused by prose written
    // about the hotel (#163). `lodging` is guarded by `IS NULL` first, the same way `least()`
    // drops a skipped hotel out of the minimum: a day trip owes no lodging comment.
    check(
      "perjadin_evaluation_low_rating_needs_prose",
      sql`(${t.lodging} is null or ${t.lodging} > ${sql.raw(String(CONCERN))}
             or btrim(coalesce(${t.lodgingComment}, '')) <> '')
          and (${t.transport} > ${sql.raw(String(CONCERN))}
             or btrim(coalesce(${t.transportComment}, '')) <> '')
          and (${t.meals} > ${sql.raw(String(CONCERN))}
             or btrim(coalesce(${t.mealsComment}, '')) <> '')
          and (${t.punctuality} > ${sql.raw(String(CONCERN))}
             or btrim(coalesce(${t.punctualityComment}, '')) <> '')`,
    ),
    index("perjadin_evaluation_concerns_idx")
      .on(sql`least(lodging, transport, meals, punctuality)`)
      .where(sql`least(lodging, transport, meals, punctuality) <= ${sql.raw(String(CONCERN))}`),
  ],
);

/**
 * One token per Perjadin, shared — the link (a QR or copyable URL) handed out from the trip's page
 * so its Evaluation can be filed without signing in (ADR-0024). A direct mirror of
 * `sessionFeedbackToken`, keyed on `perjadin_id` so **issuing a new one replaces the old** and
 * every link already shared resolves to nothing.
 *
 * `expiresAt` defaults 14 days out — the `PERJADIN_FEEDBACK_TOKEN_LIFETIME_HOURS` window — and is
 * stored rather than derived, as the Session token's is: the link is shared after the trip and the
 * filers (Pengajar, Pendamping, Pimpinan) file when they get to it, so it outlives the trip's dates
 * by design. There is no cancelled-trip bar the Session token needs: a Perjadin is a real trip once
 * it exists and is never cancelled, so a token always has a live trip behind it.
 */
export const perjadinFeedbackToken = pgTable(
  "perjadin_feedback_token",
  {
    perjadinId: uuid("perjadin_id")
      .primaryKey()
      .references(() => perjadin.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '14 days'`),
    issuedByPersonId: uuid("issued_by_person_id")
      .notNull()
      .references(() => person.id),
  },
  (t) => [check("perjadin_feedback_token_expiry_check", sql`${t.expiresAt} > ${t.issuedAt}`)],
);
