import { PERJADIN_ROLE_LABELS, ROLES, ROLE_LABELS } from "@sugt/domain";
import { describe, expect, it } from "vitest";

/**
 * **The role display labels, tested with no database and no DOM.**
 *
 * Like `theme-cycle.test.ts`, this file touches neither Postgres nor a browser. It pins the
 * one thing [#116](https://github.com/mafiefa02/sugt/issues/116) asks for — that the internal
 * UI shows `Staff` as **DITSAMA** — and, just as importantly, that this is *presentation only*:
 * the map's keys are the stored `ROLES` values, unchanged, so every `role === "Staff"` compare,
 * CHECK constraint and composite FK still speaks the same string it always did.
 *
 * T3 (#153) retired the `Teaching Team` Role, leaving Staff alone; #179 then added a second signed-in
 * role, so `ROLES` is now exactly `["Staff", "Pimpinan"]` and both maps carry those two keys. `Staff`
 * keeps its DITSAMA/Pendamping labels; the record-only `Pimpinan` reads its own name on both surfaces.
 */
describe("ROLE_LABELS", () => {
  it("labels Staff as DITSAMA and Pimpinan as Pimpinan, the two Roles", () => {
    expect(ROLE_LABELS.Staff).toBe("DITSAMA");
    expect(ROLE_LABELS.Pimpinan).toBe("Pimpinan");
    expect(ROLES).toEqual(["Staff", "Pimpinan"]);
  });

  it("keys on the stored role values, so the domain terms stay Staff and Pimpinan", () => {
    // The stored value is what the keys are: renaming a label must never rename a role.
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ROLES].sort());
    expect(ROLES).toContain("Staff");
    expect(ROLES).toContain("Pimpinan");
  });
});

/**
 * **The Perjadin-surface role labels** (#141). The same stored role, seen from the trip's
 * vantage point: on a Perjadin the DITSAMA people who accompany the visit read as
 * **Pendamping**. Presentation only, and keyed on the stored `ROLES` values exactly like
 * `ROLE_LABELS`, so `[member.role]` render sites resolve and nothing stored changes.
 */
describe("PERJADIN_ROLE_LABELS", () => {
  it("labels Staff as Pendamping and Pimpinan as Pimpinan", () => {
    expect(PERJADIN_ROLE_LABELS.Staff).toBe("Pendamping");
    expect(PERJADIN_ROLE_LABELS.Pimpinan).toBe("Pimpinan");
    expect(ROLES).toEqual(["Staff", "Pimpinan"]);
  });

  it("keys on the stored role values, like ROLE_LABELS", () => {
    expect(Object.keys(PERJADIN_ROLE_LABELS).sort()).toEqual([...ROLES].sort());
  });
});
