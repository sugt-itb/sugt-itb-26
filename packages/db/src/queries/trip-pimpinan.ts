import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { db } from "../client";
import { session, sessionPimpinan } from "../schema/delivery";
import { person } from "../schema/people";
import { school } from "../schema/reference";

/**
 * **A trip's Pimpinan, derived from its Sessions** (#492, ADR-0056). A Pimpinan is recorded on the
 * Sessions they attended, never on the trip, so "who came on the trip" is everyone recorded on at
 * least one of its **non-cancelled** Sessions. A Pimpinan recorded only on a Session that was later
 * cancelled stays on that Session but is not on the trip.
 *
 * One read serves every place that names a trip's Pimpinan — the Perjadin page, the Laporan and its
 * CSV, the `/pendamping` card — so none of them can count a cancelled Session the others skip.
 */

/** One Pimpinan on a trip, with the Schools of the live Sessions they were recorded at. */
export type TripPimpinan = {
  personId: string;
  name: string;
  /** School names, deduped, in name order. Never empty: the Pimpinan is on the trip through one. */
  schools: string[];
};

/**
 * The derived Pimpinan of each trip named, keyed by trip id. Each trip's list is in name order,
 * then by id so two Pimpinan sharing a name keep one order. A trip with none is absent from the
 * map.
 */
export async function tripPimpinan(perjadinIds: string[]): Promise<Map<string, TripPimpinan[]>> {
  const byTrip = new Map<string, TripPimpinan[]>();
  if (perjadinIds.length === 0) return byTrip;

  const rows = await db
    .selectDistinct({
      perjadinId: session.perjadinId,
      personId: person.id,
      name: person.fullName,
      schoolName: school.name,
    })
    .from(sessionPimpinan)
    .innerJoin(session, eq(session.id, sessionPimpinan.sessionId))
    .innerJoin(person, eq(person.id, sessionPimpinan.personId))
    .innerJoin(school, eq(school.id, session.schoolId))
    .where(and(inArray(session.perjadinId, perjadinIds), ne(session.status, "cancelled")))
    .orderBy(asc(person.fullName), asc(person.id), asc(school.name));

  for (const row of rows) {
    // Only an offline Session carries a trip, and the filter above keeps those alone.
    const perjadinId = row.perjadinId!;
    const list = byTrip.get(perjadinId) ?? [];
    const last = list.at(-1);
    if (last?.personId === row.personId) {
      last.schools.push(row.schoolName);
    } else {
      list.push({ personId: row.personId, name: row.name, schools: [row.schoolName] });
    }
    byTrip.set(perjadinId, list);
  }
  return byTrip;
}
