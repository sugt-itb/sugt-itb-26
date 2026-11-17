import { setKeuanganSourceAction } from "-/app/(app)/pengaturan/actions";
import { keuanganSaveMessage } from "-/app/(app)/pengaturan/keuangan-source-form";
import Page from "-/app/(app)/pengaturan/page";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import { setKeuanganSource, type Person } from "@sugt/db/queries";
import type { Grant, Role } from "@sugt/domain";
import { revalidatePath } from "next/cache";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { digestOf, FORBIDDEN } from "./support/drive";
import { addPerson, resetDatabase, withGrant } from "./support/fixtures";

/**
 * **The Block B source card on `/pengaturan`** (#571): an Administrator pastes the Block B tab's
 * address, and it is stored only if the whole tab reads and parses.
 *
 * Against the real database and the real reader, with only `fetch` stubbed — the sheet is the one
 * thing no test can reach — and made-up CSV, URL and sheet ids: the repo is public.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OLD = {
  url: "https://docs.google.com/spreadsheets/d/made-up-old/edit#gid=1",
  sheetId: "made-up-old",
  gid: "1",
};
const NEW_URL = "https://docs.google.com/spreadsheets/d/made-up-new/edit#gid=42";
const NEW_EXPORT = "https://docs.google.com/spreadsheets/d/made-up-new/export?format=csv&gid=42";

const HEADERS = [
  "Sub Blok Anggaran",
  "Kegiatan",
  "Link",
  "Link_raw",
  "Alokasi_formula",
  "Tgl",
  "Bln",
  "Thn",
  "Alokasi",
  "Realisasi",
  "Sisa",
];

/** A made-up Block B tab: two Kelompok and Finance's total row, with `drop` left out of the header. */
function blockB(drop?: string) {
  const row = (cells: Record<string, string>) =>
    HEADERS.filter((h) => h !== drop)
      .map((h) => cells[h] ?? "")
      .join(",");
  return [
    HEADERS.filter((h) => h !== drop).join(","),
    "",
    row({ "Sub Blok Anggaran": "Kelompok 1" }),
    row({
      Kegiatan: "Konsumsi",
      Alokasi_formula: "FALSE",
      Alokasi: "1000000",
      Realisasi: "250000",
    }),
    row({ "Sub Blok Anggaran": "Kelompok 2" }),
    row({
      Kegiatan: "Transportasi",
      Alokasi_formula: "FALSE",
      Alokasi: "500000",
      Realisasi: "100000",
    }),
    row({ Realisasi: "350000" }),
  ].join("\n");
}

async function staff(role: Role, email: string, grants: Grant[] = []): Promise<Person> {
  let person: Person = await addPerson({ fullName: email.split("@")[0]!, email, role });
  for (const grant of grants) person = await withGrant(person, grant);
  return person;
}

