import { GET as exportKeuangan } from "-/app/(app)/keuangan/ekspor/route";
import KeuanganPage from "-/app/(app)/keuangan/page";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import type { Grant, Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addGrant,
  addPerjadin,
  addPerson,
  addTransaction,
  addTransactionEvidence,
  resetDatabase,
} from "./support/fixtures";

/**
 * **`/keuangan` and its export, end to end** (#472): a Keuangan holder and an Administrator open both;
 * a Staff member without either Grant and a Pimpinan get the 403 from both. The page shows the
 * summary of the whole filtered set, a Perjadin cell linking to its Laporan, the receipt links and the
 * "belum tersinkron" marker; the export is a CSV attachment named for its filter.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

async function person(email: string, role: Role, grants: Grant[] = []): Promise<Person> {
  const row = await addPerson({ fullName: email, email, role });
  for (const grant of grants) await addGrant(row.id, grant);
  return { ...row, grants } as Person;
}

const signIn = (who: Person) => vi.mocked(requirePerson).mockResolvedValue(who);

const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await KeuanganPage({ searchParams: Promise.resolve(params) } as never));

const download = (query = "") =>
  exportKeuangan(new Request(`http://localhost/keuangan/ekspor${query}`));

async function digestOf(call: () => Promise<unknown>) {
  return call().then(
    () => null,
    (error: unknown) => (error as { digest?: string }).digest,
  );
}

/** Kelompok 10 with a synced Hotel line holding two receipts, and an unsynced Makan siang with one. */
async function scene() {
  const keuangan = await person("keu@itb.ac.id", "Staff", ["Keuangan"]);
  const trip = await addPerjadin({
    picPersonId: keuangan.id,
    subClusterName: "Kelompok 10",
    startsOn: "2026-10-12",
    endsOn: "2026-10-13",
  });
  const hotel = await addTransaction({
    perjadinId: trip.id,
    spentOn: "2026-10-12",
    amountIdr: 900_000,
    category: "Akomodasi",
    description: "Hotel",
    participantType: "GTK-MS",
    createdByPersonId: keuangan.id,
  });
  const meal = await addTransaction({
    perjadinId: trip.id,
    spentOn: "2026-10-13",
    amountIdr: 150_000,
    category: "Konsumsi",
    description: "Makan siang",
    createdByPersonId: keuangan.id,
  });
  for (const driveFileId of ["hotel-1", "hotel-2"]) {
    await addTransactionEvidence({
      transactionId: hotel.id,
      uploadedByPersonId: keuangan.id,
      driveFileId,
    });
  }
  await addTransactionEvidence({
    transactionId: meal.id,
    uploadedByPersonId: keuangan.id,
    driveFileId: "meal-1",
  });
  await db
    .update(schema.transaction)
    .set({ driveSyncedAt: new Date() })
    .where(eq(schema.transaction.id, hotel.id));
  return { keuangan, trip };
}

describe("who opens it", () => {
  it("answers a Staff member without Keuangan and a Pimpinan with a 403, on the page and the export", async () => {
    await scene();
    for (const who of [
      await person("staf@itb.ac.id", "Staff", ["Perjadin Editor", "Dashboard Viewer"]),
      await person("pim@itb.ac.id", "Pimpinan"),
    ]) {
      signIn(who);
      await expect(
        digestOf(() => render()),
        who.email,
      ).resolves.toBe(FORBIDDEN);
      await expect(
        digestOf(() => download()),
        who.email,
      ).resolves.toBe(FORBIDDEN);
    }
  });

  it("opens for a Keuangan holder and an Administrator", async () => {
    const { keuangan } = await scene();
    for (const who of [keuangan, await person("admin@itb.ac.id", "Staff", ["Administrator"])]) {
      signIn(who);
      await expect(render()).resolves.toContain("2 transaksi · Rp1.050.000");
      expect((await download()).status).toBe(200);
    }
  });
});

describe("the page", () => {
  it("links each line's Perjadin to its Laporan, its receipts to Drive, and marks an unsynced line", async () => {
    const { keuangan, trip } = await scene();
    signIn(keuangan);

    const html = await render();
    const rowOf = (description: string) => {
      const start = html.lastIndexOf("<tr", html.indexOf(`>${description}<`));
      return html.slice(start, html.indexOf("</tr>", start));
    };

    expect(rowOf("Hotel")).toContain(`href="/perjadin/${trip.id}/laporan"`);
    expect(rowOf("Hotel")).toContain("Kelompok 10 · 12–13 Okt 2026");
    expect(rowOf("Hotel")).toContain('href="https://drive.google.com/file/d/hotel-1/view"');
    expect(rowOf("Hotel")).toContain('href="https://drive.google.com/file/d/hotel-2/view"');
    expect(rowOf("Hotel")).not.toContain("belum tersinkron");
    expect(rowOf("Makan siang")).toContain("belum tersinkron");
    expect(rowOf("Makan siang").match(/Buka ↗/g)).toHaveLength(1);
    // Newest Tanggal Transaksi first.
    expect(html.indexOf(">Makan siang<")).toBeLessThan(html.indexOf(">Hotel<"));
    expect(html).toContain(`href="/keuangan/ekspor"`);
  });

  it("says when a filter matches nothing, and when Dari falls after Sampai", async () => {
    const { keuangan } = await scene();
    signIn(keuangan);

    await expect(render({ dari: "2027-01-01" })).resolves.toContain(
      "Tidak ada transaksi yang cocok dengan saringan ini.",
    );
    const reversed = await render({ dari: "2026-11-01", sampai: "2026-10-01" });
    expect(reversed).toContain("rentang tanggal tidak");
    expect(reversed).toContain("2 transaksi");
  });
});

describe("the export", () => {
  it("is a no-store CSV attachment named for its filter, holding every row of it", async () => {
    const { keuangan, trip } = await scene();
    signIn(keuangan);

    const response = await download(`?perjadin=${trip.id}&urut=amountIdr&arah=asc&page=2`);
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
    }).format(new Date());

    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="keuangan-kelompok-10-12-13-okt-2026-${today}.csv"`,
    );
    const lines = (await response.text()).split("\r\n").filter(Boolean);
    // The header, then both lines oldest first — the page's sort and page do not carry over.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Hotel"');
    expect(lines[2]).toContain('"Makan siang"');
  });
});
