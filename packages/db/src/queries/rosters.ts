import type { TimeZone } from "@sugt/domain";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { person } from "../schema/people";
import { province, school } from "../schema/reference";

/**
 * The two lists every planning form picks from, and the Schools a Coverage selection names.
 *
 * **This helper was earned by the second module wanting it.** Jadwalkan Sesi daring picked the
 * two lists inline first; Rencanakan Perjadin ([#29](https://github.com/mafiefa02/sugt/issues/29))
 * is the second module to want them, and the convention beside `@sugt/db` is that the second is
 * what earns a shared helper — so they moved down here.
 *
 * **Nothing here is re-exported from `./index.ts`.** Convention 3 says nothing is exported
 * that a surface renders, and no surface renders these — they are shared SQL beneath two
 * modules, which is exactly the case that convention makes room for.
 */

/** Somebody a picker can name. Both planning surfaces render the same two fields. */
export type RosterPerson = {
  id: string;
  fullName: string;
};

/** A School a Coverage selection named, as a form row shows it. */
export type SelectedSchool = {
  id: string;
  name: string;
  /** Shown so a reader can confirm this is the right School, not a namesake. */
  kabupatenKota: string;
  /**
   * The School's Time Zone, from its Province (`province.time_zone`). Carried so a create/plan
   * form can label its wall-clock time input with the zone the moment the School is picked
   * ([#165](https://github.com/mafiefa02/sugt/issues/165)); a School always sits in one Province,
   * so it is never absent.
   */
  timeZone: TimeZone;
};

/**
 * The Schools a selection names, in **name order rather than selection order**.
 *
 * Coverage hands over a `Set`, which carries no order worth preserving, and a stable one is
 * what lets a reader check the list.
 *
 * **A School id matching nothing is dropped rather than refused.** A hand-edited URL is
 * reachable, and this is the honest response to one: the form lists every School it is about
 * to write a Session for, by name, so a dropped id is visible as an absence rather than
 * hidden behind an error page.
 */
export async function selectedSchools(schoolIds: string[]): Promise<SelectedSchool[]> {
  // `inArray` on an empty list is a query with no possible answer, so it is skipped rather
  // than sent.
  if (schoolIds.length === 0) return [];

  return db
    .select({
      id: school.id,
      name: school.name,
      kabupatenKota: school.kabupatenKota,
      timeZone: province.timeZone,
    })
    .from(school)
    .innerJoin(province, eq(province.code, school.provinceCode))
    .where(inArray(school.id, schoolIds))
    .orderBy(asc(school.name));
}

/**
 * Everybody a planning form may name, by role.
 *
 * **Two rosters now** (#181): `staff` is the active `Staff` People, `pimpinan` the active `Pimpinan`
 * People — a second signed-in role since #179 (ADR-0025). The two are **disjoint by role**: a Person
 * holds exactly one, so no id appears in both. Each filters on its role explicitly rather than
 * assuming every active Person is Staff — the pre-#179 shape did the latter and would now wrongly
 * fold Pimpinan into `staff`. The teaching team a planning form once picked from People is
 * trip-scoped / session-scoped free-text names now (ADR-0020, ADR-0022), typed on the form rather
 * than chosen from a roster.
 *
 * **Revoked People are not here.** `person.active = false` is the whole revocation
 * mechanism ([ADR-0013](../../../../docs/adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md)),
 * and naming a revoked Person commits them to a trip that has not happened. Historical references
 * to them stay intact; a picker is about what happens next.
 */
export async function activeRosters(): Promise<{
  staff: RosterPerson[];
  pimpinan: RosterPerson[];
}> {
  const [staff, pimpinan] = await Promise.all([
    db
      .select({ id: person.id, fullName: person.fullName })
      .from(person)
      .where(and(eq(person.active, true), eq(person.role, "Staff")))
      .orderBy(asc(person.fullName)),
    db
      .select({ id: person.id, fullName: person.fullName })
      .from(person)
      .where(and(eq(person.active, true), eq(person.role, "Pimpinan")))
      .orderBy(asc(person.fullName)),
  ]);

  return { staff, pimpinan };
}

/**
 * Which of these Person ids are **not** an active Pimpinan — the offending set both Pimpinan writes
 * refuse before touching `perjadin_pimpinan`.
 *
 * **One rule, one place.** `planPerjadin` and `setPerjadinPimpinan` each need "is this id an active
 * Person of role Pimpinan?" (#181); the second module to want it is what earns a shared helper, the
 * same reasoning `activeRosters` sits here for. The composite `perjadin_pimpinan_is_pimpinan` FK is
 * the database backstop — this names a stray id up front rather than surfacing a raw violation.
 *
 * Takes the ids to check (the caller dedupes for its own insert) and returns those with no matching
 * active-Pimpinan row, in input order. An empty input is a query with no answer, so it is skipped.
 */
export async function unknownPimpinanIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];

  const valid = new Set(
    (
      await db
        .select({ id: person.id })
        .from(person)
        .where(and(inArray(person.id, ids), eq(person.active, true), eq(person.role, "Pimpinan")))
    ).map((row) => row.id),
  );

  return ids.filter((id) => !valid.has(id));
}
