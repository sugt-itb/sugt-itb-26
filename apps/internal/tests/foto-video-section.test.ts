import Page from "-/app/(app)/sesi/[id]/page";
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
 * **The Foto & Video section on `/sesi/[id]`** (#425): the list for everyone signed in, a Pimpinan
 * included; Hapus and the upload popup for Staff only; no upload on a cancelled Session. Rendered to
 * static markup with the router stubbed, against the real database. With no Drive connection, the
 * Staff upload trigger still shows — the popup opens to view, and says why uploading is closed.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const render = async (id: string) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ id }) } as never));

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
  await db.insert(schema.sessionFootage).values({
    sessionId: session.id,
    kind: "video",
    contentType: "video/mp4",
    originalFilename: "PENUTUPAN.MP4",
    byteSize: 300 * 1024 * 1024,
    driveFileId: "drive-file-video",
    uploadedByPersonId: staff.id,
  });
  return { staff: staff as Person, pimpinan: pimpinan as Person, session };
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

describe("Foto & Video on /sesi/[id]", () => {
  it("shows a Pimpinan the list with Buka, and neither Hapus nor an upload", async () => {
    const { pimpinan, session } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(pimpinan);

    const html = await render(session.id);

    expect(html).toContain("Foto &amp; Video");
    expect(html).toContain("PENUTUPAN.MP4");
    expect(html).toContain("300 MB");
    expect(html).toContain("https://drive.google.com/file/d/drive-file-video/view");
    expect(html).not.toContain(">Hapus<");
    expect(html).not.toContain("Unggah Foto &amp; Video");
  });

  it("gives Staff Hapus and the upload popup", async () => {
    const { staff, session } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(staff);

    const html = await render(session.id);

    expect(html).toContain(">Hapus<");
    expect(html).toContain("Unggah Foto &amp; Video");
  });

  it("keeps the list on a cancelled Session, and offers no upload", async () => {
    const { staff, session } = await scene();
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Hujan" })
      .where(eq(schema.session.id, session.id));
    vi.mocked(requirePerson).mockResolvedValue(staff);

    const html = await render(session.id);

    expect(html).toContain("PENUTUPAN.MP4");
    expect(html).not.toContain("Unggah Foto &amp; Video");
  });
});
