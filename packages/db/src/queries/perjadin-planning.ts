import {
  MAX_EXTRA_STAFF_PER_GROUP,
  MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN,
  MAX_TEACHING_TEAM_PER_PERJADIN,
  type Stream,
  type TimeZone,
  type TransportMode,
} from "@sugt/domain";
import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { session, sessionTeachingTeam } from "../schema/delivery";
import { cluster, province, school, subCluster } from "../schema/reference";
import { groupMember, perjadin, perjadinPimpinan, perjadinTeacher } from "../schema/travel";
import type { Person } from "./caller";
import { duplicatedStaff } from "./group-rules";
import {
  activeRosters,
  unknownPimpinanIds,
  type RosterPerson,
  type SelectedSchool,
} from "./rosters";
import { heldOnWithinPerjadin } from "./session-detail";
import { requireStaff } from "./staff-only";

/**
 * **Rencanakan Perjadin** — the form that plans a trip, and the write that brings the
 * Perjadin, its Group, its Teaching Team names, its Pimpinan and its Sessions into existence
 * together.
 *
 * Staff-only, by the surface list and by ADR-0004 alike: this one writes the Advance, so
 * both of `./staff-only.ts`'s two reasons apply rather than only the second.
 *
 * **Planning starts from a Sub-Cluster**, not from a Coverage selection
 * ([#69](https://github.com/mafiefa02/sugt/issues/69)). The screen picks a Sub-Cluster and
 * reveals its Schools — all eligible — and lets each kept School hold **several** Sessions, each
 * with its own date, time and Stream (ADR-0019). The Sub-Cluster says which Schools may appear on
 * the trip at all; the plan says which are visited this time (`docs/product.md`, the Perjadin
 * section).
 */

/**
 * One offline Session on the trip: the School, the day and time it runs, the Stream it teaches,
 * and which of the trip's Teaching Team names staffed it.
 *
 * A School gets **many** of these now (ADR-0019) — the form repeats a Session per School, each on
 * its own date and time, each single-Stream — so a School appears once per Session it holds rather
 * than once overall. A School is "kept" on the trip exactly when it has at least one Session.
 */
export type PlannedSession = {
  schoolId: string;
  /** `YYYY-MM-DD`, and inside the trip's window — see the `session-outside-perjadin` refusal. */
  heldOn: string;
  /**
   * Local wall-clock start time (`HH:MM`), in the School's Time Zone. `session.starts_at` is NOT
   * NULL, so a value is always written. Two **different** Schools may share a date, but not a date
   * **and** a time — see the `session-time-clash` refusal; two Sessions at the *same* School and
   * moment are allowed (ADR-0019).
   */
  startsAt: string;
  /**
   * The Session's Stream — STEM or Research (ADR-0019). Required: the schema forces every offline
   * Session to carry one (`session_offline_iff_stream`), and the form supplies it per Session.
   */
  stream: Stream;
  /**
   * "Diajar oleh" — indexes into this trip's `teacherNames`, naming which of the Perjadin's
   * trip-scoped teacher names staffed this Session's parallel rooms. Each index is written as a
   * `session_teaching_team` link to the matching `perjadin_teacher` row. May be empty: a Session's
   * teachers can be assigned later on `/perjadin/[id]` (T3).
   */
  taughtByTeacherIndexes: number[];
};

/**
 * A whole trip, submitted at once.
 *
 * **The whole payload arrives as one value and not as a series of additions**, which is what lets
 * the caps be checked at all: each is a count across sibling rows, no CHECK can see them, and
 * ADR-0005's amendment records that this is why they are validated where the trip is submitted
 * whole.
 *
 * The PIC is **not** in `extraStaffPersonIds`. They are Staff, they carry no Stream, and their
 * `group_member` row is written for them — leaving it to the caller would make the deferred
 * foreign key below a thing a form could forget. The Teaching Team are **not** Group members at
 * all now (ADR-0020): they are `teacherNames`, trip-scoped strings, and the Group is Staff-only.
 *
 * **`subClusterId` is the trip's, picked in the form.** Every School on the trip must belong
 * to it — the rule ADR-0016 explains cannot be a foreign key, checked below at the one place
 * it can be violated. `destination` is **not** here: it is derived server-side from the
 * Sub-Cluster and its Schools' Kabupaten/Kota at insert ([#105](https://github.com/mafiefa02/sugt/issues/105)),
 * so the form has no Tujuan box to drift from what it already shows.
 */
