import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  applyRemainingMigrations,
  scratchDatabaseThrough,
  withClient,
} from "./support/scratch-database";

/**
 * **Migration 0050 drops the Advance** (#465, ADR-0051): `advance_idr`, `returned_to_treasurer_idr`,
 * `returned_at` and their two CHECKs leave `perjadin`. Seeded as 0049 stood — a trip with an Advance
 * and a treasurer return set, and its `advance_set` / `advance_changed` Log entries — then migrated:
 * the trip survives without the columns, and the Log keeps its history and still allows both
 * actions. The seed skips foreign keys (`session_replication_role = replica`).
 */

const scratch = scratchDatabaseThrough("0049_hapus_bukti_and_transaksi");

const RINA = randomUUID();
const TRIP = randomUUID();

describe("0050_drop_advance_columns", () => {
  it("drops the three columns and their CHECKs, keeping the trip and the Log's history", async () => {
    await withClient(scratch.url, (sql) =>
      sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`
          insert into perjadin
            (id, sub_cluster_id, starts_on, ends_on, advance_idr, returned_to_treasurer_idr,
              returned_at, pic_person_id)
          values
            (${TRIP}, ${randomUUID()}, '2026-09-01', '2026-09-03', 15000000, 250000,
              '2026-09-05 03:00:00+00', ${RINA})`;
        await tx`
          insert into activity_log (actor_person_id, actor_email, perjadin_id, action, details, search_text)
          values
            (${RINA}, 'rina@ditsama.itb.ac.id', ${TRIP}, 'advance_set', '{"amountIdr": 12000000}',
              'uang perjalanan ditetapkan · rp12.000.000'),
            (${RINA}, 'rina@ditsama.itb.ac.id', ${TRIP}, 'advance_changed',
              '{"fromIdr": 12000000, "toIdr": 15000000}',
              'uang perjalanan diubah · rp12.000.000 → rp15.000.000')`;
      }),
    );

    await applyRemainingMigrations(scratch.url);

    await withClient(scratch.url, async (sql) => {
      const columns = await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
        where table_name = 'perjadin'
          and column_name in ('advance_idr', 'returned_to_treasurer_idr', 'returned_at')`;
      expect(columns).toEqual([]);

      const checks = await sql<{ conname: string }[]>`
        select conname from pg_constraint
        where conname in ('perjadin_advance_check', 'perjadin_returned_check')`;
      expect(checks).toEqual([]);

      await expect(sql`select id, starts_on::text from perjadin`).resolves.toEqual([
        { id: TRIP, starts_on: "2026-09-01" },
      ]);

      const logged = await sql<{ action: string; details: unknown }[]>`
        select action, details from activity_log order by action desc`;
      expect(logged).toEqual([
        { action: "advance_set", details: { amountIdr: 12_000_000 } },
        { action: "advance_changed", details: { fromIdr: 12_000_000, toIdr: 15_000_000 } },
      ]);

      // The Log's CHECK is untouched: both history actions are still valid values.
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`
          insert into activity_log (actor_person_id, actor_email, perjadin_id, action, details, search_text)
          values (${RINA}, 'rina@ditsama.itb.ac.id', ${TRIP}, 'advance_set', '{"amountIdr": 1}', '')`;
      });
    });
  });
});
