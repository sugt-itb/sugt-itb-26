import PendampingPage from "-/app/(app)/pendamping/page";
import LaporanPage from "-/app/(app)/perjadin/[id]/laporan/page";
import PerjadinDetailPage from "-/app/(app)/perjadin/[id]/page";
import { MyPerjadinSection } from "-/components/my-perjadin-section";
import { requirePerson } from "-/lib/person";
import { deleteTransaction, myPerjadin, type Person } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addGrant,
  addPerjadin,
  addPerson,
  addTransaction,
  addTransactionEvidence,
  resetDatabase,
  wibDaysFromToday,
} from "./support/fixtures";

/**
 * **Trips with and without lines, now that nothing records one** (#541). Finance records trip spending
 * outside the app, so a trip with no line says nothing about money: "Rp0" would read as nothing spent.
 * A trip with lines shows everything as before, and they stay maintainable.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
// The card's panel is collapsed until clicked, and what it holds is what these tests are about.
vi.mock("@sugt/ui/components/accordion", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<typeof import("@sugt/ui/components/accordion")>()),
    AccordionPanel: ({ children }: { children: React.ReactNode }) =>
      createElement("div", null, children),
  };
});

const NO_MONEY = ["Uang Perjalanan Terpakai", "Rp0", "Total Siswa", "Total GTK-MS"];

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

/** Rina's current trip, with one receipted line when `spendIdr` is given. */
async function aTrip(spendIdr?: number) {
  const rina = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  const trip = await addPerjadin({
    picPersonId: rina.id,
    startsOn: wibDaysFromToday(1),
    endsOn: wibDaysFromToday(2),
  });
  if (spendIdr === undefined) return { rina, trip, line: null };
  const line = await addTransaction({
    perjadinId: trip.id,
    amountIdr: spendIdr,
    category: "Konsumsi",
    createdByPersonId: rina.id,
  });
  await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: rina.id });
  return { rina, trip, line };
}

async function screens(viewer: Person, perjadinId: string) {
  vi.mocked(requirePerson).mockResolvedValue(viewer as never);
  const params = { params: Promise.resolve({ id: perjadinId }) } as never;
  const trips = await myPerjadin(viewer);
  return {
    card: renderToStaticMarkup(
      <MyPerjadinSection
        title="Perjalanan Dinas Anda"
        description=""
        trips={trips.current}
        uploadGate={{ open: true }}
        canWrite
      />,
    ),
    trip: renderToStaticMarkup(await PerjadinDetailPage(params)),
    laporan: renderToStaticMarkup(await LaporanPage(params)),
  };
}

describe("a trip with no lines", () => {
  it("shows no money on the card or the trip page, and no Laporan link", async () => {
    const { rina, trip } = await aTrip();

    const { card, trip: page } = await screens(rina, trip.id);

    for (const text of NO_MONEY) {
      expect(card, text).not.toContain(text);
      expect(page, text).not.toContain(text);
    }
    expect(page).not.toContain(`/perjadin/${trip.id}/laporan`);
    expect(page).not.toContain("Laporan Perjadin");
  });

  it("still answers the Laporan's URL, saying there is nothing on it", async () => {
    const { rina, trip } = await aTrip();

    const { laporan } = await screens(rina, trip.id);

    expect(laporan).toContain("Belum ada transaksi pada Perjadin ini.");
    expect(laporan).not.toContain("Pengeluaran");
    expect(laporan).not.toContain("Ekspor rincian");
    for (const text of NO_MONEY) expect(laporan, text).not.toContain(text);
  });
});

describe("a trip with a line", () => {
  it("shows Terpakai and the Laporan link, and the whole Laporan, as before", async () => {
    const { rina, trip } = await aTrip(150_000);

    const { card, trip: page, laporan } = await screens(rina, trip.id);

    for (const html of [card, page, laporan]) {
      expect(html).toContain("Uang Perjalanan Terpakai");
      expect(html).toContain("Rp150.000");
    }
    expect(page).toContain(`href="/perjadin/${trip.id}/laporan"`);
    for (const text of ["Pengeluaran", "Ekspor rincian", "Total Siswa", "Unggah bukti", "Hapus"]) {
      expect(laporan, text).toContain(text);
    }
    expect(laporan).not.toContain("Belum ada transaksi");
  });
});

it("moves a trip to the no-lines display when its last line is deleted", async () => {
  const { rina, trip, line } = await aTrip(150_000);
  expect((await screens(rina, trip.id)).trip).toContain("Uang Perjalanan Terpakai");

  await deleteTransaction(rina, line!.id);

  const { card, trip: page, laporan } = await screens(rina, trip.id);
  expect(card).not.toContain("Uang Perjalanan Terpakai");
  expect(page).not.toContain("Uang Perjalanan Terpakai");
  expect(page).not.toContain("Laporan Perjadin");
  expect(laporan).toContain("Belum ada transaksi pada Perjadin ini.");
});

describe("nothing records a new line", () => {
  it("offers no Catat Transaksi on the card or the Laporan, to anyone", async () => {
    const { rina, trip } = await aTrip(150_000);
    const admin = {
      ...(await addPerson({ fullName: "Ani", email: "ani@itb.ac.id", role: "Staff" })),
      grants: ["Administrator" as const],
    };
    await addGrant(admin.id, "Administrator");

    for (const viewer of [rina, admin as Person]) {
      const { card, laporan } = await screens(viewer, trip.id);
      expect(card.toLowerCase()).not.toContain("catat transaksi");
      expect(laporan.toLowerCase()).not.toContain("catat transaksi");
    }
  });

  it("keeps three buttons on the card, the last taking the whole row on a phone", async () => {
    const { rina, trip } = await aTrip();

    const { card } = await screens(rina, trip.id);

    for (const label of [">Dokumen<", ">Evaluasi Perjadin<", ">Edit<"]) {
      expect(card, label).toContain(label);
    }
    expect(card).toContain("[&amp;&gt;:last-child:nth-child(odd)]:col-span-2");
  });

  it("speaks of dokumen, not transaksi, over a finished trip on /pendamping", async () => {
    const rina = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
    await addPerjadin({
      picPersonId: rina.id,
      startsOn: wibDaysFromToday(-5),
      endsOn: wibDaysFromToday(-4),
    });
    vi.mocked(requirePerson).mockResolvedValue(rina as never);

    const html = renderToStaticMarkup(
      await PendampingPage({ searchParams: Promise.resolve({}) } as never),
    );

    expect(html).toContain("Dokumennya masih bisa dikerjakan.");
    expect(html).not.toContain("Transaksi dan dokumennya");
  });
});
