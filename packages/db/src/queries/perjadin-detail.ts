import {
  MAX_EXTRA_STAFF_PER_GROUP,
  type Role,
  type SessionStatus,
  type Stream,
  type TimeZone,
  type TransportMode,
} from "@sugt/domain";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../client";
import { session, sessionTeachingTeam } from "../schema/delivery";
import { person } from "../schema/people";
import { province, school } from "../schema/reference";
import {
  groupMember,
  perjadin,
  perjadinPimpinan,
  perjadinPreparationItem,
  perjadinTeacher,
} from "../schema/travel";
import type { Person } from "./caller";
import { duplicatedStaff } from "./group-rules";
import { derivePreparationChecklist, type PreparationItem } from "./preparation-checklist";
import { unknownPimpinanIds } from "./rosters";
import { heldOnWithinPerjadin } from "./session-detail";
import { requireStaff } from "./staff-only";

/**
 * **One Perjadin, and the writes on it** — the read open to anyone signed in and carrying no
 * money at all; the writes Staff-only.
 *
 * The no-money part is a **shape** rather than a rendering rule: this payload never carries the
 * Advance, the transactions or the Report. Money is `./perjadin-report.ts`'s `perjadinAcquittal`, a
 * separate read — and since #180 (ADR-0026) that read is open to any signed-in Person, so the trip
 * page fetches it alongside this one and shows the money strip to a Pimpinan too. This query still
 * carries none of it, and needs no role check because there is nothing here to refuse; every
 * **write** below opens with `requireStaff`, and reading money stays a job for `perjadinAcquittal`.
 */

/** One member of the Group. Staff-only now (ADR-0020), so `stream` is always null. */
export type GroupMemberEntry = {
  personId: string;
  fullName: string;
  role: Role;
  stream: Stream | null;
};

/** One offline Session on the trip, and how it is going. */
export type PerjadinSession = {
  sessionId: string;
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  heldOn: string;
  /** Wall-clock start time local to the School (`HH:MM:SS`), rendered with its zone. */
  startsAt: string;
  /** The School's Province's Time Zone, for rendering `startsAt`. */
  timeZone: TimeZone;
  status: SessionStatus;
  /** The Stream this Session teaches — STEM or Research (ADR-0019). Never null on an offline row. */
  stream: Stream | null;
  /** The trip's teacher names who staffed this Session's parallel rooms, for editing "Diajar oleh". */
  taughtBy: { id: string; name: string }[];
};

/**
 * One leg's travel logistics, as the detail screen reads them. Null on every Perjadin planned
 * before the columns existed (#106) — the screen shows those legs as not recorded.
 */
export type PerjadinTravelLeg = {
  /** Wall-clock date and time, `YYYY-MM-DD HH:MM:SS`, meaningful only beside `zone`. */
  at: string;
  zone: TimeZone;
  mode: TransportMode;
};

/** A School eligible to hold a Session on this trip — one of the trip's Sub-Cluster's Schools. */
export type EligibleSchool = {
  id: string;
  name: string;
  kabupatenKota: string;
  /**
   * The School's Time Zone, from its Province — carried so the add-Session dialog labels its time
   * input with the zone the moment a School is picked (#165). A School always sits in one Province.
   */
  timeZone: TimeZone;
};

