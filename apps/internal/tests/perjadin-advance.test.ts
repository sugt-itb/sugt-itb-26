import { db, schema } from "@sugt/db";
import {
  filePerjadinReport,
  isNotStaffError,
  perjadinAcquittal,
  updatePerjadinAdvance,
} from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addPerjadin, addPerson, addTransaction, resetDatabase } from "./support/fixtures";

/**
 * **The Advance is Staff-correctable after planning** (#192). `planPerjadin` writes it once; this is
 * the only write that changes it afterwards. It reverses the domain's "fixed during trip planning"
 * position for the amount — still set at planning, now correctable — while leaving
 * money-write-is-Staff-only (ADR-0026) intact: reads are open, this write stays `requireStaff`.
 *
 * The validation is the DB floor only (`advance_idr >= 0`), deliberately not coupled to spend: an
 * Advance below current spend is a real overspend, not an error. There is no lifecycle gate — the
 * correction is allowed even after the Report is filed, because the acquittal derives the remainder
 * live.
 */

/** The Staff Person who is PIC of the trip. */
async function staff(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

/** The Advance a Perjadin actually carries, read back rather than trusted. */
async function advanceOf(perjadinId: string) {
  const [row] = await db
    .select({ advanceIdr: schema.perjadin.advanceIdr })
    .from(schema.perjadin)
    .where(eq(schema.perjadin.id, perjadinId));
  return row?.advanceIdr ?? null;
}

describe("Correcting a Perjadin's Advance", () => {
  beforeEach(resetDatabase);

  it("persists a corrected Advance and recomputes the remainder", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id, advanceIdr: 5_000_000 });
    await addTransaction({ perjadinId: trip.id, amountIdr: 1_250_000, createdByPersonId: pic.id });

    const result = await updatePerjadinAdvance(pic, trip.id, 7_000_000);

    expect(result).toEqual({ outcome: "updated" });
    expect(await advanceOf(trip.id)).toBe(7_000_000);
    // The acquittal's remainder is derived, so correcting the Advance corrects it for free.
    const acquittal = await perjadinAcquittal(pic, trip.id);
    expect(acquittal).toMatchObject({
      advanceIdr: 7_000_000,
      spentIdr: 1_250_000,
      remainderIdr: 5_750_000,
    });
  });

  it("accepts zero — an unfunded trip is a real state", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id, advanceIdr: 5_000_000 });

    const result = await updatePerjadinAdvance(pic, trip.id, 0);

    expect(result).toEqual({ outcome: "updated" });
    expect(await advanceOf(trip.id)).toBe(0);
  });

  it("accepts an Advance below current spend, yielding a negative remainder — no coupling to spend", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id, advanceIdr: 5_000_000 });
    await addTransaction({ perjadinId: trip.id, amountIdr: 2_000_000, createdByPersonId: pic.id });

    const result = await updatePerjadinAdvance(pic, trip.id, 500_000);

    expect(result).toEqual({ outcome: "updated" });
    expect(await advanceOf(trip.id)).toBe(500_000);
    const acquittal = await perjadinAcquittal(pic, trip.id);
    // Overspend: advance (500k) − spent (2M) = −1.5M, a representable state and not a refusal.
    expect(acquittal?.remainderIdr).toBe(-1_500_000);
  });

  it("refuses a negative value and writes nothing", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id, advanceIdr: 5_000_000 });

    const result = await updatePerjadinAdvance(pic, trip.id, -1);

    expect(result).toEqual({ outcome: "negative-advance" });
    // The refusal comes before any write: the Advance is untouched.
    expect(await advanceOf(trip.id)).toBe(5_000_000);
  });

  it("is allowed after the Perjadin Report is filed — no lifecycle gate", async () => {
    const pic = await staff();
    // A trip with no transactions files cleanly (the evidence check is vacuously true).
    const trip = await addPerjadin({ picPersonId: pic.id, advanceIdr: 5_000_000 });
    const filed = await filePerjadinReport(pic, trip.id);
    if (filed.outcome !== "filed") throw new Error("fixture failed to file the report");

    const result = await updatePerjadinAdvance(pic, trip.id, 6_000_000);

    expect(result).toEqual({ outcome: "updated" });
    expect(await advanceOf(trip.id)).toBe(6_000_000);
  });

  it("reports no-such-perjadin for an id that names no trip", async () => {
    const pic = await staff();

    const result = await updatePerjadinAdvance(
      pic,
      "00000000-0000-0000-0000-000000000000",
      1_000_000,
    );

    expect(result).toEqual({ outcome: "no-such-perjadin" });
  });

  it("refuses a real signed-in Pimpinan — money writes stay Staff-only (ADR-0026)", async () => {
    const pic = await staff();
    const pimpinan = await addPerson({
      fullName: "Fatimah Azzahra",
      email: "fatimah@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    const trip = await addPerjadin({ picPersonId: pic.id, advanceIdr: 5_000_000 });

    const refusal = await updatePerjadinAdvance(pimpinan, trip.id, 9_000_000).catch(
      (error: unknown) => error,
    );

    expect(isNotStaffError(refusal)).toBe(true);
    // Nothing was written: the guard runs before the update.
    expect(await advanceOf(trip.id)).toBe(5_000_000);
  });
});
