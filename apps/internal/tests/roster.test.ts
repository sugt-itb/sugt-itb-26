import { db, schema } from "@sugt/db";
import { addPerson, isNotStaffError, revokePerson, roster } from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addPerjadin,
  addPerson as seedPerson,
  addProvince,
  addSchool,
  refusedBy,
  resetDatabase,
} from "./support/fixtures";
import { signInAsPerson } from "./support/sign-in";

/**
 * **Orang** — the roster and the invite list. The rules under test are the ones ADR-0013 draws:
 * revoking is one write, a duplicate active email is refused by the partial index, and `used` —
 * the write-once lock — is computed from all **six** composite foreign keys, the Story author
 * included. T3 (#153) dropped `session_teacher`, so its composite reference is gone and a Person
 * can no longer be `used` via one; six references remain. The gate is the invite list alone
 * (ADR-0003, amended by #115): any email may be listed, and with only the one Role left `addPerson`
 * no longer refuses a Staff member on a non-DITSAMA address.
 */

/** A Staff Person to hand the writes as their caller. */
async function staffCaller() {
  return seedPerson({ fullName: "Rina Nurhayati", email: "rina@ditsama.itb.ac.id", role: "Staff" });
}

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but `addPerson` and `revokePerson` still have
 * to reject a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the
 * row. The cast through `unknown` is the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Prof",
    email: "prof@gmail.com",
    role: "Teaching Team" as unknown as Role,
    grants: [],
  };
}

async function oneSchool() {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  return addSchool({ slug: "sman-8", name: "SMAN 8", clusterId: cluster.id, provinceCode: "JB" });
}

const byEmail = (list: Awaited<ReturnType<typeof roster>>, email: string) =>
  list.find((entry) => entry.email === email);

describe("addPerson", () => {
  beforeEach(resetDatabase);

  it("the partial person_email_key refuses a second active row for one email", async () => {
    await seedPerson({ fullName: "Budi", email: "budi@gmail.com", role: "Staff" });

    const refusal = await refusedBy(
      db
        .insert(schema.person)
        .values({ fullName: "Budi Dua", email: "budi@gmail.com", role: "Staff" }),
    );

    expect(refusal).toBe("person_email_key");
  });

  it("refuses a duplicate active email as a value", async () => {
    const staff = await staffCaller();
    await addPerson(staff, { fullName: "Budi", email: "budi@gmail.com", role: "Staff" });

    const again = await addPerson(staff, {
      fullName: "Budi Dua",
      email: "budi@gmail.com",
      role: "Staff",
    });

    expect(again).toEqual({ outcome: "email-taken" });
  });

  it("adds a member on a non-DITSAMA address — the domain rule is gone", async () => {
    const staff = await staffCaller();

    const result = await addPerson(staff, {
      fullName: "Doni",
      email: "doni@gmail.com",
      role: "Staff",
    });

    expect(result.outcome).toBe("added");
    const rows = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.email, "doni@gmail.com"));
    expect(rows).toHaveLength(1);
  });

  it("adds a Staff member with a DITSAMA address", async () => {
    const staff = await staffCaller();

    const result = await addPerson(staff, {
      fullName: "Dewi",
      email: "dewi@ditsama.itb.ac.id",
      role: "Staff",
    });

    expect(result.outcome).toBe("added");
  });

  it("refuses a blank name or email", async () => {
    const staff = await staffCaller();

    expect(
      await addPerson(staff, { fullName: "   ", email: "x@gmail.com", role: "Staff" }),
    ).toEqual({ outcome: "incomplete" });
  });

  it("re-adds an email once the active row is revoked", async () => {
    const staff = await staffCaller();
    const first = await addPerson(staff, {
      fullName: "Budi",
      email: "budi@gmail.com",
      role: "Staff",
    });
    if (first.outcome !== "added") throw new Error("unreachable");
    await revokePerson(staff, first.personId);

    const again = await addPerson(staff, {
      fullName: "Budi Baru",
      email: "budi@gmail.com",
      role: "Staff",
    });

    expect(again.outcome).toBe("added");
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const refusal = await addPerson(nonStaff(), {
      fullName: "Budi",
      email: "budi@gmail.com",
      role: "Staff",
    }).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });
});

