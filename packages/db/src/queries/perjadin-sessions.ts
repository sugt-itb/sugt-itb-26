import { MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN } from "@sugt/domain";
import { and, eq, inArray, ne } from "drizzle-orm";

import { db } from "../client";
import { session, sessionTeachingTeam } from "../schema/delivery";
import { school } from "../schema/reference";
import { perjadin, perjadinTeacher } from "../schema/travel";
import type { Person } from "./caller";
import { snapshotTripSchools } from "./perjadin-naming";
import {
  bookedOnAnotherPerjadin,
  type SchoolBookedOnAnotherPerjadin,
  slotViolationRefusal,
} from "./school-slot";
import { heldOnWithinPerjadin, type PastArranged } from "./session-detail";
import { requirePerjadinWriter, requireSessionWriter, requireStaff } from "./staff-only";

/**
 * **Editing a Perjadin's offline Sessions, per Session.** Rencanakan Perjadin brought a trip's whole
 * set of Sessions into existence at once (`./perjadin-planning.ts`); these two writes add one more
 * and edit one that exists, on `/perjadin/[id]`, so the schedule can be corrected after the trip is
 * planned. Removing a Session is `cancelSession` in `./session-detail.ts`, reused unchanged.
 *
 * Both are **Staff-only**, by the surface list, and the trip's Group's, a Perjadin Editor's or an
 * Administrator's (`requirePerjadinWriter`, ADR-0048). Every rule the plan form checks against the whole
 * payload — a Session inside the trip's window, at a School of its Sub-Cluster, no two *different*
 * Schools sharing a moment, the ten-per-School ceiling — is re-checked here against the trip's
 * **existing** Sessions plus the one being written, because that is now the whole set. The
 * different-Schools clash has no database backstop since ADR-0019 (the old
 * `session_one_school_at_a_time_per_perjadin` index was dropped so two Sessions at the *same* School
 * and moment became legal), so this application check is its only guard. ADR-0038 made that same-School
 * pair illegal again, but refuses it through its own per-School index rather than restoring the
 * trip-wide one: the *same* School twice at one moment on this trip is the database's to refuse,
 * reported as `duplicate-session`, and is not pre-checked here. On **another** trip it is checked
 * first (#408, `bookedOnAnotherPerjadin`), so the refusal can name that trip.
 *
 * "Diajar oleh" is the set of the trip's `perjadin_teacher` names who staffed the Session's parallel
 * rooms, written as `session_teaching_team` links. It is replaced whole on each write — a name the
 * payload comes back without is a name Staff removed from that Session.
 */

/** The fields a Session on the detail screen sets: its School, day, time and who taught it. */
export type PerjadinSessionInput = {
  /** A School of the trip's Sub-Cluster — the eligible set, the same rule planning enforces. */
  schoolId: string;
  /** `YYYY-MM-DD`, inside the trip's window. */
  heldOn: string;
  /** Local wall-clock start time (`HH:MM`), in the School's Time Zone. */
  startsAt: string;
  /** `perjadin_teacher` ids of this trip whose names taught the Session. May be empty. */
  taughtByTeacherIds: string[];
};

/** Two *different* Schools planned for the same date and time — physically impossible on one trip. */
export type SessionPlacementRefusal =
  /** A School that does not belong to the trip's Sub-Cluster. */
  | { outcome: "school-outside-sub-cluster"; schoolId: string }
  /** A date outside the trip it happens on — the invariant #28 states, held here as one of its writes. */
  | { outcome: "session-outside-perjadin"; startsOn: string; endsOn: string }
  /** More than `MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN` live Sessions at one School on the trip. */
  | { outcome: "too-many-sessions"; schoolId: string; count: number; limit: number }
  /** Two different Schools at one moment — the Group cannot be in two places at once. */
  | { outcome: "session-time-clash"; heldOn: string; startsAt: string; schoolIds: string[] }
  /** A "Diajar oleh" id that is not one of this trip's `perjadin_teacher` names. */
  | { outcome: "unknown-teacher"; teacherIds: string[] }
  /** The School already has a live offline Session at this date and time on another trip (#408). */
  | SchoolBookedOnAnotherPerjadin;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A trip's window and Sub-Cluster, read once and shared by every placement check below. */
type TripPlacement = { subClusterId: string; startsOn: string; endsOn: string };

/**
 * Whether a Session may sit where the input puts it, checked against the trip's other live Sessions.
 * Returns the first refusal or `null` when the placement is legal.
 *
 * `excludeSessionId` drops the Session being edited from "the trip's other Sessions", so moving one
 * onto its own slot is not a clash with itself and re-saving it does not trip the per-School cap.
 * A `time` comes back from Postgres as `HH:MM:SS`; the input is `HH:MM`, so both are compared on
 * their first five characters for the clash slot.
 */