/** Stub `fetch` to answer every request with `body` as CSV, and record what was asked for. */
function stubSheet(body: string) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(body, { status: 200, headers: { "content-type": "text/csv" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const fetchedUrls = (fetch: ReturnType<typeof stubSheet>) =>
  fetch.mock.calls.map(([input]) => String(input));

async function storedSource() {
  return db.select().from(schema.keuanganSource);
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving the Block B source", () => {
  it.each([
    ["a Keuangan holder", "Staff", ["Keuangan"]],
    ["a Perjadin Editor", "Staff", ["Perjadin Editor"]],
    ["a grant-less Staff", "Staff", []],
    ["a Pimpinan", "Pimpinan", []],
  ] as [string, Role, Grant[]][])(
    "refuses %s with the 403, fetching nothing and storing nothing",
    async (_, role, grants) => {
      vi.mocked(requirePerson).mockResolvedValue(await staff(role, "orang@itb.ac.id", grants));
      const fetch = stubSheet(blockB());

      await expect(digestOf(setKeuanganSourceAction(NEW_URL))).resolves.toBe(FORBIDDEN);

      expect(fetch).not.toHaveBeenCalled();
      await expect(storedSource()).resolves.toEqual([]);
    },
  );

  it.each([
    ["another host", "https://example.com/spreadsheets/d/made-up-new/edit#gid=42"],
    ["a missing gid", "https://docs.google.com/spreadsheets/d/made-up-new/edit"],
    ["text that is no address", "Blok B"],
  ])("refuses %s before any fetch, keeping the old source", async (_, text) => {
    const admin = await staff("Staff", "ani@itb.ac.id", ["Administrator"]);
    vi.mocked(requirePerson).mockResolvedValue(admin);
    await setKeuanganSource(admin, OLD);
    const fetch = stubSheet(blockB());

    const result = await setKeuanganSourceAction(text);

    expect(result).toEqual({ ok: false, detail: expect.stringMatching(/\S/) });
    expect(fetch).not.toHaveBeenCalled();
    await expect(storedSource()).resolves.toMatchObject([OLD]);
  });

  it("keeps the old source and says exactly why when the sheet does not parse", async () => {
    const admin = await staff("Staff", "ani@itb.ac.id", ["Administrator"]);
    vi.mocked(requirePerson).mockResolvedValue(admin);
    await setKeuanganSource(admin, OLD);
    const fetch = stubSheet(blockB("Link_raw"));

    const result = await setKeuanganSourceAction(NEW_URL);

    expect(result).toEqual({
      ok: false,
      detail: 'Kolom "Link_raw" tidak ditemukan di baris 1–2.',
    });
    expect(fetchedUrls(fetch)).toEqual([NEW_EXPORT]);
    await expect(storedSource()).resolves.toMatchObject([OLD]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the old source when the sheet cannot be reached", async () => {
    const admin = await staff("Staff", "ani@itb.ac.id", ["Administrator"]);
    vi.mocked(requirePerson).mockResolvedValue(admin);
    await setKeuanganSource(admin, OLD);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const result = await setKeuanganSourceAction(NEW_URL);

    expect(result).toEqual({ ok: false, detail: "Spreadsheet tidak dapat dihubungi." });
    await expect(storedSource()).resolves.toMatchObject([OLD]);
  });

  it("stores a good tab, fetching only the export URL, and reports its Kelompok and total", async () => {
    const admin = await staff("Staff", "ani@itb.ac.id", ["Administrator"]);
    vi.mocked(requirePerson).mockResolvedValue(admin);
    await setKeuanganSource(admin, OLD);
    const budi = await staff("Staff", "budi@itb.ac.id", ["Administrator"]);
    vi.mocked(requirePerson).mockResolvedValue(budi);
    const fetch = stubSheet(blockB());

    const result = await setKeuanganSourceAction(`  ${NEW_URL}\n`);

    expect(result).toEqual({ ok: true, kelompok: 2, totalRealisasi: 350_000 });
    // Both pages that show the source re-render with the new one.
    expect(revalidatePath).toHaveBeenCalledWith("/pengaturan");
    expect(revalidatePath).toHaveBeenCalledWith("/keuangan");
    expect(fetchedUrls(fetch)).toEqual([NEW_EXPORT]);
    await expect(storedSource()).resolves.toEqual([
      {
        singleton: true,
        url: NEW_URL,
        sheetId: "made-up-new",
        gid: "42",
        updatedAt: expect.any(Date),
        setByPersonId: budi.id,
      },
    ]);
  });

  it("confirms a save with the Kelompok count and the grand total Realisasi", () => {
    expect(keuanganSaveMessage({ ok: true, kelompok: 2, totalRealisasi: 350_000.4 })).toBe(
      "Tersimpan: 2 Kelompok, total Realisasi Rp350.000.",
    );
  });
});

describe("the card on /pengaturan", () => {
  const renderPage = async () =>
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) } as never));

  /** The Keuangan card's markup: from its title to the end of the page. */
  const card = (html: string) => html.slice(html.indexOf("Sumber data Keuangan"));

  it("says Belum diatur before any source is set", async () => {
    vi.mocked(requirePerson).mockResolvedValue(
      await staff("Staff", "ani@itb.ac.id", ["Administrator"]),
    );

    const html = card(await renderPage());

    expect(html).toContain("Belum diatur");
    expect(html).toContain("Simpan");
  });

  it("shows the source's address as a link in a new tab, when it was set and by whom", async () => {
    const admin = await staff("Staff", "ani@itb.ac.id", ["Administrator"]);
    vi.mocked(requirePerson).mockResolvedValue(admin);
    await setKeuanganSource(admin, OLD);

    const html = card(await renderPage());

    expect(html).toMatch(
      /<a[^>]*href="https:\/\/docs\.google\.com\/spreadsheets\/d\/made-up-old\/edit#gid=1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
    expect(html).toContain("ani");
    expect(html).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/);
    expect(html).not.toContain("Belum diatur");
  });
});
