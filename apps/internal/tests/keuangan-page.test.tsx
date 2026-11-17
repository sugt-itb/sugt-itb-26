import Page from "-/app/(app)/keuangan/page";
import { fetchKeuanganSheet, type KeuanganSheet } from "-/lib/keuangan-sheet";
import { requirePerson } from "-/lib/person";
import { keuanganSourceForRead, type Person } from "@sugt/db/queries";
import type { Grant, Role } from "@sugt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **`/keuangan`, the page** (#550): a read-only view of the Block B tab of Finance's spreadsheet.
 *
 * The two reads are stubbed at their seams — the stored source (`keuanganSourceForRead`, #549) and
 * the sheet reader (`fetchKeuanganSheet`, #548), each tested on its own — so this file pins what the
 * page does with them: who reaches it, what it reads and in which order, and what it renders. Made-up
 * data only: the repo is public.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("@sugt/db/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sugt/db/queries")>()),
  keuanganSourceForRead: vi.fn(),
}));
vi.mock("-/lib/keuangan-sheet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/keuangan-sheet")>()),
  fetchKeuanganSheet: vi.fn(),
}));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";

const person = (role: Role, grants: Grant[] = []): Person => ({
  id: "00000000-0000-4000-8000-000000000001",
  fullName: "Orang",
  email: "orang@itb.ac.id",
  role,
  grants,
});

const SOURCE = {
  sheetId: "made-up-sheet",
  gid: "7",
  updatedAt: new Date("2026-11-04T03:00:00Z"),
};

const SHEET: KeuanganSheet = {
  kelompok: [
    {
      name: "Kelompok 1\nSMA Contoh Satu\nSMA Contoh Dua",
      rows: [
        {
          sheetRow: 5,
          budgetLine: "Konsumsi",
          kegiatan: "Konsumsi",
          link: { label: "Nota 1", url: "https://example.com/nota-1" },
          date: { day: 12, month: 10, year: 2026 },
          alokasi: { amount: 1_000_000, kind: "new" },
          realisasi: 250_000,
          sisa: 750_000,
        },
        {
          sheetRow: 6,
          budgetLine: "Konsumsi",
          kegiatan: "",
          link: { label: "Bluebird", url: null },
          date: { day: null, month: 11, year: 2026 },
          alokasi: { amount: 750_000, kind: "carried" },
          realisasi: 1_500.25,
          sisa: 748_499.75,
        },
        {
          sheetRow: 7,
          budgetLine: "Konsumsi",
          kegiatan: "",
          link: null,
          date: null,
          alokasi: null,
          realisasi: 99_000,
          sisa: null,
        },
      ],
      totals: { alokasi: 1_000_000, realisasi: 350_500.25, sisa: 649_499.75 },
    },
    {
      name: "Kelompok 2",
      rows: [
        {
          sheetRow: 10,
          budgetLine: "Transportasi",
          kegiatan: "Transportasi",
          link: null,
          date: null,
          alokasi: { amount: 1_000_000, kind: "new" },
          realisasi: 1_500_000,
          sisa: -500_000,
        },
      ],
      totals: { alokasi: 1_000_000, realisasi: 1_500_000, sisa: -500_000 },
    },
  ],
  totals: { alokasi: 2_000_000, realisasi: 1_850_500.25, sisa: 149_499.75 },
};

async function digestOf(call: Promise<unknown>) {
  const thrown = await call.then(
    () => null,
    (error: unknown) => error,
  );
  return (thrown as { digest?: string } | null)?.digest;
}

const render = async () => renderToStaticMarkup(await Page());

