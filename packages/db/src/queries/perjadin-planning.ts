import {
  MAX_EXTRA_STAFF_PER_GROUP,
  MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN,
  MAX_TEACHING_TEAM_PER_PERJADIN,
} from "@sugt/domain";
import { asc, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { session, sessionTeachingTeam } from "../schema/delivery";
import { cluster, province, school, subCluster } from "../schema/reference";
import { groupMember, perjadin, perjadinPimpinan, perjadinTeacher } from "../schema/travel";
import type { Person } from "./caller";
import { type CoveredSession, offlineSessionsElsewhere } from "./covered-sessions";
import { duplicatedStaff } from "./group-rules";
import {
  activeRosters,
  unknownPimpinanIds,
  type RosterPerson,
  type SelectedSchool,
} from "./rosters";
import {
  bookedOnAnotherPerjadin,
  type SchoolBookedOnAnotherPerjadin,
  slotViolationRefusal,
} from "./school-slot";
import { heldOnWithinPerjadin } from "./session-detail";
import { requireGrant, requireStaff } from "./staff-only";

/**
 * **Rencanakan Perjadin** — the form that plans a trip, and the write that brings the
 * Perjadin, its Group, its Teaching Team names, its Pimpinan and its Sessions into existence
 * together.
 *
 * Staff-only, by the surface list: arranging delivery is one of `./staff-only.ts`'s two reasons. It
 * once wrote the Advance too, which made it the other; the Advance is no longer tracked (ADR-0051).
 * **And it needs the Editor Grant** (ADR-0047): planning a trip is a deliberate choice of who plans, not every Staff member's.
 *
 * **Planning starts from a Sub-Cluster**, not from a Coverage selection
 * ([#69](https://github.com/mafiefa02/sugt/issues/69)). The screen picks a Sub-Cluster and
 * reveals its Schools — all eligible — and lets each kept School hold **several** Sessions, each
 * with its own date and time (ADR-0019) and no Stream (ADR-0038). The Sub-Cluster says which
 * Schools may appear on the trip at all; the plan says which are visited this time
 * (`docs/product.md`, the Perjadin section).
 */

/**
 * One offline Session on the trip: the School, the day and time it runs, and which of the trip's
 * Teaching Team names staffed it. No Stream — a Session teaches both (ADR-0038).
 *
 * A School gets **many** of these now (ADR-0019) — the form repeats a Session per School, each on
 * its own date and time — so a School appears once per Session it holds rather than once overall.
 * A School is "kept" on the trip exactly when it has at least one Session.
 */
export type PlannedSession = {
  schoolId: string;
  /** `YYYY-MM-DD`, and inside the trip's window — see the `session-outside-perjadin` refusal. */
  heldOn: string;
  /**
   * Local wall-clock start time (`HH:MM`), in the School's Time Zone. `session.starts_at` is NOT
   * NULL, so a value is always written. Two **different** Schools may share a date, but not a date
   * **and** a time — see the `session-time-clash` refusal — and one School may not hold two
   * Sessions at the same moment either — see `duplicate-session` (ADR-0038).
   */
  startsAt: string;
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
 * it can be violated. There is no destination or name here: a Perjadin's name is
 * `{Sub-Cluster} · {dates}`, read live and never stored (ADR-0044), so the form has no Tujuan box to
 * drift from what it already shows.
 */
export type PlanPerjadinInput = {
  subClusterId: string;
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
   * **Tanggal mulai**, `YYYY-MM-DD` — typed, written straight to `starts_on` (ADR-0041). A Perjadin
   * carries no travel legs: many trips are PP, so one departure and one return describe nothing.
   * This is what the `session-outside-perjadin` window opens on.
   */
  startsOn: string;
  /**
   * **Tanggal selesai**, `YYYY-MM-DD`, written to `ends_on`. `endsOn < startsOn` is the
   * `ends-before-starts` refusal; the same day is allowed.
   */
  endsOn: string;
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
 * page. `NotStaffError` and `NotGrantedError` are the opposite case and still throw, as does a PIC who is not
 * Staff — that one is not reachable from a screen that only offers Staff.
 */
export type PlanPerjadinResult =
  | { outcome: "planned"; perjadinId: string }
  /**
   * Tanggal selesai before Tanggal mulai, so the `[starts_on … ends_on]` range would be inverted
   * (ADR-0041). Same-day is allowed. `perjadin_dates_check` holds `ends_on >= starts_on` at the
   * database too; this repeats it so the form can point at Tanggal selesai.
   */
  | { outcome: "ends-before-starts" }
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
   * so this is impossible. There is **no database backstop** — ADR-0019 dropped the trip-wide
   * `session_one_school_at_a_time_per_perjadin` index because it forbade parallel Sessions at one
   * School too, and ADR-0038's index is per School — so this rule is the application's alone (see
   * `data-model.md`'s "what the database does not hold"). Two Sessions at the *same* School and
   * moment are `duplicate-session`.
   */
  | { outcome: "session-time-clash"; clashes: SessionTimeClash[] }
  /**
   * One School planned twice at the same date **and** time (ADR-0038). Parallel rooms are one
   * Session now, whose Teaching Team lists everyone who taught, so a second row at the same moment is
   * a mistake. `session_no_duplicate_offline_per_school` refuses it at the database too; checked
   * here against the whole payload so the form gets a value naming each slot rather than a
   * unique-violation thrown from inside the transaction. The form catches it before submit as well.
   */
  | { outcome: "duplicate-session"; duplicates: DuplicateSessionSlot[] }
  /**
   * A planned Session's School already has a live offline Session at that date and time on another
   * Perjadin (#408, ADR-0043) — a double-booking `session_no_duplicate_offline_per_school` refuses
   * at the database. Checked first, Session by Session, so the refusal names the other trip; the
   * first one found is reported.
   */
  | SchoolBookedOnAnotherPerjadin;

/** A School planned more than once at one date and time — see the `duplicate-session` refusal. */
export type DuplicateSessionSlot = {
  schoolId: string;
  heldOn: string;
  startsAt: string;
};

/**
 * Plan a Perjadin: the trip, its Staff-only Group, its trip-scoped Teaching Team names, its
 * Pimpinan and its Sessions — with each Session's "Diajar oleh" links — in one transaction.
 *
 * **Creating the Perjadin is what arranges its Sessions**, per ADR-0006 — there are no
 * planned rows waiting to be filled in, so this form is the arranging and there is no
 * second step. The writes are one act and commit together.
 *
 * Everything the application has to check is checked **before** the transaction opens.
 * That is not an optimisation: all but one of these are rules the database cannot hold, so
 * finding out inside the transaction would mean rolling back a trip somebody typed rather
 * than telling them which field is wrong. The one it does hold — a School already booked at that
 * moment on another trip (#408) — is read first too, for the sentence naming that trip, and a race
 * past the read is caught on the index and named the same way.
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
  // Planning a Perjadin needs the Editor Grant (ADR-0047).
  // `requireStaff` stays first, so a Pimpinan is refused as non-Staff.
  requireGrant(caller, "Editor");

  // The range is two typed dates (ADR-0041). Same-day is allowed. `perjadin_dates_check` holds
  // `ends_on >= starts_on` too; this is repeated here so the form can point at Tanggal selesai
  // rather than showing the page a constraint violation produces.
  if (input.endsOn < input.startsOn) return { outcome: "ends-before-starts" };

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
  // the date is on another table's. The window is the typed range (ADR-0041).
  const window = { startsOn: input.startsOn, endsOn: input.endsOn };
  const offending = input.sessions.filter(
    (planned) => !heldOnWithinPerjadin(planned.heldOn, window),
  );
  if (offending.length > 0) {
    return { outcome: "session-outside-perjadin", ...window, offending };
  }

  // A Perjadin goes to exactly one Sub-Cluster and every School it teaches at belongs to it
  // (CONTEXT.md, ADR-0016). Planning is one of the two writes that can break that rule —
  // `addPerjadinSession`, which adds a School to an existing trip, checks it too — so it is refused
  // for the whole payload here rather than left to a foreign key that editability forbids. A School
  // id that names no row, or one whose Sub-Cluster is null, is "outside" too, since neither equals
  // the chosen Sub-Cluster.
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

  // Both moment rules read the same grouping — planned Sessions by `(date, time)`:
  //
  // - Two *different* Schools in one slot is the Group being in two places at once. No index refuses
  //   it — ADR-0019 dropped the trip-wide `session_one_school_at_a_time_per_perjadin`, and ADR-0038's
  //   index is per School — so this app check is the only guard for the different-Schools rule. Sharing a date alone stays legal;
  //   that is what the per-School start time serves.
  // - The *same* School twice in one slot is a duplicate (ADR-0038): parallel rooms are one Session
  //   now, and `session_no_duplicate_offline_per_school` would refuse the second row at the
  //   database. Caught here so it comes back as a value naming the slot, not a raw violation.
  const slots = new Map<
    string,
    { heldOn: string; startsAt: string; schoolIds: Set<string>; repeated: Set<string> }
  >();
  for (const planned of input.sessions) {
    const key = `${planned.heldOn} ${planned.startsAt}`;
    const slot = slots.get(key) ?? {
      heldOn: planned.heldOn,
      startsAt: planned.startsAt,
      schoolIds: new Set<string>(),
      repeated: new Set<string>(),
    };
    if (slot.schoolIds.has(planned.schoolId)) slot.repeated.add(planned.schoolId);
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

  const duplicates: DuplicateSessionSlot[] = [...slots.values()].flatMap((slot) =>
    [...slot.repeated].map((schoolId) => ({
      schoolId,
      heldOn: slot.heldOn,
      startsAt: slot.startsAt,
    })),
  );
  if (duplicates.length > 0) return { outcome: "duplicate-session", duplicates };

  // The same School at the same moment on another trip (#408). Every live offline Session is on
  // another trip — this one does not exist yet — so any holder is a double-booking.
  const booked = await bookedOnAnotherPerjadin(db, input.sessions, { ownPerjadinId: null });
  if (booked) return booked;

  let perjadinId: string;
  try {
    perjadinId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(perjadin)
        .values({
          subClusterId: input.subClusterId,
          // Typed, written directly (ADR-0041). `perjadin_dates_check` still holds
          // `ends_on >= starts_on`, guarded above.
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          picPersonId: input.picPersonId,
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

      // The Sessions. RETURNING keeps them in input order, so
      // `sessionIds[i]` is the row for `input.sessions[i]` — the join key the teaching-team links use.
      const sessionIds = (
        await tx
          .insert(session)
          .values(
            input.sessions.map((planned) => ({
              schoolId: planned.schoolId,
              perjadinId: id,
              mode: "offline" as const,
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
  } catch (error) {
    // A race past the read above: another trip took a slot between the check and the insert. The
    // index refused it; read again who holds it, so the form still gets the sentence.
    const raced = await slotViolationRefusal(error, input.sessions, { ownPerjadinId: null });
    if (raced) return raced;
    throw error;
  }

  return { outcome: "planned", perjadinId };
}

/**
 * A School the form is planning a Session for, as one row of its Sub-Cluster shows it: the fields of
 * `SelectedSchool`, extended rather than restated — the reuse `arrange-online-session.ts`'s
 * `SchoolOption` also makes, so the shared fields cannot drift — plus what the School already has
 * on other trips (#409), which only this form shows.
 */
export type PlannableSchool = SelectedSchool & {
  /**
   * Its live offline Sessions on other Perjadins (#409) — every one, since the trip being planned
   * does not exist yet — for the note under its row. Read-only: nothing here changes what can be
   * submitted.
   */
  offlineSessionsElsewhere: CoveredSession[];
};

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

/** A Sub-Cluster and its Schools as stored, before `perjadinPlan` adds what each already has. */
type SubClusterOfSchools = Omit<PlannableSubCluster, "schools"> & { schools: SelectedSchool[] };

/**
 * The Sub-Clusters a trip can be planned around, each with its eligible Schools, in one round
 * trip. An inner join to `school`, so a Sub-Cluster with no Schools does not appear — it has
 * nothing to visit, and the form's first act is to reveal a Sub-Cluster's Schools.
 */
async function plannableSubClusters(): Promise<SubClusterOfSchools[]> {
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

  const map = new Map<string, SubClusterOfSchools>();
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
 * **Editor-only, so the read is too** (ADR-0047) — a caller without the Grant reaching the URL
 * directly would otherwise be shown the whole form and refused only on submit. `Promise.all` keeps the
 * Sub-Cluster read and the roster read concurrent; the rosters come from `./rosters.ts`. What each
 * School already has on other trips (#409) is a second round trip after them, since it is keyed on
 * the Schools the first one found. Both the
 * `staff` and `pimpinan` halves are kept — Staff for the PIC/extra-Staff pickers, Pimpinan for the
 * record-only checkbox list (#181). The Teaching Team are trip-scoped names now, not a roster (ADR-0020).
 */
export async function perjadinPlan(caller: Person): Promise<PerjadinPlan> {
  requireStaff(caller);
  // Planning a Perjadin needs the Editor Grant (ADR-0047).
  // `requireStaff` stays first, so a Pimpinan is refused as non-Staff.
  requireGrant(caller, "Editor");

  const [subClusters, { staff, pimpinan }] = await Promise.all([
    plannableSubClusters(),
    activeRosters(),
  ]);

  // What each School already has on other trips (#409), read once for every School the form can show.
  const covered = await offlineSessionsElsewhere(
    subClusters.flatMap((entry) => entry.schools.map((row) => row.id)),
  );
  return {
    subClusters: subClusters.map((entry) => ({
      ...entry,
      schools: entry.schools.map((row) => ({
        ...row,
        offlineSessionsElsewhere: covered.get(row.id) ?? [],
      })),
    })),
    staff,
    pimpinan,
  };
}