async function checkPlacement(
  tx: Tx,
  perjadinId: string,
  trip: TripPlacement,
  input: PerjadinSessionInput,
  excludeSessionId?: string,
): Promise<SessionPlacementRefusal | null> {
  const window = { startsOn: trip.startsOn, endsOn: trip.endsOn };
  if (!heldOnWithinPerjadin(input.heldOn, window)) {
    return { outcome: "session-outside-perjadin", ...window };
  }

  // A Perjadin teaches only at Schools of its Sub-Cluster (ADR-0016). A School id that names no row
  // is "outside" too, since its (absent) Sub-Cluster does not equal the trip's.
  const [target] = await tx
    .select({ subClusterId: school.subClusterId })
    .from(school)
    .where(eq(school.id, input.schoolId));
  if (!target || target.subClusterId !== trip.subClusterId) {
    return { outcome: "school-outside-sub-cluster", schoolId: input.schoolId };
  }

  // "Diajar oleh" must name this trip's own teacher rows; an id from another trip, or none, would
  // insert a dangling link. Deduped so the payload's own repeats are not reported as unknown.
  const wanted = [...new Set(input.taughtByTeacherIds)];
  if (wanted.length > 0) {
    const found = await tx
      .select({ id: perjadinTeacher.id })
      .from(perjadinTeacher)
      .where(and(eq(perjadinTeacher.perjadinId, perjadinId), inArray(perjadinTeacher.id, wanted)));
    const known = new Set(found.map((row) => row.id));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0) return { outcome: "unknown-teacher", teacherIds: unknown };
  }

  // The trip's other live offline Sessions — cancelled ones count for nothing, and the edited
  // Session is excluded so it never clashes with, or caps out against, itself.
  const siblings = (
    await tx
      .select({
        id: session.id,
        schoolId: session.schoolId,
        heldOn: session.heldOn,
        startsAt: session.startsAt,
      })
      .from(session)
      .where(and(eq(session.perjadinId, perjadinId), ne(session.status, "cancelled")))
  ).filter((row) => row.id !== excludeSessionId);

  const atSameSchool = siblings.filter((row) => row.schoolId === input.schoolId).length;
  if (atSameSchool >= MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN) {
    return {
      outcome: "too-many-sessions",
      schoolId: input.schoolId,
      count: atSameSchool + 1,
      limit: MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN,
    };
  }

  const clashing = siblings.filter(
    (row) =>
      row.heldOn === input.heldOn &&
      row.startsAt.slice(0, 5) === input.startsAt.slice(0, 5) &&
      row.schoolId !== input.schoolId,
  );
  if (clashing.length > 0) {
    return {
      outcome: "session-time-clash",
      heldOn: input.heldOn,
      startsAt: input.startsAt,
      schoolIds: [input.schoolId, ...new Set(clashing.map((row) => row.schoolId))],
    };
  }

  // The same School at the same moment on another trip (#408). On this trip it is left to the
  // index, which the writes' catch reports as `duplicate-session`.
  return bookedOnAnotherPerjadin(tx, [input], { ownPerjadinId: perjadinId, excludeSessionId });
}

/** Replace a Session's `session_teaching_team` links with the (deduped) set named. */
async function replaceTeachingTeam(tx: Tx, sessionId: string, teacherIds: string[]): Promise<void> {
  await tx.delete(sessionTeachingTeam).where(eq(sessionTeachingTeam.sessionId, sessionId));
  const wanted = [...new Set(teacherIds)];
  if (wanted.length > 0) {
    await tx
      .insert(sessionTeachingTeam)
      .values(wanted.map((perjadinTeacherId) => ({ sessionId, perjadinTeacherId })));
  }
}

export type AddPerjadinSessionResult =
  /**
   * `schoolsChanged`: the Session's School was not yet on the trip, so the trip's Schools — and its
   * Drive folder name — changed, and the caller renames the folders (#407).
   */
  | { outcome: "added"; sessionId: string; schoolsChanged: boolean }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" }
  /**
   * A second live Session at the same School, date and time on the trip, which
   * `session_no_duplicate_offline_per_school` refuses at the database (ADR-0038, #408). Parallel
   * rooms are one Session now, whose Teaching Team lists everyone who taught, so this is where a
   * second one at the same moment is reported rather than crashing.
   */
  | { outcome: "duplicate-session" }
  | SessionPlacementRefusal;

/**
 * Add one offline Session to a trip. Staff-only, arranged by construction (ADR-0006), carrying its
 * "Diajar oleh" links, checked against the trip's other Sessions before it is written.
 */
