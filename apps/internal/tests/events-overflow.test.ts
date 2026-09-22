import { eventsOverflow } from "-/app/(app)/_calendar/events-overflow";
import { describe, expect, it } from "vitest";

/**
 * **The `/kalender` day-cell overflow helper, tested with no DOM.** `eventsOverflow` decides how
 * many event names a cell prints and what the "(+N)" link counts. The rules —
 * everything fits below the cap, the exact-fit boundary, the spill, the empty day and the clamped
 * bad cap — are assertions here rather than pixels.
 */

describe("eventsOverflow", () => {
  it("shows every event with no overflow when the list is under the cap", () => {
    expect(eventsOverflow(["a", "b"], 3)).toEqual({ shown: ["a", "b"], overflow: 0 });
  });

  it("shows all with no overflow at the exact-fit boundary", () => {
    expect(eventsOverflow(["a", "b", "c"], 3)).toEqual({ shown: ["a", "b", "c"], overflow: 0 });
  });

  it("keeps the first `limit` and counts the rest as overflow", () => {
    expect(eventsOverflow(["a", "b", "c", "d", "e"], 3)).toEqual({
      shown: ["a", "b", "c"],
      overflow: 2,
    });
  });

  it("is empty with no overflow for a day with no events", () => {
    expect(eventsOverflow([], 3)).toEqual({ shown: [], overflow: 0 });
  });

  it("shows nothing and counts all as overflow at a zero cap", () => {
    expect(eventsOverflow(["a", "b"], 0)).toEqual({ shown: [], overflow: 2 });
  });

  it("clamps a negative cap to zero rather than slicing from the end", () => {
    expect(eventsOverflow(["a", "b", "c"], -1)).toEqual({ shown: [], overflow: 3 });
  });

  it("preserves the incoming order (it does not sort)", () => {
    expect(eventsOverflow(["z", "a", "m"], 2).shown).toEqual(["z", "a"]);
  });
});