/** Everything the Perjadin detail screen renders, and no money. */
export type PerjadinDetail = {
  id: string;
  destination: string;
  startsOn: string;
  endsOn: string;
  picPersonId: string;
  picFullName: string;
  /** Departure from Bandung; null when this trip predates the logistics columns. */
  departure: PerjadinTravelLeg | null;
  /** Return; null when this trip predates the logistics columns. */
  return: PerjadinTravelLeg | null;
  /**
   * **The Report deadline is not here.** It is on `perjadinAcquittal`, because the Perjadin
   * Report *is* the acquittal — `docs/data-model.md` says so in as many words — and this payload
   * carries no money-side figure. That acquittal read is open to any signed-in Person since #180
   * (ADR-0026), so the deadline rides with the money there rather than being duplicated here.
   */
  group: GroupMemberEntry[];
  sessions: PerjadinSession[];
  /** The trip's Teaching Team as trip-scoped names (ADR-0020), for the per-name editor and the "Diajar oleh" pickers. */
  teachers: { id: string; name: string }[];
  /**
   * The Pimpinan recorded on the trip, for the checkbox editor — each a real Person of role Pimpinan
   * (#181), carried as its `personId` and the person's `name` so the editor can key on the id and
   * the read-only view can show the name.
   */
  pimpinan: { personId: string; name: string }[];
  /**
   * The Pimpinan roster the editor picks from — every active Person of role Pimpinan (#181). Mirrors
   * `staff` below; empty until Pimpinan are added on `/orang`. Revoked People are not offered.
   */
  pimpinanRoster: { id: string; fullName: string }[];
  /**
   * Every active Staff member, for the PIC picker and the extra-Staff multi-select. Revoked People
   * are not offered — naming one puts them on a trip they are no longer on.
   */
  staff: { id: string; fullName: string }[];
  /** The Schools of the trip's Sub-Cluster, for the "add a Session" picker (ADR-0016's eligible set). */
  eligibleSchools: EligibleSchool[];
  /**
   * The Preparation Checklist, each item with its tick state ([#114](https://github.com/mafiefa02/sugt/issues/114)).
   * **Derived here, not stored**: `perjadin_preparation_item` holds only the ticks. Its per-teacher
   * derivation is T4's ([#139](https://github.com/mafiefa02/sugt/issues/139)); this ticket leaves it
   * as it stands. No money, so it rides on this payload rather than the separate acquittal read.
   */
  preparation: PreparationItem[];
};

/**
 * One Perjadin, or `null` when the id names none — a stale link, which is reachable, and
 * which the screen turns into a 404.
 *
 * A header with several independent lists hanging off it, gathered concurrently with `Promise.all`
 * rather than joined at once — joining every list into one statement would multiply each list's rows
 * by the others'. The screen still makes one call and assembles nothing.
 */
