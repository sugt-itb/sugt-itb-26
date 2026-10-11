import type { SessionStatus, TimeZone } from "@sugt/domain";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "../client";
import { session, sessionTeachingTeam } from "../schema/delivery";
import { person } from "../schema/people";
import { province, school, subCluster } from "../schema/reference";
import {
  groupMember,
  perjadin,
  perjadinPimpinan,
  perjadinTeacher,
  transaction,
} from "../schema/travel";
import type { Person } from "./caller";
import { todayInDeadlineZone } from "./deadline";
import { tripSchoolNames } from "./perjadin-naming";
import { preparationChecklists, type PreparationItem } from "./preparation-checklist";
import { requireGrant, requireStaff } from "./staff-only";

/**
 * **The caller's own trips**, for `/pendamping` (#197, #396): Perjalanan Dinas Anda — the trips not
 * yet over — and Perjalanan Dinas Sebelumnya — the ones that are, still fully workable, since the
 * transactions and the attendance sheets are often finished after the trip.
 *
 * A read scoped **by** the caller rather than gated by their role: it takes a `Person` and returns
 * only the trips that Person is a working member of, so there is no Staff choke point (every
 * signed-in Person is Staff since T3, and a delivery read is open anyway). "Their trips" is
 * membership, not the PIC seat — the PIC is *a* `group_member` too (`perjadin_pic_is_a_group_member`
 * guarantees it), so joining `group_member` on `person_id = caller.id` already includes the trips
 * they lead and drops the trips they are merely PIC-eligible for but not on. There is no separate
 * `perjadin_pimpinan` path: a Pimpinan is record-only (ADR-0025) and this is a working-member view.
 *
 * **Money rides on this payload**, unlike `./perjadin-detail.ts` which carries none. This is a
 * personal work list — what the trip has spent so far is part of the point of it — and money reads
 * are open now (ADR-0026), so `spentIdr` sits here directly rather than behind a second call.
 */

/** One Staff member of the trip's Group. `isPic` flags the one the reader looks for first. */
export type MyPerjadinStaff = {
  personId: string;
  fullName: string;
  isPic: boolean;
};

/** One trip-scoped teacher name (ADR-0020) — never a `person` row. */
export type MyPerjadinPengajar = {
  id: string;
  name: string;
};

/**
 * One School's Narasumber on the card (#447): whoever is in "Diajar oleh" of a live Session there.
 * Named for the code's `pengajar`, as CONTEXT.md keeps it; Narasumber is the UI label.
 */
export type MyPerjadinPengajarSchool = {
  schoolId: string;
  name: string;
  /** A–Z, each once however many of its Sessions they taught; empty reads "belum ditugaskan". */
  pengajar: MyPerjadinPengajar[];
};

/**
 * **The trip's Narasumber by School** (#447), the card's folded Narasumber block. The Schools are
 * the ones with a live (non-cancelled) offline Session on the trip, by their earliest live Session
 * and then by name — the timeline's order. Each School's list stands alone, so someone who taught
 * at two Schools is under both. `unassigned` is everyone in no live Session's "Diajar oleh", including
 * someone whose only Session was cancelled. Identity is the `perjadin_teacher` row, not the name.
 *
 * A usual practice shown, not a rule: nothing here constrains who may teach where.
 */
export type MyPerjadinPengajarBySchool = {
  bySchool: MyPerjadinPengajarSchool[];
  unassigned: MyPerjadinPengajar[];
};

/** One Pimpinan recorded on the trip — record-only, the name of a real Pimpinan-Person (#181). */
export type MyPerjadinPimpinan = {
  personId: string;
  name: string;
};

/** One offline Session at a visited School, and how it is going. Cancelled ones are included. */
export type MyPerjadinSession = {
  sessionId: string;
  heldOn: string;
  /** Wall-clock start time local to the School (`HH:MM:SS`), read beside its School's `timeZone`. */
  startsAt: string;
  status: SessionStatus;
};

/** One visited School, with the trip's offline Sessions there. */
export type MyPerjadinSchool = {
  schoolId: string;
  name: string;
  kabupatenKota: string;
  /** The School's Province's Time Zone, for rendering each Session's `startsAt`. */
  timeZone: TimeZone;
  sessions: MyPerjadinSession[];
};

