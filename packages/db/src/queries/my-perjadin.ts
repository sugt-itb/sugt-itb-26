import type { SessionStatus, TimeZone, TransportMode } from "@sugt/domain";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { person } from "../schema/people";
import { province, school } from "../schema/reference";
import {
  groupMember,
  perjadin,
  perjadinPimpinan,
  perjadinPreparationItem,
  perjadinTeacher,
  transaction,
} from "../schema/travel";
import { advanceDrawdownCategoryList } from "./advance-drawdown";
import type { Person } from "./caller";
import { todayInDeadlineZone } from "./deadline";
import {
  derivePreparationChecklist,
  type PreparationItem,
  type PreparationTick,
} from "./preparation-checklist";

/**
 * **Perjalanan Saya** — the caller's own upcoming trips, for the Staff home strip (#197).
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
 * personal work list — "how much of my Advance is left" is the point of it — and money reads are
 * open now (ADR-0026), so `advanceIdr`/`drawnDownIdr` sit here directly rather than behind a second call.
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
 * One upcoming trip the caller is on, everything the home strip renders.
 *
 * The six leg fields are straight off `perjadin` and all nullable — a trip planned before the
 * logistics columns existed (#106) carries none. `preparation` is the flat fixed seven (amendment
 * to ADR-0018), each item carrying its tick state — the same `derivePreparationChecklist` the detail
 * read runs. It carries the whole checklist rather than a bare `x`/`N` because the card's pill *and*
 * its Persiapan dialog read from one payload: the pill is `preparation.filter(i => i.checked).length`
 * out of `preparation.length` (always seven), and the dialog toggles the very items shown here.
 */
export type MyUpcomingPerjadin = {
  id: string;
  destination: string;
  startsOn: string;
  endsOn: string;
  picPersonId: string;
  picFullName: string;
  /** Fixed at planning and transferred before departure, so never null and never absent. */
  advanceIdr: number;
  /**
   * The **travel-float draw-down** for this trip: the sum of only the transactions whose category is
   * an `ADVANCE_DRAWDOWN_CATEGORIES` member (ADR-0029), zero when none has been entered. The UI
   * derives Tersisa as `advanceIdr - drawnDownIdr`, the same math `perjadinAcquittal.remainderIdr`
   * uses — a test pins the two equal so the two screens never show two answers. It is summed in SQL
   * here (this list renders no line items) with a `category in (…)` filter kept in step with the
   * domain constant, where the acquittal reduces its loaded rows through `sumAdvanceDrawdownIdr`.
   */
  drawnDownIdr: number;
  /** Departure from Bandung's date and time; null when this trip predates the logistics columns. */
  departureAt: string | null;
  departureZone: TimeZone | null;
  departureMode: TransportMode | null;
  /** Return; null when this trip predates the logistics columns. */
  returnAt: string | null;
  returnZone: TimeZone | null;
  returnMode: TransportMode | null;
  /** The fixed seven, each with its current tick state — the pill's `x`/`N` and the dialog's boxes. */
  preparation: PreparationItem[];
  /**
   * Who is on the trip, in three lists the way `docs/data-model.md` splits them: the Staff Group,
   * the trip-scoped teacher names, and the record-only Pimpinan. `anggotaTotal` is their combined
   * head count, summed here so the strip does not re-add three lengths at the render site.
   */
  anggota: {
    staff: MyPerjadinStaff[];
    pengajar: MyPerjadinPengajar[];
    pimpinan: MyPerjadinPimpinan[];
    anggotaTotal: number;
  };
  /** The Schools this trip teaches at, each with its offline Sessions (cancelled ones included). */
  schools: MyPerjadinSchool[];
};

/**
 * The caller's own upcoming trips, soonest first.
 *
 * Shaped like `perjadinAcquittal`/`perjadinDetail`: the base trip rows come back first — filtered to
 * the caller's memberships and to trips not yet over, sorted for a total order — then each hanging
 * list is one batched select keyed by `inArray(tripIds)` and stitched on with a Map, rather than one
 * join that would multiply each list by the others'. When the caller is on no upcoming trip the base
 * query returns nothing and the extra round trips are skipped entirely.
 */