export async function addPerjadinSession(
  caller: Person,
  perjadinId: string,
  input: PerjadinSessionInput,
): Promise<AddPerjadinSessionResult> {
  requireStaff(caller);

  try {
    return await db.transaction(async (tx) => {
      await requirePerjadinWriter(caller, perjadinId, tx);

      const [trip] = await tx
        .select({
          subClusterId: perjadin.subClusterId,
          startsOn: perjadin.startsOn,
          endsOn: perjadin.endsOn,
        })
        .from(perjadin)
        .where(eq(perjadin.id, perjadinId))
        .for("update");
      if (!trip) return { outcome: "no-such-perjadin" };

      const refusal = await checkPlacement(tx, perjadinId, trip, input);
      if (refusal) return refusal;

      const schoolsChanged = await snapshotTripSchools(tx, perjadinId);
      const [created] = await tx
        .insert(session)
        .values({
          schoolId: input.schoolId,
          perjadinId,
          mode: "offline",
          heldOn: input.heldOn,
          startsAt: input.startsAt,
        })
        .returning({ id: session.id });

      await replaceTeachingTeam(tx, created!.id, input.taughtByTeacherIds);
      return { outcome: "added", sessionId: created!.id, schoolsChanged: await schoolsChanged() };
    });
  } catch (error) {
    return (
      (await slotViolationRefusal(error, [input], { ownPerjadinId: perjadinId })) ?? {
        outcome: "duplicate-session",
      }
    );
  }
}

export type EditPerjadinSessionResult =
  /**
   * `schoolsChanged`: the Session moved to another School, and one joined the trip's Schools or one
   * left them — so the caller renames the Drive folders (#407).
   */
  | { outcome: "edited"; schoolsChanged: boolean }
  /** A Session past `arranged` — its School, date and time are settled once it happened. */
  | { outcome: "not-arranged"; status: PastArranged }
  | { outcome: "duplicate-session" }
  | SessionPlacementRefusal;

/**
 * Edit one offline Session's School, date, time and "Diajar oleh". Staff-only, and offered
 * only while the Session is `arranged` — a delivered Session records something that happened, so its
 * fields are fixed. The same placement rules apply, checked against the trip's other Sessions with
 * this one excluded so it does not clash with, or count against, itself.
 *
 * A missing Session **throws** rather than returning a value: Detail Perjadin 404s on an unknown id
 * before it offers any write, and nothing deletes a Session, so an id that names nothing arrived by a
 * hand-edited request — not a user state to be helpful about, the same rule `moveSessionDate` states.
 */
export async function editPerjadinSession(
  caller: Person,
  sessionId: string,
  input: PerjadinSessionInput,
): Promise<EditPerjadinSessionResult> {
  requireStaff(caller);

  // The trip the Session is on, kept for the catch: a race on the index is a duplicate when the
  // slot's holder is on this same trip. Asserted rather than annotated, so the assignment inside the
  // transaction's callback is not narrowed away to `null`.
  let tripId = null as string | null;
  try {
    return await db.transaction(async (tx) => {
      await requireSessionWriter(caller, sessionId, tx);

      const [row] = await tx
        .select({
          status: session.status,
          perjadinId: session.perjadinId,
          subClusterId: perjadin.subClusterId,
          startsOn: perjadin.startsOn,
          endsOn: perjadin.endsOn,
        })
        .from(session)
        .innerJoin(perjadin, eq(perjadin.id, session.perjadinId))
        .where(eq(session.id, sessionId))
        .for("update", { of: session });
      if (!row || row.perjadinId === null) {
        throw new Error(
          `No offline Session has id ${sessionId}. Detail Perjadin 404s on an unknown id before ` +
            "offering any write, and nothing deletes a Session, so this is a bug or a hand-edited " +
            "request.",
        );
      }
      if (row.status !== "arranged") return { outcome: "not-arranged", status: row.status };
      tripId = row.perjadinId;

      const refusal = await checkPlacement(
        tx,
        row.perjadinId,
        { subClusterId: row.subClusterId, startsOn: row.startsOn, endsOn: row.endsOn },
        input,
        sessionId,
      );
      if (refusal) return refusal;

      const schoolsChanged = await snapshotTripSchools(tx, row.perjadinId);
      await tx
        .update(session)
        .set({
          schoolId: input.schoolId,
          heldOn: input.heldOn,
          startsAt: input.startsAt,
        })
        .where(eq(session.id, sessionId));

      await replaceTeachingTeam(tx, sessionId, input.taughtByTeacherIds);
      return { outcome: "edited", schoolsChanged: await schoolsChanged() };
    });
  } catch (error) {
    return (
      (await slotViolationRefusal(error, [input], {
        ownPerjadinId: tripId,
        excludeSessionId: sessionId,
      })) ?? { outcome: "duplicate-session" }
    );
  }
}