describe("revokePerson", () => {
  beforeEach(resetDatabase);

  it("sets active to false in one write", async () => {
    const staff = await staffCaller();
    const person = await seedPerson({
      fullName: "Budi",
      email: "budi@gmail.com",
      role: "Staff",
    });

    expect(await revokePerson(staff, person.id)).toEqual({ outcome: "revoked" });
    const [row] = await db.select().from(schema.person).where(eq(schema.person.id, person.id));
    expect(row?.active).toBe(false);
  });

  it("reports no-such-person when the row is already revoked", async () => {
    const staff = await staffCaller();
    const person = await seedPerson({
      fullName: "Budi",
      email: "budi@gmail.com",
      role: "Staff",
      active: false,
    });

    expect(await revokePerson(staff, person.id)).toEqual({ outcome: "no-such-person" });
  });

  it("throws NotStaffError for a non-Staff caller", async () => {
    const target = await seedPerson({
      fullName: "Budi",
      email: "budi@gmail.com",
      role: "Staff",
    });

    const refusal = await revokePerson(nonStaff(), target.id).catch((error: unknown) => error);

    expect(isNotStaffError(refusal)).toBe(true);
  });
});

describe("roster", () => {
  beforeEach(resetDatabase);

  it("shows the three states — invited, signed in, and revoked", async () => {
    const staff = await staffCaller();
    await seedPerson({ fullName: "Invited", email: "invited@gmail.com", role: "Staff" });
    await signInAsPerson("Staff", "signed@gmail.com", "Signed In");
    const revoked = await seedPerson({
      fullName: "Revoked",
      email: "revoked@gmail.com",
      role: "Staff",
    });
    await revokePerson(staff, revoked.id);

    const list = await roster(staff);
    expect(byEmail(list, "invited@gmail.com")).toMatchObject({ active: true, signedIn: false });
    expect(byEmail(list, "signed@gmail.com")).toMatchObject({ active: true, signedIn: true });
    expect(byEmail(list, "revoked@gmail.com")).toMatchObject({ active: false });
  });

  it("flags a used Person and leaves an unused one unlocked", async () => {
    const staff = await staffCaller();
    const leader = await seedPerson({
      fullName: "Ketua",
      email: "ketua@gmail.com",
      role: "Staff",
    });
    await seedPerson({ fullName: "Unused", email: "unused@gmail.com", role: "Staff" });
    // Being a trip's PIC makes the Person a Group member — used by the group_member composite key.
    // The Teaching Team member this once used is gone: the Group is the PIC alone now, all Staff
    // and none carrying a Stream (T3, #153), so a trip's PIC is the fixture that locks a role.
    await addPerjadin({ advanceIdr: 5_000_000, picPersonId: leader.id });

    const list = await roster(staff);
    expect(byEmail(list, "ketua@gmail.com")?.used).toBe(true);
    expect(byEmail(list, "unused@gmail.com")?.used).toBe(false);
  });

  it("flags a Story author as used — the sixth composite reference", async () => {
    const staff = await staffCaller();
    const author = await seedPerson({
      fullName: "Penulis",
      email: "penulis@ditsama.itb.ac.id",
      role: "Staff",
    });
    const school = await oneSchool();
    await db.insert(schema.story).values({
      slug: "cerita-1",
      schoolId: school.id,
      title: "Judul",
      body: "Isi",
      writtenByPersonId: author.id,
    });

    const list = await roster(staff);
    expect(byEmail(list, "penulis@ditsama.itb.ac.id")?.used).toBe(true);
  });
});