export async function perjadinDetail(
  _caller: Person,
  perjadinId: string,
): Promise<PerjadinDetail | null> {
  const pic = alias(person, "pic");

  const [
    [trip],
    group,
    sessions,
    teachers,
    pimpinan,
    pimpinanRoster,
    staff,
    eligibleSchools,
    teachingLinks,
    preparationTicks,
  ] = await Promise.all([
    db
      .select({
        id: perjadin.id,
        destination: perjadin.destination,
        startsOn: perjadin.startsOn,
        endsOn: perjadin.endsOn,
        picPersonId: pic.id,
        picFullName: pic.fullName,
        departureAt: perjadin.departureAt,
        departureZone: perjadin.departureZone,
        departureMode: perjadin.departureMode,
        returnAt: perjadin.returnAt,
        returnZone: perjadin.returnZone,
        returnMode: perjadin.returnMode,
      })
      .from(perjadin)
      .innerJoin(pic, eq(pic.id, perjadin.picPersonId))
      .where(eq(perjadin.id, perjadinId)),
    db
      .select({
        personId: groupMember.personId,
        fullName: person.fullName,
        role: groupMember.role,
        stream: groupMember.stream,
      })
      .from(groupMember)
      .innerJoin(person, eq(person.id, groupMember.personId))
      .where(eq(groupMember.perjadinId, perjadinId))
      // The PIC is who a reader looks for; among the Staff-only Group, name order otherwise.
      .orderBy(asc(person.fullName)),
    db
      .select({
        sessionId: session.id,
        schoolId: session.schoolId,
        schoolName: school.name,
        schoolSlug: school.slug,
        heldOn: session.heldOn,
        startsAt: session.startsAt,
        timeZone: province.timeZone,
        status: session.status,
        stream: session.stream,
      })
      .from(session)
      .innerJoin(school, eq(school.id, session.schoolId))
      .innerJoin(province, eq(province.code, school.provinceCode))
      .where(eq(session.perjadinId, perjadinId))
      .orderBy(asc(session.heldOn), asc(session.startsAt), asc(school.name)),
    // The trip's Teaching Team names, in name order, for the editor and the "Diajar oleh" pickers.
    db
      .select({ id: perjadinTeacher.id, name: perjadinTeacher.name })
      .from(perjadinTeacher)
      .where(eq(perjadinTeacher.perjadinId, perjadinId))
      .orderBy(asc(perjadinTeacher.name)),
    // The Pimpinan recorded on the trip — record-only rows referencing a real Person (#181). Joined
    // to `person` for the display name, in name order for the read-only view.
    db
      .select({ personId: perjadinPimpinan.personId, name: person.fullName })
      .from(perjadinPimpinan)
      .innerJoin(person, eq(person.id, perjadinPimpinan.personId))
      .where(eq(perjadinPimpinan.perjadinId, perjadinId))
      .orderBy(asc(person.fullName)),
    // The Pimpinan roster the checkbox editor picks from — active Pimpinan People (#181). Mirrors the
    // Staff roster below, filtering role='Pimpinan'. Revoked People excluded.
    db
      .select({ id: person.id, fullName: person.fullName })
      .from(person)
      .where(and(eq(person.active, true), eq(person.role, "Pimpinan")))
      .orderBy(asc(person.fullName)),
    // The Staff roster, for the PIC picker and the extra-Staff multi-select. Revoked People excluded.
    db
      .select({ id: person.id, fullName: person.fullName })
      .from(person)
      .where(and(eq(person.active, true), eq(person.role, "Staff")))
      .orderBy(asc(person.fullName)),
    // The Schools of the trip's Sub-Cluster — the set a new Session may be added at (ADR-0016).
    db
      .select({
        id: school.id,
        name: school.name,
        kabupatenKota: school.kabupatenKota,
        timeZone: province.timeZone,
      })
      .from(school)
      .innerJoin(perjadin, eq(perjadin.subClusterId, school.subClusterId))
      .innerJoin(province, eq(province.code, school.provinceCode))
      .where(eq(perjadin.id, perjadinId))
      .orderBy(asc(school.name)),
    // "Diajar oleh" for every Session on the trip: the teacher rows those Sessions link to. Scoped
    // to this trip by `perjadin_teacher.perjadin_id`, so a link's Session belongs to it too.
    db
      .select({
        sessionId: sessionTeachingTeam.sessionId,
        teacherId: perjadinTeacher.id,
        teacherName: perjadinTeacher.name,
      })
      .from(sessionTeachingTeam)
      .innerJoin(perjadinTeacher, eq(perjadinTeacher.id, sessionTeachingTeam.perjadinTeacherId))
      .where(eq(perjadinTeacher.perjadinId, perjadinId))
      .orderBy(asc(perjadinTeacher.name)),
    db
      .select({
        itemKey: perjadinPreparationItem.itemKey,
        checkedBy: perjadinPreparationItem.checkedBy,
        checkedAt: perjadinPreparationItem.checkedAt,
      })
      .from(perjadinPreparationItem)
      .where(eq(perjadinPreparationItem.perjadinId, perjadinId)),
  ]);

  if (!trip) return null;

  // "Diajar oleh" stitched onto each Session — the links are already scoped to the trip and ordered
  // by teacher name.
  const taughtBySession = new Map<string, { id: string; name: string }[]>();
  for (const link of teachingLinks) {
    const list = taughtBySession.get(link.sessionId) ?? [];
    list.push({ id: link.teacherId, name: link.teacherName });
    taughtBySession.set(link.sessionId, list);
  }

  // The Preparation Checklist is a flat fixed seven now (amendment to ADR-0018) — no per-member
  // derivation, so it does not read the Group at all.
  const preparation = derivePreparationChecklist(preparationTicks);

  const { departureAt, departureZone, departureMode, returnAt, returnZone, returnMode, ...header } =
    trip;

  return {
    ...header,
    // A leg reads as recorded only when all three of its columns are present. They are written
    // together and the CHECKs pin the zone/mode, so in practice they are all-or-nothing.
    departure:
      departureAt !== null && departureZone !== null && departureMode !== null
        ? { at: departureAt, zone: departureZone, mode: departureMode }
        : null,
    return:
      returnAt !== null && returnZone !== null && returnMode !== null
        ? { at: returnAt, zone: returnZone, mode: returnMode }
        : null,
    group,
    sessions: sessions.map((row) => ({
      ...row,
      taughtBy: taughtBySession.get(row.sessionId) ?? [],
    })),
    teachers,
    pimpinan: pimpinan.map((row) => ({ personId: row.personId, name: row.name })),
    pimpinanRoster,
    staff,
    eligibleSchools,
    preparation,
  };
}

