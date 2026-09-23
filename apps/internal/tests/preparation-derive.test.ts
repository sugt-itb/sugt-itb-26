import { preparationPercent, preparationWarnings } from "-/app/(app)/preparation-derive";
import type { PreparationCard } from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

/**
 * **The Preparation Card percentage fold, tested with no database and no DOM** — like the
 * other Dashboard (`/`) derive seams. It hands `preparationPercent` a hand-built checklist and asserts
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

/**
 * **The Persiapan due-date warnings fold (#234), tested with no database and no DOM.** It hands
 * `preparationWarnings` hand-built Cards and a fixed `today`, and pins the trigger: incomplete Cards
 * whose `startsOn` is on or before `today + 5 days` (including today and past dates) warn; complete
 * Cards never warn; `endsOn` never moves the trigger. `today` is `2026-10-10` throughout, so
 * `today + 5d` is `2026-10-15`.
 */
const TODAY = "2026-10-10";

/** A Preparation Card; `startsOn`, item checks and the rest are the only fields a case sets. */
function card(over: Partial<PreparationCard> & Pick<PreparationCard, "startsOn">): PreparationCard {
  return {
    id: crypto.randomUUID(),
    title: "Rapat koordinasi",
    endsOn: null,
    items: [{ id: "i1", label: "Undang narasumber", jenis: "Teknis", position: 0, checked: false }],
    ...over,
  };
}

describe("preparationWarnings", () => {
  it("warns for an incomplete card starting within the next 5 days", () => {
    const warnings = preparationWarnings([card({ startsOn: "2026-10-13" })], TODAY);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe(
      'Persiapan "Rapat koordinasi" belum selesai, tenggat waktu hingga 13 Oktober 2026',
    );
  });

  it("keys the id stably on the card id", () => {
    const [warning] = preparationWarnings([card({ id: "abc", startsOn: TODAY })], TODAY);
    expect(warning?.id).toBe("persiapan-abc");
  });

  it("warns on the exact today+5d boundary but not the day after", () => {
    expect(preparationWarnings([card({ startsOn: "2026-10-15" })], TODAY)).toHaveLength(1);
    expect(preparationWarnings([card({ startsOn: "2026-10-16" })], TODAY)).toHaveLength(0);
  });

  it("warns for a card starting today and one already past — no lower bound", () => {
    expect(preparationWarnings([card({ startsOn: TODAY })], TODAY)).toHaveLength(1);
    expect(preparationWarnings([card({ startsOn: "2026-09-01" })], TODAY)).toHaveLength(1);
  });

  it("never warns for a 100%-complete card, even when overdue", () => {
    const complete = card({
      startsOn: "2026-09-01",
      items: [
        { id: "i1", label: "Undang narasumber", jenis: "Teknis", position: 0, checked: true },
      ],
    });
    expect(preparationWarnings([complete], TODAY)).toEqual([]);
  });

  it("warns for a 0-item card that is due (0% is incomplete)", () => {
    expect(preparationWarnings([card({ startsOn: TODAY, items: [] })], TODAY)).toHaveLength(1);
  });

  it("ignores endsOn — the trigger is startsOn alone", () => {
    // A card whose range has ended but whose startsOn is beyond the horizon does not warn…
    expect(
      preparationWarnings([card({ startsOn: "2026-10-20", endsOn: "2026-10-25" })], TODAY),
    ).toHaveLength(0);
    // …and one due by startsOn warns regardless of a far-future endsOn.
    expect(
      preparationWarnings([card({ startsOn: "2026-10-12", endsOn: "2026-12-31" })], TODAY),
    ).toHaveLength(1);
  });
});