/**
 * One leg of the trip's travel, as the form submits it: a wall-clock date and time and a mode.
 * The zone is not here — `departure_zone` is fixed to WIB (the origin is Bandung) and
 * `return_zone` is derived from the last School visited, both server-side (#106).
 */
export type PlannedTravelLeg = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`, wall-clock in the leg's zone. */
  time: string;
  mode: TransportMode;
};

export type PlanPerjadinInput = {
  subClusterId: string;
  advanceIdr: number;
  /** A Staff member. `perjadin_pic_is_staff` refuses anyone else, at the database. */
  picPersonId: string;
  /**
   * The extra Staff on the Group, beyond the PIC — a coordinator, a treasurer, a documentarian.
   * Each must be a distinct Staff member, none equal to the PIC; they are written as ordinary
   * `group_member` rows (Staff, no Stream). Up to ten (`MAX_EXTRA_STAFF_PER_GROUP`), so the Group
   * is the PIC plus up to ten others (ADR-0020). Optional; empty when the PIC travels alone.
   */
  extraStaffPersonIds?: string[];
  /**
   * The Teaching Team as **trip-scoped names** (ADR-0020) — plain strings, not `person` rows, each
   * written as a `perjadin_teacher` row. Zero to twenty (`MAX_TEACHING_TEAM_PER_PERJADIN`); may be
   * empty, since a Group's minimum at planning is just the PIC and the team can be filled in later.
   * A Session's `taughtByTeacherIndexes` index into this list.
   */
  teacherNames: string[];
  /**
   * The **Pimpinan** recorded on the trip — the `personId`s of real People of role Pimpinan, chosen
   * from the Pimpinan roster (#181, ADR-0020). Each is written as a `perjadin_pimpinan` row;
   * record-only, never a `group_member`. Optional, zero or more; an id that is not an active
   * Pimpinan is refused (`unknown-pimpinan`).
   */
  pimpinan: string[];
  sessions: PlannedSession[];
  /**
   * Departure from Bandung. Its zone is always WIB. Its **date is the trip's `starts_on`**: the
   * range is no longer typed in but derived from the legs (ADR-0021), so this date is what the
   * `session-outside-perjadin` window opens on and what every reader renders as the trip's start.
   */
  departure: PlannedTravelLeg;
  /**
   * Return. Its zone is derived from the last School visited. Its **date is the trip's `ends_on`**
   * (ADR-0021) — the mirror of `departure.date` above — so `return.date < departure.date` is what
   * the `return-before-departure` refusal guards, same-day allowed.
   */
  return: PlannedTravelLeg;
};

/** Two Schools planned for the same date and the same time — physically impossible on one trip. */
export type SessionTimeClash = {
  heldOn: string;
  startsAt: string;
  schoolIds: string[];
};

/**
 * Why a trip was not planned.
 *
 * Every one is a **user state and comes back as a value**, by the rule settled on
 * [#12](https://github.com/mafiefa02/sugt/issues/12): each is reachable from a form
 * somebody filled in honestly, and each gets a field-level message rather than an error
 * page. `NotStaffError` is the opposite case and still throws, as does a PIC who is not
 * Staff — that one is not reachable from a screen that only offers Staff.
 */
export type PlanPerjadinResult =
  | { outcome: "planned"; perjadinId: string }
  /**
   * The return date lands before the departure date, so the derived `[starts_on … ends_on]` range
   * would be inverted (ADR-0021). Same-day is allowed. `perjadin_dates_check` holds `ends_on >=
   * starts_on` at the database too; this repeats it so the form can point at the return date.
   */
  | { outcome: "return-before-departure" }
  /**
   * An extra Staff member repeated, or the same as the PIC. A Group holds each person once by
   * `(perjadin_id, person_id)`, so this is refused up front rather than left to a PK violation
   * inside the transaction.
   */
  | { outcome: "duplicate-staff"; personIds: string[] }
  /** More than `MAX_EXTRA_STAFF_PER_GROUP` extra Staff — the Group is the PIC plus up to ten. */
  | { outcome: "too-many-extra-staff"; count: number; limit: number }
  /** More than `MAX_TEACHING_TEAM_PER_PERJADIN` trip-scoped teacher names. */
  | { outcome: "too-many-teachers"; count: number; limit: number }
  /**
   * A School with more than `MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN` Sessions on the trip —
   * a safety ceiling, never reached in practice. Names each offending School and its count.
   */
  | { outcome: "too-many-sessions-per-school"; offending: { schoolId: string; count: number }[] }
  /** A Pimpinan id that is not an active Person of role Pimpinan. Not reachable through the form. */
  | { outcome: "unknown-pimpinan"; offending: string[] }
  /**
   * A Session's "Diajar oleh" naming a teacher slot that does not exist — a `taughtByTeacherIndexes`
   * value outside `[0, teacherNames.length)`. Not reachable through the form, which reindexes the
   * Sessions when a name is removed; checked anyway so a hand-edited payload gets a refusal value
   * rather than a `perjadin_teacher_id` NOT NULL violation from inside the transaction — the same
   * disposition as `unknown-pimpinan` and `school-outside-sub-cluster`.
   */
  | { outcome: "unknown-teacher-index"; offending: { schoolId: string; indexes: number[] }[] }
  /** A trip with no Session on it teaches nobody, and would write nothing. */
  | { outcome: "no-schools" }
  /** A Session dated outside the trip it happens on. */
  | {
      outcome: "session-outside-perjadin";
      startsOn: string;
      endsOn: string;
      offending: PlannedSession[];
    }
  /**
   * A School on the trip that does not belong to the chosen Sub-Cluster. Not reachable through
   * the form, and checked anyway — ADR-0016's rule that a mutable grouping cannot be a foreign
   * key into immutable history, and planning is the one write that can violate it.
   */
  | { outcome: "school-outside-sub-cluster"; offending: string[] }
  /**
   * Two **different** Schools sharing a date **and** a time. The Group is in one place at a time,
   * so this is impossible. Since ADR-0019 there is **no database backstop** — the old
   * `session_one_school_at_a_time_per_perjadin` index forbade parallel Sessions at one School too
   * and had to go, so this rule is the application's alone (see `data-model.md`'s "what the
   * database does not hold"). Two Sessions at the *same* School and moment are allowed.
   */
  | { outcome: "session-time-clash"; clashes: SessionTimeClash[] };

/**
 * Plan a Perjadin: the trip, its Staff-only Group, its trip-scoped Teaching Team names, its
 * Pimpinan and its Sessions — with each Session's "Diajar oleh" links — in one transaction.
 *
 * **Creating the Perjadin is what arranges its Sessions**, per ADR-0006 — there are no
 * planned rows waiting to be filled in, so this form is the arranging and there is no
 * second step. The writes are one act and commit together.
 *
 * Everything the application has to check is checked **before** the transaction opens.
 * That is not an optimisation: each of these is a rule the database cannot hold, so
 * finding out inside the transaction would mean rolling back a trip somebody typed rather
 * than telling them which field is wrong.
 *
 * What is **not** checked here is checked at the database and left there. The PIC being
 * Staff is `perjadin_pic_is_staff`; a Session being offline and carrying its Perjadin is
 * `session_offline_iff_perjadin`; the PIC being on their own Group is
 * `perjadin_pic_is_a_group_member`, `DEFERRABLE INITIALLY DEFERRED` so that it is checked
 * at COMMIT — neither the Perjadin nor its membership row can go first, and this
 * transaction is the reason that constraint has the form it does.
 *
 * **No `session_teacher` rows are written**, and no `group_member` rows for the Teaching Team.
 * Offline teaching is name-based now (ADR-0019, ADR-0020): each Session records who taught it
 * through `session_teaching_team` links into `perjadin_teacher`, and the Group is Staff-only.
 */
export async function planPerjadin(
  caller: Person,
  input: PlanPerjadinInput,
): Promise<PlanPerjadinResult> {
  requireStaff(caller);

  // The range is the departure→return span now (ADR-0021), not two typed fields, so the guard is on
  // the leg dates: `return.date` before `departure.date` would derive an inverted range. Same-day is
  // allowed. `perjadin_dates_check` holds `ends_on >= starts_on` too; this is repeated here so the
  // form can point at the return date rather than showing the page a constraint violation produces.
  if (input.return.date < input.departure.date) return { outcome: "return-before-departure" };

  if (input.sessions.length === 0) return { outcome: "no-schools" };

  // The app-enforced caps the database deliberately does not hold (ADR-0019, ADR-0020): they are
  // counts across sibling rows, the same shape as the Group rules, so they are checked here where
  // the whole payload is in hand rather than left to a constraint that cannot see the set.
  const extraStaff = input.extraStaffPersonIds ?? [];
  if (extraStaff.length > MAX_EXTRA_STAFF_PER_GROUP) {
    return {
      outcome: "too-many-extra-staff",
      count: extraStaff.length,
      limit: MAX_EXTRA_STAFF_PER_GROUP,
    };
  }

  if (input.teacherNames.length > MAX_TEACHING_TEAM_PER_PERJADIN) {
    return {
      outcome: "too-many-teachers",
      count: input.teacherNames.length,
      limit: MAX_TEACHING_TEAM_PER_PERJADIN,
    };
  }

  // A Pimpinan is a real Person of role Pimpinan (#181); the composite `perjadin_pimpinan_is_pimpinan`
  // FK refuses any other at the database too, but the form only offers the roster, so a stray id is a
  // hand-edited payload — validated here against the active-Pimpinan roster and named rather than
  // surfaced as a raw constraint violation.
  const uniquePimpinan = [...new Set(input.pimpinan)];
  const unknownPimpinan = await unknownPimpinanIds(uniquePimpinan);
  if (unknownPimpinan.length > 0)
    return { outcome: "unknown-pimpinan", offending: unknownPimpinan };

  // Extra Staff must be distinct from each other and from the PIC — the Group primary key
  // `(perjadin_id, person_id)` holds each person once, so a repeat is a plan to question rather
  // than a row to write. Refused up front, not left to a PK violation inside the transaction.
  const duplicateStaff = duplicatedStaff(input.picPersonId, extraStaff);
  if (duplicateStaff.length > 0) return { outcome: "duplicate-staff", personIds: duplicateStaff };

  // A School's Session count is an app ceiling, not a DB rule (ADR-0019): the exact-duplicate index
  // is all the database holds, so the ten-per-School cap is checked here against the whole payload.
  const sessionCounts = new Map<string, number>();
  for (const planned of input.sessions) {
    sessionCounts.set(planned.schoolId, (sessionCounts.get(planned.schoolId) ?? 0) + 1);
  }
  const overCap = [...sessionCounts.entries()]
    .filter(([, count]) => count > MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN)
    .map(([schoolId, count]) => ({ schoolId, count }));
  if (overCap.length > 0) return { outcome: "too-many-sessions-per-school", offending: overCap };

  // "Diajar oleh" is a list of indexes into `teacherNames`. An index past the end of that list —
  // or negative, or non-integer — would map to no `perjadin_teacher` row and insert an undefined
  // `perjadin_teacher_id`, a NOT NULL violation surfacing from inside the transaction. The form
  // reindexes the Sessions when a name is removed, so it cannot produce one; a hand-edited payload
  // can, so it is refused up front like `unknown-pimpinan`, naming each School and its bad indexes.
  const unknownTeacherIndexes = input.sessions
    .map((planned) => ({
      schoolId: planned.schoolId,
      indexes: planned.taughtByTeacherIndexes.filter(
        (index) => !Number.isInteger(index) || index < 0 || index >= input.teacherNames.length,
      ),
    }))
    .filter((entry) => entry.indexes.length > 0);
  if (unknownTeacherIndexes.length > 0) {
    return { outcome: "unknown-teacher-index", offending: unknownTeacherIndexes };
  }

  // The second of the three places a Session's date is written, and the invariant
  // [#28](https://github.com/mafiefa02/sugt/issues/28) stated: an arranged offline Session
  // lies inside its Perjadin. No CHECK can carry it, because the range is on this row and
  // the date is on another table's. The window is the derived range — the departure and return
  // dates (ADR-0021) — not two typed fields.
  const window = { startsOn: input.departure.date, endsOn: input.return.date };
  const offending = input.sessions.filter(
    (planned) => !heldOnWithinPerjadin(planned.heldOn, window),
  );
  if (offending.length > 0) {
    return { outcome: "session-outside-perjadin", ...window, offending };
  }

  // A Perjadin goes to exactly one Sub-Cluster and every School it teaches at belongs to it
  // (CONTEXT.md, ADR-0016). This is the one write that can break that rule — there is no write
  // that adds a School to an existing trip — so it is refused for the whole payload here rather
  // than left to a foreign key that editability forbids. A School id that names no row, or one
  // whose Sub-Cluster is null, is "outside" too, since neither equals the chosen Sub-Cluster.
  const schoolIds = input.sessions.map((planned) => planned.schoolId);
  const memberships = await db
    .select({ id: school.id, subClusterId: school.subClusterId })
    .from(school)
    .where(inArray(school.id, schoolIds));
  const subClusterById = new Map(memberships.map((row) => [row.id, row.subClusterId]));
  const outside = [...new Set(schoolIds)].filter(
    (id) => subClusterById.get(id) !== input.subClusterId,
  );
  if (outside.length > 0) return { outcome: "school-outside-sub-cluster", offending: outside };

  // Two *different* Schools on the same date and the same time is the Group being in two places at
  // once. Since ADR-0019 no index refuses it — the old `session_one_school_at_a_time_per_perjadin`
  // was dropped so parallel Sessions at one School become possible — so this app check is the only
  // guard for the different-Schools rule. It groups planned Sessions by `(date, time)` and flags a
  // slot holding two or more **distinct** Schools. Two Sessions at the *same* School and moment are
  // now allowed (parallel Streams or split rooms), so same-School rows collapse to one entry and do
  // not clash; sharing a date alone stays legal too — that is what the per-School start time serves.
  const slots = new Map<string, { heldOn: string; startsAt: string; schoolIds: Set<string> }>();
  for (const planned of input.sessions) {
    const key = `${planned.heldOn} ${planned.startsAt}`;
    const slot = slots.get(key) ?? {
      heldOn: planned.heldOn,
      startsAt: planned.startsAt,
      schoolIds: new Set<string>(),
    };
    slot.schoolIds.add(planned.schoolId);
    slots.set(key, slot);
  }
  const clashes: SessionTimeClash[] = [...slots.values()]
    .filter((slot) => slot.schoolIds.size > 1)
    .map((slot) => ({
      heldOn: slot.heldOn,
      startsAt: slot.startsAt,
      schoolIds: [...slot.schoolIds],
    }));
  if (clashes.length > 0) return { outcome: "session-time-clash", clashes };

  // The destination is derived, not typed: the planner has already picked the Sub-Cluster and
  // seen its Schools, so a free-text box would only restate that and could drift from it (#105).
  // A **snapshot** into the write-once column, computed once here and never on read — Sub-Clusters
  // are editable (ADR-0016), so a live read would silently rewrite an already-issued Surat Tugas
  // when Schools are later regrouped or the Sub-Cluster is renamed.
  const destination = await derivePerjadinDestination(input.subClusterId);

  // The return zone is the last-visited School's — the Group returns from that city, so its
  // wall-clock time means that city's zone, not Bandung's. Snapshot at insert, like the
  // destination, for the same ADR-0016 reason. Departure is always WIB (the origin is Bandung).
  const returnZone = await deriveReturnZone(input.sessions);

  const perjadinId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(perjadin)
      .values({
        subClusterId: input.subClusterId,
        destination,
        // The range is stored-but-derived (ADR-0021): its source is the leg dates, not a typed
        // field. `perjadin_dates_check` still holds `ends_on >= starts_on`, guarded above.
        startsOn: input.departure.date,
        endsOn: input.return.date,
        advanceIdr: input.advanceIdr,
        picPersonId: input.picPersonId,
        departureAt: `${input.departure.date} ${input.departure.time}`,
        departureZone: "WIB",
        departureMode: input.departure.mode,
        returnAt: `${input.return.date} ${input.return.time}`,
        returnZone,
        returnMode: input.return.mode,
      })
      .returning({ id: perjadin.id });

    const id = created!.id;

    // The Group is **Staff and only Staff** now (ADR-0020): the PIC plus the extra Staff, none
    // carrying a Stream — `group_member_stream_iff_teaching` refuses one that does. The Teaching
    // Team have left this table entirely for `perjadin_teacher` below; the PIC's row is first so the
    // DEFERRABLE `perjadin_pic_is_a_group_member` is satisfied at COMMIT.
    await tx.insert(groupMember).values([
      { perjadinId: id, personId: input.picPersonId, role: "Staff" as const, stream: null },
      ...extraStaff.map((personId) => ({
        perjadinId: id,
        personId,
        role: "Staff" as const,
        stream: null,
      })),
    ]);

    // The Teaching Team as trip-scoped names (ADR-0020) — one `perjadin_teacher` row per name.
    // RETURNING keeps the inserted ids in the order the names were given, which is what a Session's
    // `taughtByTeacherIndexes` indexes into. Skipped entirely when the team is empty, since an
    // INSERT with no rows is not a statement Postgres accepts.
    const teacherIds =
      input.teacherNames.length > 0
        ? (
            await tx
              .insert(perjadinTeacher)
              .values(input.teacherNames.map((name) => ({ perjadinId: id, name })))
              .returning({ id: perjadinTeacher.id })
          ).map((row) => row.id)
        : [];

    // The Sessions, each carrying its Stream (ADR-0019). RETURNING keeps them in input order, so
    // `sessionIds[i]` is the row for `input.sessions[i]` — the join key the teaching-team links use.
    const sessionIds = (
      await tx
        .insert(session)
        .values(
          input.sessions.map((planned) => ({
            schoolId: planned.schoolId,
            perjadinId: id,
            mode: "offline" as const,
            stream: planned.stream,
            heldOn: planned.heldOn,
            startsAt: planned.startsAt,
          })),
        )
        .returning({ id: session.id })
    ).map((row) => row.id);

    // "Diajar oleh" — each Session's `taughtByTeacherIndexes` become `session_teaching_team` links
    // from the Session to the `perjadin_teacher` rows those indexes name. A Session with no teachers
    // yet contributes nothing; the whole insert is skipped when there are no links at all.
    const teachingLinks = input.sessions.flatMap((planned, i) =>
      planned.taughtByTeacherIndexes.map((teacherIndex) => ({
        sessionId: sessionIds[i]!,
        perjadinTeacherId: teacherIds[teacherIndex]!,
      })),
    );
    if (teachingLinks.length > 0) {
      await tx.insert(sessionTeachingTeam).values(teachingLinks);
    }

    // The Pimpinan recorded on the trip — record-only rows referencing a real Person, never
    // `group_member` (ADR-0020, #181). Deduped so `(perjadin_id, person_id)` cannot collide; skipped
    // when none join. `role` defaults to 'Pimpinan'.
    if (uniquePimpinan.length > 0) {
      await tx
        .insert(perjadinPimpinan)
        .values(uniquePimpinan.map((personId) => ({ perjadinId: id, personId })));
    }

    return id;
  });

  return { outcome: "planned", perjadinId };
}

/**
 * The destination line the Surat Tugas is written against: the Sub-Cluster's own label, then the
 * distinct Kabupaten/Kota its Schools sit in — e.g. `Kelompok 18: Samarinda, Bontang dan Balikpapan`.
 *
 * **The whole Sub-Cluster, not only the visited Schools:** the line names where the trip's
 * Kelompok is, which does not change because one School was dropped this time. Distinct
 * Kabupaten/Kota in School order (first appearance wins), so several Schools in one regency
 * collapse to one entry. The Sub-Cluster name is used verbatim — it already reads "Kelompok 18".
 */
async function derivePerjadinDestination(subClusterId: string): Promise<string> {
  const rows = await db
    .select({ name: subCluster.name, kabupatenKota: school.kabupatenKota })
    .from(subCluster)
    .innerJoin(school, eq(school.subClusterId, subCluster.id))
    .where(eq(subCluster.id, subClusterId))
    .orderBy(asc(school.name));

  const places: string[] = [];
  for (const row of rows) {
    if (!places.includes(row.kabupatenKota)) places.push(row.kabupatenKota);
  }
  return `${rows[0]?.name ?? ""}: ${joinWithDan(places)}`;
}

/**
 * Join a list the way an Indonesian sentence does: comma-separated, with `" dan "` before the
 * last and no serial comma. One item is itself; none is the empty string.
 * `["Samarinda", "Bontang", "Balikpapan"]` → `"Samarinda, Bontang dan Balikpapan"`.
 */
function joinWithDan(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} dan ${items[items.length - 1]}`;
}