export type SetPerjadinStaffResult =
  | { outcome: "set" }
  /** More than `MAX_EXTRA_STAFF_PER_GROUP` extra Staff — the Group is the PIC plus up to ten. */
  | { outcome: "too-many-staff"; count: number; limit: number }
  /** An extra Staff member repeated, or the same as the PIC — a Group holds each person once. */
  | { outcome: "duplicate-staff"; personIds: string[] }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" };

/**
 * **Set the Group's extra Staff** — the PIC plus this set, and nobody else.
 *
 * This replaced the wholesale `replacePerjadinGroup` when the Teaching Team left the Group
 * (ADR-0020): a Group is Staff and only Staff now, so editing it is choosing the extra Staff. The
 * set is written whole, the same way planning writes it — up to ten distinct Staff, none the PIC —
 * because the caps and the distinctness are counts across sibling rows no CHECK can hold.
 *
 * **The PIC is re-inserted rather than asked for.** They are the one member the caller cannot drop —
 * `perjadin_pic_is_a_group_member` refuses a Group without them at COMMIT — and the PIC is changed
 * through `changePerjadinPic`, not here.
 */
export async function setPerjadinStaff(
  caller: Person,
  perjadinId: string,
  staffPersonIds: string[],
): Promise<SetPerjadinStaffResult> {
  requireStaff(caller);

  if (staffPersonIds.length > MAX_EXTRA_STAFF_PER_GROUP) {
    return {
      outcome: "too-many-staff",
      count: staffPersonIds.length,
      limit: MAX_EXTRA_STAFF_PER_GROUP,
    };
  }

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ picPersonId: perjadin.picPersonId })
      .from(perjadin)
      .where(eq(perjadin.id, perjadinId))
      .for("update");
    if (!trip) return { outcome: "no-such-perjadin" };

    const duplicate = duplicatedStaff(trip.picPersonId, staffPersonIds);
    if (duplicate.length > 0) return { outcome: "duplicate-staff", personIds: duplicate };

    await tx.delete(groupMember).where(eq(groupMember.perjadinId, perjadinId));
    await tx.insert(groupMember).values([
      {
        perjadinId,
        personId: trip.picPersonId,
        role: "Staff" as const,
        stream: null,
      },
      ...staffPersonIds.map((personId) => ({
        perjadinId,
        personId,
        role: "Staff" as const,
        stream: null,
      })),
    ]);

    return { outcome: "set" };
  });
}

export type ChangePerjadinPicResult =
  | { outcome: "changed" }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" };

/**
 * **Reassign a Perjadin's PIC**, keeping the Group valid.
 *
 * Two writes in one transaction: `perjadin.pic_person_id` moves to the new PIC, and the new PIC is
 * made a `group_member` if they are not one already. It has to be one transaction because
 * `perjadin_pic_is_a_group_member` — the DEFERRABLE self-referential foreign key — must hold at
 * COMMIT: the `perjadin` update runs **first**, while the new PIC is not yet a member, which an
 * immediate check would refuse and the deferral lets pass; the membership insert then satisfies it
 * before COMMIT. The old PIC stays on the Group as an ordinary Staff member, droppable afterwards
 * through `setPerjadinStaff`.
 *
 * A new PIC who is not Staff is refused by `perjadin_pic_is_staff` at the database, which is not
 * reachable from the picker (it offers active Staff only) and so throws rather than returning a
 * value — the same disposition planning gives a professor named PIC.
 */
export async function changePerjadinPic(
  caller: Person,
  perjadinId: string,
  newPicPersonId: string,
): Promise<ChangePerjadinPicResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ picPersonId: perjadin.picPersonId })
      .from(perjadin)
      .where(eq(perjadin.id, perjadinId))
      .for("update");
    if (!trip) return { outcome: "no-such-perjadin" };
    if (trip.picPersonId === newPicPersonId) return { outcome: "changed" };

    // The `perjadin` update goes first, before the new PIC is a member — legal only because the
    // membership foreign key is DEFERRED to COMMIT.
    await tx
      .update(perjadin)
      .set({ picPersonId: newPicPersonId })
      .where(eq(perjadin.id, perjadinId));
    await tx
      .insert(groupMember)
      .values({ perjadinId, personId: newPicPersonId, role: "Staff" as const, stream: null })
      // Already a member — the new PIC was an extra Staff — is the common case, and idempotent here.
      .onConflictDoNothing();

    return { outcome: "changed" };
  });
}

