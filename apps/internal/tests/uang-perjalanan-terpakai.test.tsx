import LogPage from "-/app/(app)/log/page";
import { csvOf } from "-/app/(app)/perjadin/[id]/laporan/ekspor/csv";
import LaporanPage from "-/app/(app)/perjadin/[id]/laporan/page";
import PerjadinDetailPage from "-/app/(app)/perjadin/[id]/page";
import { TripMoney } from "-/components/my-perjadin-section";
import { requirePerson } from "-/lib/person";
import { monitoringData, myPerjadin, perjadinAcquittal, type Person } from "@sugt/db/queries";
import { formatRupiah } from "@sugt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addActivityLogEntry,
  addGrant,
  addPerjadin,
  addPerson,
  addTransaction,
  resetDatabase,
  wibDaysFromToday,
} from "./support/fixtures";

/**
 * **The Advance is not tracked** (ADR-0051, #464). What is left of the money side is one figure,
 * **Uang Perjalanan Terpakai**: every transaction on the trip, all categories. These pin it equal on
 * every screen that shows it — `/perjadin/[id]`, its Laporan, the CSV and the `/pendamping` card —
 * on a trip whose spend is in the old draw-down categories and outside them alike, and pin that no
 * screen still shows an Advance, a remainder or a bar.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

/** What the four screens said before ADR-0051, none of which may come back. */
const ADVANCE_COPY = [
  "Diterima",
  "Sisa",
  "Tersisa",
  "belum diisi",
  "Belum diisi",
  "Isi Uang Perjalanan",
  "Ubah Uang Perjalanan",
  'role="progressbar"',
];

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

/**
 * Rina's current trip, with spend in Konsumsi and Lainnya (the old draw-down categories, ADR-0029)
 * and in Akomodasi (which was not) — Rp1.950.000 in all.
 */
async function aTripWithSpend() {
  const rina = await addPerson({
    fullName: "Rina Setiawati",
    email: "rina@ditsama.itb.ac.id",
    role: "Staff",
  });
  const trip = await addPerjadin({
    picPersonId: rina.id,
    startsOn: wibDaysFromToday(0),
    endsOn: wibDaysFromToday(1),
  });
  for (const [amountIdr, category, participantType] of [
    [1_250_000, "Konsumsi", "Siswa"],
    [400_000, "Lainnya", "GTK-MS"],
    [300_000, "Akomodasi", "GTK-MS"],
  ] as const) {
    await addTransaction({
      perjadinId: trip.id,
      amountIdr,
      category,
      participantType,
      createdByPersonId: rina.id,
    });
  }
  return { rina, trip };
}

async function asViewer(person: Person) {
  vi.mocked(requirePerson).mockResolvedValue(person as never);
}

describe("Uang Perjalanan Terpakai is one number on every screen", () => {
  it("is every transaction, all categories, on the trip page, the Laporan, the CSV and the card", async () => {
    const { rina, trip } = await aTripWithSpend();
    await asViewer(rina);
    const params = { params: Promise.resolve({ id: trip.id }) } as never;

    // The card's panel is collapsed on `/pendamping`, so it is rendered from `myPerjadin`'s figure.
    const {
      current: [mine],
    } = await myPerjadin(rina);
    const screens = {
      trip: renderToStaticMarkup(await PerjadinDetailPage(params)),
      laporan: renderToStaticMarkup(await LaporanPage(params)),
      card: renderToStaticMarkup(<TripMoney spentIdr={mine!.spentIdr} />),
    };
    const acquittal = await perjadinAcquittal(rina, trip.id);
    const csv = csvOf(acquittal!);

    expect(acquittal?.spentIdr).toBe(1_950_000);
    const figure = formatRupiah(1_950_000);
    for (const [name, html] of Object.entries(screens)) {
      expect(html, name).toMatch(
        new RegExp(
          `Uang Perjalanan Terpakai</(dt|p)><(dd|p)[^>]*>${figure.replaceAll(".", "\\.")}<`,
        ),
      );
      for (const copy of ADVANCE_COPY) expect(html, `${name}: ${copy}`).not.toContain(copy);
      expect(html, name).not.toMatch(/>Terpakai</);
    }
    expect(csv).toContain('"Uang Perjalanan Terpakai","","","","1950000",""');
    // Penyerapan Anggaran never read the Advance, and still sums every category.
    expect((await monitoringData(rina)).budgetUsedIdr).toBe(1_950_000);
  });

  it("keeps the Laporan's Total Siswa and Total GTK-MS", async () => {
    const { rina, trip } = await aTripWithSpend();
    await asViewer(rina);

    const html = renderToStaticMarkup(
      await LaporanPage({ params: Promise.resolve({ id: trip.id }) } as never),
    );

    expect(html).toMatch(/Total Siswa<\/dt><dd[^>]*>Rp1\.250\.000</);
    expect(html).toMatch(/Total GTK-MS<\/dt><dd[^>]*>Rp700\.000</);
  });

  it("heads the strip Pengeluaran, not Uang Perjalanan", async () => {
    const { rina, trip } = await aTripWithSpend();
    await asViewer(rina);
    const params = { params: Promise.resolve({ id: trip.id }) } as never;

    for (const html of [
      renderToStaticMarkup(await PerjadinDetailPage(params)),
      renderToStaticMarkup(await LaporanPage(params)),
    ]) {
      expect(html).toContain(">Pengeluaran</h2>");
      expect(html).not.toContain(">Uang Perjalanan</h2>");
    }
  });
});

describe("the Log's Uang Perjalanan history stays readable", () => {
  it("renders advance_set and advance_changed with their labels, and the filter still finds them", async () => {
    const admin = await addPerson({ fullName: "Admin", email: "admin@itb.ac.id", role: "Staff" });
    await addGrant(admin.id, "Administrator");
    await asViewer({ ...admin, grants: ["Administrator"] } as Person);
    const rina = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
    const trip = await addPerjadin({ picPersonId: rina.id });
    const written = { perjadinId: trip.id, actorPersonId: rina.id, actorEmail: rina.email };
    await addActivityLogEntry({
      ...written,
      action: "advance_set",
      details: { amountIdr: 15_000_000 },
      searchText: "uang perjalanan ditetapkan · rp15.000.000",
      occurredAt: new Date("2026-10-01T02:00:00Z"),
    });
    await addActivityLogEntry({
      ...written,
      action: "advance_changed",
      details: { fromIdr: 15_000_000, toIdr: 18_500_000 },
      searchText: "uang perjalanan diubah · rp15.000.000 → rp18.500.000",
      occurredAt: new Date("2026-10-02T02:00:00Z"),
    });
    await addActivityLogEntry({
      ...written,
      action: "report_filed",
      details: { transactionCount: 0, totalIdr: 0 },
      searchText: "laporan dikirim · 0 transaksi · total rp0",
      occurredAt: new Date("2026-10-03T02:00:00Z"),
    });
    const render = async (params: Record<string, string>) =>
      renderToStaticMarkup(await LogPage({ searchParams: Promise.resolve(params) } as never));

    const filtered = await render({ aksi: "uang-perjalanan" });
    for (const text of [
      "Uang Perjalanan ditetapkan",
      "Rp15.000.000",
      "Uang Perjalanan diubah",
      "Rp15.000.000 → Rp18.500.000",
      "2 entri · halaman 1 dari 1",
    ]) {
      expect(filtered).toContain(text);
    }
    expect(filtered).not.toContain("Laporan dikirim ·");
    await expect(render({ q: "ditetapkan" })).resolves.toContain("1 entri · halaman 1 dari 1");
  });
});
