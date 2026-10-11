import { addPersonAction, revokePersonAction } from "-/app/(app)/orang/actions";
import OrangPage from "-/app/(app)/orang/page";
import { keepLocked } from "-/components/multi-select-combobox";
import { GRANT_OPTIONS } from "-/components/orang-roster";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import type { Grant, Role } from "@sugt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addGrant, addPerson, resetDatabase } from "./support/fixtures";

/**
 * **`/orang` is an Administrator's to manage** (#470). Anyone signed in reads the roster; only an
 * Administrator sees Tambah, Nonaktifkan and the Akses picker, and a Staff member without the Grant
 * calling either write gets a 403 with nothing written. An Administrator's own row offers no
 * Nonaktifkan, and their own Administrator chip carries no remove button.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

async function person(fullName: string, email: string, role: Role, grants: Grant[] = []) {
  const row = await addPerson({ fullName, email, role });
  for (const grant of grants) await addGrant(row.id, grant);
  return { ...row, grants } as Person;
}

/** Sari and Rina administer, Budi is plain Staff, Pak Hadi is a Pimpinan. */
async function people() {
  return {
    sari: await person("Sari", "sari@itb.ac.id", "Staff", ["Administrator"]),
    rina: await person("Rina", "rina@itb.ac.id", "Staff", ["Administrator", "Keuangan"]),
    budi: await person("Budi", "budi@itb.ac.id", "Staff"),
    hadi: await person("Pak Hadi", "hadi@itb.ac.id", "Pimpinan"),
  };
}

async function render(viewer: Person) {
  vi.mocked(requirePerson).mockResolvedValue(viewer);
  return renderToStaticMarkup(await OrangPage());
}

/** What a call throws, as its `digest`, or `null` when it returns. */
async function digestOf(call: Promise<unknown>) {
  const thrown = await call.then(
    () => null,
    (error: unknown) => error as { digest?: string },
  );
  return thrown?.digest ?? null;
}

describe("reading /orang", () => {
  it("shows everyone signed in the roster, and only an Administrator its controls", async () => {
    const who = await people();

    for (const [viewer, administers] of [
      [who.budi, false],
      [who.hadi, false],
      [who.sari, true],
    ] as const) {
      const html = await render(viewer);
      for (const name of ["Sari", "Rina", "Budi", "Pak Hadi"]) expect(html).toContain(name);
      expect(html.includes(">Tambah<"), viewer.email).toBe(administers);
      expect(html.includes(">Nonaktifkan<"), viewer.email).toBe(administers);
      expect(html.includes(">Akses<"), viewer.email).toBe(administers);
    }
    expect(await render(who.sari)).toContain("hanya Administrator yang menambah dan menonaktifkan");
  });

  it("offers an Administrator no lockout on their own row: no Nonaktifkan, a locked Administrator chip", async () => {
    const who = await people();
    const html = await render(who.sari);

    // Rina, Budi and Pak Hadi each have a Nonaktifkan; Sari's own row does not.
    expect(html.match(/>Nonaktifkan</g)).toHaveLength(3);
    const chips = (name: string) => {
      const row = html.slice(
        html.indexOf(`>${name}<`),
        html.indexOf("</tr>", html.indexOf(`>${name}<`)),
      );
      return [
        ...row.matchAll(/data-slot="combobox-chip"[^>]*aria-label="([^"]+)"[^>]*>(.*?)<\/div>/g),
      ].map(([, label, inner]) => [label, inner!.includes('data-slot="combobox-chip-remove"')]);
    };
    expect(chips("Sari")).toEqual([["Administrator", false]]);
    // Another Administrator's chip can be removed, and only stored Grants are chips.
    expect(chips("Rina")).toEqual([
      ["Administrator", true],
      ["Keuangan", true],
    ]);
  });
});

describe("the roster's writes", () => {
  it("answer a Staff member without the Administrator Grant with a 403, writing nothing", async () => {
    const who = await people();
    vi.mocked(requirePerson).mockResolvedValue(who.budi);

    await expect(
      digestOf(addPersonAction({ fullName: "Dewi", email: "dewi@itb.ac.id", role: "Staff" })),
    ).resolves.toBe(FORBIDDEN);
    await expect(digestOf(revokePersonAction(who.rina.id))).resolves.toBe(FORBIDDEN);

    const rows = await db.select().from(schema.person);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.active)).toBe(true);
  });

  it("let an Administrator add a Person and deactivate another Administrator, never themselves", async () => {
    const who = await people();
    vi.mocked(requirePerson).mockResolvedValue(who.sari);

    await expect(
      addPersonAction({ fullName: "Dewi", email: "dewi@itb.ac.id", role: "Staff" }),
    ).resolves.toMatchObject({ outcome: "added" });
    await expect(revokePersonAction(who.sari.id)).resolves.toEqual({ outcome: "self" });
    await expect(revokePersonAction(who.rina.id)).resolves.toEqual({ outcome: "revoked" });
  });
});

describe("the Grant picker's options and lock", () => {
  it("offers the six Grants in order, each with the line saying what it gates", () => {
    expect(GRANT_OPTIONS.map((option) => [option.value, option.description])).toEqual([
      ["Administrator", "semua akses"],
      ["Keuangan", "belum ada fitur"],
      ["Perjadin Editor", "merencanakan dan menulis setiap Perjadin"],
      ["Daring Editor", "Sesi daring dan Pretest"],
      ["Dashboard Editor", "termasuk Dashboard Viewer"],
      ["Dashboard Viewer", "membaca Dashboard"],
    ]);
  });

  it("puts back a locked value a change dropped, and leaves every other change alone", () => {
    const held = ["Administrator", "Keuangan"];

    // A Backspace, or a click on the locked row, drops Administrator: it comes back.
    expect(keepLocked(["Keuangan"], held, ["Administrator"])).toEqual([
      "Keuangan",
      "Administrator",
    ]);
    // Removing another chip, or adding one, goes through.
    expect(keepLocked(["Administrator"], held, ["Administrator"])).toEqual(["Administrator"]);
    expect(keepLocked([...held, "Daring Editor"], held, ["Administrator"])).toEqual([
      ...held,
      "Daring Editor",
    ]);
    // Nothing locked, or a locked value never chosen, changes nothing.
    expect(keepLocked(["Keuangan"], held, [])).toEqual(["Keuangan"]);
    expect(keepLocked([], [], ["Administrator"])).toEqual([]);
  });
});
