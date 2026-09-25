import { desc, eq, sql } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { person } from "../schema/people";
import { school } from "../schema/reference";
import { groupMember, perjadin, perjadinTeacher } from "../schema/travel";
import type { Person } from "./caller";
import { PREPARATION_FIXED_KEYS, preparationDoneSubquery } from "./preparation-checklist";

/**
 * **The Perjadin list** — every trip, open to anyone signed in.
 *
 * A separate module from the detail, the way `./school-directory.ts` is separate from
 * `./school-detail.ts`: convention 3 is one module per surface's payload, and a list and a
 * detail are two surfaces that happen to be about the same noun.
 *
 * No money here and no role check, for the reason `./perjadin-detail.ts` gives at length:
 * the Advance is `./perjadin-report.ts`'s, behind the Staff-only choke point.
 */

/** One trip, as the list shows it. */
export type DirectoryPerjadin = {
  id: string;
  destination: string;
  startsOn: string;
  endsOn: string;
  /** How many Schools the Group teaches at. The trip's size, in the only unit that matters. */
  schoolCount: number;
  picFullName: string;
  /**
   * The Preparation Checklist pill's `x` and `N` ([#114](https://github.com/mafiefa02/sugt/issues/114)).
   * `preparationTotal` is the constant **7** — the flat fixed item set (amendment to ADR-0018), with
   * no per-member derivation; `preparationDone` counts the present ticks whose key is one of the
   * seven fixed items. An orphan `dosen:` tick from the old model matches none, so the pill never
   * reads past `N`.
   */
  preparationDone: number;
  preparationTotal: number;
  /**
   * The three name axes the `/perjadin` search matches on beyond `destination` and `picFullName`
   * (#334) — the trip-scoped Teaching-Team names, the Group (Kelompok Perjalanan) member names, and
   * the names of the Schools it visits. All three are one-to-many, so each is returned as an array
   * and populated by a correlated aggregate subquery rather than a join (see `pengajarNames` below).
   * Search-only: nothing on the list renders them, so a trip with none carries an empty array.
   */
  pengajarNames: string[];
  groupMemberNames: string[];
  schoolNames: string[];
};

/**
 * The three name arrays the `/perjadin` search reads (#334), each a **correlated aggregate
 * subquery** — the shape `preparationDoneSubquery` uses, kept off the outer `session` left join so it
 * stays a scalar and never fans the row out. A plain join would multiply the row and break the
 * existing `count(distinct session.school_id)` and the `groupBy`; these open their own scans instead.
 * `coalesce(…, '{}'::text[])` makes a trip with none an empty array rather than `null`, mirroring
 * `roster.ts`'s `grantsHeld`. Ordered by name so the arrays are stable read to read; `schoolNames`
 * is `distinct` because a School is taught over several Sessions on one trip. Correlated on
 * `perjadin.id`, which is in the outer `groupBy`, so each is valid in the grouped select.
 */
const pengajarNames = sql<string[]>`coalesce(
  (
    select array_agg(pt.name order by pt.name)
    from ${perjadinTeacher} pt
    where pt.perjadin_id = ${perjadin.id}
  ),
  '{}'::text[]
)`;

const groupMemberNames = sql<string[]>`coalesce(
  (
    select array_agg(gp.full_name order by gp.full_name)
    from ${groupMember} gm
    join ${person} gp on gp.id = gm.person_id
    where gm.perjadin_id = ${perjadin.id}
  ),
  '{}'::text[]
)`;

const schoolNames = sql<string[]>`coalesce(
  (
    select array_agg(distinct sch.name order by sch.name)
    from ${session} s
    join ${school} sch on sch.id = s.school_id
    where s.perjadin_id = ${perjadin.id}
  ),
  '{}'::text[]
)`;

/**
 * Every Perjadin, newest trip first.
 *
 * Ordered by `starts_on` rather than by `created_at`: a trip is remembered by when it
 * happens, and the two differ whenever a trip is planned out of order. `id` breaks the tie
 * so the order is total.
 */
export async function perjadinDirectory(_caller: Person): Promise<DirectoryPerjadin[]> {
  return db
    .select({
      id: perjadin.id,
      destination: perjadin.destination,
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      picFullName: person.fullName,
      // **`distinct`, and on the School rather than the Session.** Cancelled Sessions count
      // here, unlike everywhere else — this is how big the trip is, not how much teaching it
      // delivered — and both partial unique indexes are predicated on `status <> 'cancelled'`
      // precisely so a cancelled Session and the one that replaced it coexist on one trip.
      // Counting Sessions would report a two-School trip as three the first time that happens.
      schoolCount: sql<number>`count(distinct ${session.schoolId})`.mapWith(Number),
      // The pill's `N` (the flat fixed seven, amendment to ADR-0018) and its `x` — the shared
      // correlated subquery in `./preparation-checklist.ts`, correlated on this query's `perjadin.id`
      // and kept off the `session` left join above so it never fans out. `myUpcomingPerjadin` builds
      // the same pill from the same helper, so the fragment has one home (convention 3).
      preparationTotal: sql<number>`${PREPARATION_FIXED_KEYS.length}`.mapWith(Number),
      preparationDone: preparationDoneSubquery(perjadin.id),
      pengajarNames,
      groupMemberNames,
      schoolNames,
    })
    .from(perjadin)
    .innerJoin(person, eq(person.id, perjadin.picPersonId))
    .leftJoin(session, eq(session.perjadinId, perjadin.id))
    .groupBy(perjadin.id, person.fullName)
    .orderBy(desc(perjadin.startsOn), desc(perjadin.id));
}
