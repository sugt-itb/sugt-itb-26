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
import type { Grant, Role } from "@sugt/domain";
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
      "Monitoring Editor",
      "Administrator",
    ]);
    // array_agg orders on the grant, so the caller's list is stable regardless of insert order.
    expect(staff.grants).toEqual(["Administrator", "Monitoring Editor"]);

    const bare = await resolved("Staff", "bare@ditsama.itb.ac.id");
    expect(bare.grants).toEqual([]);
  });

  it("has an Administrator satisfy every Grant check — Administrator implies all", async () => {
    const admin = await resolved("Staff", "admin@ditsama.itb.ac.id", ["Administrator"]);

    // Holds Monitoring Editor without a Monitoring Editor row of its own.
    expect(hasGrant(admin, "Monitoring Editor")).toBe(true);
    expect(hasGrant(admin, "Administrator")).toBe(true);
    expect(() => requireGrant(admin, "Monitoring Editor")).not.toThrow();
  });

  it("grants a Staff Person exactly the Grant they hold", async () => {
    const editor = await resolved("Staff", "editor@ditsama.itb.ac.id", ["Monitoring Editor"]);

    expect(hasGrant(editor, "Monitoring Editor")).toBe(true);
    expect(hasGrant(editor, "Administrator")).toBe(false);
  });

  it("refuses a Staff Person a Grant they do not hold, with a distinguishable typed error", async () => {
    const staff = await resolved("Staff", "nogrant@ditsama.itb.ac.id");

    expect(hasGrant(staff, "Monitoring Editor")).toBe(false);

    const refusal = await Promise.resolve()
      .then(() => requireGrant(staff, "Monitoring Editor"))
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
    expect(hasGrant(pimpinan, "Monitoring Editor")).toBe(false);
    expect(() => requireGrant(pimpinan, "Monitoring Editor")).toThrow();
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

  it("assigns a Grant to a Staff Person, then revokes it", async () => {
    const admin = await anAdministrator();
    const target = await aStaffTarget();

    await expect(assignGrant(admin, target.id, "Monitoring Editor")).resolves.toEqual({
      outcome: "assigned",
    });
    await expect(personGrants(admin, target.id)).resolves.toEqual(["Monitoring Editor"]);

    await expect(revokeGrant(admin, target.id, "Monitoring Editor")).resolves.toEqual({
      outcome: "revoked",
    });
    await expect(personGrants(admin, target.id)).resolves.toEqual([]);
  });

  it("refuses assigning a Grant to a non-Staff Person", async () => {
    const admin = await anAdministrator();
    const pimpinan = await addPerson({
      fullName: "Bapak",
      email: "pimpinan@ditsama.itb.ac.id",
      role: "Pimpinan",
    });

    await expect(assignGrant(admin, pimpinan.id, "Monitoring Editor")).resolves.toEqual({
      outcome: "not-staff-target",
    });
    await expect(personGrants(admin, pimpinan.id)).resolves.toEqual([]);
  });

  it("tells a stale or revoked target apart from a refusal", async () => {
    const admin = await anAdministrator();
    const target = await aStaffTarget();
    await revokePerson(target.id);

    await expect(assignGrant(admin, target.id, "Monitoring Editor")).resolves.toEqual({
      outcome: "no-such-person",
    });
    await expect(
      assignGrant(admin, "00000000-0000-0000-0000-000000000000", "Monitoring Editor"),
    ).resolves.toEqual({ outcome: "no-such-person" });
  });

  it("is idempotent — re-assigning a held Grant writes no second row", async () => {
    const admin = await anAdministrator();
    const target = await aStaffTarget();

    await assignGrant(admin, target.id, "Monitoring Editor");
    await expect(assignGrant(admin, target.id, "Monitoring Editor")).resolves.toEqual({
      outcome: "assigned",
    });
    await expect(personGrants(admin, target.id)).resolves.toEqual(["Monitoring Editor"]);
  });

  it("refuses the write to a Staff Person who is not an Administrator", async () => {
    // A Monitoring Editor is Staff and holds a Grant, but administering Grants is Administrator-only.
    const editor = await resolved("Staff", "editor@ditsama.itb.ac.id", ["Monitoring Editor"]);
    const target = await aStaffTarget();

    const refusal = await assignGrant(editor, target.id, "Monitoring Editor").catch(
      (error: unknown) => error,
    );
    expect(isNotGrantedError(refusal)).toBe(true);
    // The read is Staff-only rather than Administrator-only, so the editor may confirm nothing wrote.
    await expect(personGrants(editor, target.id)).resolves.toEqual([]);
  });
});
