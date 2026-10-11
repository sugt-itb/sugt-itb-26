import PerjadinPage from "-/app/(app)/perjadin/page";
import { levelHref, parseLevelParams, scopeOf } from "-/app/(app)/perjadin/pengaturan/level-params";
import Page from "-/app/(app)/perjadin/pengaturan/page";
import { requirePerson } from "-/lib/person";
import type { Person } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addGrant,
  addPerjadin,
  addPerson,
  addSubCluster,
  COMPANY_PREPARATION_ITEMS,
  resetDatabase,
  wibDaysFromToday,
} from "./support/fixtures";

/**
 * **`/perjadin/pengaturan`, the page** (#422): Administrator only — a grant-less Staff member, an
 * Editor and a Pimpinan get the 403 — reached from a button on `/perjadin` that only an Administrator
 * is shown. The level is the URL, parsed leniently. Rendered to static markup with the router
 * stubbed, since the editor is a client component that navigates.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined }),
}));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";

async function digestOf(call: Promise<unknown>) {
  const thrown = await call.then(
    () => null,
    (error: unknown) => error,
  );
  return (thrown as { digest?: string } | null)?.digest;
}

const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) } as never));

async function administrator(): Promise<Person> {
  const admin = await addPerson({ fullName: "Admin", email: "admin@itb.ac.id", role: "Staff" });
  await addGrant(admin.id, "Administrator");
  return { ...admin, grants: ["Administrator"] } as Person;
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

describe("only an Administrator reaches Pengaturan Perjadin", () => {
  it("forbids a grant-less Staff member, an Editor and a Pimpinan", async () => {
    const staff = await addPerson({ fullName: "Staf", email: "staf@itb.ac.id", role: "Staff" });
    const editor = await addPerson({ fullName: "Ed", email: "ed@itb.ac.id", role: "Staff" });
    await addGrant(editor.id, "Editor");
    const pimpinan = await addPerson({ fullName: "Pim", email: "pim@itb.ac.id", role: "Pimpinan" });

    for (const person of [staff, { ...editor, grants: ["Editor"] } as Person, pimpinan]) {
      vi.mocked(requirePerson).mockResolvedValue(person);
      await expect(digestOf(render())).resolves.toBe(FORBIDDEN);
    }
  });

  it("shows an Administrator the Semua list, the system item with no Hapus", async () => {
    vi.mocked(requirePerson).mockResolvedValue(await administrator());

    const html = await render();

    for (const label of COMPANY_PREPARATION_ITEMS) expect(html).toContain(label);
    // Fourteen items, thirteen Hapus buttons: the system item has none.
    expect(html.match(/>Hapus</g)).toHaveLength(COMPANY_PREPARATION_ITEMS.length - 1);
    expect(html).toContain("Tidak bisa dihapus");
    expect(html).toContain("Tambah item");
  });

  it("shows the Pengaturan Perjadin button on /perjadin to an Administrator only", async () => {
    const staff = await addPerson({ fullName: "Staf", email: "staf@itb.ac.id", role: "Staff" });
    const renderList = async () => renderToStaticMarkup(await PerjadinPage());

    vi.mocked(requirePerson).mockResolvedValue(staff);
    expect(await renderList()).not.toContain("Pengaturan Perjadin");

    vi.mocked(requirePerson).mockResolvedValue(await administrator());
    const html = await renderList();
    expect(html).toContain("Pengaturan Perjadin");
    expect(html).toContain('href="/perjadin/pengaturan"');
  });

  it("asks for a Perjadin before showing one, and says when the one asked for is gone", async () => {
    const admin = await administrator();
    vi.mocked(requirePerson).mockResolvedValue(admin);
    const clusterId = (await addCluster({ slug: "c", name: "Cluster Satu" })).id;
    const subClusterId = (await addSubCluster({ slug: "k", name: "Kelompok 1", clusterId })).id;
    const trip = await addPerjadin({
      picPersonId: admin.id,
      subClusterId,
      startsOn: wibDaysFromToday(1),
      endsOn: wibDaysFromToday(3),
    });

    expect(await render({ tingkat: "perjadin" })).toContain("Pilih Perjadin");
    expect(
      await render({ tingkat: "perjadin", perjadin: "00000000-0000-0000-0000-000000000000" }),
    ).toContain("tidak ditemukan");
    const html = await render({ tingkat: "perjadin", perjadin: trip.id });
    expect(html).toContain("Perjadin ini");
    expect(html).toContain(COMPANY_PREPARATION_ITEMS[0]);
  });
});

describe("the level in the URL", () => {
  const clusters = ["c1", "c2"];

  it("reads Semua by default and for anything unknown", () => {
    expect(parseLevelParams({}, clusters)).toEqual({ level: "semua" });
    expect(parseLevelParams({ tingkat: "lain" }, clusters)).toEqual({ level: "semua" });
  });

  it("falls back to the first Cluster for a missing or unknown one", () => {
    expect(parseLevelParams({ tingkat: "cluster", cluster: "c2" }, clusters)).toEqual({
      level: "cluster",
      clusterId: "c2",
    });
    expect(parseLevelParams({ tingkat: "cluster", cluster: "x" }, clusters)).toEqual({
      level: "cluster",
      clusterId: "c1",
    });
    expect(scopeOf(parseLevelParams({ tingkat: "cluster" }, []))).toBeNull();
  });

  it("drops a Perjadin id that is not a UUID", () => {
    expect(parseLevelParams({ tingkat: "perjadin", perjadin: "1; drop" }, clusters)).toEqual({
      level: "perjadin",
      perjadinId: null,
    });
  });

  it("writes back only what a level needs, and reads back what it wrote", () => {
    const id = "0b9f8a62-2f7e-4c3e-9d1a-6a2b5c4d3e2f";
    expect(levelHref({ level: "semua" })).toBe("/perjadin/pengaturan");
    expect(levelHref({ level: "cluster", clusterId: "c2" })).toBe(
      "/perjadin/pengaturan?tingkat=cluster&cluster=c2",
    );
    const href = levelHref({ level: "perjadin", perjadinId: id });
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseLevelParams(params, clusters)).toEqual({ level: "perjadin", perjadinId: id });
  });
});
