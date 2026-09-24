import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { publicUrlFor } from "-/lib/story-photo-url";
import { type CeritaEntry, ceritaIndex } from "@sugt/db/queries";
import { Badge } from "@sugt/ui/components/badge";
import { LinkButton } from "@sugt/ui/components/link-button";
import { ImageOff, Plus } from "lucide-react";
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
 * Drafts and published Stories are split into two sections — a draft is `published_at` null — each
 * newest-first, the order `ceritaIndex` returns.
 */
export default async function Page() {
  const person = await requirePerson();
  const entries = await staffSurface(() => ceritaIndex(person));

  const drafts = entries.filter((entry) => entry.publishedAt === null);
  const published = entries.filter((entry) => entry.publishedAt !== null);

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

      {entries.length === 0 ? (
        <p className="p-7 text-sm text-muted-foreground">
          Belum ada Cerita. Mulai satu dengan tombol Cerita baru.
        </p>
      ) : (
        <div className="space-y-8 p-7">
          <Section
            title="Draf"
            count={drafts.length}
            entries={drafts}
            emptyLabel="Tidak ada draf."
          />
          <Section
            title="Terbit"
            count={published.length}
            entries={published}
            emptyLabel="Belum ada Cerita yang terbit."
          />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  entries,
  emptyLabel,
}: {
  title: string;
  count: number;
  entries: CeritaEntry[];
  emptyLabel: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        {title} · {count}
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <EntryCard entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EntryCard({ entry }: { entry: CeritaEntry }) {
  return (
    <Link
      href={`/cerita/${entry.id}`}
      className="flex gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
        {entry.coverPhotoPath ? (
          // eslint-disable-next-line @next/next/no-img-element -- internal thumbnail, no optimisation needed
          <img
            src={publicUrlFor(entry.coverPhotoPath)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageOff className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-sm font-medium">{entry.title || "Tanpa judul"}</p>
        <p className="truncate text-xs text-muted-foreground">{entry.schoolName}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">
            {entry.kind === "field" ? "Cerita lapangan" : "Final Project"}
          </Badge>
          <Badge variant="outline">{entry.stream ?? "Keduanya"}</Badge>
        </div>
      </div>
    </Link>
  );
}
