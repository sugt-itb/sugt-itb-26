import { findActivePersonByEmail } from "-/lib/invite-list";
import { db, schema } from "@sugt/db";
import {
  canViewKeuangan,
  isNotGrantedError,
  keuanganSourceCard,
  keuanganSourceForRead,
  setKeuanganSource,
  type Person,
} from "@sugt/db/queries";
import type { Grant, Role } from "@sugt/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { addGrant, addPerson, resetDatabase } from "./support/fixtures";

/**
 * **Who reads `/keuangan`, and the one stored row naming the Block B tab it reads** (#549).
 *
 * `canViewKeuangan` is the page's predicate: a Staff Person holding Keuangan (an Administrator
 * implies it), or a Pimpinan by Role, since a Pimpinan holds no Grant. The source is one row or none;
 * an Administrator sets and sees all of it on `/pengaturan`, and the page's readers get only the sheet
 * id, the gid and when it was set — never the URL or who set it. Made-up URL and sheet id only: the
 * repo is public.
 */

async function resolved(role: Role, email: string, grants: Grant[] = []): Promise<Person> {
  const row = await addPerson({ fullName: email.split("@")[0]!, email, role });
  for (const grant of grants) await addGrant(row.id, grant);
  const person = await findActivePersonByEmail(email);
  if (!person) throw new Error(`Resolved no Person for ${email}`);
  return person;
}

const OTHER_GRANTS = [
  "Perjadin Editor",
  "Daring Editor",
  "Dashboard Editor",
  "Dashboard Viewer",
] as const;

describe("canViewKeuangan", () => {
  beforeEach(resetDatabase);

  it("admits a Staff holding Keuangan", async () => {
    expect(canViewKeuangan(await resolved("Staff", "kiki@itb.ac.id", ["Keuangan"]))).toBe(true);
  });

  it("admits an Administrator, who implies Keuangan", async () => {
    expect(canViewKeuangan(await resolved("Staff", "ani@itb.ac.id", ["Administrator"]))).toBe(true);
  });

  it("admits a Pimpinan by Role, holding no Grant", async () => {
    const pimpinan = await resolved("Pimpinan", "pak@itb.ac.id");
    expect(pimpinan.grants).toEqual([]);
    expect(canViewKeuangan(pimpinan)).toBe(true);
  });

  it.each(OTHER_GRANTS)("refuses a Staff holding only %s", async (grant) => {
    expect(canViewKeuangan(await resolved("Staff", "orang@itb.ac.id", [grant]))).toBe(false);
  });

  it("refuses a grant-less Staff", async () => {
    expect(canViewKeuangan(await resolved("Staff", "rina@itb.ac.id"))).toBe(false);
  });
});

describe("the Block B source", () => {
  beforeEach(resetDatabase);

  const FIRST = {
    url: "https://docs.google.com/spreadsheets/d/made-up-first/edit#gid=7",
    sheetId: "made-up-first",
    gid: "7",
  };
  const SECOND = {
    url: "https://docs.google.com/spreadsheets/d/made-up-second/edit?gid=9",
    sheetId: "made-up-second",
    gid: "9",
  };

  const refusal = (call: Promise<unknown>) =>
    call.then(
      () => "admitted",
      (error: unknown) => (isNotGrantedError(error) ? "refused" : error),
    );

  it("is unset until an Administrator sets it", async () => {
    const admin = await resolved("Staff", "ani@itb.ac.id", ["Administrator"]);
    await expect(keuanganSourceCard(admin)).resolves.toBeNull();
    await expect(keuanganSourceForRead(admin)).resolves.toBeNull();
  });

  it("shows an Administrator the URL as pasted, the id, the gid, when and by whom", async () => {
    const admin = await resolved("Staff", "ani@itb.ac.id", ["Administrator"]);
    await setKeuanganSource(admin, FIRST);

    await expect(keuanganSourceCard(admin)).resolves.toEqual({
      ...FIRST,
      updatedAt: expect.any(Date),
      setByName: "ani",
    });
  });

  it("replaces the row on a second save rather than adding one", async () => {
    const ani = await resolved("Staff", "ani@itb.ac.id", ["Administrator"]);
    const budi = await resolved("Staff", "budi@itb.ac.id", ["Administrator"]);
    await setKeuanganSource(ani, FIRST);
    // Back-date the first save, so a second save that kept its time could not pass for a fresh one.
    const longAgo = new Date("2026-01-01T00:00:00Z");
    await db.update(schema.keuanganSource).set({ updatedAt: longAgo });

    await setKeuanganSource(budi, SECOND);

    await expect(db.select().from(schema.keuanganSource)).resolves.toHaveLength(1);
    const second = await keuanganSourceCard(ani);
    expect(second).toEqual({ ...SECOND, updatedAt: expect.any(Date), setByName: "budi" });
    expect(second!.updatedAt.getTime()).toBeGreaterThan(longAgo.getTime());
  });

  it("gives the page's readers the sheet id, the gid and when — never the URL or the setter", async () => {
    const admin = await resolved("Staff", "ani@itb.ac.id", ["Administrator"]);
    await setKeuanganSource(admin, FIRST);

    for (const reader of [
      admin,
      await resolved("Staff", "kiki@itb.ac.id", ["Keuangan"]),
      await resolved("Pimpinan", "pak@itb.ac.id"),
    ]) {
      await expect(keuanganSourceForRead(reader)).resolves.toStrictEqual({
        sheetId: "made-up-first",
        gid: "7",
        updatedAt: expect.any(Date),
      });
    }
  });

  it("refuses the read to every Staff the page refuses", async () => {
    for (const [index, grants] of [[], ...OTHER_GRANTS.map((g) => [g])].entries()) {
      const staff = await resolved("Staff", `staff-${index}@itb.ac.id`, grants as Grant[]);
      await expect(refusal(keuanganSourceForRead(staff)), grants.join() || "none").resolves.toBe(
        "refused",
      );
    }
  });

  it("admits only an Administrator to the card and the save, and a refused save writes nothing", async () => {
    for (const caller of [
      await resolved("Staff", "kiki@itb.ac.id", ["Keuangan"]),
      await resolved("Pimpinan", "pak@itb.ac.id"),
      await resolved("Staff", "eka@itb.ac.id", ["Perjadin Editor", "Dashboard Editor"]),
      await resolved("Staff", "rina@itb.ac.id"),
    ]) {
      await expect(refusal(keuanganSourceCard(caller)), caller.email).resolves.toBe("refused");
      await expect(refusal(setKeuanganSource(caller, FIRST)), caller.email).resolves.toBe(
        "refused",
      );
    }
    await expect(db.select().from(schema.keuanganSource)).resolves.toEqual([]);
  });
});
