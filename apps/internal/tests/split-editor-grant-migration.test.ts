import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  applyRemainingMigrations,
  scratchDatabaseThrough,
  withClient,
} from "./support/scratch-database";

/**
 * **Migration 0051 splits Editor** (#469, ADR-0052). Seeded as 0050 stood — an Editor, an Editor who
 * is also an Administrator, and a Dashboard Viewer — then migrated: each Editor holds Perjadin Editor,
 * Daring Editor and Dashboard Editor instead, granted when the Editor was, nobody else changes, and
 * `Editor` is no longer a legal value.
 */

const scratch = scratchDatabaseThrough("0050_drop_advance_columns");

const EDITOR = randomUUID();
const ADMIN_EDITOR = randomUUID();
const VIEWER = randomUUID();
const GRANTED_AT = "2026-09-01 03:00:00+00";

describe("0051_split_editor_grant", () => {
  it("gives every Editor the three Editor Grants, keeps everyone else, and retires Editor", async () => {
    await withClient(scratch.url, (sql) =>
      sql.begin(async (tx) => {
        await tx`
          insert into person (id, full_name, email, role)
          values
            (${EDITOR}, 'Rina', 'rina@ditsama.itb.ac.id', 'Staff'),
            (${ADMIN_EDITOR}, 'Sari', 'sari@ditsama.itb.ac.id', 'Staff'),
            (${VIEWER}, 'Dewi', 'dewi@ditsama.itb.ac.id', 'Staff')`;
        await tx`
          insert into person_grant (person_id, "grant", granted_at)
          values
            (${EDITOR}, 'Editor', ${GRANTED_AT}),
            (${ADMIN_EDITOR}, 'Editor', ${GRANTED_AT}),
            (${ADMIN_EDITOR}, 'Administrator', ${GRANTED_AT}),
            (${VIEWER}, 'Dashboard Viewer', ${GRANTED_AT})`;
      }),
    );

    await applyRemainingMigrations(scratch.url);

    await withClient(scratch.url, async (sql) => {
      const rows = await sql<{ person_id: string; grant: string; granted_at: Date }[]>`
        select person_id, "grant", granted_at from person_grant order by person_id, "grant"`;
      const held = (personId: string) =>
        rows.filter((row) => row.person_id === personId).map((row) => row.grant);

      expect(held(EDITOR)).toEqual(["Daring Editor", "Dashboard Editor", "Perjadin Editor"]);
      expect(held(ADMIN_EDITOR)).toEqual([
        "Administrator",
        "Daring Editor",
        "Dashboard Editor",
        "Perjadin Editor",
      ]);
      expect(held(VIEWER)).toEqual(["Dashboard Viewer"]);
      for (const row of rows) {
        expect(row.granted_at.toISOString()).toBe("2026-09-01T03:00:00.000Z");
      }

      const refused = await sql`
        insert into person_grant (person_id, "grant") values (${EDITOR}, 'Editor')`.catch(
        (error: unknown) => error as { constraint_name?: string },
      );
      expect(refused).toMatchObject({ constraint_name: "person_grant_grant_check" });
    });
  });
});