/**
 * One trip the caller is on, everything its `/pendamping` card renders.
 *
 * `preparation` is the trip's own checklist (ADR-0045), each item carrying its tick state — the
 * same resolver the detail read runs. It carries the whole checklist rather than a bare `x`/`N`
 * because the card's pill *and* its Persiapan dialog read from one payload: the pill is
 * `preparation.filter(i => i.checked).length` out of `preparation.length`, and the dialog toggles
 * the very items shown here.
 */
export type MyPerjadinTrip = {
  id: string;
  /** The trip is named `{subClusterName} · {dates}` (ADR-0044), read live — never stored. */
  subClusterName: string;
  /** The trip's Schools (`tripSchoolNames`): the School line under the card's name. */
  schoolNames: string[];
  startsOn: string;
  endsOn: string;
  picPersonId: string;
  picFullName: string;
  /**
   * **Uang Perjalanan Terpakai** (ADR-0051): the sum of every transaction on the trip, all
   * categories, zero when none has been entered. The same figure as `perjadinAcquittal.spentIdr` — a
   * test pins the two equal so the card and the trip's screens never show two answers. It is summed
   * in SQL here because this list renders no line items.
   */
  spentIdr: number;
  /** The trip's checklist, each item with its tick state — the pill's `x`/`N` and the dialog's boxes. */
  preparation: PreparationItem[];
  /**
   * Who is on the trip, in three lists the way `docs/data-model.md` splits them: the Staff Group,
   * the trip-scoped teacher names, and the record-only Pimpinan. `anggotaTotal` is their combined
   * head count, summed here so the strip does not re-add three lengths at the render site.
   * `pengajarBySchool` is `pengajar` again, grouped by School for the card's Narasumber block
   * (#447); the trip's distinct Narasumber — the block's heading count — is still `pengajar.length`.
   */
  anggota: {
    staff: MyPerjadinStaff[];
    pengajar: MyPerjadinPengajar[];
    pengajarBySchool: MyPerjadinPengajarBySchool;
    pimpinan: MyPerjadinPimpinan[];
    anggotaTotal: number;
  };
  /** The Schools this trip teaches at, each with its offline Sessions (cancelled ones included). */
  schools: MyPerjadinSchool[];
};

/** The caller's trips, split at today: `current` soonest first, `previous` most recent first. */
export type MyPerjadin = { current: MyPerjadinTrip[]; previous: MyPerjadinTrip[] };

/**
 * **The caller's own trips, in one read**, split at today in the office's zone: a trip ending today
 * is still current.
 *
 * Shaped like `perjadinAcquittal`/`perjadinDetail`: the base trip rows come back first — filtered to
 * the caller's memberships and sorted for a total order — then each hanging list is one batched
 * select keyed by `inArray(tripIds)` and stitched on with a Map, rather than one join that would
 * multiply each list by the others'. When the caller is on no trip the base query returns nothing
 * and the extra round trips are skipped entirely.
 */
export async function myPerjadin(caller: Person): Promise<MyPerjadin> {
  return perjadinOf(caller.id);
}

export type PendampingPerjadinResult =
  | { outcome: "ok"; fullName: string; perjadin: MyPerjadin }
  /** A Pimpinan's id, an unknown one or a malformed one: no Staff Person to show. */
  | { outcome: "no-such-pendamping" };

/**
 * **One Staff Person's `/pendamping`, for an Administrator** (#440): the trips that Person sees as
 * theirs, exactly as `myPerjadin` gives them to that Person, for the "Pendamping Lain" tab — the
 * screenshot an Administrator needs to show someone how to use their own page.
 *
 * **Administrator only, held here rather than only in the page.** `requireStaff` first, so a
 * Pimpinan is refused as non-Staff; then `requireGrant(caller, "Administrator")` — no other Grant
 * is enough — before any row is read. A `personId` that names no Staff Person (a Pimpinan, an unknown id,
 * a malformed one) is `no-such-pendamping`, a value the page says in a sentence. Viewing writes
 * nothing to the Activity Log.
 */
