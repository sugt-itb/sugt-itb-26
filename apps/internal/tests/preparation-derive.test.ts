import { preparationPercent } from "-/app/(app)/monitoring/preparation-derive";
import { describe, expect, it } from "vitest";

/**
 * **The Monitoring Preparation percentage fold, tested with no database and no DOM** — like the
 * other `/monitoring` derive seams. It hands `preparationPercent` a hand-built checklist and asserts
 * the whole-number percent, including the empty-checklist zero and the recompute after an edit.
 */
const items = (...checked: boolean[]) => checked.map((c) => ({ checked: c }));

describe("preparationPercent", () => {
  it("is 0% for an empty checklist — a Card with nothing to do has done none of it", () => {
    expect(preparationPercent([])).toBe(0);
  });

  it("is 100% when every item is checked", () => {
    expect(preparationPercent(items(true, true, true))).toBe(100);
  });

  it("is checked ÷ total as a whole-number percent for a mix", () => {
    expect(preparationPercent(items(true, false, false, false))).toBe(25);
    expect(preparationPercent(items(true, true, false))).toBe(67); // 2/3 → 66.7 → 67, rounded
  });

  it("recomputes when an item is added or removed", () => {
    const before = items(true, false); // 1/2 = 50%
    expect(preparationPercent(before)).toBe(50);

    // Add an unchecked item: 1/3 → 33%.
    expect(preparationPercent([...before, { checked: false }])).toBe(33);

    // Remove the unchecked one from the original: 1/1 = 100%.
    expect(preparationPercent(before.filter((item) => item.checked))).toBe(100);
  });
});
