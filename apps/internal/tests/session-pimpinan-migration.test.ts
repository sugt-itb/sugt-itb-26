import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  applyRemainingMigrations,
  scratchDatabaseThrough,
  withClient,
} from "./support/scratch-database";

/**
 * **Migration 0054 moves the Pimpinan from the trip onto its Sessions** (#492, ADR-0056). Seeded as
 * 0053 stood — `perjadin_pimpinan` rows on three trips — then migrated:
 *
 * - a trip with live Sessions copies each Pimpinan onto every **non-cancelled** one, not the
 *   cancelled one;
 * - a trip whose Sessions are all cancelled copies onto all of them, so nothing is lost;
 * - a trip with no Session at all has nowhere to keep its Pimpinan. The query the ticket asks the
 *   migration to be checked with counts those rows before the migration runs — one here, and
 *   expected to be none on the live data.
 *
 * `perjadin_pimpinan` is gone afterwards. The trips, Schools and Sub-Clusters are seeded without
 * their foreign keys (`session_replication_role = replica`); the People are real, because the
 * migration's own insert checks `session_pimpinan_is_pimpinan` against them.
 */

const scratch = scratchDatabaseThrough("0053_drop_report_filed_at");

const RINA = randomUUID();
const FATIMAH = randomUUID();
const ANTON = randomUUID();

const LIVE_TRIP = randomUUID();
const ARRANGED = randomUUID();
const DELIVERED = randomUUID();
const CANCELLED = randomUUID();

const CANCELLED_TRIP = randomUUID();
const CANCELLED_ONLY_A = randomUUID();
const CANCELLED_ONLY_B = randomUUID();

const EMPTY_TRIP = randomUUID();

/** The rows the migration cannot keep: Pimpinan on a trip with no Session at all. */
const STRANDED = `
  select count(*)::int as stranded from perjadin_pimpinan
  where not exists (select 1 from session where session.perjadin_id = perjadin_pimpinan.perjadin_id)`;

describe("0054_session_pimpinan", () => {
  it("copies each trip Pimpinan onto its live Sessions, or all of them when none is live", async () => {
    await withClient(scratch.url, (sql) =>
      sql.begin(async (tx) => {
        await tx`
          insert into person (id, full_name, email, role) values
            (${RINA}, 'Rina Nurhayati', 'rina@ditsama.itb.ac.id', 'Staff'),
            (${FATIMAH}, 'Fatimah Arofiati Noor', 'fatimah@ditsama.itb.ac.id', 'Pimpinan'),
            (${ANTON}, 'Anton Timur Jaelani', 'anton@ditsama.itb.ac.id', 'Pimpinan')`;
        await tx`set local session_replication_role = replica`;
        await tx`
          insert into perjadin (id, sub_cluster_id, starts_on, ends_on, pic_person_id) values
            (${LIVE_TRIP}, ${randomUUID()}, '2026-09-01', '2026-09-03', ${RINA}),
            (${CANCELLED_TRIP}, ${randomUUID()}, '2026-09-08', '2026-09-09', ${RINA}),
            (${EMPTY_TRIP}, ${randomUUID()}, '2026-09-15', '2026-09-16', ${RINA})`;
        await tx`
          insert into session (id, school_id, perjadin_id, mode, held_on, starts_at, status, cancelled_reason)
          values
            (${ARRANGED}, ${randomUUID()}, ${LIVE_TRIP}, 'offline', '2026-09-02', '09:00', 'arranged', null),
            (${DELIVERED}, ${randomUUID()}, ${LIVE_TRIP}, 'offline', '2026-09-01', '09:00', 'delivered', null),
            (${CANCELLED}, ${randomUUID()}, ${LIVE_TRIP}, 'offline', '2026-09-03', '09:00', 'cancelled', 'Sekolah libur'),
            (${CANCELLED_ONLY_A}, ${randomUUID()}, ${CANCELLED_TRIP}, 'offline', '2026-09-08', '09:00', 'cancelled', 'Banjir'),
            (${CANCELLED_ONLY_B}, ${randomUUID()}, ${CANCELLED_TRIP}, 'offline', '2026-09-09', '09:00', 'cancelled', 'Banjir')`;
        await tx`
          insert into perjadin_pimpinan (perjadin_id, person_id) values
            (${LIVE_TRIP}, ${FATIMAH}),
            (${LIVE_TRIP}, ${ANTON}),
            (${CANCELLED_TRIP}, ${FATIMAH}),
            (${EMPTY_TRIP}, ${ANTON})`;
      }),
    );

    // The rows a trip with no Session holds — what the migration has to drop. One in this seed.
    await withClient(scratch.url, async (sql) => {
      await expect(sql.unsafe(STRANDED)).resolves.toEqual([{ stranded: 1 }]);
    });

    await applyRemainingMigrations(scratch.url);

    await withClient(scratch.url, async (sql) => {
      const rows = await sql<{ session_id: string; person_id: string; role: string }[]>`
        select session_id, person_id, role from session_pimpinan`;
      const recorded = rows.map((row) => `${row.session_id} ${row.person_id} ${row.role}`).sort();
      expect(recorded).toEqual(
        [
          // The live trip: both Pimpinan on the arranged and the delivered Session, not the
          // cancelled one.
          `${ARRANGED} ${FATIMAH} Pimpinan`,
          `${ARRANGED} ${ANTON} Pimpinan`,
          `${DELIVERED} ${FATIMAH} Pimpinan`,
          `${DELIVERED} ${ANTON} Pimpinan`,
          // No live Session: every Session keeps the Pimpinan.
          `${CANCELLED_ONLY_A} ${FATIMAH} Pimpinan`,
          `${CANCELLED_ONLY_B} ${FATIMAH} Pimpinan`,
        ].sort(),
      );

      await expect(sql`select to_regclass('perjadin_pimpinan') as table`).resolves.toEqual([
        { table: null },
      ]);
    });
  });
});
