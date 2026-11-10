import Page from "-/app/(app)/sesi/[id]/page";
import { fotoVideoBackUrl, fotoVideoFrom, fotoVideoHref } from "-/lib/foto-video";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
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
 * **The Foto & Video section on `/sesi/[id]`** (#425, #552): one link, in a new tab, to the route that
 * opens the Session's folder in the company Google Drive — for everyone signed in, a Pimpinan
 * included. A cancelled Session shows it only when its folder already exists. Rendered to static
 * markup with the router stubbed, against the real database.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
/** The browser's query string, as `useSearchParams` reads it. */
let search = new URLSearchParams();
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => search,
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
  const session = await addOfflineSession({
    schoolId: school.id,
    heldOn: "2026-10-14",
    perjadinId: trip.id,
  });
  return { staff: staff as Person, pimpinan: pimpinan as Person, session };
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
  it("gives a Pimpinan the link to the Session's folder, in a new tab, and no upload", async () => {
    const { pimpinan, session } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(pimpinan);

    const html = await render(session.id);

    expect(html).toContain("Foto &amp; Video");
    expect(html).toContain(
      `href="${fotoVideoHref(session.id, `/sesi/${session.id}`).replaceAll("&", "&amp;")}"`,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("Unggah");
    expect(html).not.toContain(">Hapus<");
  });

  it("offers no link on a cancelled Session with no folder", async () => {
    const { staff, session } = await scene();
    await cancel(session.id);
    vi.mocked(requirePerson).mockResolvedValue(staff);

    const html = await render(session.id);

    expect(html).not.toContain("/foto-video/buka");
    expect(html).toContain("tidak punya folder Foto &amp; Video");
  });

  it("keeps the link on a cancelled Session whose folder already exists", async () => {
    const { staff, session } = await scene();
    await db
      .update(schema.session)
      .set({ driveFootageFolderId: "folder-1" })
      .where(eq(schema.session.id, session.id));
    await cancel(session.id);
    vi.mocked(requirePerson).mockResolvedValue(staff);

    expect(await render(session.id)).toContain("/foto-video/buka");
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