export type SetPerjadinPimpinanResult =
  | { outcome: "set" }
  /**
   * A personId that is not an active Person of role Pimpinan — a revoked Pimpinan, a Staff id, or a
   * stranger. Not reachable through the checkbox editor (it offers the roster), checked anyway.
   */
  | { outcome: "unknown-pimpinan"; offending: string[] }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" };

/**
 * **Set the Pimpinan recorded on a trip** — the subset of the Pimpinan roster who joined. Staff-only.
 *
 * Record-only rows (ADR-0020): a Pimpinan is not a `group_member`, files no Perjadin Evaluation and
 * adds nothing to the Preparation Checklist. The set is written whole — removed rows deleted, added
 * ones inserted — deduped so the `(perjadin_id, person_id)` primary key cannot collide. Each id is
 * validated against the roster (an active Person of role='Pimpinan') before any write, the way
 * planning validates it; the composite `perjadin_pimpinan_is_pimpinan` FK is the DB backstop that
 * refuses a non-Pimpinan even from the SQL editor.
 */
export async function setPerjadinPimpinan(
  caller: Person,
  perjadinId: string,
  personIds: string[],
): Promise<SetPerjadinPimpinanResult> {
  requireStaff(caller);

  const unique = [...new Set(personIds)];
  const offending = await unknownPimpinanIds(unique);
  if (offending.length > 0) return { outcome: "unknown-pimpinan", offending };

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: perjadin.id })
      .from(perjadin)
      .where(eq(perjadin.id, perjadinId))
      .for("update");
    if (!trip) return { outcome: "no-such-perjadin" };

    await tx.delete(perjadinPimpinan).where(eq(perjadinPimpinan.perjadinId, perjadinId));
    if (unique.length > 0) {
      await tx
        .insert(perjadinPimpinan)
        .values(unique.map((personId) => ({ perjadinId, personId })));
    }

    return { outcome: "set" };
  });
}

/**
 * The six logistics fields as the edit surface submits them. Unlike the plan form, the return
 * **zone is explicit here** — it was derived from the last School at plan time, but a correction
 * may be needed. The departure zone stays WIB (the origin is always Bandung), so it is not asked
 * for and not accepted: the query fixes it.
 */
export type PerjadinLogisticsInput = {
  departureDate: string;
  departureTime: string;
  departureMode: TransportMode;
  returnDate: string;
  returnTime: string;
  returnMode: TransportMode;
  returnZone: TimeZone;
};

export type UpdatePerjadinLogisticsResult =
  | { outcome: "updated" }
  /**
   * The return date lands before the departure date, so the derived `[starts_on … ends_on]` range
   * would be inverted (ADR-0021). Same-day is allowed. Refused before the transaction opens.
   */
  | { outcome: "return-before-departure" }
  /**
   * At least one **arranged** Session would fall outside the new `[departure … return]` window; the
   * range is not resized and nothing is written. The same shape the retired `movePerjadinDates`
   * used — this is the resize-and-clamp guard that replaced the auto-shift (ADR-0021).
   */
  | { outcome: "would-strand"; strandedCount: number; startsOn: string; endsOn: string }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" };

/**
 * Correct a Perjadin's departure/return logistics after planning — and, with them, the trip's
 * range. Staff-only.
 *
 * **The range is the leg dates now (ADR-0021).** `starts_on`/`ends_on` are no longer typed; they
 * are `departure.date` and `return.date`, so editing a leg date *is* editing the range. This write
 * therefore sets all six logistics columns **plus** `starts_on`/`ends_on`, in one transaction.
 *
 * **Resize and clamp, never auto-shift.** Moving a leg date resizes the window; it does not move any
 * Session. If the new `[departure … return]` window would leave an **arranged** Session outside it,
 * the whole edit is refused (`would-strand`) rather than stranding it — the mirror of planning's
 * `session-outside-perjadin`. Only arranged Sessions are checked: a delivered or cancelled Session
 * records something that already happened and may legitimately sit outside the window its trip now
 * claims (`docs/data-model.md`, Delivery). Online Sessions carry no `perjadin_id` and are excluded.
 *
 * `departure_zone` is fixed to WIB and never taken from the caller; `return_zone` is the caller's,
 * because a return from a WITA/WIT city is read in that city's wall-clock and the derivation at plan
 * time can be wrong. The `*_at` values are wall-clock `date time` strings, the same shape planning
 * wrote — no instant, no conversion.
 */
