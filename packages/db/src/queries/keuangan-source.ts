import { eq, sql } from "drizzle-orm";

import { db } from "../client";
import { keuanganSource } from "../schema/keuangan";
import { person } from "../schema/people";
import type { Person } from "./caller";
import { requireGrant, requireKeuanganReader } from "./staff-only";

/**
 * **The Block B source: which spreadsheet tab `/keuangan` reads** (ADR-0064, #549). One row or none
 * (`keuangan_source`). Split the way `driveConnectionCard` and `driveCredentials` are, by who may see
 * what: the Administrator's `/pengaturan` card sees everything, and the page's readers see only what
 * the read needs. The URL as pasted and who set it never leave the card.
 */

/** What `/pengaturan`'s card shows an Administrator. `null` is "not set yet". */
export type KeuanganSourceCard = {
  url: string;
  sheetId: string;
  gid: string;
  updatedAt: Date;
  setByName: string;
};

/** The source for an Administrator's card. Refuses anyone else with `NotGrantedError`. */
export async function keuanganSourceCard(caller: Person): Promise<KeuanganSourceCard | null> {
  requireGrant(caller, "Administrator");

  const [row] = await db
    .select({
      url: keuanganSource.url,
      sheetId: keuanganSource.sheetId,
      gid: keuanganSource.gid,
      updatedAt: keuanganSource.updatedAt,
      setByName: person.fullName,
    })
    .from(keuanganSource)
    .innerJoin(person, eq(person.id, keuanganSource.setByPersonId));
  return row ?? null;
}

/** What the page reads with: where the tab is, and when it was set — a copy is a snapshot. */
export type KeuanganSourceForRead = { sheetId: string; gid: string; updatedAt: Date };

/**
 * The source for `/keuangan`'s read, for anyone `canViewKeuangan` admits. Never the URL or the setter.
 * Refuses anyone else with `NotGrantedError`, the same 403 a missed page check would answer.
 */
export async function keuanganSourceForRead(caller: Person): Promise<KeuanganSourceForRead | null> {
  requireKeuanganReader(caller);

  const [row] = await db
    .select({
      sheetId: keuanganSource.sheetId,
      gid: keuanganSource.gid,
      updatedAt: keuanganSource.updatedAt,
    })
    .from(keuanganSource);
  return row ?? null;
}

/**
 * Set the source: the first one, or a fresh copy **replacing** the last, never a second row. The
 * caller is recorded as setter and `updated_at` is now. Administrator only, refused **here** rather
 * than trusted to the page, so a missed check on the action cannot write it. The caller checks that
 * the sheet reads and parses before calling (#571); this stores what it is given.
 */
export async function setKeuanganSource(
  caller: Person,
  source: { url: string; sheetId: string; gid: string },
): Promise<void> {
  requireGrant(caller, "Administrator");

  const values = {
    url: source.url,
    sheetId: source.sheetId,
    gid: source.gid,
    updatedAt: sql`now()`,
    setByPersonId: caller.id,
  };
  await db
    .insert(keuanganSource)
    .values(values)
    .onConflictDoUpdate({ target: keuanganSource.singleton, set: values });
}
