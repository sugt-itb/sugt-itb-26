import { findActivePersonByEmail } from "-/lib/invite-list";
import { canViewDashboard, type Person } from "@sugt/db/queries";
import type { Grant, Role } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { addGrant, addPerson, resetDatabase } from "./support/fixtures";

/**
 * **`canViewDashboard`** — the one predicate behind both the Dashboard (`/`) page guard and the
 * sidebar's Dashboard link (#322). Reading the Dashboard now needs a grant: a `Pimpinan` reads it by
 * Role, a `Staff` by holding `Editor` or `Dashboard Viewer` (an `Administrator` implies both). A
 * grant-less Staff falls through to `false` — the page redirects them to `/pendamping` and the
 * sidebar hides the link.
 *
 * Driven at the same seam `grant-foundation.test.ts` uses: `addPerson` + `addGrant` write the rows,
 * and `findActivePersonByEmail` resolves the caller so `person.grants` is what resolution threads on,
 * not a fabricated array.
 */
async function resolved(role: Role, email: string, grants: Grant[] = []): Promise<Person> {
  const row = await addPerson({ fullName: "Orang", email, role });
  for (const grant of grants) await addGrant(row.id, grant);
  const person = await findActivePersonByEmail(email);
  if (!person) throw new Error(`Resolved no Person for ${email}`);
  return person;
}

describe("canViewDashboard", () => {
  beforeEach(resetDatabase);

  it("lets a Pimpinan read the Dashboard by Role, holding no Grant", async () => {
    const pimpinan = await resolved("Pimpinan", "pimpinan@ditsama.itb.ac.id");
    expect(pimpinan.grants).toEqual([]);
    expect(canViewDashboard(pimpinan)).toBe(true);
  });

  it("lets a Staff holding Dashboard Viewer read the Dashboard", async () => {
    const viewer = await resolved("Staff", "viewer@ditsama.itb.ac.id", ["Dashboard Viewer"]);
    expect(canViewDashboard(viewer)).toBe(true);
  });

  it("lets a Staff holding Editor read the Dashboard", async () => {
    const editor = await resolved("Staff", "editor@ditsama.itb.ac.id", ["Editor"]);
    expect(canViewDashboard(editor)).toBe(true);
  });

  it("lets a Staff holding Administrator read the Dashboard — Administrator implies every Grant", async () => {
    const admin = await resolved("Staff", "admin@ditsama.itb.ac.id", ["Administrator"]);
    expect(canViewDashboard(admin)).toBe(true);
  });

  it("refuses a grant-less Staff — they are the caller redirected to /pendamping", async () => {
    const staff = await resolved("Staff", "plain@ditsama.itb.ac.id");
    expect(staff.grants).toEqual([]);
    expect(canViewDashboard(staff)).toBe(false);
  });
});