export async function pendampingPerjadin(
  caller: Person,
  personId: string,
): Promise<PendampingPerjadinResult> {
  requireStaff(caller);
  requireGrant(caller, "Administrator");

  const [found] = await db
    .select({ id: person.id, fullName: person.fullName })
    .from(person)
    // A text compare, so a malformed id is simply no Person rather than a cast error.
    .where(and(sql`${person.id}::text = ${personId}`, eq(person.role, "Staff")));
  if (!found) return { outcome: "no-such-pendamping" };

  return { outcome: "ok", fullName: found.fullName, perjadin: await perjadinOf(found.id) };
}

/** One Staff Person "Pendamping Lain" offers to pick (#440). */
export type PendampingOption = { id: string; fullName: string; email: string };

/**
 * **Whom "Pendamping Lain" offers** (#440): every Staff Person but the caller, by name, with
 * the email the picker also searches. Administrator only, like `pendampingPerjadin`.
 */
export async function pendampingOptions(caller: Person): Promise<PendampingOption[]> {
  requireStaff(caller);
  requireGrant(caller, "Administrator");

  return db
    .select({ id: person.id, fullName: person.fullName, email: person.email })
    .from(person)
    .where(and(eq(person.role, "Staff"), ne(person.id, caller.id)))
    .orderBy(asc(person.fullName), asc(person.id));
}

/**
 * The body of `myPerjadin`, keyed on a **person id** rather than a caller, so `pendampingPerjadin`
 * gives an Administrator another Person's trips through exactly the read that Person gets.
 */
