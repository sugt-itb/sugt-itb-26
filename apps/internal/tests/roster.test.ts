import { db, schema } from "@sugt/db";
import {
  addPerson,
  isNotGrantedError,
  isNotStaffError,
  revokePerson,
  roster,
  type Person,
} from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addGrant,
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

/** An Administrator to hand the writes as their caller — adding and revoking People is theirs (#470). */
async function administrator(email = "rina@ditsama.itb.ac.id"): Promise<Person> {
  const person = await seedPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
  await addGrant(person.id, "Administrator");
  return { ...person, grants: ["Administrator"] };
}

/** A Staff Person with no Grant — the caller #470 takes the roster's writes away from. */
async function plainStaff(): Promise<Person> {
  const person = await seedPerson({
    fullName: "Budi Staf",
    email: "staf@gmail.com",
    role: "Staff",
  });
  return { ...person, grants: [] };
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
    const admin = await administrator();
    await addPerson(admin, { fullName: "Budi", email: "budi@gmail.com", role: "Staff" });

    const again = await addPerson(admin, {
      fullName: "Budi Dua",
      email: "budi@gmail.com",
      role: "Staff",
    });

    expect(again).toEqual({ outcome: "email-taken" });
  });

  it("adds a member on a non-DITSAMA address — the domain rule is gone", async () => {
    const admin = await administrator();

    const result = await addPerson(admin, {
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
    const admin = await administrator();

    const result = await addPerson(admin, {
      fullName: "Dewi",
      email: "dewi@ditsama.itb.ac.id",
      role: "Staff",
    });

    expect(result.outcome).toBe("added");
  });

  it("refuses a blank name or email", async () => {
    const admin = await administrator();

    expect(
      await addPerson(admin, { fullName: "   ", email: "x@gmail.com", role: "Staff" }),
    ).toEqual({ outcome: "incomplete" });
  });

  it("re-adds an email once the active row is revoked", async () => {
    const admin = await administrator();
    const first = await addPerson(admin, {
      fullName: "Budi",
      email: "budi@gmail.com",
      role: "Staff",
    });
    if (first.outcome !== "added") throw new Error("unreachable");
    await revokePerson(admin, first.personId);

    const again = await addPerson(admin, {
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
    const admin = await administrator();
    const person = await seedPerson({
      fullName: "Budi",
      email: "budi@gmail.com",
      role: "Staff",
    });

    expect(await revokePerson(admin, person.id)).toEqual({ outcome: "revoked" });
    const [row] = await db.select().from(schema.person).where(eq(schema.person.id, person.id));
    expect(row?.active).toBe(false);
  });

  it("reports no-such-person when the row is already revoked", async () => {
    const admin = await administrator();
    const person = await seedPerson({
      fullName: "Budi",
      email: "budi@gmail.com",
      role: "Staff",
      active: false,
    });

    expect(await revokePerson(admin, person.id)).toEqual({ outcome: "no-such-person" });
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

describe("the roster's writes are an Administrator's (#470)", () => {
  beforeEach(resetDatabase);

  it("refuses a Staff member without the Administrator Grant both writes, and writes nothing", async () => {
    const staff = await plainStaff();
    const target = await seedPerson({ fullName: "Budi", email: "budi@gmail.com", role: "Staff" });

    const added = await addPerson(staff, {
      fullName: "Dewi",
      email: "dewi@gmail.com",
      role: "Staff",
    }).catch((error: unknown) => error);
    const revoked = await revokePerson(staff, target.id).catch((error: unknown) => error);

    expect(isNotGrantedError(added)).toBe(true);
    expect(isNotGrantedError(revoked)).toBe(true);
    const rows = await db.select().from(schema.person);
    expect(rows.map((row) => [row.email, row.active]).toSorted()).toEqual([
      ["budi@gmail.com", true],
      ["staf@gmail.com", true],
    ]);
  });

  it("refuses an Administrator deactivating themselves, and lets them deactivate another", async () => {
    const admin = await administrator();
    const other = await administrator("sari@ditsama.itb.ac.id");

    await expect(revokePerson(admin, admin.id)).resolves.toEqual({ outcome: "self" });
    const [self] = await db.select().from(schema.person).where(eq(schema.person.id, admin.id));
    expect(self?.active).toBe(true);

    await expect(revokePerson(admin, other.id)).resolves.toEqual({ outcome: "revoked" });
  });
});

describe("roster", () => {
  beforeEach(resetDatabase);

  it("refuses everyone but an Administrator, a Pimpinan included (#488)", async () => {
    const staff = await plainStaff();
    const pimpinan = await seedPerson({
      fullName: "Pak Hadi",
      email: "hadi@gmail.com",
      role: "Pimpinan",
    });

    for (const caller of [staff, { ...pimpinan, grants: [] } as Person]) {
      const refused = await roster(caller).catch((error: unknown) => error);
      expect(isNotGrantedError(refused), caller.email).toBe(true);
    }
    await expect(roster(await administrator())).resolves.toHaveLength(3);
  });

  it("shows the three states — invited, signed in, and revoked", async () => {
    const admin = await administrator();
    await seedPerson({ fullName: "Invited", email: "invited@gmail.com", role: "Staff" });
    await signInAsPerson("Staff", "signed@gmail.com", "Signed In");
    const revoked = await seedPerson({
      fullName: "Revoked",
      email: "revoked@gmail.com",
      role: "Staff",
    });
    await revokePerson(admin, revoked.id);

    const list = await roster(admin);
    expect(byEmail(list, "invited@gmail.com")).toMatchObject({ active: true, signedIn: false });
    expect(byEmail(list, "signed@gmail.com")).toMatchObject({ active: true, signedIn: true });
    expect(byEmail(list, "revoked@gmail.com")).toMatchObject({ active: false });
  });

  it("flags a used Person and leaves an unused one unlocked", async () => {
    const admin = await administrator();
    const leader = await seedPerson({
      fullName: "Ketua",
      email: "ketua@gmail.com",
      role: "Staff",
    });
    await seedPerson({ fullName: "Unused", email: "unused@gmail.com", role: "Staff" });
    // Being a trip's PIC makes the Person a Group member — used by the group_member composite key.
    // The Teaching Team member this once used is gone: the Group is the PIC alone now, all Staff
    // and none carrying a Stream (T3, #153), so a trip's PIC is the fixture that locks a role.
    await addPerjadin({ picPersonId: leader.id });

    const list = await roster(admin);
    expect(byEmail(list, "ketua@gmail.com")?.used).toBe(true);
    expect(byEmail(list, "unused@gmail.com")?.used).toBe(false);
  });

  it("flags a Story author as used — the sixth composite reference", async () => {
    const admin = await administrator();
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

    const list = await roster(admin);
    expect(byEmail(list, "penulis@ditsama.itb.ac.id")?.used).toBe(true);
  });

  it("carries each Person's Grants, ordered, and an empty list for one with none", async () => {
    // The roster's Grant-management column reads these per row (ADR-0028), so the read carries them.
    const admin = await administrator();
    const granted = await seedPerson({
      fullName: "Diberi",
      email: "diberi@ditsama.itb.ac.id",
      role: "Staff",
    });
    await addGrant(granted.id, "Keuangan");
    await addGrant(granted.id, "Administrator");
    await seedPerson({ fullName: "Tanpa", email: "tanpa@ditsama.itb.ac.id", role: "Staff" });

    const list = await roster(admin);
    // array_agg orders on the grant, so the row's list is stable regardless of insert order.
    expect(byEmail(list, "diberi@ditsama.itb.ac.id")?.grants).toEqual([
      "Administrator",
      "Keuangan",
    ]);
    expect(byEmail(list, "tanpa@ditsama.itb.ac.id")?.grants).toEqual([]);
  });
});
