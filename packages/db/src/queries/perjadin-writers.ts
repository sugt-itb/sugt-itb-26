import { and, asc, eq, or, sql } from "drizzle-orm";

import { db } from "../client";
import { person, personGrant } from "../schema/people";
import { groupMember } from "../schema/travel";
import type { Person } from "./caller";

/**
 * **Who may write a Perjadin, as a list of sign-in emails** (#552) — the people `perjadinWriterSql`
 * in `./staff-only.ts` lets write the trip (ADR-0048), read the other way round: not "may this
 * Person write", but "everyone who may". It is what the trip's Foto & Video folder in the company
 * Google Drive is shared with for editing, so the folder's editors are the trip's writers.
 *
 * Three ways in, each for an **active Staff** Person only:
 * - a member of the trip's Group (the PIC included);
 * - the **Perjadin Editor** Grant;
 * - the **Administrator** Grant, which implies every other.
 *
 * A Pimpinan is never in a Group and never holds a Grant, and a revoked Person (`active = false`) is
 * left out. Lower-cased, de-duplicated and sorted, so a caller can compare it with what Drive lists.
 *
 * **Open to any signed-in Person**: sharing the folder is the app's housekeeping on the company
 * account, run on whoever's click (a Pimpinan's included), and an email list of Staff is not a write.
 * Kept in its own module so the follow-up ticket — re-sharing the moment a Group, Grant or Person
 * changes — calls the same read.
 */
export async function perjadinWriterEmails(_caller: Person, perjadinId: string): Promise<string[]> {
  const inGroup = sql<boolean>`exists (
    select 1 from ${groupMember} gm
    where gm.perjadin_id::text = ${perjadinId} and gm.person_id = ${person.id}
  )`;
  const holdsWriterGrant = sql<boolean>`exists (
    select 1 from ${personGrant} pg
    where pg.person_id = ${person.id}
      and pg."grant" in ('Perjadin Editor', 'Administrator')
  )`;

  const rows = await db
    .selectDistinct({ email: sql<string>`lower(${person.email})` })
    .from(person)
    .where(and(eq(person.active, true), eq(person.role, "Staff"), or(inGroup, holdsWriterGrant)))
    .orderBy(asc(sql`lower(${person.email})`));
  return rows.map((row) => row.email);
}
