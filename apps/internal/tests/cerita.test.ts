import { db, schema } from "@sugt/db";
import {
  addStoryPhotos,
  ceritaIndex,
  createStory,
  deleteStoryPhoto,
  isNotStaffError,
  publishStory,
  setStoryCover,
  storyForEditor,
  withdrawStory,
  type NewStoryPhoto,
} from "@sugt/db/queries";
import type { Role } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addCluster, addPerson, addProvince, addSchool, resetDatabase } from "./support/fixtures";

/**
 * A non-Staff caller, hand-built rather than invited. T3 (#153) retired the Teaching Team Role, so
 * no such Person can exist in the database any more — but the Staff-only choke point still has to
 * reject a non-Staff caller, and `requireStaff` throws on the role alone, before it touches the
 * row. The cast through `unknown` is the only way to name a role the type no longer admits.
 */
function nonStaff() {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Budi Santoso",
    email: "budi@gmail.com",
    role: "Teaching Team" as unknown as Role,
    grants: [],
  };
}

/**
 * **Cerita** — creating, editing and publishing Stories. The invariants under test are the one
 * gate in the product (publish needs a cover once photographs exist), the cover clearing itself
 * when its photograph is deleted, and the gallery's stable order under a bulk upload.
 */

async function staff(email = "rina@ditsama.itb.ac.id") {
  return addPerson({ fullName: "Rina Nurhayati", email, role: "Staff" });
}

async function oneSchool(slug = "sman-1-bandung") {
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  return addSchool({ slug, name: "SMAN 1 Bandung", clusterId: cluster.id, provinceCode: "JB" });
}

/** A photograph the upload has "landed" — a unique storage path is all the row needs. */
function photo(path: string, caption: string | null = null): NewStoryPhoto {
  return { storagePath: path, contentType: "image/jpeg", byteSize: 1000, caption };
}

async function publishedAtOf(storyId: string) {
  const [row] = await db
    .select({ publishedAt: schema.story.publishedAt })
    .from(schema.story)
    .where(eq(schema.story.id, storyId));
  return row?.publishedAt ?? null;
}

describe("Cerita", () => {
  beforeEach(resetDatabase);

  it("creates a draft with a generated slug, and distinct slugs for the same title", async () => {
    const pic = await staff();
    const school = await oneSchool();

    const a = await createStory(pic, {
      schoolId: school.id,
      title: "Kunjungan ke SMAN 1",
      body: "Isi.",
      kind: "field",
      stream: "STEM",
    });
    const b = await createStory(pic, {
      schoolId: school.id,
      title: "Kunjungan ke SMAN 1",
      body: "Isi lain.",
      kind: "field",
      stream: null,
    });

    expect(a.slug).toBe("kunjungan-ke-sman-1");
    expect(b.slug).toBe("kunjungan-ke-sman-1-2");
    expect(await publishedAtOf(a.id)).toBeNull(); // a draft
  });

  it("publishes a Story with no photographs at all — that is not gated", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Tanpa foto",
      body: "b",
      kind: "field",
      stream: null,
    });

    expect(await publishStory(pic, s.id)).toEqual({ outcome: "published" });
    expect(await publishedAtOf(s.id)).not.toBeNull();
  });

  it("refuses to publish while photographs exist and none is the cover — the one gate", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Ada foto",
      body: "b",
      kind: "field",
      stream: null,
    });
    await addStoryPhotos(pic, s.id, [photo("story/a/1.jpg"), photo("story/a/2.jpg")]);

    expect(await publishStory(pic, s.id)).toEqual({ outcome: "needs-cover" });
    expect(await publishedAtOf(s.id)).toBeNull();

    // Choosing a cover opens the gate.
    const editor = await storyForEditor(pic, s.id);
    await setStoryCover(pic, s.id, editor!.photos[0]!.id);
    expect(await publishStory(pic, s.id)).toEqual({ outcome: "published" });
    expect(await publishedAtOf(s.id)).not.toBeNull();
  });

  it("clears the cover when the cover photograph is deleted, rather than blocking", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Hapus sampul",
      body: "b",
      kind: "field",
      stream: null,
    });
    await addStoryPhotos(pic, s.id, [photo("story/b/1.jpg")]);
    const editor = await storyForEditor(pic, s.id);
    const coverId = editor!.photos[0]!.id;
    await setStoryCover(pic, s.id, coverId);

    await deleteStoryPhoto(pic, s.id, coverId);

    const after = await storyForEditor(pic, s.id);
    expect(after!.coverPhotoId).toBeNull();
    expect(after!.photos).toHaveLength(0);
  });

  it("orders the gallery by uploaded_at, tie-broken by id, so a bulk upload is stable", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Galeri",
      body: "b",
      kind: "field",
      stream: null,
    });
    // One insert — every row takes the same default uploaded_at, so only the id tie-break orders them.
    await addStoryPhotos(pic, s.id, [
      photo("story/c/1.jpg"),
      photo("story/c/2.jpg"),
      photo("story/c/3.jpg"),
    ]);

    const editor = await storyForEditor(pic, s.id);
    const ids = editor!.photos.map((p) => p.id);
    expect(ids).toEqual([...ids].sort()); // stable ascending-by-id order
    expect(editor!.photos).toHaveLength(3);
  });

  it("takes a published Story down when withdrawn", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Turunkan",
      body: "b",
      kind: "field",
      stream: null,
    });
    await publishStory(pic, s.id);
    expect(await publishedAtOf(s.id)).not.toBeNull();

    await withdrawStory(pic, s.id);
    expect(await publishedAtOf(s.id)).toBeNull();
  });

  it("lists drafts and published together in the index, with the cover path", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Di indeks",
      body: "b",
      kind: "final_project",
      stream: null,
    });
    await addStoryPhotos(pic, s.id, [photo("story/d/cover.jpg")]);
    const editor = await storyForEditor(pic, s.id);
    await setStoryCover(pic, s.id, editor!.photos[0]!.id);

    const index = await ceritaIndex(pic);
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      title: "Di indeks",
      schoolName: "SMAN 1 Bandung",
      kind: "final_project",
      coverPhotoPath: "story/d/cover.jpg",
    });
  });

  it("refuses a non-Staff caller everywhere — publishing is Staff-only", async () => {
    const pic = await staff();
    const school = await oneSchool();
    const s = await createStory(pic, {
      schoolId: school.id,
      title: "Staff saja",
      body: "b",
      kind: "field",
      stream: null,
    });
    // T3 (#153) retired the Teaching Team Role, so no non-Staff Person can be invited; the
    // Staff-only gate is still proven with a hand-built non-Staff caller.
    const teacher = nonStaff();

    await expect(ceritaIndex(teacher)).rejects.toSatisfy(isNotStaffError);
    await expect(publishStory(teacher, s.id)).rejects.toSatisfy(isNotStaffError);
    await expect(
      createStory(teacher, {
        schoolId: school.id,
        title: "x",
        body: "b",
        kind: "field",
        stream: null,
      }),
    ).rejects.toSatisfy(isNotStaffError);
  });
});
