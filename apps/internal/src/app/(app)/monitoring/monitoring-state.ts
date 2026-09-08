import type { Role } from "@sugt/domain";

/**
 * **The pure core of `/monitoring`, with no React and no DOM**, so it is tested the way
 * `theme-cycle.ts` and `deriveToolbarState` are — by asserting on values, never by mounting a
 * component. The page's only moving parts are two small decisions, and both live here as plain
 * functions the browser calls and the suite drives directly:
 *
 *   1. **`showBudget`** — the money gate. It now returns `true` for both signed-in roles, `"Staff"`
 *      and the read-only `"Pimpinan"`, because money is open to any signed-in Person to READ
 *      (ADR-0004 reversed by ADR-0026, #180). Testing the value, not the render, is what lets the
 *      suite pin which roles see the budget card.
 *   2. **The dismiss state machine** — a warning the operator sets aside moves from `active` to the
 *      end of `ignored`. Modelled as two immutable lists so a reducer over them is a pure
 *      `(state, id) → state`, with the view holding the current state in `useState`.
 */

/** A single monitoring warning: a stable id and the human message shown in the banner. */
export type Warning = { id: string; message: string };

/** The two lists the banner and the "ignored" accordion read from. */
export type WarningState = { active: Warning[]; ignored: Warning[] };

/**
 * Whether to render the budget figures. `true` for any signed-in role — both `"Staff"` and the
 * read-only `"Pimpinan"` — because money is open to any signed-in Person to READ now (ADR-0004
 * reversed by ADR-0026, #180). Leadership monitoring a Programme are meant to see how much of the
 * budget has been spent. Writing money stays Staff-only, enforced server-side in each money-write
 * query — this gate is about the read.
 */
export function showBudget(role: Role): boolean {
  return role === "Staff" || role === "Pimpinan";
}

/** The starting state: every warning active, nothing ignored yet. Copies the input so the caller's
 *  array is never aliased into the state. */
export function initialWarningState(warnings: Warning[]): WarningState {
  return { active: [...warnings], ignored: [] };
}

/**
 * Set a warning aside. Returns a NEW state with the warning whose id matches moved from `active` to
 * the END of `ignored`, preserving the order of the rest. An id not currently active is a no-op —
 * a fresh, structurally-equal state, with nothing duplicated. The input arrays are never mutated.
 */
export function dismissWarning(state: WarningState, id: string): WarningState {
  const moved = state.active.find((w) => w.id === id);
  if (!moved) {
    return { active: [...state.active], ignored: [...state.ignored] };
  }
  return {
    active: state.active.filter((w) => w.id !== id),
    ignored: [...state.ignored, moved],
  };
}