async function perjadinOf(personId: string): Promise<MyPerjadin> {
  // Not yet over: `ends_on` on or after today, reckoned in the office's zone via the shared
  // `todayInDeadlineZone` fragment (`./deadline.ts`) — the same calendar the acquittal's
  // `daysRemaining` counts in, not the database session's default zone.
  const isCurrent = sql<boolean>`${perjadin.endsOn} >= ${todayInDeadlineZone}`;

  // The base rows: every trip the caller is a `group_member` of. The `group_member` inner join both
  // filters (only the caller's trips) and cannot fan out — its primary key is
  // `(perjadin_id, person_id)`, so at most one row matches for a given caller.
  const rows = await db
    .select({
      id: perjadin.id,
      subClusterName: subCluster.name,
      schoolNames: tripSchoolNames(perjadin.id),
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      picPersonId: perjadin.picPersonId,
      picFullName: person.fullName,
      isCurrent,
    })
    .from(perjadin)
    .innerJoin(
      groupMember,
      and(eq(groupMember.perjadinId, perjadin.id), eq(groupMember.personId, personId)),
    )
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .innerJoin(person, eq(person.id, perjadin.picPersonId))
    // Current trips first, soonest first — a trip is remembered by when it happens. Then the
    // previous ones, the most recently ended first. `id` breaks the tie so the order is total.
    .orderBy(
      desc(isCurrent),
      sql`case when ${isCurrent} then ${perjadin.startsOn} end asc`,
      sql`case when ${isCurrent} then null else ${perjadin.endsOn} end desc`,
      sql`case when ${isCurrent} then null else ${perjadin.startsOn} end desc`,
      asc(perjadin.id),
    );

  if (rows.length === 0) return { current: [], previous: [] };

  const tripIds = rows.map((trip) => trip.id);

  // The seven hanging lists, gathered concurrently and each scoped to just these trips.
  const [spentRows, staffRows, pengajarRows, pimpinanRows, sessionRows, taughtRows, checklists] =
    await Promise.all([
      // Uang Perjalanan Terpakai per trip (ADR-0051): every category, grouped by `perjadin_id`. A trip
      // with no spend is absent and defaults to 0 below.
      db
        .select({
          perjadinId: transaction.perjadinId,
          spentIdr: sql<number>`coalesce(sum(${transaction.amountIdr}), 0)`.mapWith(Number),
        })
        .from(transaction)
        .where(inArray(transaction.perjadinId, tripIds))
        .groupBy(transaction.perjadinId),
      // The Staff Group, joined to `person` for the name, in name order. `isPic` is derived per row
      // below rather than joined, since the PIC id is already on each trip.
      db
        .select({
          perjadinId: groupMember.perjadinId,
          personId: groupMember.personId,
          fullName: person.fullName,
        })
        .from(groupMember)
        .innerJoin(person, eq(person.id, groupMember.personId))
        .where(and(inArray(groupMember.perjadinId, tripIds), eq(groupMember.role, "Staff")))
        .orderBy(asc(person.fullName)),
      // The trip-scoped teacher names (ADR-0020), in name order.
      db
        .select({
          perjadinId: perjadinTeacher.perjadinId,
          id: perjadinTeacher.id,
          name: perjadinTeacher.name,
        })
        .from(perjadinTeacher)
        .where(inArray(perjadinTeacher.perjadinId, tripIds))
        .orderBy(asc(perjadinTeacher.name)),
      // The record-only Pimpinan (#181), joined to `person` for the display name, in name order.
      db
        .select({
          perjadinId: perjadinPimpinan.perjadinId,
          personId: perjadinPimpinan.personId,
          name: person.fullName,
        })
        .from(perjadinPimpinan)
        .innerJoin(person, eq(person.id, perjadinPimpinan.personId))
        .where(inArray(perjadinPimpinan.perjadinId, tripIds))
        .orderBy(asc(person.fullName)),
      // Every offline Session on these trips, with its School and the School's Province zone.
      // Cancelled ones are **included** — this is the trip's shape, the Schools it visited, not how
      // much teaching it delivered. Ordered by School name, then within a School by (held_on,
      // starts_at, id) for a total order.
      db
        .select({
          perjadinId: session.perjadinId,
          schoolId: session.schoolId,
          schoolName: school.name,
          kabupatenKota: school.kabupatenKota,
          timeZone: province.timeZone,
          sessionId: session.id,
          heldOn: session.heldOn,
          startsAt: session.startsAt,
          status: session.status,
        })
        .from(session)
        .innerJoin(school, eq(school.id, session.schoolId))
        .innerJoin(province, eq(province.code, school.provinceCode))
        .where(and(inArray(session.perjadinId, tripIds), eq(session.mode, "offline")))
        .orderBy(asc(school.name), asc(session.heldOn), asc(session.startsAt), asc(session.id)),
      // "Diajar oleh" on the trips' live offline Sessions (#447): which Narasumber taught at which
      // School. A cancelled Session's team is left out, so whoever taught only there is unassigned.
      db
        .selectDistinct({
          perjadinId: session.perjadinId,
          schoolId: session.schoolId,
          perjadinTeacherId: sessionTeachingTeam.perjadinTeacherId,
        })
        .from(sessionTeachingTeam)
        .innerJoin(session, eq(session.id, sessionTeachingTeam.sessionId))
        .where(
          and(
            inArray(session.perjadinId, tripIds),
            eq(session.mode, "offline"),
            ne(session.status, "cancelled"),
          ),
        ),
      // Every trip's checklist in one batched read (ADR-0045): the card's Persiapan dialog toggles
      // the boxes, so it needs each item whole, not a count.
      preparationChecklists(tripIds),
    ]);

  // Uang Perjalanan Terpakai keyed by trip; a trip absent from the grouped sum spent nothing.
  const spentByTrip = new Map(spentRows.map((row) => [row.perjadinId, row.spentIdr]));

  const staffByTrip = new Map<string, MyPerjadinStaff[]>();
  const pengajarByTrip = new Map<string, MyPerjadinPengajar[]>();
  const pimpinanByTrip = new Map<string, MyPerjadinPimpinan[]>();
  for (const row of staffRows) {
    const list = staffByTrip.get(row.perjadinId) ?? [];
    // `isPic` off the trip's own PIC id — the row is already ordered by name, so no re-sort.
    list.push({ personId: row.personId, fullName: row.fullName, isPic: false });
    staffByTrip.set(row.perjadinId, list);
  }
  for (const row of pengajarRows) {
    const list = pengajarByTrip.get(row.perjadinId) ?? [];
    list.push({ id: row.id, name: row.name });
    pengajarByTrip.set(row.perjadinId, list);
  }
  for (const row of pimpinanRows) {
    const list = pimpinanByTrip.get(row.perjadinId) ?? [];
    list.push({ personId: row.personId, name: row.name });
    pimpinanByTrip.set(row.perjadinId, list);
  }

  // Sessions grouped by (trip, School), preserving the query's School-then-Session order. A trip's
  // Schools appear in first-seen order, which is School-name order since the rows are sorted so.
  const schoolsByTrip = new Map<string, MyPerjadinSchool[]>();
  const schoolByTripAndId = new Map<string, MyPerjadinSchool>();
  for (const row of sessionRows) {
    // Offline Sessions always carry a `perjadin_id` (`session_offline_iff_perjadin`), so the column
    // is non-null here; the narrowing satisfies the nullable column type.
    if (row.perjadinId === null) continue;
    const key = `${row.perjadinId}:${row.schoolId}`;
    let schoolNode = schoolByTripAndId.get(key);
    if (!schoolNode) {
      schoolNode = {
        schoolId: row.schoolId,
        name: row.schoolName,
        kabupatenKota: row.kabupatenKota,
        timeZone: row.timeZone,
        sessions: [],
      };
      schoolByTripAndId.set(key, schoolNode);
      const list = schoolsByTrip.get(row.perjadinId) ?? [];
      list.push(schoolNode);
      schoolsByTrip.set(row.perjadinId, list);
    }
    schoolNode.sessions.push({
      sessionId: row.sessionId,
      heldOn: row.heldOn,
      startsAt: row.startsAt,
      status: row.status,
    });
  }

  const taughtByTrip = new Map<string, { schoolId: string; perjadinTeacherId: string }[]>();
  for (const row of taughtRows) {
    if (row.perjadinId === null) continue;
    const list = taughtByTrip.get(row.perjadinId) ?? [];
    list.push(row);
    taughtByTrip.set(row.perjadinId, list);
  }

  const built = rows.map(({ isCurrent, ...trip }) => {
    const staff = (staffByTrip.get(trip.id) ?? []).map((member) => ({
      ...member,
      isPic: member.personId === trip.picPersonId,
    }));
    const pengajar = pengajarByTrip.get(trip.id) ?? [];
    const pimpinan = pimpinanByTrip.get(trip.id) ?? [];
    const schools = schoolsByTrip.get(trip.id) ?? [];
    const card: MyPerjadinTrip = {
      ...trip,
      spentIdr: spentByTrip.get(trip.id) ?? 0,
      preparation: checklists.get(trip.id) ?? [],
      anggota: {
        staff,
        pengajar,
        pengajarBySchool: groupPengajarBySchool(schools, pengajar, taughtByTrip.get(trip.id) ?? []),
        pimpinan,
        anggotaTotal: staff.length + pengajar.length + pimpinan.length,
      },
      schools,
    };
    return { isCurrent, trip: card };
  });

  // The rows are already in section order, so splitting keeps each section's order.
  return {
    current: built.filter((entry) => entry.isCurrent).map((entry) => entry.trip),
    previous: built.filter((entry) => !entry.isCurrent).map((entry) => entry.trip),
  };
}