/**
 * The Time Zone of the **last School visited** — the Session with the greatest `(held_on,
 * starts_at)`. The Group returns from that School's city, so `return_at`'s wall-clock time is
 * meaningful only in that Province's zone, which is why the return zone is not fixed to Bandung's.
 *
 * `sessions` is non-empty here (the `no-schools` refusal ran first) and each `schoolId` is real
 * and in the Sub-Cluster (the `school-outside-sub-cluster` refusal ran too), so the join returns a
 * row.
 */
async function deriveReturnZone(sessions: PlannedSession[]): Promise<TimeZone> {
  const last = [...sessions].sort((a, b) => {
    const byDate = b.heldOn.localeCompare(a.heldOn);
    return byDate !== 0 ? byDate : b.startsAt.localeCompare(a.startsAt);
  })[0]!;

  const [row] = await db
    .select({ timeZone: province.timeZone })
    .from(school)
    .innerJoin(province, eq(province.code, school.provinceCode))
    .where(eq(school.id, last.schoolId));
  return row!.timeZone;
}

/**
 * A School the form is planning a Session for, as one row of its Sub-Cluster shows it. The same
 * three fields a form row has always rendered, so it **aliases** `SelectedSchool` rather than
 * restating the shape — the reuse `arrange-online-session.ts`'s `SchoolOption` also makes, which
 * keeps the two from drifting.
 */
