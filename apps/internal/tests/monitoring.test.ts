import {
  dismissWarning,
  initialWarningState,
  showBudget,
  type Warning,
} from "-/app/(app)/monitoring/monitoring-state";
import { describe, expect, it } from "vitest";

/**
 * **The pure `/monitoring` logic, tested with no database and no DOM.**
 *
 * Like `theme-cycle.test.ts` and `toolbar-state.test.ts`, this file touches neither Postgres nor a
 * browser — it asserts on `showBudget` (a pure `Role → boolean`) and the warning reducer (a pure
 * `(state, id) → state`). The `/monitoring` view is mock-only and never rendered by any test in this
 * repo; the moving parts are extracted into `monitoring-state.ts` precisely so they can be checked
 * here. It sits with the rest of the suite only because `pnpm --filter @sugt/internal test` is one
 * Vitest project today; whoever later splits the pure tests off can lift it out untouched.
 */

describe("showBudget", () => {
  it("shows the budget to Staff", () => {
    expect(showBudget("Staff")).toBe(true);
  });

  it("shows the budget to a Pimpinan too — money is open to any signed-in Person to read (#180)", () => {
    // ADR-0004 reversed by ADR-0026 (#180): money reads are open to any signed-in Person, so the
    // read-only Pimpinan sees the budget card too. Writing money stays Staff-only, enforced
    // server-side and not by this gate. `Pimpinan` is a real `Role` now, so no cast.
    expect(showBudget("Pimpinan")).toBe(true);
  });
});

describe("dismissWarning", () => {
  const w1: Warning = { id: "w1", message: "satu" };
  const w2: Warning = { id: "w2", message: "dua" };

  it("moves a dismissed warning from active to ignored, leaving the rest active", () => {
    const start = initialWarningState([w1, w2]);
    const next = dismissWarning(start, "w1");
    expect(next.active).toEqual([w2]);
    expect(next.ignored).toEqual([w1]);
  });

  it("appends to ignored in dismissal order until active empties", () => {
    let state = initialWarningState([w1, w2]);
    state = dismissWarning(state, "w1");
    state = dismissWarning(state, "w2");
    expect(state.active).toEqual([]);
    expect(state.ignored).toEqual([w1, w2]);
  });

  it("is a no-op for an unknown id", () => {
    const start = initialWarningState([w1, w2]);
    const next = dismissWarning(start, "does-not-exist");
    expect(next.active).toEqual([w1, w2]);
    expect(next.ignored).toEqual([]);
  });

  it("never mutates the input state or its arrays", () => {
    const start = initialWarningState([w1, w2]);
    const activeBefore = start.active;
    const ignoredBefore = start.ignored;
    dismissWarning(start, "w1");
    expect(start.active).toBe(activeBefore);
    expect(start.ignored).toBe(ignoredBefore);
    expect(start.active).toEqual([w1, w2]);
    expect(start.ignored).toEqual([]);
  });
});
