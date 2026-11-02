import { randomUUID } from "node:crypto";

import { canViewDashboard } from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { describe, expect, it } from "vitest";

import {
  applyRemainingMigrations,
  scratchDatabaseThrough,
  withClient,
} from "./support/scratch-database";

/**
 * **Migration 0056 retires the Keuangan Grant** (#533, ADR-0059). Every `'Keuangan'` row goes, including
 * the record of who held it, and the CHECK then refuses the value. Every other Grant a holder has stays,
 * and someone who held only this one becomes grant-less Staff, who land on `/pendamping`.
 */

const scratch = scratchDatabaseThrough("0055_drop_one_online_session_per_school_per_day");

const ONLY = randomUUID();
const BOTH = randomUUID();
const OTHER = randomUUID();

async function seed() {
  await withClient(
    scratch.url,
    (sql) => sql`
      insert into person (id, full_name, email, role) values
        (${ONLY}, 'Kiki', 'kiki@itb.ac.id', 'Staff'),
        (${BOTH}, 'Sari', 'sari@itb.ac.id', 'Staff'),
        (${OTHER}, 'Budi', 'budi@itb.ac.id', 'Staff')`,
  );
  await withClient(
    scratch.url,
    (sql) => sql`
      insert into person_grant (person_id, "grant") values
        (${ONLY}, 'Keuangan'),
        (${BOTH}, 'Keuangan'),
        (${BOTH}, 'Administrator'),
        (${BOTH}, 'Perjadin Editor'),
        (${BOTH}, 'Daring Editor'),
        (${BOTH}, 'Dashboard Editor'),
        (${BOTH}, 'Dashboard Viewer'),
        (${OTHER}, 'Perjadin Editor')`,
  );
}

async function grantsOf(personId: string) {
  const rows = await withClient(
    scratch.url,
    (sql) => sql<{ grant: string }[]>`
      select "grant" from person_grant where person_id = ${personId} order by "grant"`,
  );
  return rows.map((row) => row.grant);
}

describe("migration 0056", () => {
  it("deletes every Keuangan row and leaves every other Grant", async () => {
    await seed();

    await applyRemainingMigrations(scratch.url);

    await expect(grantsOf(ONLY)).resolves.toEqual([]);
    await expect(grantsOf(BOTH)).resolves.toEqual([
      "Administrator",
      "Daring Editor",
      "Dashboard Editor",
      "Dashboard Viewer",
      "Perjadin Editor",
    ]);
    await expect(grantsOf(OTHER)).resolves.toEqual(["Perjadin Editor"]);
  });

  it("leaves someone who held only Keuangan unable to read the Dashboard, so on /pendamping", async () => {
    await seed();

    await applyRemainingMigrations(scratch.url);

    const grants = (await grantsOf(ONLY)) as Grant[];
    expect(
      canViewDashboard({
        id: ONLY,
        fullName: "Kiki",
        email: "kiki@itb.ac.id",
        role: "Staff",
        grants,
      }),
    ).toBe(false);
  });

  it("makes the constraint refuse Keuangan and still accept the five Grants", async () => {
    await applyRemainingMigrations(scratch.url);
    await withClient(
      scratch.url,
      (sql) => sql`
        insert into person (id, full_name, email, role)
        values (${ONLY}, 'Kiki', 'kiki@itb.ac.id', 'Staff')`,
    );

    await expect(
      withClient(
        scratch.url,
        (sql) => sql`insert into person_grant (person_id, "grant") values (${ONLY}, 'Keuangan')`,
      ),
    ).rejects.toMatchObject({ constraint_name: "person_grant_grant_check" });

    for (const grant of [
      "Administrator",
      "Perjadin Editor",
      "Daring Editor",
      "Dashboard Editor",
      "Dashboard Viewer",
    ]) {
      await withClient(
        scratch.url,
        (sql) => sql`insert into person_grant (person_id, "grant") values (${ONLY}, ${grant})`,
      );
    }
    await expect(grantsOf(ONLY)).resolves.toHaveLength(5);
  });
});
