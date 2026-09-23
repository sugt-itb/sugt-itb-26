import type { StoryKind, Stream } from "@sugt/domain";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../client";
import { person } from "../schema/people";
import { school } from "../schema/reference";
import { story, storyPhoto } from "../schema/stories";
import type { Person } from "./caller";
import { requireStaff } from "./staff-only";

/**
 * **Cerita** — the Stories index and the editor behind it. Staff-only: publishing is money's
 * neighbour on ADR-0004's wall, and every function here opens with the choke point.
 *
 * The one gate in the product lives in `publishStory`: a Story with photographs and no cover
 * cannot be published. Everything else is open, per `CONTEXT.md`.
 */

/** A row in the Cerita index — draft or published, newest first. */
export type CeritaEntry = {
  id: string;
  slug: string;
  title: string;
  schoolName: string;
  stream: Stream | null;
  kind: StoryKind;
  coverPhotoPath: string | null;
  publishedAt: Date | null;
};

/** One Story and its gallery, for the editor. `null` when the id names none. */
export type StoryForEditor = {
  id: string;
  slug: string;
  schoolId: string;
  title: string;
  body: string;
  stream: Stream | null;
  kind: StoryKind;
  coverPhotoId: string | null;
  publishedAt: Date | null;
  photos: StoryPhoto[];
};

export type StoryPhoto = {
  id: string;
  storagePath: string;
  contentType: string;
  caption: string | null;
};

export type CreateStoryInput = {
  schoolId: string;
  title: string;
  body: string;
  kind: StoryKind;
  stream: Stream | null;
};

export type UpdateStoryInput = {
  title: string;
  body: string;
  kind: StoryKind;
  stream: Stream | null;
};

/** A photograph the upload has already landed in `public-media`. */
export type NewStoryPhoto = {
  storagePath: string;
  contentType: string;
  byteSize: number;
  caption: string | null;
};

export type PublishResult =
  | { outcome: "published" }
  /** Photographs exist but none is the cover — the one gate in the product. */
  | { outcome: "needs-cover" }
  | { outcome: "no-such-story" };

/**
 * A URL-safe slug from the title. Not reversible and not the title: it is the public path, so
 * it is generated once at creation and never re-derived — editing a published Story's title
 * must not move the page out from under a link to it.
 */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
  return base === "" ? "cerita" : base;
}

/** The index: every Story, draft and published, newest first. */
export async function ceritaIndex(caller: Person): Promise<CeritaEntry[]> {
  requireStaff(caller);
  const cover = alias(storyPhoto, "cover");
  return db
    .select({
      id: story.id,
      slug: story.slug,
      title: story.title,
      schoolName: school.name,
      stream: story.stream,
      kind: story.kind,
      coverPhotoPath: cover.storagePath,
      publishedAt: story.publishedAt,
    })
    .from(story)
    .innerJoin(school, eq(school.id, story.schoolId))
    .leftJoin(cover, eq(cover.id, story.coverPhotoId))
    .orderBy(desc(story.updatedAt));
}

/** One Story and its gallery, or `null`. The gallery orders by `uploaded_at`, tie-broken by `id`. */
export async function storyForEditor(caller: Person, id: string): Promise<StoryForEditor | null> {
  requireStaff(caller);
  // Column-explicit like every other read in this package: `StoryForEditor` uses exactly these nine
  // columns, so a bare `select()` would pull `written_by_*`, `created_at` and `updated_at` only to
  // discard them below.
  const [row] = await db
    .select({
      id: story.id,
      slug: story.slug,
      schoolId: story.schoolId,
      title: story.title,
      body: story.body,
      stream: story.stream,
      kind: story.kind,
      coverPhotoId: story.coverPhotoId,
      publishedAt: story.publishedAt,
    })
    .from(story)
    .where(eq(story.id, id));
  if (!row) return null;
  const photos = await db
    .select({
      id: storyPhoto.id,
      storagePath: storyPhoto.storagePath,
      contentType: storyPhoto.contentType,
      caption: storyPhoto.caption,
    })
    .from(storyPhoto)
    .where(eq(storyPhoto.storyId, id))
    .orderBy(asc(storyPhoto.uploadedAt), asc(storyPhoto.id));
  return {
    id: row.id,
    slug: row.slug,
    schoolId: row.schoolId,
    title: row.title,
    body: row.body,
    stream: row.stream,
    kind: row.kind,
    coverPhotoId: row.coverPhotoId,
    publishedAt: row.publishedAt,
    photos,
  };
}

