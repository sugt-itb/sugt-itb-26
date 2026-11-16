import Page from "-/app/(app)/sesi/[id]/page";
import { MyPerjadinSection } from "-/components/my-perjadin-section";
import {
  FOTO_VIDEO_UPLOAD_NOTE,
  fotoVideoBackUrl,
  fotoVideoFrom,
  fotoVideoHref,
} from "-/lib/foto-video";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import { myPerjadin, type Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The Foto & Video section on `/sesi/[id]`** (#425, #561): links, in a new tab, to the routes that
 * open the Session's folders in the company Google Drive — **Foto & Video** (the upload folder) for
 * the trip's writers, **Lihat arsip** for everyone signed in, a Pimpinan included. A cancelled Session
 * shows each only when its folder already exists. Rendered to static markup with the router stubbed,
 * against the real database.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
/** The browser's query string, as `useSearchParams` reads it. */
let search = new URLSearchParams();
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/pendamping",
  useSearchParams: () => search,
}));
// A /pendamping card's panel is collapsed until clicked, and its timeline is what one test is about.
vi.mock("@sugt/ui/components/accordion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sugt/ui/components/accordion")>()),
  AccordionPanel: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

const render = async (id: string, query: Record<string, string> = {}) => {
  search = new URLSearchParams(query);
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) } as never));
};

async function scene() {
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  const pimpinan = await addPerson({ fullName: "Fa", email: "fa@itb.ac.id", role: "Pimpinan" });
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "k18",
    name: "Kelompok 18",
    clusterId: cluster.id,
  });
  const school = await addSchool({
    slug: "sman-1",
    name: "SMAN 1 Bontang",
    clusterId: cluster.id,
    subClusterId: subCluster.id,
    provinceCode: "KT",
  });
  const trip = await addPerjadin({
    picPersonId: staff.id,
    subClusterId: subCluster.id,
    startsOn: "2026-10-12",
    endsOn: "2026-10-16",
  });
  // Rina is the PIC, so in the trip's Group: she writes it (ADR-0048).
  const session = await addOfflineSession({
    schoolId: school.id,
    heldOn: "2026-10-14",
    perjadinId: trip.id,
  });
  const outsider = await addPerson({ fullName: "Eka", email: "eka@itb.ac.id", role: "Staff" });
  return {
    staff: { ...staff, grants: [] } as Person,
    pimpinan: { ...pimpinan, grants: [] } as Person,
    outsider: { ...outsider, grants: [] } as Person,
    session,
  };
}

const cancel = (sessionId: string) =>
  db
    .update(schema.session)
    .set({ status: "cancelled", cancelledReason: "Hujan" })
    .where(eq(schema.session.id, sessionId));

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

