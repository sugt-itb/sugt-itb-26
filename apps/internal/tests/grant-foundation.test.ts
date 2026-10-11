import { findActivePersonByEmail } from "-/lib/invite-list";
import {
  assignGrant,
  hasGrant,
  isNotGrantedError,
  personGrants,
  requireGrant,
  revokeGrant,
  type Person,
} from "@sugt/db/queries";
import { GRANTS, type Grant, type Role } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { addGrant, addPerson, resetDatabase, revokePerson } from "./support/fixtures";

/**
 * **Grants — the second, additive access axis** (ADR-0028), driven at the same seam the Staff-only
 * choke point is.
 *
 * Every caller here is a **real, resolved** `Person`: `addPerson` puts a row on the invite list,
 * `addGrant` writes the `person_grant` rows the guard is about, and `findActivePersonByEmail`
 * resolves the caller the same way a request does — so the `grants` the guard reads are the ones
 * resolution threads on, not a fabricated array. A fixture writing a Grant onto a **Pimpinan**
 * bypasses the assign path deliberately: it is the only way to build the one caller the assign path
 * refuses to create, and it is what proves "Staff-only wins over any row that exists".
 */
async function resolved(role: Role, email: string, grants: Grant[] = []): Promise<Person> {
  const row = await addPerson({ fullName: "Orang", email, role });
  for (const grant of grants) await addGrant(row.id, grant);
  const person = await findActivePersonByEmail(email);
  if (!person) throw new Error(`Resolved no Person for ${email}`);
  return person;
}

describe("the requireGrant choke point", () => {
  beforeEach(resetDatabase);

  it("threads a Person's Grants onto the resolved caller, ordered and never null", async () => {
    const staff = await resolved("Staff", "granted@ditsama.itb.ac.id", [
      "Perjadin Editor",
      "Administrator",
    ]);
    // array_agg orders on the grant, so the caller's list is stable regardless of insert order.
    expect(staff.grants).toEqual(["Administrator", "Perjadin Editor"]);

    const bare = await resolved("Staff", "bare@ditsama.itb.ac.id");
    expect(bare.grants).toEqual([]);
  });

  it("has an Administrator satisfy every Grant check — Administrator implies all", async () => {
    const admin = await resolved("Staff", "admin@ditsama.itb.ac.id", ["Administrator"]);

    // Holds every Grant without a row of its own for any of them.
    for (const grant of GRANTS) expect(hasGrant(admin, grant), grant).toBe(true);
    expect(() => requireGrant(admin, "Perjadin Editor")).not.toThrow();
  });

  /**
   * **No Grant implies another** (ADR-0052) but Administrator, which implies all, and Dashboard
   * Editor, which implies Dashboard Viewer. Every held/checked pair is pinned.
   */
  it("grants a Staff Person what they hold, and only Dashboard Editor implies another", async () => {
    for (const [index, held] of GRANTS.entries()) {
      const person = await resolved("Staff", `held-${index}@ditsama.itb.ac.id`, [held]);
      for (const checked of GRANTS) {
        const implied =
          held === checked ||
          held === "Administrator" ||
          (held === "Dashboard Editor" && checked === "Dashboard Viewer");
        expect(hasGrant(person, checked), `${held} → ${checked}`).toBe(implied);
      }
    }
  });

  it("refuses a Staff Person a Grant they do not hold, with a distinguishable typed error", async () => {
    const staff = await resolved("Staff", "nogrant@ditsama.itb.ac.id");

    expect(hasGrant(staff, "Perjadin Editor")).toBe(false);

    const refusal = await Promise.resolve()
      .then(() => requireGrant(staff, "Perjadin Editor"))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isNotGrantedError(refusal)).toBe(true);
  });

  it("refuses a Pimpinan any Grant, whatever rows exist — Staff-only wins first", async () => {
    // The fixture forces an Administrator row onto a Pimpinan; the assign path never would.
    const pimpinan = await resolved("Pimpinan", "pimpinan@ditsama.itb.ac.id", ["Administrator"]);

    expect(pimpinan.grants).toEqual(["Administrator"]);
    expect(hasGrant(pimpinan, "Administrator")).toBe(false);
    expect(hasGrant(pimpinan, "Dashboard Viewer")).toBe(false);
    expect(() => requireGrant(pimpinan, "Perjadin Editor")).toThrow();
  });
});