export async function updatePerjadinLogistics(
  caller: Person,
  perjadinId: string,
  input: PerjadinLogisticsInput,
): Promise<UpdatePerjadinLogisticsResult> {
  requireStaff(caller);

  // The derived range: departure date opens it, return date closes it (ADR-0021).
  const newStartsOn = input.departureDate;
  const newEndsOn = input.returnDate;

  // An inverted range is refused before the transaction opens — same-day allowed. `perjadin_dates_check`
  // holds `ends_on >= starts_on` at the database too, but returning a value lets the edit surface point
  // at the return field rather than surfacing a raw constraint violation.
  if (newEndsOn < newStartsOn) return { outcome: "return-before-departure" };

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ id: perjadin.id })
      .from(perjadin)
      .where(eq(perjadin.id, perjadinId))
      .for("update");
    if (!trip) return { outcome: "no-such-perjadin" };

    // Offline arranged Sessions on this trip; online ones carry no `perjadin_id`, so the
    // `perjadin_id` match already excludes them. Delivered and cancelled ones are left out on
    // purpose — the invariant is scoped to arranged.
    const arranged = await tx
      .select({ id: session.id, heldOn: session.heldOn })
      .from(session)
      .where(and(eq(session.perjadinId, perjadinId), eq(session.status, "arranged")))
      .for("update", { of: session });

    const window = { startsOn: newStartsOn, endsOn: newEndsOn };
    const stranded = arranged.filter((s) => !heldOnWithinPerjadin(s.heldOn, window));
    if (stranded.length > 0) {
      // Return before any write: the transaction commits, but it carries only the locking reads, so
      // the trip and its Sessions are left exactly as they were. No Session is shifted.
      return {
        outcome: "would-strand",
        strandedCount: stranded.length,
        startsOn: newStartsOn,
        endsOn: newEndsOn,
      };
    }

    await tx
      .update(perjadin)
      .set({
        departureAt: `${input.departureDate} ${input.departureTime}`,
        departureZone: "WIB",
        departureMode: input.departureMode,
        returnAt: `${input.returnDate} ${input.returnTime}`,
        returnZone: input.returnZone,
        returnMode: input.returnMode,
        // The range rides along, derived from the leg dates it was just given (ADR-0021).
        startsOn: newStartsOn,
        endsOn: newEndsOn,
      })
      .where(eq(perjadin.id, perjadinId));

    return { outcome: "updated" };
  });
}

export type UpdatePerjadinAdvanceResult =
  | { outcome: "updated" }
  /**
   * A negative Advance. The DB `perjadin_advance_check` (`advance_idr >= 0`) is the floor;
   * returning a value lets the edit surface point at the field rather than surfacing a raw
   * constraint violation. **Zero is allowed** — an unfunded trip is a real state.
   */
  | { outcome: "negative-advance" }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" };

/**
 * **Correct a Perjadin's Advance after planning.** Staff-only (money writes stay Staff-only,
 * ADR-0026); reading it is open, so this write is the only place the figure changes after
 * `planPerjadin` set it once.
 *
 * **No lifecycle gate.** The correction is allowed at any time, *including after the Perjadin
 * Report is filed* — it is a correction affordance, and the acquittal derives the remainder live
 * (`remainderIdr = advance − spent`), so a fixed Advance fixes the remainder for free.
 *
 * **The only validation is the DB floor** (`advance_idr >= 0`). It is deliberately *not* coupled
 * to what has already been spent: setting the Advance below current spend yields a negative
 * remainder (an overspend), which is a real, representable state and not an error.
 */
export async function updatePerjadinAdvance(
  caller: Person,
  perjadinId: string,
  advanceIdr: number,
): Promise<UpdatePerjadinAdvanceResult> {
  requireStaff(caller);

  // The DB CHECK is the floor; reject a negative value up front so the surface can point at the
  // field rather than showing a raw constraint violation. Not coupled to spend on purpose.
  if (advanceIdr < 0) return { outcome: "negative-advance" };

  const updated = await db
    .update(perjadin)
    .set({ advanceIdr })
    .where(eq(perjadin.id, perjadinId))
    .returning({ id: perjadin.id });

  if (updated.length === 0) return { outcome: "no-such-perjadin" };

  return { outcome: "updated" };
}
