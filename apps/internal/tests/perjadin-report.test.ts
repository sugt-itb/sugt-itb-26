import { randomUUID } from "node:crypto";

import { db, schema } from "@sugt/db";
import {
  attachTransactionEvidence,
  filePerjadinReport,
  isNotStaffError,
  perjadinAcquittal,
  recordTransaction,
  type NewEvidence,
} from "@sugt/db/queries";
import {
  MAX_RECEIPTS_PER_TRANSACTION,
  REPORT_DEADLINE_DAYS_AFTER_RETURN,
  TRANSACTION_CATEGORIES,
} from "@sugt/domain";
import type { Role } from "@sugt/domain";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addPerjadin,
  addPerson,
  addTransaction,
  addTransactionEvidence,
  refusedBy,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The Perjadin Report** — the acquittal of one trip.
 *
 * The invariants under test are the ones no column holds: the reconciliation is derived
 * rather than typed, a transaction is recorded with 1–5 receipts and never gains a sixth
 * (ADR-0039), filing still refuses a grandfathered line with none, and every entry point refuses a
 * non-Staff caller.
 *
 * `staff-only.test.ts` covers the choke point itself at the sign-in seam. This file drives
 * the same guard on the four surfaces #30 added, and asserts on rows.
 */

async function pic(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the Staff-only choke point still has to
 * reject a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the
 * row. The cast through `unknown` is the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Budi Santoso",
    email: "budi@gmail.com",
    role: "Teaching Team" as unknown as Role,
    grants: [],
  };
}

// Calendar-day arithmetic on the `YYYY-MM-DD` strings the `date` columns hold, at UTC midnight
// so the shift itself never crosses a boundary — the same helper `perjadin-detail.ts` keeps.
const MS_PER_DAY = 86_400_000;

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Today's date in the zone the deadline is counted in.
 *
 * Read from `Intl` rather than from the machine's local clock: a test that took the runner's
 * zone would agree with the query only on a machine that happens to sit in Jakarta, which is
 * both of the machines this has ever run on and neither of the ones it needs to keep working
 * on.
 */
function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

/**
 * Resolve once some other connection to this database is waiting on a lock — the observable moment
 * a concurrent write has reached a row another transaction holds. Polled rather than slept, so a
 * slow machine waits longer instead of passing for the wrong reason.
 */