describe("assigning and revoking Grants", () => {
  beforeEach(resetDatabase);

  async function anAdministrator(): Promise<Person> {
    return resolved("Staff", "admin@ditsama.itb.ac.id", ["Administrator"]);
  }

  async function aStaffTarget(): Promise<{ id: string }> {
    return addPerson({ fullName: "Rina", email: "rina@ditsama.itb.ac.id", role: "Staff" });
  }

  it.each(GRANTS)("assigns %s to a Staff Person, then revokes it", async (grant) => {
    const admin = await anAdministrator();
    const target = await aStaffTarget();

    await expect(assignGrant(admin, target.id, grant)).resolves.toEqual({ outcome: "assigned" });
    await expect(personGrants(admin, target.id)).resolves.toEqual([grant]);

    await expect(revokeGrant(admin, target.id, grant)).resolves.toEqual({ outcome: "revoked" });
    await expect(personGrants(admin, target.id)).resolves.toEqual([]);
  });

  it("refuses assigning a Grant to a non-Staff Person", async () => {
    const admin = await anAdministrator();
    const pimpinan = await addPerson({
      fullName: "Bapak",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });

    await expect(assignGrant(admin, pimpinan.id, "Keuangan")).resolves.toEqual({
      outcome: "not-staff-target",
    });
    await expect(personGrants(admin, pimpinan.id)).resolves.toEqual([]);
  });

  it("tells a stale or revoked target apart from a refusal", async () => {
    const admin = await anAdministrator();
    const target = await aStaffTarget();
    await revokePerson(target.id);

    await expect(assignGrant(admin, target.id, "Daring Editor")).resolves.toEqual({
      outcome: "no-such-person",
    });
    await expect(
      assignGrant(admin, "00000000-0000-0000-0000-000000000000", "Daring Editor"),
    ).resolves.toEqual({ outcome: "no-such-person" });
  });

  it("is idempotent — re-assigning a held Grant writes no second row", async () => {
    const admin = await anAdministrator();
    const target = await aStaffTarget();

    await assignGrant(admin, target.id, "Daring Editor");
    await expect(assignGrant(admin, target.id, "Daring Editor")).resolves.toEqual({
      outcome: "assigned",
    });
    await expect(personGrants(admin, target.id)).resolves.toEqual(["Daring Editor"]);
  });

  it("assigns and revokes Dashboard Viewer on a Staff Person, and refuses it to a non-Staff target", async () => {
    const admin = await anAdministrator();
    const target = await aStaffTarget();

    await expect(assignGrant(admin, target.id, "Dashboard Viewer")).resolves.toEqual({
      outcome: "assigned",
    });
    await expect(personGrants(admin, target.id)).resolves.toEqual(["Dashboard Viewer"]);

    await expect(revokeGrant(admin, target.id, "Dashboard Viewer")).resolves.toEqual({
      outcome: "revoked",
    });
    await expect(personGrants(admin, target.id)).resolves.toEqual([]);

    const pimpinan = await addPerson({
      fullName: "Ibu",
      email: "ibu-pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });
    await expect(assignGrant(admin, pimpinan.id, "Dashboard Viewer")).resolves.toEqual({
      outcome: "not-staff-target",
    });
    await expect(personGrants(admin, pimpinan.id)).resolves.toEqual([]);
  });

  it("refuses the write to a Staff Person who is not an Administrator", async () => {
    // A Perjadin Editor is Staff and holds a Grant, but administering Grants is Administrator-only.
    const editor = await resolved("Staff", "editor@ditsama.itb.ac.id", ["Perjadin Editor"]);
    const target = await aStaffTarget();

    const refusal = await assignGrant(editor, target.id, "Perjadin Editor").catch(
      (error: unknown) => error,
    );
    expect(isNotGrantedError(refusal)).toBe(true);
    // The read is Staff-only rather than Administrator-only, so the editor may confirm nothing wrote.
    await expect(personGrants(editor, target.id)).resolves.toEqual([]);
  });
});
