import {
  attachTransactionEvidence,
  filePerjadinReport,
  isNotStaffError,
  perjadinAcquittal,
  recordTransaction,
} from "@sugt/db/queries";
import { beforeEach, describe, expect, it } from "vitest";

import { addPerjadin, addPerson, addTransaction, resetDatabase } from "./support/fixtures";

/**
 * **Money is open to READ, and every money WRITE stays Staff-only.**
 *
 * This is the invariant #180 pins, and it is the reversal of ADR-0004's money half: that ADR drew
 * the internal boundary at delivery-vs-money and made reading money Staff-only;
 * [ADR-0026](../../../docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md) redraws it as
 * **read (any signed-in Person) vs write (Staff)**. So a Pimpinan — the second, read-only Person
 * role (#179) — reads the whole Perjadin acquittal, and is refused by every query that would change
 * it.
 *
 * `perjadin-report.test.ts` drives the four money writes against a hand-built non-Staff caller to
 * prove the choke point still refuses one; this file proves the other side of the new boundary with
 * a *real* signed-in Pimpinan: the read now goes through, and the four writes still throw
 * `NotStaffError`. The two together are the whole of the read/write split — open to read, Staff to
 * write.
 */

async function aTripWithAPimpinan() {
  const staff = await addPerson({
    fullName: "Rina Nurhayati",
    email: "rina@ditsama.itb.ac.id",
    role: "Staff",
  });
  const pimpinan = await addPerson({
    fullName: "Fatimah Azzahra",
    email: "fatimah@ditsama.itb.ac.id",
    role: "Pimpinan",
  });
  const trip = await addPerjadin({ advanceIdr: 5_000_000, picPersonId: staff.id });
  return { staff, pimpinan, trip };
}

describe("a Pimpinan reads money", () => {
  beforeEach(resetDatabase);

  it("reads a Perjadin's acquittal in full — the money read is open", async () => {
    const { staff, pimpinan, trip } = await aTripWithAPimpinan();
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 1_250_000,
      createdByPersonId: staff.id,
    });

    // Not null, and it does not throw: money reads are open to any signed-in Person (ADR-0026).
    const acquittal = await perjadinAcquittal(pimpinan, trip.id);

    expect(acquittal).toMatchObject({
      advanceIdr: 5_000_000,
      spentIdr: 1_250_000,
      remainderIdr: 3_750_000,
    });
    expect(acquittal?.transactions).toHaveLength(1);
  });
});

describe("a Pimpinan cannot write money", () => {
  beforeEach(resetDatabase);

  it("is refused by recordTransaction", async () => {
    const { pimpinan, trip } = await aTripWithAPimpinan();

    const refusal = await recordTransaction(pimpinan, {
      perjadinId: trip.id,
      spentOn: "2026-09-02",
      description: "Taksi",
      amountIdr: 50_000,
      category: "Transport Lokal Dalam Provinsi",
      participantType: "Siswa",
    }).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });

  it("is refused by attachTransactionEvidence", async () => {
    const { staff, pimpinan, trip } = await aTripWithAPimpinan();
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 50_000,
      createdByPersonId: staff.id,
    });

    const refusal = await attachTransactionEvidence(pimpinan, trip.id, line.id, [
      { storagePath: "a", contentType: "image/jpeg", byteSize: 10 },
    ]).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });

  it("is refused by filePerjadinReport", async () => {
    const { pimpinan, trip } = await aTripWithAPimpinan();

    const refusal = await filePerjadinReport(pimpinan, trip.id).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });
});
