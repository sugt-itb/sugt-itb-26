import { resolvePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Role } from "@sugt/domain";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addPerson, resetDatabase, revokePerson } from "./support/fixtures";
import { signInWithGoogle } from "./support/sign-in";

/**
 * **Seam 2 — the Person-resolution function, called with an explicit `Headers`.**
 *
 * This is the one thing seam 1 cannot show, because resolving a Person happens inside
 * a request rather than at the HTTP boundary. It is **fed by seam 1**: sign in through
 * the handler, take the `Set-Cookie`, hand it here. That keeps it one flow rather than
 * two disconnected fixtures, and it means these inputs are always real ones.
 */
describe("resolving who is asking", () => {
  beforeEach(resetDatabase);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function signIn(role: Role, email: string) {
    const person = await addPerson({ fullName: "Yang Masuk", email, role });
    const result = await signInWithGoogle({
      googleId: `google-${email}`,
      email,
      name: "Yang Masuk",
    });
    if (!result.sessionCookie) throw new Error("Expected the sign-in to issue a session cookie");
    return { person, cookie: result.sessionCookie };
  }

  it("resolves a valid cookie to the right Person, with the right role", async () => {
    const { person, cookie } = await signIn("Staff", "rina@ditsama.itb.ac.id");

    const resolved = await resolvePerson(new Headers({ cookie }));

    expect(resolved).toEqual({
      id: person.id,
      fullName: "Yang Masuk",
      email: "rina@ditsama.itb.ac.id",
      role: "Staff",
      // Grants are threaded onto the caller at resolution, the same as `role` (ADR-0028); a
      // freshly signed-in Staff Person holds none.
      grants: [],
    });
  });

  it("resolves no cookie to null", async () => {
    await expect(resolvePerson(new Headers())).resolves.toBeNull();
  });

  it("resolves a cookie for a deleted session to null", async () => {
    const { cookie } = await signIn("Staff", "hilang@gmail.com");

    await db.delete(schema.authSession).where(sql`true`);

    await expect(resolvePerson(new Headers({ cookie }))).resolves.toBeNull();
  });

  it("refuses a revoked Person on the very next request, and leaves their session row alone", async () => {
    /**
     * **The revocation invariant.** It asserts the property actually wanted —
     * revocation takes effect on the next request — rather than asserting a
     * configuration flag, and it holds with cookie caching either way, because the
     * `active` join is our own read against our own table.
     */
    const { person, cookie } = await signIn("Staff", "dicabut@gmail.com");
    await expect(resolvePerson(new Headers({ cookie }))).resolves.not.toBeNull();

    await revokePerson(person.id);

    await expect(resolvePerson(new Headers({ cookie }))).resolves.toBeNull();
    // Nothing deletes the session row. It is harmless: every request re-reads `active`.
    await expect(db.select().from(schema.authSession)).resolves.toHaveLength(1);
  });
});
