import PendampingPage from "-/app/(app)/pendamping/page";
import PerjadinDetailPage from "-/app/(app)/perjadin/[id]/page";
import { MyPerjadinSection } from "-/components/my-perjadin-section";
import { FakeDrive } from "-/lib/drive/fake-drive";
import { requirePerson } from "-/lib/person";
import { myPerjadin, type Person } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addDocumentLeftInStaging, addRecordedDocument, connectDrive } from "./support/drive";
import {
  addGrant,
  addPerjadin,
  addPerson,
  addSchoolOnTrip,
  resetDatabase,
  wibDaysFromToday,
} from "./support/fixtures";

/**
 * **Dokumen is read-only** (#559, ADR-0061): no Dokumen control on a `/pendamping` card for anyone,
 * an Administrator included, and on `/perjadin/[id]` a trip's recorded documents listed with their
 * Drive links — the section absent on a trip with none.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/pendamping",
  useSearchParams: () => new URLSearchParams(),
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

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

/** Rina's trip, one current and one finished, and Ani, a Staff Administrator on neither's Group. */
async function scene() {
  const rina = (await addPerson({
    fullName: "Rina",
    email: "rina@itb.ac.id",
    role: "Staff",
  })) as Person;
  const ani = await addPerson({ fullName: "Ani", email: "ani@itb.ac.id", role: "Staff" });
  await addGrant(ani.id, "Administrator");
  const admin = { ...ani, grants: ["Administrator"] } as Person;
  const current = await addPerjadin({
    picPersonId: rina.id,
    startsOn: wibDaysFromToday(1),
    endsOn: wibDaysFromToday(2),
  });
  const finished = await addPerjadin({
    picPersonId: rina.id,
    startsOn: wibDaysFromToday(-5),
    endsOn: wibDaysFromToday(-4),
  });
  // An Administrator who leads a trip of their own sees their own cards too.
  await addPerjadin({
    picPersonId: ani.id,
    startsOn: wibDaysFromToday(1),
    endsOn: wibDaysFromToday(2),
  });
  return { rina, admin, current, finished };
}

async function pendamping(viewer: Person, searchParams: Record<string, string> = {}) {
  vi.mocked(requirePerson).mockResolvedValue(viewer as never);
  return renderToStaticMarkup(
    await PendampingPage({ searchParams: Promise.resolve(searchParams) } as never),
  );
}

async function tripPage(viewer: Person, perjadinId: string) {
  vi.mocked(requirePerson).mockResolvedValue(viewer as never);
  return renderToStaticMarkup(
    await PerjadinDetailPage({ params: Promise.resolve({ id: perjadinId }) } as never),
  );
}

describe("/pendamping", () => {
  it("offers no Dokumen control on any card, to the trip's PIC or to an Administrator", async () => {
    const { rina, admin } = await scene();

    const pages = [
      await pendamping(rina),
      await pendamping(admin),
      await pendamping(admin, { tab: "lain", pendamping: rina.id }),
    ];

    for (const html of pages) {
      // The cards rendered, with their buttons.
      expect(html).toContain(">Evaluasi Perjadin<");
      expect(html).not.toContain(">Dokumen<");
      expect(html).not.toContain("Unggah dokumen");
    }
  });
});

describe("the card's Drive-closed reason", () => {
  it("is said only on a card whose timeline has a Foto & Video to explain", async () => {
    const { rina, current, finished } = await scene();
    await addSchoolOnTrip({ perjadin: current, name: "SMAN 1 Bontang" });
    const reason = "Google Drive belum terhubung.";
    const trips = await myPerjadin(rina);
    const card = (trip: (typeof trips.current)[number]) =>
      renderToStaticMarkup(
        <MyPerjadinSection
          title="Perjalanan Dinas"
          description=""
          trips={[trip]}
          uploadGate={{ open: false, reason }}
          canWrite
        />,
      );

    const withSession = trips.current.find((trip) => trip.id === current.id)!;
    const withoutSession = trips.previous.find((trip) => trip.id === finished.id)!;
    expect(card(withSession)).toContain(`-mt-2 text-xs text-muted-foreground">${reason}</p>`);
    expect(card(withoutSession)).not.toContain(reason);
  });
});

describe("/perjadin/[id]", () => {
  it("lists a trip's recorded documents read-only, each with its Drive link", async () => {
    const { rina, admin, finished } = await scene();
    const drive = new FakeDrive();
    const folders = await connectDrive(drive, rina.id);
    const synced = await addRecordedDocument(drive, folders, rina, {
      perjadinId: finished.id,
      kind: "Daftar Hadir Pendamping",
      documentDate: wibDaysFromToday(-5),
    });
    const left = await addDocumentLeftInStaging(drive, folders, rina, {
      perjadinId: finished.id,
      kind: "Daftar Hadir Narasumber",
      documentDate: wibDaysFromToday(-4),
    });
    expect(synced.synced).toBe(true);

    for (const viewer of [rina, admin]) {
      const html = await tripPage(viewer, finished.id);

      expect(html).toContain(">Dokumen</h2>");
      expect(html).toContain(`https://drive.google.com/file/d/${synced.fileId}/view`);
      expect(html).toContain(`https://drive.google.com/file/d/${left.fileId}/view`);
      expect(html).toContain("belum tersinkron");
      expect(html).not.toContain("Unggah dan hapus");
      expect(html).not.toContain(">Hapus<");
    }
  });

  it("shows no Dokumen section on a trip with none", async () => {
    const { rina, admin, current } = await scene();

    for (const viewer of [rina, admin]) {
      const html = await tripPage(viewer, current.id);

      expect(html).toContain(">Evaluasi Perjadin</h2>");
      expect(html).not.toContain(">Dokumen</h2>");
      expect(html).not.toContain("SPPD: ");
      expect(html).not.toContain(">Daftar Hadir Pendamping<");
    }
  });
});