async function untilSomeoneWaitsOnALock() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await db.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting
      from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `);
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("No connection ever waited on a lock.");
}

/**
 * `count` receipts as Drive would describe them once landed. Each has its own file id, since
 * `transaction_evidence.drive_file_id` is unique.
 */
function receipts(count: number): NewEvidence[] {
  return Array.from({ length: count }, () => ({
    driveFileId: randomUUID(),
    contentType: "image/jpeg",
    byteSize: 120_000,
  }));
}

/**
 * A trip and its PIC. T3 (#153) made the Group Staff-only and Stream-less, so the
 * Group is now the PIC alone — no Teaching Team member rides on it any more.
 */
async function aTrip() {
  const staff = await pic();
  const trip = await addPerjadin({ picPersonId: staff.id });
  return { staff, trip };
}

describe("the acquittal payload", () => {
  beforeEach(resetDatabase);

  it("sums every line, all categories, as Uang Perjalanan Terpakai — reconciled against nothing", async () => {
    const { staff, trip } = await aTrip();
    // Konsumsi and Lainnya once drew a float down and Akomodasi did not (ADR-0029); all three count now.
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 1_250_000,
      category: "Konsumsi",
      createdByPersonId: staff.id,
    });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 400_000,
      category: "Lainnya",
      createdByPersonId: staff.id,
    });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 300_000,
      category: "Akomodasi",
      createdByPersonId: staff.id,
    });

    const acquittal = await perjadinAcquittal(staff, trip.id);

    expect(acquittal).toMatchObject({ spentIdr: 1_950_000 });
    // The Advance is not tracked (ADR-0051): there is nothing to reconcile against.
    expect(acquittal).not.toHaveProperty("remainderIdr");
  });

  it("reads a trip that spent nothing as zero rather than as unknown", async () => {
    const { staff, trip } = await aTrip();

    await expect(perjadinAcquittal(staff, trip.id)).resolves.toMatchObject({
      spentIdr: 0,
      transactions: [],
    });
  });

  it("derives the deadline from the trip's end date", async () => {
    /**
     * It follows from `ends_on` plus the constant, so the assertion computes the same way
     * rather than hard-coding a date — a hard-coded one would only be testing the clock.
     */
    const staff = await pic();
    const endsOn = "2026-09-03";
    const trip = await addPerjadin({
      picPersonId: staff.id,
      startsOn: "2026-09-01",
      endsOn,
    });

    const acquittal = await perjadinAcquittal(staff, trip.id);

    expect(acquittal?.reportDueOn).toBe(shiftDate(endsOn, REPORT_DEADLINE_DAYS_AFTER_RETURN));
  });

  it("counts the days left in Jakarta's calendar, and past the deadline as negative", async () => {
    /**
     * The arithmetic, driven at four offsets rather than asserted to be a number.
     *
     * "Today" is a zone, and the query names `Asia/Jakarta` rather than inheriting whatever the
     * database session defaults to. So the expectation is computed in that zone too — reading
     * the machine's own clock here would make this test pass or fail by where it runs, which is
     * the exact bug the named zone exists to prevent.
     */
    const staff = await pic();
    const today = jakartaToday();

    for (const offset of [5, 0, -2, -10]) {
      const endsOn = shiftDate(today, offset - REPORT_DEADLINE_DAYS_AFTER_RETURN);
      const trip = await addPerjadin({
        picPersonId: staff.id,
        startsOn: shiftDate(endsOn, -2),
        endsOn,
      });

      const acquittal = await perjadinAcquittal(staff, trip.id);
      expect(acquittal?.daysRemaining).toBe(offset);
    }
  });

  it("carries each line item's evidence without multiplying the money", async () => {
    /**
     * The bug this shape exists to prevent: joining evidence onto transactions and summing
     * the result counts a line item once per receipt. Two receipts on one transaction must
     * still spend its amount once.
     */
    const { staff, trip } = await aTrip();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 900_000,
      createdByPersonId: staff.id,
    });
    await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: staff.id });
    await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: staff.id });

    const acquittal = await perjadinAcquittal(staff, trip.id);

    expect(acquittal?.spentIdr).toBe(900_000);
    expect(acquittal?.transactions).toHaveLength(1);
    expect(acquittal?.transactions[0]?.evidence).toHaveLength(2);
  });

  it("carries each line's participant type and splits the spend by cohort", async () => {
    // `participant_type` is an axis orthogonal to `category` — which cohort the spend served. The
    // acquittal returns it per line and sums the two subtotals off the loaded rows, so a mix of
    // Siswa and GTK-MS spend splits into `siswaSpentIdr` / `gtkMsSpentIdr` that add back to
    // `spentIdr`.
    const { staff, trip } = await aTrip();
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 600_000,
      description: "Uang harian",
      spentOn: "2026-09-01",
      category: "Uang Harian",
      participantType: "Siswa",
      createdByPersonId: staff.id,
    });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 400_000,
      description: "Konsumsi",
      spentOn: "2026-09-02",
      category: "Konsumsi",
      participantType: "GTK-MS",
      createdByPersonId: staff.id,
    });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 75_000,
      spentOn: "2026-09-03",
      participantType: "Siswa",
      createdByPersonId: staff.id,
    });

    const acquittal = await perjadinAcquittal(staff, trip.id);

    expect(acquittal?.transactions[0]?.participantType).toBe("Siswa");
    expect(acquittal?.transactions[1]?.participantType).toBe("GTK-MS");
    expect(acquittal?.siswaSpentIdr).toBe(675_000);
    expect(acquittal?.gtkMsSpentIdr).toBe(400_000);
    // The two cohorts partition the spend: there is no third type and no unset state.
    expect(acquittal!.siswaSpentIdr + acquittal!.gtkMsSpentIdr).toBe(acquittal?.spentIdr);
  });

  it("tells a missing Perjadin apart from a refusal", async () => {
    const staff = await pic();

    await expect(
      perjadinAcquittal(staff, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeNull();
  });

  it("names the Pimpinan who joined the trip, ordered, and reads none as an empty list", async () => {
    /**
     * The Laporan names who travelled (#142). A Pimpinan is record-only — now the name of a real
     * Pimpinan-Person row (#181, joined from `person`) — so the acquittal carries the names and
     * nothing more, ordered so the screen and its CSV read the same on every load.
     */
    const staff = await pic();
    const fatimah = await addPerson({
      fullName: "Fatimah Arofiati Noor",
      email: "fatimah@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    const anton = await addPerson({
      fullName: "Anton Timur Jaelani",
      email: "anton@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    const trip = await addPerjadin({
      picPersonId: staff.id,
      pimpinan: [fatimah.id, anton.id],
    });

    const acquittal = await perjadinAcquittal(staff, trip.id);
    // Ordered by name — "Anton …" sorts before "Fatimah …".
    expect(acquittal?.pimpinan).toEqual([anton.fullName, fatimah.fullName]);

    const noneTrip = await addPerjadin({ picPersonId: staff.id });
    const none = await perjadinAcquittal(staff, noneTrip.id);
    expect(none?.pimpinan).toEqual([]);
  });
});

describe("the category", () => {
  beforeEach(resetDatabase);

  it("accepts every value @sugt/domain declares", async () => {
    /**
     * The CHECK is written out character for character in `travel.ts` rather than composed
     * from `TRANSACTION_CATEGORIES`, so the two can drift silently. This drives every value
     * through the real constraint, which is the only thing that catches a typo in either.
     */
    const { staff, trip } = await aTrip();

    for (const category of TRANSACTION_CATEGORIES) {
      const result = await recordTransaction(staff, {
        perjadinId: trip.id,
        spentOn: "2026-09-02",
        description: category,
        amountIdr: 10_000,
        category,
        participantType: "Siswa",
        evidence: receipts(1),
      });
      expect(result.outcome).toBe("recorded");
    }

    const rows = await db
      .select({ category: schema.transaction.category })
      .from(schema.transaction)
      .where(eq(schema.transaction.perjadinId, trip.id));
    expect(rows.map((row) => row.category).sort()).toEqual([...TRANSACTION_CATEGORIES].sort());
  });

  it("holds exactly the twelve, with the constraint read back rather than inferred", async () => {
    /**
     * The loop above catches drift in one direction only — a value the domain gains and the
     * CHECK lacks fails on insert. This catches the other: a value the CHECK still names after
     * the domain drops it would never be inserted, so no insert could notice. Reading the
     * constraint's own text out of Postgres is what closes it.
     *
     * `pg_get_constraintdef` returns the whole `CHECK (...)` expression, so the assertion is on
     * which quoted literals appear in it rather than on its exact formatting — Postgres
     * normalises that and pinning it would test the server's printer.
     */
    const [row] = await db.execute<{ definition: string }>(sql`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'transaction_category_check'
    `);

    const named = [...(row?.definition ?? "").matchAll(/'((?:[^']|'')*)'/g)].map((match) =>
      match[1]!.replaceAll("''", "'"),
    );
    expect([...new Set(named)].sort()).toEqual([...TRANSACTION_CATEGORIES].sort());
  });

  it("refuses a value outside the closed set, at the database", async () => {
    const { staff, trip } = await aTrip();

    const refusal = await refusedBy(
      db.insert(schema.transaction).values({
        perjadinId: trip.id,
        spentOn: "2026-09-02",
        description: "Parkir",
        amountIdr: 10_000,
        // The cast is the point: this is what a caller bypassing the type would send, and
        // the database is what has to refuse it.
        category: "Parkir" as (typeof TRANSACTION_CATEGORIES)[number],
        // Valid, so the category check is the one that fires rather than the not-null on this.
        participantType: "Siswa",
        createdByPersonId: staff.id,
      }),
    );

    expect(refusal).toBe("transaction_category_check");
  });
});

describe("recording a line item", () => {
  beforeEach(resetDatabase);

  it("refuses a non-Staff caller with a distinguishable typed error", async () => {
    const { trip } = await aTrip();

    const refusal = await recordTransaction(nonStaff(), {
      perjadinId: trip.id,
      spentOn: "2026-09-02",
      description: "Taksi",
      amountIdr: 50_000,
      category: "Transport Lokal Dalam Provinsi",
      participantType: "Siswa",
      evidence: receipts(1),
    }).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });

  it("records the participant type the form collected, and reads it back on the acquittal", async () => {
    // `participant_type` is required and orthogonal to `category`; the write persists it and the
    // acquittal returns it unchanged, which is what the Laporan's per-cohort split reads.
    const { staff, trip } = await aTrip();

    const result = await recordTransaction(staff, {
      perjadinId: trip.id,
      spentOn: "2026-09-02",
      description: "Honorarium narasumber",
      amountIdr: 600_000,
      category: "Honorarium Narasumber",
      participantType: "GTK-MS",
      evidence: receipts(1),
    });

    expect(result.outcome).toBe("recorded");
    const acquittal = await perjadinAcquittal(staff, trip.id);
    expect(acquittal?.transactions[0]?.participantType).toBe("GTK-MS");
    expect(acquittal?.gtkMsSpentIdr).toBe(600_000);
    expect(acquittal?.siswaSpentIdr).toBe(0);
  });

  it("comes back as a value on a stale Perjadin link and on a non-positive amount", async () => {
    const { staff, trip } = await aTrip();

    await expect(
      recordTransaction(staff, {
        perjadinId: "00000000-0000-0000-0000-000000000000",
        spentOn: "2026-09-02",
        description: "Taksi",
        amountIdr: 50_000,
        category: "Transport Lokal Dalam Provinsi",
        participantType: "Siswa",
        evidence: receipts(1),
      }),
    ).resolves.toEqual({ outcome: "no-such-perjadin" });

    await expect(
      recordTransaction(staff, {
        perjadinId: trip.id,
        spentOn: "2026-09-02",
        description: "Taksi",
        amountIdr: 0,
        category: "Transport Lokal Dalam Provinsi",
        participantType: "Siswa",
        evidence: receipts(1),
      }),
    ).resolves.toEqual({ outcome: "amount-not-positive" });
  });
});

describe("recording a line item with its receipts (ADR-0039)", () => {
  beforeEach(resetDatabase);

  /** One line item's fields, with `count` receipts. */
  function aLine(perjadinId: string, count: number) {
    return {
      perjadinId,
      spentOn: "2026-09-02",
      description: "Taksi bandara",
      amountIdr: 150_000,
      category: "Transport Bandara/Stasiun" as const,
      participantType: "Siswa" as const,
      evidence: receipts(count),
    };
  }

  async function rows() {
    return {
      lines: await db.select().from(schema.transaction),
      evidence: await db.select().from(schema.transactionEvidence),
    };
  }

  it("refuses a line with no receipt, and writes nothing", async () => {
    const { staff, trip } = await aTrip();

    await expect(recordTransaction(staff, aLine(trip.id, 0))).resolves.toEqual({
      outcome: "evidence-missing",
    });
    await expect(rows()).resolves.toEqual({ lines: [], evidence: [] });
  });

  it.each([1, MAX_RECEIPTS_PER_TRANSACTION])(
    "records a line with %i receipt(s), and the line and its evidence together",
    async (count) => {
      const { staff, trip } = await aTrip();
      const input = aLine(trip.id, count);

      const result = await recordTransaction(staff, input);

      expect(result.outcome).toBe("recorded");
      const { lines, evidence } = await rows();
      expect(lines).toHaveLength(1);
      expect(lines[0]?.id).toBe((result as { transactionId: string }).transactionId);
      expect(evidence.map((row) => row.driveFileId).sort()).toEqual(
        input.evidence.map((file) => file.driveFileId).sort(),
      );
      expect(evidence.every((row) => row.transactionId === lines[0]?.id)).toBe(true);
      expect(evidence.every((row) => row.uploadedByPersonId === staff.id)).toBe(true);
    },
  );

  it("refuses a line with more than five receipts, and writes nothing", async () => {
    const { staff, trip } = await aTrip();

    await expect(
      recordTransaction(staff, aLine(trip.id, MAX_RECEIPTS_PER_TRANSACTION + 1)),
    ).resolves.toEqual({
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
      count: MAX_RECEIPTS_PER_TRANSACTION + 1,
    });
    await expect(rows()).resolves.toEqual({ lines: [], evidence: [] });
  });

  it("writes no line when one of its receipts is refused by the database", async () => {
    // One transaction for both: a receipt already attached elsewhere trips the unique key, and the
    // line inserted a moment earlier in the same write must not survive it.
    const { staff, trip } = await aTrip();
    const first = aLine(trip.id, 1);
    await recordTransaction(staff, first);
    const input = aLine(trip.id, 2);
    input.evidence[1] = {
      contentType: "image/jpeg",
      byteSize: 10,
      driveFileId: first.evidence[0]!.driveFileId,
    };

    const refusal = await refusedBy(recordTransaction(staff, input));

    expect(refusal).toBe("transaction_evidence_drive_file_id_unique");
    const { lines, evidence } = await rows();
    expect(lines).toHaveLength(1);
    expect(evidence).toHaveLength(1);
  });
});

describe("attaching evidence", () => {
  beforeEach(resetDatabase);

  it("refuses a non-Staff caller", async () => {
    const { staff, trip } = await aTrip();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });

    const refusal = await attachTransactionEvidence(nonStaff(), trip.id, line.id, [
      { driveFileId: "a", contentType: "image/jpeg", byteSize: 10 },
    ]).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });

  it("refuses a line item belonging to another trip", async () => {
    /**
     * A Server Action is a public endpoint, so the transaction is named with its Perjadin
     * and the pair is checked rather than assumed from whatever screen sent it.
     */
    const { staff, trip } = await aTrip();
    const otherStaff = await addPerson({
      fullName: "Andi Pratama",
      email: "andi@ditsama.itb.ac.id",
      role: "Staff",
    });
    const otherTrip = await addPerjadin({ picPersonId: otherStaff.id });
    const line = await addTransaction({
      perjadinId: otherTrip.id,
      amountIdr: 50_000,
      createdByPersonId: otherStaff.id,
    });

    await expect(
      attachTransactionEvidence(staff, trip.id, line.id, [
        { driveFileId: "forged", contentType: "image/jpeg", byteSize: 10 },
      ]),
    ).resolves.toEqual({ outcome: "no-such-transaction" });
    await expect(db.select().from(schema.transactionEvidence)).resolves.toHaveLength(0);
  });

  it("records what the server read the file to be", async () => {
    const { staff, trip } = await aTrip();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });

    const result = await attachTransactionEvidence(staff, trip.id, line.id, [
      {
        driveFileId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
        contentType: "image/webp",
        byteSize: 4096,
      },
    ]);

    expect(result).toEqual({ outcome: "attached", count: 1 });
    const [row] = await db.select().from(schema.transactionEvidence);
    expect(row).toMatchObject({
      contentType: "image/webp",
      byteSize: 4096,
      uploadedByPersonId: staff.id,
    });
  });

  it("refuses to attach one uploaded file twice", async () => {
    const { staff, trip } = await aTrip();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });
    const file = { driveFileId: "one-file", contentType: "image/jpeg", byteSize: 10 };

    await attachTransactionEvidence(staff, trip.id, line.id, [file]);
    const refusal = await refusedBy(attachTransactionEvidence(staff, trip.id, line.id, [file]));

    expect(refusal).toBe("transaction_evidence_drive_file_id_unique");
  });

  /** A line item already carrying `count` receipts. */
  async function aLineWith(count: number) {
    const { staff, trip } = await aTrip();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });
    for (let index = 0; index < count; index += 1) {
      await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: staff.id });
    }
    return { staff, trip, line };
  }

  async function evidenceOn(transactionId: string) {
    return db
      .select()
      .from(schema.transactionEvidence)
      .where(eq(schema.transactionEvidence.transactionId, transactionId));
  }

  it("refuses a sixth receipt on a line that has five", async () => {
    const { staff, trip, line } = await aLineWith(MAX_RECEIPTS_PER_TRANSACTION);

    await expect(attachTransactionEvidence(staff, trip.id, line.id, receipts(1))).resolves.toEqual({
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
      existing: MAX_RECEIPTS_PER_TRANSACTION,
    });
    await expect(evidenceOn(line.id)).resolves.toHaveLength(MAX_RECEIPTS_PER_TRANSACTION);
  });

  it("refuses a batch that would take a line from three to six, attaching none of it", async () => {
    const { staff, trip, line } = await aLineWith(3);

    await expect(attachTransactionEvidence(staff, trip.id, line.id, receipts(3))).resolves.toEqual({
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
      existing: 3,
    });
    await expect(evidenceOn(line.id)).resolves.toHaveLength(3);
  });

  it("attaches a batch that takes a line from three to exactly five", async () => {
    const { staff, trip, line } = await aLineWith(3);

    await expect(attachTransactionEvidence(staff, trip.id, line.id, receipts(2))).resolves.toEqual({
      outcome: "attached",
      count: 2,
    });
    await expect(evidenceOn(line.id)).resolves.toHaveLength(5);
  });

  it("makes a batch wait for a concurrent one on the same line, then counts its receipts", async () => {
    /**
     * Two uploads racing on one line: each alone fits (0 + 3 ≤ 5), both together would not. The
     * first is held open mid-write — its parent row locked, its three rows inserted, not yet
     * committed — the state a real concurrent `attachTransactionEvidence` passes through. The second
     * must wait on the parent row, then count the first's three and refuse. Without the lock it
     * would count zero committed rows and insert, leaving six.
     */
    const { staff, trip, line } = await aLineWith(0);
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalHeld = () => {};
    const held = new Promise<void>((resolve) => {
      signalHeld = resolve;
    });

    const first = db.transaction(async (tx) => {
      await tx
        .select({ id: schema.transaction.id })
        .from(schema.transaction)
        .where(eq(schema.transaction.id, line.id))
        .for("update");
      await tx.insert(schema.transactionEvidence).values(
        receipts(3).map((file) => ({
          ...file,
          transactionId: line.id,
          uploadedByPersonId: staff.id,
        })),
      );
      signalHeld();
      await released;
    });
    await held;

    const second = attachTransactionEvidence(staff, trip.id, line.id, receipts(3));
    // Let the first commit only once the second is blocked on a lock, so it cannot have counted
    // before the first's rows existed. With `for update` the wait is on the parent row; without it,
    // on the evidence FK's key-share lock — either way the second is past the point of choosing.
    await untilSomeoneWaitsOnALock();
    release();
    await first;

    await expect(second).resolves.toEqual({
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
      existing: 3,
    });
    await expect(evidenceOn(line.id)).resolves.toHaveLength(3);
  });
});

describe("filing the Report", () => {
  beforeEach(resetDatabase);

  it("still refuses a grandfathered line item with no receipt", async () => {
    /**
     * `recordTransaction` no longer writes a line without a receipt (ADR-0039), but the shared
     * database may already hold one from before — no migration touched them. The fixture inserts
     * such a row directly, and the filing check is what still catches it.
     */
    const { staff, trip } = await aTrip();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 150_000,
      createdByPersonId: staff.id,
    });

    const refused = await filePerjadinReport(staff, trip.id);
    expect(refused).toEqual({ outcome: "evidence-missing", transactionIds: [line.id] });

    const [row] = await db
      .select({ filedAt: schema.perjadin.reportFiledAt })
      .from(schema.perjadin)
      .where(eq(schema.perjadin.id, trip.id));
    expect(row?.filedAt).toBeNull();
  });

  it("files once every line item carries a receipt", async () => {
    const { staff, trip } = await aTrip();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 150_000,
      createdByPersonId: staff.id,
    });
    await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: staff.id });

    const filed = await filePerjadinReport(staff, trip.id);

    expect(filed.outcome).toBe("filed");
    const acquittal = await perjadinAcquittal(staff, trip.id);
    expect(acquittal?.reportFiledAt).toBeInstanceOf(Date);
  });

  it("files a trip that spent nothing", async () => {
    /** A vacuous truth is the right answer, not an edge case to refuse. */
    const { staff, trip } = await aTrip();

    await expect(filePerjadinReport(staff, trip.id)).resolves.toMatchObject({ outcome: "filed" });
  });

  it("refuses to re-file, so the timestamp keeps meaning when it happened", async () => {
    const { staff, trip } = await aTrip();
    const first = await filePerjadinReport(staff, trip.id);

    await expect(filePerjadinReport(staff, trip.id)).resolves.toEqual({
      outcome: "already-filed",
      filedAt: (first as { filedAt: Date }).filedAt,
    });
  });

  it("refuses a non-Staff caller, and a stale link as a value", async () => {
    const { staff, trip } = await aTrip();

    const refusal = await filePerjadinReport(nonStaff(), trip.id).catch((error: unknown) => error);
    expect(isNotStaffError(refusal)).toBe(true);

    await expect(
      filePerjadinReport(staff, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toEqual({ outcome: "no-such-perjadin" });
  });
});
