import {
  createStory,
  delivery,
  publishStory,
  publishedStories,
  publishedStory,
  scope,
  setStoryCover,
  addStoryPhotos,
  storyForEditor,
  withdrawStory,
  type ServiceCaller,
} from "@sugt/db/queries";
import { beforeEach, describe, expect, it } from "vitest";

import { addCluster, addProvince, addSchool, addSession, resetDatabase } from "./support/fixtures";
import { signInAsPerson } from "./support/sign-in";

/**
 * **The aggregates payloads** — the four the public site reads, through the `ServiceCaller` arm.
 *
 * Unlike a `Person`, a `ServiceCaller` has no resolution seam to drive: the shared-secret gate that
 * mints one lives in the route handler, tested separately in `aggregates-routes.test.ts`. Here the
 * arm is constructed directly, because these assertions are about the SQL the four queries run, not
 * about the gate. What is asserted is the payload a public page renders, never a particular join.
 */
const service: ServiceCaller = { kind: "service" };

/** A Staff Person, the only caller that can author a Story. Online Sessions need one as their PIC. */
const staff = () => signInAsPerson("Staff", "rina@ditsama.itb.ac.id", "Rina Nurhayati");

describe("the scope payload", () => {
  beforeEach(resetDatabase);

  it("carries the Clusters with Topic and Problem, and every School with province and Cluster", async () => {
    await addProvince("JB", "Jawa Barat");
    await addProvince("DKI", "DKI Jakarta");
    const alpha = await addCluster({
      slug: "alpha",
      name: "Cluster Alpha",
      topic: "Mitigasi Bencana",
      problem: "Peringatan dini banjir",
    });
    const beta = await addCluster({
      slug: "beta",
      name: "Cluster Beta",
      topic: "Ketahanan Pangan",
      problem: "Hama padi",
    });
    await addSchool({ slug: "sman-1", name: "SMAN 1", clusterId: alpha.id, provinceCode: "JB" });
    await addSchool({
      slug: "sman-2",
      name: "SMAN 2",
      clusterId: beta.id,
      provinceCode: "DKI",
      kabupatenKota: "Jakarta Pusat",
    });

    const payload = await scope(service);

    expect(payload.clusters).toEqual([
      {
        id: alpha.id,
        slug: "alpha",
        name: "Cluster Alpha",
        topic: "Mitigasi Bencana",
        problem: "Peringatan dini banjir",
      },
      {
        id: beta.id,
        slug: "beta",
        name: "Cluster Beta",
        topic: "Ketahanan Pangan",
        problem: "Hama padi",
      },
    ]);
    expect(payload.schools).toEqual([
      expect.objectContaining({
        slug: "sman-1",
        name: "SMAN 1",
        provinceCode: "JB",
        provinceName: "Jawa Barat",
        clusterId: alpha.id,
        clusterSlug: "alpha",
      }),
      expect.objectContaining({
        slug: "sman-2",
        name: "SMAN 2",
        kabupatenKota: "Jakarta Pusat",
        provinceCode: "DKI",
        provinceName: "DKI Jakarta",
        clusterId: beta.id,
        clusterSlug: "beta",
      }),
    ]);
  });

  it("sends no figures — `47 Sekolah · 16 provinsi` is derived from the School list", async () => {
    await addProvince("JB", "Jawa Barat");
    await addProvince("DKI", "DKI Jakarta");
    const alpha = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    await addSchool({ slug: "a", name: "A", clusterId: alpha.id, provinceCode: "JB" });
    await addSchool({ slug: "b", name: "B", clusterId: alpha.id, provinceCode: "JB" });
    await addSchool({ slug: "c", name: "C", clusterId: alpha.id, provinceCode: "DKI" });

    const payload = await scope(service);

    // No count field exists to disagree with the list; both figures are read off it.
    expect(payload).not.toHaveProperty("schoolCount");
    expect(payload).not.toHaveProperty("provinceCount");
    expect(payload.schools).toHaveLength(3);
    expect(new Set(payload.schools.map((s) => s.provinceCode)).size).toBe(2);
  });
});

describe("the delivery payload", () => {
  beforeEach(resetDatabase);

  it("carries a delivered total and a per-Cluster count, and counts delivered Sessions only", async () => {
    await addProvince("JB", "Jawa Barat");
    const alpha = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const beta = await addCluster({ slug: "beta", name: "Cluster Beta" });
    const busy = await addSchool({
      slug: "s1",
      name: "S1",
      clusterId: alpha.id,
      provinceCode: "JB",
    });
    const other = await addSchool({
      slug: "s2",
      name: "S2",
      clusterId: beta.id,
      provinceCode: "JB",
    });

    await addSession({
      schoolId: busy.id,
      heldOn: "2026-09-01",
      status: "delivered",
    });
    await addSession({
      schoolId: busy.id,
      heldOn: "2026-09-08",
      status: "delivered",
    });
    await addSession({
      schoolId: busy.id,
      heldOn: "2026-09-15",
      status: "arranged",
    });
    await addSession({
      schoolId: busy.id,
      heldOn: "2026-09-22",
      status: "cancelled",
    });
    await addSession({
      schoolId: other.id,
      heldOn: "2026-09-02",
      status: "delivered",
    });

    const payload = await delivery(service);

    expect(payload.deliveredTotal).toBe(3);
    expect(payload.perCluster).toEqual([
      { clusterId: alpha.id, clusterSlug: "alpha", delivered: 2 },
      { clusterId: beta.id, clusterSlug: "beta", delivered: 1 },
    ]);
    // Per School is never exposed — no public surface needs it.
    expect(JSON.stringify(payload)).not.toContain(busy.id);
  });

  it("reports zero for a Cluster nobody has reached, rather than dropping it", async () => {
    await addProvince("JB", "Jawa Barat");
    const alpha = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    await addSchool({ slug: "s1", name: "S1", clusterId: alpha.id, provinceCode: "JB" });

    const payload = await delivery(service);

    expect(payload.deliveredTotal).toBe(0);
    expect(payload.perCluster).toEqual([
      { clusterId: alpha.id, clusterSlug: "alpha", delivered: 0 },
    ]);
  });
});

