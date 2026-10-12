import { describe, expect, it } from "vitest";

import {
  applyRemainingMigrations,
  scratchDatabaseThrough,
  withClient,
} from "./support/scratch-database";

/**
 * **Migration 0052 adds Pendamping Support to evaluations already filed** (#481, ADR-0054). Every
 * row from before it was filed by a form that never asked, so each must survive with a null Rating
 * and a null Komentar — from every Role, a low-but-explained one included — and the rebuilt
 * elaboration CHECK, the rater CHECK and the concerns index must all accept them as they stand.
 *
 * A scratch database migrated to 0051 (`scratchDatabaseThrough`), seeded as `perjadin_evaluation`
 * stood then, and taken through the rest. The seed skips the foreign key
 * (`session_replication_role = replica`): the migration reads this one table.
 */

const scratch = scratchDatabaseThrough("0051_split_editor_grant");

describe("0052_perjadin_pendamping_support", () => {
  it("keeps every evaluation filed before it, each with no Pendamping Support", async () => {
    await withClient(scratch.url, async (sql) => {
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        for (const role of ["Narasumber", "Pendamping", "Pimpinan"]) {
          await tx`
            insert into perjadin_evaluation
              (perjadin_id, filed_by_role, filed_by_name, lodging, transport, meals, punctuality)
            values (gen_random_uuid(), ${role}, ${`Filer ${role}`}, 9, 9, 9, 9)`;
        }
        // A day trip with a low, explained Aspect — the shape the rebuilt CHECK and index meet.
        await tx`
          insert into perjadin_evaluation
            (perjadin_id, filed_by_role, filed_by_name, lodging, transport, meals, punctuality,
             punctuality_comment)
          values (gen_random_uuid(), 'Pimpinan', 'Bu Sri', null, 9, 9, 4, 'Jadwal molor')`;
      });
    });

    await applyRemainingMigrations(scratch.url);

    const rows = await withClient(
      scratch.url,
      (sql) => sql<
        { filed_by_name: string; pendamping_support: number | null; comment: string | null }[]
      >`
        select filed_by_name, pendamping_support, pendamping_support_comment as comment
          from perjadin_evaluation
         order by filed_by_name`,
    );
    expect(rows).toEqual([
      { filed_by_name: "Bu Sri", pendamping_support: null, comment: null },
      { filed_by_name: "Filer Narasumber", pendamping_support: null, comment: null },
      { filed_by_name: "Filer Pendamping", pendamping_support: null, comment: null },
      { filed_by_name: "Filer Pimpinan", pendamping_support: null, comment: null },
    ]);
  });
});