export type PlannableSchool = SelectedSchool;

/** One Sub-Cluster the form can plan a trip around, with the Schools it is eligible to visit. */
export type PlannableSubCluster = {
  id: string;
  name: string;
  /** The Cluster it sits in, so two Sub-Clusters with similar names are told apart in the picker. */
  clusterName: string;
  schools: PlannableSchool[];
};

/** Somebody the form's pickers can name. */
export type PlannablePerson = RosterPerson;

/** What Rencanakan Perjadin renders before anything is written. */
export type PerjadinPlan = {
  /** Every Sub-Cluster that has at least one School — an empty one cannot host a trip. */
  subClusters: PlannableSubCluster[];
  /**
   * Staff, for the PIC and the extra-Staff combobox. There is **no Teaching Team roster** here any
   * more (ADR-0020): a Perjadin's Teaching Team are trip-scoped names typed on the form, not People
   * chosen from a list, so the form needs no roster for them.
   */
  staff: PlannablePerson[];
  /**
   * Pimpinan, for the record-only Pimpinan checkbox list (#181). Real People of role Pimpinan chosen
   * from the roster now, not the retired fixed-three constant; empty until Pimpinan are added.
   */
  pimpinan: PlannablePerson[];
};

/**
 * The Sub-Clusters a trip can be planned around, each with its eligible Schools, in one round
 * trip. An inner join to `school`, so a Sub-Cluster with no Schools does not appear — it has
 * nothing to visit, and the form's first act is to reveal a Sub-Cluster's Schools.
 */
