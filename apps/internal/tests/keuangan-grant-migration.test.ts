import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  applyRemainingMigrations,
  scratchDatabaseThrough,
  withClient,
} from "./support/scratch-database";

/**
 * **The Keuangan Grant comes back, and the Block B source gets its table** (#549), in one migration.
 * It widens `person_grant_grant_check` and creates `keuangan_source`, and deletes nothing: the
 * holders #533 removed are not restored, and every Grant held before it stays.
 */

const scratch = scratchDatabaseThrough("0058_footage_copy");

const ANI = randomUUID();
const BUDI = randomUUID();

const SIX = [
  "Administrator",
  "Daring Editor",
  "Dashboard Editor",
  "Dashboard Viewer",
  "Keuangan",
  "Perjadin Editor",
];

async function grantsOf(personId: string) {
  const rows = await withClient(
    scratch.url,
    (sql) => sql<{ grant: string }[]>`
      select "grant" from person_grant where person_id = ${personId} order by "grant"`,
  );
  return rows.map((row) => row.grant);
}

async function insertGrant(personId: string, grant: string) {
  await withClient(
    scratch.url,
    (sql) => sql`insert into person_grant (person_id, "grant") values (${personId}, ${grant})`,
  );
}

async function insertSource(singleton: boolean, sheetId: string) {
  await withClient(
    scratch.url,
    (sql) => sql`
      insert into keuangan_source (singleton, url, sheet_id, gid, set_by_person_id)
      values (${singleton}, ${`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=1`},
              ${sheetId}, '1', ${ANI})`,
  );
}

describe("the Keuangan Grant and source migration", () => {
  it("leaves every Grant held before it, and accepts all six Grants and nothing else", async () => {
    await withClient(
      scratch.url,
      (sql) => sql`
        insert into person (id, full_name, email, role) values
          (${ANI}, 'Ani', 'ani@itb.ac.id', 'Staff'),
          (${BUDI}, 'Budi', 'budi@itb.ac.id', 'Staff')`,
    );
    for (const grant of ["Administrator", "Daring Editor"]) await insertGrant(ANI, grant);
    await insertGrant(BUDI, "Perjadin Editor");

    await applyRemainingMigrations(scratch.url);

    await expect(grantsOf(ANI)).resolves.toEqual(["Administrator", "Daring Editor"]);
    await expect(grantsOf(BUDI)).resolves.toEqual(["Perjadin Editor"]);

    for (const grant of ["Dashboard Editor", "Dashboard Viewer", "Keuangan", "Perjadin Editor"]) {
      await insertGrant(ANI, grant);
    }
    await expect(grantsOf(ANI)).resolves.toEqual(SIX);

    await expect(insertGrant(BUDI, "Bendahara")).rejects.toMatchObject({
      constraint_name: "person_grant_grant_check",
    });
  });

  it("holds at most one Block B source", async () => {
    await withClient(
      scratch.url,
      (sql) => sql`
        insert into person (id, full_name, email, role)
        values (${ANI}, 'Ani', 'ani@itb.ac.id', 'Staff')`,
    );
    await applyRemainingMigrations(scratch.url);

    await insertSource(true, "made-up-one");

    await expect(insertSource(true, "made-up-two")).rejects.toMatchObject({
      constraint_name: "keuangan_source_pkey",
    });
    await expect(insertSource(false, "made-up-two")).rejects.toMatchObject({
      constraint_name: "keuangan_source_singleton_check",
    });
    const rows = await withClient(
      scratch.url,
      (sql) => sql<{ sheet_id: string }[]>`select sheet_id from keuangan_source`,
    );
    expect(rows).toEqual([{ sheet_id: "made-up-one" }]);
  });
});