/**
 * One trip's `MyPerjadinPengajarBySchool`, from what `perjadinOf` already holds: its Schools with every
 * Session, its Narasumber A–Z, and who taught at which School on a live Session. Filtering the A–Z
 * list, rather than collecting from `taught`, keeps each list in that order and each name once.
 */
function groupPengajarBySchool(
  schools: MyPerjadinSchool[],
  pengajar: MyPerjadinPengajar[],
  taught: { schoolId: string; perjadinTeacherId: string }[],
): MyPerjadinPengajarBySchool {
  const live = schools.flatMap((school) => {
    const sessions = school.sessions.filter((each) => each.status !== "cancelled");
    if (sessions.length === 0) return [];
    // `heldOn` is `YYYY-MM-DD` and `startsAt` `HH:MM:SS`, so the joined strings order as the
    // values do.
    const earliest = sessions.map((each) => `${each.heldOn} ${each.startsAt}`).sort()[0]!;
    return [{ school, earliest }];
  });
  // The sort is stable and `schools` arrive in name order, so a tie stays by name.
  live.sort((a, b) => a.earliest.localeCompare(b.earliest));

  const assigned = new Set(taught.map((row) => row.perjadinTeacherId));
  return {
    bySchool: live.map(({ school }) => {
      const here = new Set(
        taught
          .filter((row) => row.schoolId === school.schoolId)
          .map((row) => row.perjadinTeacherId),
      );
      return {
        schoolId: school.schoolId,
        name: school.name,
        pengajar: pengajar.filter((person) => here.has(person.id)),
      };
    }),
    unassigned: pengajar.filter((person) => !assigned.has(person.id)),
  };
}