async function plannableSubClusters(): Promise<PlannableSubCluster[]> {
  const rows = await db
    .select({
      subClusterId: subCluster.id,
      subClusterName: subCluster.name,
      clusterName: cluster.name,
      schoolId: school.id,
      schoolName: school.name,
      kabupatenKota: school.kabupatenKota,
      timeZone: province.timeZone,
    })
    .from(subCluster)
    .innerJoin(cluster, eq(cluster.id, subCluster.clusterId))
    .innerJoin(school, eq(school.subClusterId, subCluster.id))
    .innerJoin(province, eq(province.code, school.provinceCode))
    .orderBy(asc(cluster.name), asc(subCluster.name), asc(school.name));

  const map = new Map<string, PlannableSubCluster>();
  for (const row of rows) {
    let entry = map.get(row.subClusterId);
    if (!entry) {
      entry = {
        id: row.subClusterId,
        name: row.subClusterName,
        clusterName: row.clusterName,
        schools: [],
      };
      map.set(row.subClusterId, entry);
    }
    entry.schools.push({
      id: row.schoolId,
      name: row.schoolName,
      kabupatenKota: row.kabupatenKota,
      timeZone: row.timeZone,
    });
  }
  return [...map.values()];
}

/**
 * The form's payload: the Sub-Clusters to plan around, and the Staff roster its PIC and extra-Staff
 * pickers name.
 *
 * **Staff-only, so the read is too** — a Teaching Team member reaching the URL directly would
 * otherwise be shown the whole form and refused only on submit. `Promise.all` keeps the
 * Sub-Cluster read and the roster read concurrent; the rosters come from `./rosters.ts`. Both the
 * `staff` and `pimpinan` halves are kept — Staff for the PIC/extra-Staff pickers, Pimpinan for the
 * record-only checkbox list (#181). The Teaching Team are trip-scoped names now, not a roster (ADR-0020).
 */
export async function perjadinPlan(caller: Person): Promise<PerjadinPlan> {
  requireStaff(caller);

  const [subClusters, { staff, pimpinan }] = await Promise.all([
    plannableSubClusters(),
    activeRosters(),
  ]);

  return { subClusters, staff, pimpinan };
}
