import { CeritaEditor } from "-/components/cerita/cerita-editor";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { publicUrlFor } from "-/lib/story-photo-url";
import { schoolDirectory, storyForEditor } from "@sugt/db/queries";
import { notFound } from "next/navigation";

/**
 * **The Cerita editor** — one Story, its badges, its cover, and its gallery.
 *
 * Staff-only, so the read is too: `staffSurface` turns `@sugt/db`'s typed refusal into a 403 on
 * the server. Without it, a Teaching Team member who reached this URL directly would be shown the
 * whole editor and refused only on the first write. An id that names no Story is a 404 — a
 * hand-typed or stale link, not a state to render.
 *
 * The School name is looked up from the directory (all forty-seven, open to anyone signed in) rather
 * than joined into `storyForEditor`, which returns the `school_id` a Story attaches to and no more.
 * Each photograph's public URL is built here so `SUPABASE_URL` never reaches the client.
 */
export default async function Page({ params }: PageProps<"/cerita/[id]">) {
  const person = await requirePerson();
  const { id } = await params;

  const story = await staffSurface(() => storyForEditor(person, id));
  if (!story) notFound();

  // `school_id` is a NOT NULL foreign key and `schoolDirectory` returns every School, so the match
  // always resolves; the `?? ""` is only there to satisfy the type, not a School the reader will see.
  const schools = await schoolDirectory(person);
  const schoolName = schools.find((school) => school.id === story.schoolId)?.name ?? "";

  return (
    <div className="flex min-h-full flex-col">
      <CeritaEditor
        story={{
          id: story.id,
          slug: story.slug,
          schoolName,
          title: story.title,
          body: story.body,
          kind: story.kind,
          stream: story.stream,
          coverPhotoId: story.coverPhotoId,
          publishedAt: story.publishedAt,
          photos: story.photos.map((photo) => ({ ...photo, url: publicUrlFor(photo.storagePath) })),
        }}
      />
    </div>
  );
}
