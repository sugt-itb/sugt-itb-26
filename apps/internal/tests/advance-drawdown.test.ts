import { monitoringData, perjadinAcquittal } from "@sugt/db/queries";
import {
  ADVANCE_DRAWDOWN_CATEGORIES,
  isAdvanceDrawdownCategory,
  sumAdvanceDrawdownIdr,
} from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { addPerjadin, addPerson, addTransaction, resetDatabase } from "./support/fixtures";

/**
 * **The travel-float draw-down** (ADR-0029): only `ADVANCE_DRAWDOWN_CATEGORIES` (Konsumsi, Lainnya)
 * reduce a Perjadin's remaining float; every other category is recorded and shown but paid outside
 * the float. `/monitoring`'s programme spend is deliberately untouched — it still sums every
 * category. This pins the ticket's two worked examples end to end, plus the pure domain helper.
 */

describe("the ADVANCE_DRAWDOWN_CATEGORIES helper", () => {
  it("names exactly Konsumsi and Lainnya, and recognises them", () => {
    expect([...ADVANCE_DRAWDOWN_CATEGORIES]).toEqual(["Konsumsi", "Lainnya"]);
    expect(isAdvanceDrawdownCategory("Konsumsi")).toBe(true);
    expect(isAdvanceDrawdownCategory("Lainnya")).toBe(true);
    expect(isAdvanceDrawdownCategory("Akomodasi")).toBe(false);
    expect(isAdvanceDrawdownCategory("Uang Harian")).toBe(false);
  });

  it("sums only the drawdown categories", () => {
    const lines = [
      { category: "Akomodasi", amountIdr: 350_000 },
      { category: "Konsumsi", amountIdr: 179_000 },
      { category: "Lainnya", amountIdr: 21_000 },
      { category: "Tiket Pesawat/Kereta PP", amountIdr: 900_000 },
    ];
    expect(sumAdvanceDrawdownIdr(lines)).toBe(200_000); // 179k + 21k
    expect(sumAdvanceDrawdownIdr([])).toBe(0);
  });
});

describe("the Advance is a travel float — worked examples", () => {
  beforeEach(resetDatabase);

  async function aStaffPic() {
    const pic = await addPerson({
      fullName: "Rina",
      email: "rina@ditsama.itb.ac.id",
      role: "Staff",
    });
    return pic;
  }

  it("a non-drawdown Akomodasi leaves the remainder but rises /monitoring spend", async () => {
    const pic = await aStaffPic();
    const trip = await addPerjadin({ advanceIdr: 1_000_000, picPersonId: pic.id });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 350_000,
      category: "Akomodasi",
      createdByPersonId: pic.id,
    });

    const acquittal = await perjadinAcquittal(pic, trip.id);
    // Remaining float unchanged; the full spend still shows and still counts programme-wide.
    expect(acquittal?.remainderIdr).toBe(1_000_000);
    expect(acquittal?.spentIdr).toBe(350_000);
    expect((await monitoringData(pic)).budgetUsedIdr).toBe(350_000);
  });

  it("a Konsumsi draws the float down", async () => {
    const pic = await aStaffPic();
    const trip = await addPerjadin({ advanceIdr: 1_000_000, picPersonId: pic.id });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 179_000,
      category: "Konsumsi",
      createdByPersonId: pic.id,
    });

    const acquittal = await perjadinAcquittal(pic, trip.id);
    expect(acquittal?.remainderIdr).toBe(821_000);
    expect(acquittal?.spentIdr).toBe(179_000);
    expect((await monitoringData(pic)).budgetUsedIdr).toBe(179_000);
  });

  it("mixes both: only the drawdown share reduces the remainder, the log keeps all", async () => {
    const pic = await aStaffPic();
    const trip = await addPerjadin({ advanceIdr: 1_000_000, picPersonId: pic.id });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 350_000,
      category: "Akomodasi",
      createdByPersonId: pic.id,
    });
    await addTransaction({
      perjadinId: trip.id,
      amountIdr: 179_000,
      category: "Konsumsi",
      createdByPersonId: pic.id,
    });

    const acquittal = await perjadinAcquittal(pic, trip.id);
    // Remainder draws down only the 179k; Terpakai logs the full 529k; /monitoring sums all 529k.
    expect(acquittal?.remainderIdr).toBe(821_000);
    expect(acquittal?.spentIdr).toBe(529_000);
    expect(acquittal?.transactions).toHaveLength(2);
    expect((await monitoringData(pic)).budgetUsedIdr).toBe(529_000);
  });
});