/** The page as `viewer` sees it, with the source set and the sheet reading cleanly. */
async function renderAs(viewer: Person) {
  vi.mocked(requirePerson).mockResolvedValue(viewer);
  vi.mocked(keuanganSourceForRead).mockResolvedValue(SOURCE);
  vi.mocked(fetchKeuanganSheet).mockResolvedValue({ ok: true, sheet: SHEET });
  return render();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

describe("who reaches /keuangan", () => {
  it.each([
    ["a Keuangan holder", person("Staff", ["Keuangan"])],
    ["an Administrator", person("Staff", ["Administrator"])],
    ["a Pimpinan", person("Pimpinan")],
  ])("opens for %s, reading the source and then the sheet", async (_, viewer) => {
    const html = await renderAs(viewer);

    expect(html).toContain("Blok B — Pembelajaran Luring");
    expect(keuanganSourceForRead).toHaveBeenCalledWith(viewer);
    expect(fetchKeuanganSheet).toHaveBeenCalledWith({ sheetId: "made-up-sheet", gid: "7" });
  });

  it.each([
    [[]],
    [["Perjadin Editor"]],
    [["Daring Editor"]],
    [["Dashboard Editor"]],
    [["Dashboard Viewer"]],
  ] as Grant[][][])(
    "answers 403 to a Staff holding %j, reading neither source nor sheet",
    async (grants) => {
      vi.mocked(requirePerson).mockResolvedValue(person("Staff", grants));

      await expect(digestOf(render())).resolves.toBe(FORBIDDEN);
      expect(keuanganSourceForRead).not.toHaveBeenCalled();
      expect(fetchKeuanganSheet).not.toHaveBeenCalled();
    },
  );
});

describe("with no source set", () => {
  it.each([
    ["an Administrator", person("Staff", ["Administrator"]), true],
    ["a Keuangan holder", person("Staff", ["Keuangan"]), false],
    ["a Pimpinan", person("Pimpinan"), false],
  ])(
    "shows %s the notice, and the /pengaturan link only to an Administrator",
    async (_, viewer, link) => {
      vi.mocked(requirePerson).mockResolvedValue(viewer);
      vi.mocked(keuanganSourceForRead).mockResolvedValue(null);

      const html = await render();

      expect(html).toContain("Sumber data keuangan belum diatur.");
      expect(html.includes('href="/pengaturan"')).toBe(link);
      expect(html).not.toContain("<table");
      expect(fetchKeuanganSheet).not.toHaveBeenCalled();
    },
  );
});

describe("the budget", () => {
  const admin = person("Staff", ["Administrator"]);

  it("summarises each Kelompok by its first line, in sheet order, with a grand total", async () => {
    const html = await renderAs(admin);

    const first = html.indexOf(">Kelompok 1<");
    const second = html.indexOf(">Kelompok 2<");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    // Kelompok 1's totals, rounded to the rupiah.
    expect(html).toContain("Rp350.500");
    expect(html).toContain("Rp649.500");
    // The grand total.
    expect(html).toContain("Rp2.000.000");
    expect(html).toContain("Rp1.850.500");
    expect(html).toContain("Rp149.500");
  });

  it("puts each Kelompok's rows in place behind its toggle, with no further read", async () => {
    const html = await renderAs(admin);

    expect(html).toMatch(/aria-expanded="false" aria-controls="kelompok-0-rows"/);
    const rows = html.slice(html.indexOf('id="kelompok-0-rows"'));
    expect(rows).toContain("SMA Contoh Satu");
    expect(rows).toContain(">Konsumsi<");
    expect(rows).toContain("12 Okt 2026");
    expect(rows).toContain("Nov 2026");
    expect(rows).toContain("Rp1.500");
    expect(fetchKeuanganSheet).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a Budget Line on a row whose own Kegiatan is empty", async () => {
    const html = await renderAs(admin);

    expect(html.match(/>Konsumsi</g)).toHaveLength(1);
  });

  it("opens a receipt URL in a new tab and keeps a label with no URL as text", async () => {
    const html = await renderAs(admin);

    expect(html).toMatch(
      /<a[^>]*href="https:\/\/example\.com\/nota-1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Nota 1<\/a>/,
    );
    expect(html).toContain("Bluebird");
    expect(html).not.toMatch(/<a[^>]*>Bluebird<\/a>/);
  });

  it("marks a negative Sisa", async () => {
    const html = await renderAs(admin);

    expect(html).toMatch(/<[^>]*data-negative="true"[^>]*>-Rp500\.000</);
    expect(html).not.toMatch(/data-negative="true"[^>]*>Rp/);
  });

  it("says where the figures come from and when the source was set, not by whom", async () => {
    const html = await renderAs(admin);

    expect(html).toContain("Sumber diatur 4 Nov 2026");
    expect(html).toContain("spreadsheet");
  });

  it("has no form, no export and no link to the spreadsheet", async () => {
    const html = await renderAs(admin);

    expect(html).not.toContain("<form");
    expect(html).not.toContain("made-up-sheet");
    expect(html).not.toContain("docs.google.com");
    expect(html).not.toMatch(/ekspor/i);
  });
});

describe("a failed read", () => {
  it("shows the generic banner and no figures, never the detailed reason", async () => {
    vi.mocked(requirePerson).mockResolvedValue(person("Staff", ["Keuangan"]));
    vi.mocked(keuanganSourceForRead).mockResolvedValue(SOURCE);
    vi.mocked(fetchKeuanganSheet).mockResolvedValue({
      ok: false,
      error: "Gagal memuat data keuangan dari spreadsheet",
      detail: 'Baris 12: kolom "Alokasi" berisi "x", bukan jumlah uang.',
    });

    const html = await render();

    expect(html).toContain("Gagal memuat data keuangan dari spreadsheet");
    expect(html).not.toContain("Baris 12");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Rp");
  });
});
