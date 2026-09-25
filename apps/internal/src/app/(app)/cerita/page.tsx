import { CeritaIndex } from "-/components/cerita-index";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { publicUrlFor } from "-/lib/story-photo-url";
import { ceritaIndex } from "@sugt/db/queries";
import { LinkButton } from "@sugt/ui/components/link-button";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Cerita" };

/**
 * **Cerita** — the index of every Story, draft and published, and the way into the editor.
 *
 * Staff-only, so the read is too: `ceritaIndex` opens with the Staff choke point and `staffSurface`
 * turns its refusal into a 403 on the server. The sidebar already hides this surface from a
 * Teaching Team member; this is the gate that holds when one navigates straight to the URL.
 *
 * The page fetches the full list and folds each Story's cover URL in here — `publicUrlFor` reads a
 * server-only env, so the string is built server-side and handed down — then `CeritaIndex` filters
 * and renders it in the browser, splitting the matches into the Draf and Terbit sections.
 */
export default async function Page() {
  const person = await requirePerson();
  const entries = await staffSurface(() => ceritaIndex(person));

  const cards = entries.map((entry) => ({
    ...entry,
    coverPhotoUrl: entry.coverPhotoPath === null ? null : publicUrlFor(entry.coverPhotoPath),
  }));

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-7 py-5">
        <div>
          <h1 className="font-heading text-lg font-medium">Cerita</h1>
          <p className="text-sm text-muted-foreground">
            Narasi publik tentang Sekolah, ditulis dan diterbitkan di sini.
          </p>
        </div>
        <LinkButton render={<Link href="/cerita/baru" />}>
          <Plus data-icon="inline-start" />
          Cerita baru
        </LinkButton>
      </header>

      {cards.length === 0 ? (
        <p className="p-7 text-sm text-muted-foreground">
          Belum ada Cerita. Mulai satu dengan tombol Cerita baru.
        </p>
      ) : (
        <CeritaIndex entries={cards} />
      )}
    </div>
  );
}