/** Create a draft Story. `published_at` is null; the slug is generated once, here. */
export async function createStory(
  caller: Person,
  input: CreateStoryInput,
): Promise<{ id: string; slug: string }> {
  requireStaff(caller);
  return db.transaction(async (tx) => {
    // The slug is `base`, or `base-2`, `base-3`… — the first no Story holds. One statement reads
    // every collision; the loop picks a free suffix without a second round trip per try.
    const base = slugify(input.title);
    const taken = new Set(
      (
        await tx
          .select({ slug: story.slug })
          .from(story)
          .where(like(story.slug, `${base}%`))
      ).map((row) => row.slug),
    );
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    const [row] = await tx
      .insert(story)
      .values({
        slug,
        schoolId: input.schoolId,
        title: input.title,
        body: input.body,
        kind: input.kind,
        stream: input.stream,
        writtenByPersonId: caller.id,
      })
      .returning({ id: story.id, slug: story.slug });
    return row!;
  });
}

/** Edit a Story's prose and badges. The slug does not move — see `slugify`. */
export async function updateStory(
  caller: Person,
  id: string,
  input: UpdateStoryInput,
): Promise<void> {
  requireStaff(caller);
  await db
    .update(story)
    .set({
      title: input.title,
      body: input.body,
      kind: input.kind,
      stream: input.stream,
      updatedAt: new Date(),
    })
    .where(eq(story.id, id));
}

/** Attach photographs the upload has landed. Bulk or single — the same insert. */
export async function addStoryPhotos(
  caller: Person,
  storyId: string,
  photos: NewStoryPhoto[],
): Promise<void> {
  requireStaff(caller);
  if (photos.length === 0) return;
  await db.insert(storyPhoto).values(
    photos.map((photo) => ({
      storyId,
      storagePath: photo.storagePath,
      contentType: photo.contentType,
      byteSize: photo.byteSize,
      caption: photo.caption,
      uploadedByPersonId: caller.id,
    })),
  );
}

/**
 * Promote a photograph to cover, or clear it (`photoId` null). Setting it checks the photograph
 * belongs to this Story, so one Story's cover can never be another's photograph.
 */
export async function setStoryCover(
  caller: Person,
  storyId: string,
  photoId: string | null,
): Promise<void> {
  requireStaff(caller);
  await db.transaction(async (tx) => {
    if (photoId !== null) {
      const [owned] = await tx
        .select({ id: storyPhoto.id })
        .from(storyPhoto)
        .where(and(eq(storyPhoto.id, photoId), eq(storyPhoto.storyId, storyId)));
      if (!owned) {
        throw new Error(
          `Photo ${photoId} is not on Story ${storyId}. The editor only offers a Story's own ` +
            "photographs as cover, so this is a bug or a hand-edited request.",
        );
      }
    }
    await tx.update(story).set({ coverPhotoId: photoId }).where(eq(story.id, storyId));
  });
}

/**
 * Delete a photograph. If it was the cover, `story.cover_photo_id` clears itself — the foreign
 * key is `on delete set null`, so the delete is never blocked.
 */
export async function deleteStoryPhoto(
  caller: Person,
  storyId: string,
  photoId: string,
): Promise<void> {
  requireStaff(caller);
  await db
    .delete(storyPhoto)
    .where(and(eq(storyPhoto.id, photoId), eq(storyPhoto.storyId, storyId)));
}

/**
 * Publish a Story — **the one gate in the product**. A Story with photographs and no cover is
 * refused; one with a cover, or with no photographs at all, publishes. Withdrawing is
 * `withdrawStory`. Both leave the revalidation of `@sugt/public` to the caller, which is the
 * only place that can await it and report progress.
 */
export async function publishStory(caller: Person, id: string): Promise<PublishResult> {
  requireStaff(caller);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ coverPhotoId: story.coverPhotoId })
      .from(story)
      .where(eq(story.id, id))
      .for("update");
    if (!current) return { outcome: "no-such-story" };

    const [{ photoCount }] = await tx
      .select({ photoCount: sql<number>`count(*)::int` })
      .from(storyPhoto)
      .where(eq(storyPhoto.storyId, id));
    if (photoCount! > 0 && current.coverPhotoId === null) return { outcome: "needs-cover" };

    await tx
      .update(story)
      .set({ publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(story.id, id));
    return { outcome: "published" };
  });
}

/** Take a Story down: `published_at` back to null. A draft withdrawn is a no-op, not an error. */
export async function withdrawStory(caller: Person, id: string): Promise<void> {
  requireStaff(caller);
  await db.update(story).set({ publishedAt: null, updatedAt: new Date() }).where(eq(story.id, id));
}

/** The two slugs a publish or withdrawal has to revalidate on `@sugt/public`: the Story's own and its School's. */
export type StoryPublicTargets = { slug: string; schoolSlug: string };

/**
 * The public path segments a Story's revalidation needs — its own slug and its School's — read in
 * one join so the publish flow does not carry the School slug from the editor. `null` when the id
 * names no Story. Staff-only, like everything that reaches a publish.
 */
export async function storyPublicTargets(
  caller: Person,
  id: string,
): Promise<StoryPublicTargets | null> {
  requireStaff(caller);
  const [row] = await db
    .select({ slug: story.slug, schoolSlug: school.slug })
    .from(story)
    .innerJoin(school, eq(school.id, story.schoolId))
    .where(eq(story.id, id));
  return row ?? null;
}