export async function myUpcomingPerjadin(caller: Person): Promise<MyUpcomingPerjadin[]> {
  // The base rows: every trip the caller is a `group_member` of that is not yet over. The
  // `group_member` inner join both filters (only the caller's trips) and cannot fan out — its
  // primary key is `(perjadin_id, person_id)`, so at most one row matches for a given caller.
  const trips = await db
    .select({
      id: perjadin.id,
      destination: perjadin.destination,
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      picPersonId: perjadin.picPersonId,
      picFullName: person.fullName,
      advanceIdr: perjadin.advanceIdr,
      departureAt: perjadin.departureAt,
      departureZone: perjadin.departureZone,
      departureMode: perjadin.departureMode,
      returnAt: perjadin.returnAt,
      returnZone: perjadin.returnZone,
      returnMode: perjadin.returnMode,
    })
    .from(perjadin)
    .innerJoin(
      groupMember,
      and(eq(groupMember.perjadinId, perjadin.id), eq(groupMember.personId, caller.id)),
    )
    .innerJoin(person, eq(person.id, perjadin.picPersonId))
    // Not yet over: `ends_on` on or after today, reckoned in the office's zone via the shared
    // `todayInDeadlineZone` fragment (`./deadline.ts`) — the same calendar the acquittal's
    // `daysRemaining` counts in, not the database session's default zone.
    .where(sql`${perjadin.endsOn} >= ${todayInDeadlineZone}`)
    // A trip is remembered by when it happens; `id` breaks the tie so the order is total.
    .orderBy(asc(perjadin.startsOn), asc(perjadin.id));

  if (trips.length === 0) return [];

  const tripIds = trips.map((trip) => trip.id);

  // The six hanging lists, gathered concurrently and each scoped to just these trips.
  const [drawnDownRows, staffRows, pengajarRows, pimpinanRows, sessionRows, preparationRows] =
    await Promise.all([
      // Travel-float draw-down per trip (ADR-0029): `sum(amount_idr) filter (where category in …)`
      // over only `ADVANCE_DRAWDOWN_CATEGORIES`, grouped by `perjadin_id`. A trip with no drawdown
      // spend (or none at all) is absent or sums to 0 and defaults to 0 below. The `in (…)` list is
      // built from the domain constant so it cannot drift; the acquittal reduces its loaded rows
      // through `sumAdvanceDrawdownIdr` for the identical rule, and a test pins the UI's
      // `advanceIdr - drawnDownIdr` equal to the acquittal's `remainderIdr`.
      db
        .select({
          perjadinId: transaction.perjadinId,
          drawnDownIdr:
            sql<number>`coalesce(sum(${transaction.amountIdr}) filter (where ${transaction.category} in (${advanceDrawdownCategoryList()})), 0)`.mapWith(
              Number,
            ),
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
      // Every fixed-item tick on these trips. Not a count like `perjadinDirectory`'s pill: the card's
      // Persiapan dialog toggles the boxes, so it needs the whole tick per item (who and when), which
      // `derivePreparationChecklist` folds into the fixed seven below — the same derivation the detail
      // read runs. A `dosen:` orphan the old model left behind matches no fixed key, so it drops out.
      db
        .select({
          perjadinId: perjadinPreparationItem.perjadinId,
          itemKey: perjadinPreparationItem.itemKey,
          checkedBy: perjadinPreparationItem.checkedBy,
          checkedAt: perjadinPreparationItem.checkedAt,
        })
        .from(perjadinPreparationItem)
        .where(inArray(perjadinPreparationItem.perjadinId, tripIds)),
    ]);

  // Float draw-down keyed by trip; a trip absent from the grouped sum drew nothing down.
  const drawnDownByTrip = new Map(drawnDownRows.map((row) => [row.perjadinId, row.drawnDownIdr]));

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

  // Preparation ticks bucketed by trip; `derivePreparationChecklist` folds each bucket into the
  // fixed seven below. A trip absent here has no ticks, and `derivePreparationChecklist([])` gives
  // the same seven all unchecked — so the pill reads `0/7` rather than the trip dropping its pill.
  const preparationTicksByTrip = new Map<string, PreparationTick[]>();
  for (const row of preparationRows) {
    const list = preparationTicksByTrip.get(row.perjadinId) ?? [];
    list.push({ itemKey: row.itemKey, checkedBy: row.checkedBy, checkedAt: row.checkedAt });
    preparationTicksByTrip.set(row.perjadinId, list);
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

  return trips.map((trip) => {
    const staff = (staffByTrip.get(trip.id) ?? []).map((member) => ({
      ...member,
      isPic: member.personId === trip.picPersonId,
    }));
    const pengajar = pengajarByTrip.get(trip.id) ?? [];
    const pimpinan = pimpinanByTrip.get(trip.id) ?? [];
    return {
      ...trip,
      drawnDownIdr: drawnDownByTrip.get(trip.id) ?? 0,
      preparation: derivePreparationChecklist(preparationTicksByTrip.get(trip.id) ?? []),
      anggota: {
        staff,
        pengajar,
        pimpinan,
        anggotaTotal: staff.length + pengajar.length + pimpinan.length,
      },
      schools: schoolsByTrip.get(trip.id) ?? [],
    };
  });
}