describe("the Stories payloads", () => {
  beforeEach(resetDatabase);

  async function oneSchool() {
    await addProvince("JB", "Jawa Barat");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    return addSchool({ slug: "sman-1", name: "SMAN 1", clusterId: cluster.id, provinceCode: "JB" });
  }

  it("lists published Stories with a cover path and an excerpt, and never a body", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Kunjungan ke SMAN 1",
      body: "# Judul\n\nParagraf pembuka yang cukup untuk menjadi kutipan pada daftar.",
      kind: "field",
      stream: "STEM",
    });
    await addStoryPhotos(pic, s.id, [
      {
        storagePath: "story/x/cover.jpg",
        contentType: "image/jpeg",
        byteSize: 1000,
        caption: null,
      },
    ]);
    const editor = await storyForEditor(pic, s.id);
    await setStoryCover(pic, s.id, editor!.photos[0]!.id);
    await publishStory(pic, s.id);

    const list = await publishedStories(service);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      slug: "kunjungan-ke-sman-1",
      title: "Kunjungan ke SMAN 1",
      kind: "field",
      stream: "STEM",
      coverPhotoPath: "story/x/cover.jpg",
    });
    // The Markdown heading token does not surface in the excerpt, and no body travels.
    expect(list[0]!.excerpt).toContain("Paragraf pembuka");
    expect(list[0]!.excerpt).not.toContain("#");
    expect(list[0]).not.toHaveProperty("body");
  });

  it("omits drafts and Stories that were withdrawn", async () => {
    const pic = await staff();
    const school = await oneSchool();

    const draft = await createStory(pic, {
      schoolId: school.id,
      title: "Draf",
      body: "b",
      kind: "field",
      stream: null,
    });
    const published = await createStory(pic, {
      schoolId: school.id,
      title: "Terbit",
      body: "b",
      kind: "field",
      stream: null,
    });
    await publishStory(pic, published.id);
    const pulled = await createStory(pic, {
      schoolId: school.id,
      title: "Ditarik",
      body: "b",
      kind: "field",
      stream: null,
    });
    await publishStory(pic, pulled.id);
    await withdrawStory(pic, pulled.id);

    const list = await publishedStories(service);

    expect(list.map((row) => row.slug)).toEqual(["terbit"]);
    // The draft and the withdrawn Story do not resolve on the detail route either.
    expect(await publishedStory(service, "draf")).toBeNull();
    expect(await publishedStory(service, "ditarik")).toBeNull();
    void draft;
  });

  it("serves one Story's body and its ordered gallery on the detail route", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Galeri",
      body: "Isi lengkap cerita.",
      kind: "final_project",
      stream: "Research",
    });
    await addStoryPhotos(pic, s.id, [
      { storagePath: "story/g/1.jpg", contentType: "image/jpeg", byteSize: 1, caption: "Satu" },
      { storagePath: "story/g/2.jpg", contentType: "image/jpeg", byteSize: 1, caption: null },
      { storagePath: "story/g/3.jpg", contentType: "image/jpeg", byteSize: 1, caption: "Tiga" },
    ]);
    const editor = await storyForEditor(pic, s.id);
    // The one insert shares a timestamp, so `photos[0]` is the smallest random id, not "story/g/1".
    // The cover is whichever that is; assert against it rather than a hardcoded path.
    const coverPath = editor!.photos[0]!.storagePath;
    await setStoryCover(pic, s.id, editor!.photos[0]!.id);
    await publishStory(pic, s.id);

    const detail = await publishedStory(service, "galeri");

    expect(detail).toMatchObject({
      slug: "galeri",
      title: "Galeri",
      kind: "final_project",
      stream: "Research",
      body: "Isi lengkap cerita.",
      coverPhotoPath: coverPath,
    });
    // Ordered by uploaded_at then id — the one insert shares a timestamp, so the id tie-break
    // orders it, which is exactly the order the editor reads too. Assert against that rather than
    // insertion order, which the random ids do not follow.
    const ordered = editor!.photos.map((p) => p.storagePath);
    expect(detail!.gallery.map((p) => p.storagePath)).toEqual(ordered);
    expect(new Set(detail!.gallery.map((p) => p.storagePath))).toEqual(
      new Set(["story/g/1.jpg", "story/g/2.jpg", "story/g/3.jpg"]),
    );
    expect(detail!.gallery.find((p) => p.storagePath === "story/g/1.jpg")!.caption).toBe("Satu");
    expect(detail!.gallery.find((p) => p.storagePath === "story/g/2.jpg")!.caption).toBeNull();
  });

  it("returns null for a slug that names no Story", async () => {
    expect(await publishedStory(service, "tidak-ada")).toBeNull();
  });

  it("refuses no one by role — the ServiceCaller reads on its own arm", async () => {
    // Authoring is Staff-only, but reading the published payload is the ServiceCaller's alone. The
    // arm is the check; there is no Person or role here to narrow further — and T3 (#153) retired
    // the one non-Staff Role anyway, so every signed-in caller is Staff. This documents that these
    // four take the arm and run no `requireStaff`.
    await expect(scope(service)).resolves.toBeTruthy();
  });
});