describe("Foto & Video on /sesi/[id]", () => {
  const href = (sessionId: string, folder: "upload" | "archive") =>
    `href="${fotoVideoHref(sessionId, folder, `/sesi/${sessionId}`).replaceAll("&", "&amp;")}"`;

  it("gives the trip's writer both links, in a new tab, with the note under Foto & Video", async () => {
    const { staff, session } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(staff);

    const html = await render(session.id);

    expect(html).toContain(href(session.id, "upload"));
    expect(html).toContain(href(session.id, "archive"));
    expect(html).toContain(">Foto &amp; Video<");
    expect(html).toContain(">Lihat arsip<");
    expect(html).toContain(FOTO_VIDEO_UPLOAD_NOTE);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain(">Unggah<");
    expect(html).not.toContain(">Hapus<");
  });

  it("gives a Pimpinan and a Staff member off the trip Lihat arsip only", async () => {
    const { pimpinan, outsider, session } = await scene();
    for (const who of [pimpinan, outsider]) {
      vi.mocked(requirePerson).mockResolvedValue(who);

      const html = await render(session.id);

      expect(html).toContain(href(session.id, "archive"));
      expect(html).not.toContain("/foto-video/unggah");
      expect(html).not.toContain(FOTO_VIDEO_UPLOAD_NOTE);
    }
  });

  it("offers no link on a cancelled Session with no folder", async () => {
    const { staff, session } = await scene();
    await cancel(session.id);
    vi.mocked(requirePerson).mockResolvedValue(staff);

    const html = await render(session.id);

    expect(html).not.toContain("/foto-video/");
    expect(html).toContain("tidak punya folder Foto &amp; Video");
  });

  it("keeps on a cancelled Session only the link whose folder already exists", async () => {
    const { staff, session } = await scene();
    await cancel(session.id);
    vi.mocked(requirePerson).mockResolvedValue(staff);

    await db
      .update(schema.session)
      .set({ driveFootageFolderId: "folder-1" })
      .where(eq(schema.session.id, session.id));
    const archiveOnly = await render(session.id);
    expect(archiveOnly).toContain("/foto-video/arsip");
    expect(archiveOnly).not.toContain("/foto-video/unggah");

    await db
      .update(schema.session)
      .set({ driveFootageFolderId: null, driveFootageUploadFolderId: "folder-2" })
      .where(eq(schema.session.id, session.id));
    const uploadOnly = await render(session.id);
    expect(uploadOnly).toContain("/foto-video/unggah");
    expect(uploadOnly).not.toContain("/foto-video/arsip");
  });

  it("says why the folder did not open, in the app's own words only", async () => {
    const { staff, session } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(staff);

    expect(await render(session.id, { "foto-video": "drive-unavailable" })).toContain(
      "Google Drive belum tersedia — coba lagi nanti.",
    );
    expect(await render(session.id, { "foto-video": "folder-gone" })).toContain(
      "Minta Administrator memulihkannya dari tempat sampah Google Drive.",
    );
    expect(await render(session.id, { "foto-video": "<b>apa saja</b>" })).not.toContain("apa saja");
  });
});

describe("Foto & Video on the /pendamping timeline", () => {
  it("gives each Session both links for the trip's writers, with the note said once; Lihat arsip only otherwise", async () => {
    const { staff, session } = await scene();
    const trips = await myPerjadin(staff);
    const card = (canWrite: boolean) =>
      renderToStaticMarkup(
        createElement(MyPerjadinSection, {
          title: "Perjalanan Dinas Anda",
          description: "",
          trips: [...trips.current, ...trips.previous],
          canWrite,
        }),
      );

    const writer = card(true);
    expect(writer).toContain(
      `href="${fotoVideoHref(session.id, "upload", "/pendamping").replaceAll("&", "&amp;")}"`,
    );
    expect(writer).toContain(
      `href="${fotoVideoHref(session.id, "archive", "/pendamping").replaceAll("&", "&amp;")}"`,
    );
    expect(writer.split(FOTO_VIDEO_UPLOAD_NOTE)).toHaveLength(2);

    const reader = card(false);
    expect(reader).toContain("/foto-video/arsip");
    expect(reader).not.toContain("/foto-video/unggah");
    expect(reader).not.toContain(FOTO_VIDEO_UPLOAD_NOTE);
  });
});

describe("where the route sends a tab back", () => {
  const base = "https://internal.sugt.test";
  const back = (from: string | null) => fotoVideoBackUrl(from, "s1", base, "folder-gone");

  it("keeps a page on this app, its own query included, and adds the notice", () => {
    expect(back("/pendamping")).toBe(`${base}/pendamping?foto-video=folder-gone`);
    expect(back("/pendamping?tab=lain&pendamping=p1")).toBe(
      `${base}/pendamping?tab=lain&pendamping=p1&foto-video=folder-gone`,
    );
  });

  it("falls back to the Session's page for anything that would leave the app", () => {
    for (const offsite of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example/x",
      "/\n/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      null,
      "",
    ]) {
      expect(back(offsite), JSON.stringify(offsite)).toBe(`${base}/sesi/s1?foto-video=folder-gone`);
    }
  });
});

describe("the page a timeline button names as dari", () => {
  it("is the path and its query, without an earlier notice", () => {
    expect(fotoVideoFrom("/pendamping", null)).toBe("/pendamping");
    expect(
      fotoVideoFrom(
        "/pendamping",
        new URLSearchParams("tab=lain&pendamping=p1&foto-video=drive-unavailable"),
      ),
    ).toBe("/pendamping?tab=lain&pendamping=p1");
  });
});
