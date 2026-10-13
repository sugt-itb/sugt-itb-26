import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  applyRemainingMigrations,
  scratchDatabaseThrough,
  withClient,
} from "./support/scratch-database";

/**
 * **Migration 0053 drops `perjadin.report_filed_at`** (#489, ADR-0055): the Laporan is neither
 * filed nor due. Seeded as 0052 stood — a filed trip and its `report_filed` Log entry — then
 * migrated: the trip survives without the column, and the Log keeps the filing and still allows the
 * action, so a past entry is never rewritten. The seed skips foreign keys
 * (`session_replication_role = replica`).
 */

const scratch = scratchDatabaseThrough("0052_perjadin_pendamping_support");

const RINA = randomUUID();
const TRIP = randomUUID();

describe("0053_drop_report_filed_at", () => {
  it("drops the column from a filed trip, keeping the trip and its report_filed entry", async () => {
    await withClient(scratch.url, (sql) =>
      sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`
          insert into perjadin (id, sub_cluster_id, starts_on, ends_on, report_filed_at, pic_person_id)
          values
            (${TRIP}, ${randomUUID()}, '2026-09-01', '2026-09-03', '2026-09-05 03:00:00+00',
              ${RINA})`;
        await tx`
          insert into activity_log (actor_person_id, actor_email, perjadin_id, action, details, search_text)
          values
            (${RINA}, 'rina@ditsama.itb.ac.id', ${TRIP}, 'report_filed',
              '{"transactionCount": 3, "totalIdr": 4500000}', 'laporan dikirim · 3 transaksi')`;
      }),
    );

    await applyRemainingMigrations(scratch.url);

    await withClient(scratch.url, async (sql) => {
      const columns = await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
        where table_name = 'perjadin' and column_name = 'report_filed_at'`;
      expect(columns).toEqual([]);

      await expect(sql`select id, ends_on::text from perjadin`).resolves.toEqual([
        { id: TRIP, ends_on: "2026-09-03" },
      ]);

      await expect(sql`select action, details from activity_log`).resolves.toEqual([
        { action: "report_filed", details: { transactionCount: 3, totalIdr: 4_500_000 } },
      ]);

      // The Log's CHECK is untouched: `report_filed` is still a valid value for old rows.
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`
          insert into activity_log (actor_person_id, actor_email, perjadin_id, action, details, search_text)
          values (${RINA}, 'rina@ditsama.itb.ac.id', ${TRIP}, 'report_filed',
            '{"transactionCount": 0, "totalIdr": 0}', '')`;
      });
    });
  });
});
