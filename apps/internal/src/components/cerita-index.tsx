"use client";

import type { CeritaEntry } from "@sugt/db/queries";
import { Badge } from "@sugt/ui/components/badge";
import { Input } from "@sugt/ui/components/input";
import { ImageOff } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * One Story card's data: a `CeritaEntry` plus its cover URL, built on the server.
 *
 * The URL is computed by `publicUrlFor` on the page, not here — that helper reads `SUPABASE_URL`
 * through `requireEnv`, a server-only value (rule 4, and `@sugt/ui` presentational-only). So this
 * client component receives the finished string and stays a pure renderer; no env crosses to the
 * browser.
 */
export type CeritaCard = CeritaEntry & { coverPhotoUrl: string | null };

/**
 * **Cerita** — the two-section index, narrowed by a search box.
 *
 * **The filtering happens here and not in the query.** The page fetches every Story and hands the
 * full array down; the browser narrows it as you type, the one-round-trip shape `SchoolDirectoryTable`
 * uses. Search matches title and School name, the two texts on a card. The filter runs across the
 * whole list first, then the result splits back into Draf and Terbit — so each section's count is the
 * count of what matched within it, and both narrow together.
 */
function CeritaIndex({ entries }: { entries: CeritaCard[] }) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return entries;
    return entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(needle) ||
        entry.schoolName.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  const drafts = shown.filter((entry) => entry.publishedAt === null);
  const published = shown.filter((entry) => entry.publishedAt !== null);

  return (
    <div className="space-y-8 p-7">
      <div>
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Cari Cerita atau Sekolah"
          aria-label="Cari Cerita atau Sekolah"
          className="h-8 w-full max-w-72"
        />
        <p className="mt-2.5 text-xs text-muted-foreground">
          Menampilkan {shown.length} dari {entries.length} Cerita
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Tidak ada Cerita yang cocok dengan pencarian ini.
        </p>
      ) : (
        <>
          <Section
            title="Draf"
            count={drafts.length}
            entries={drafts}
            emptyLabel="Tidak ada draf yang cocok."
          />
          <Section
            title="Terbit"
            count={published.length}
            entries={published}
            emptyLabel="Tidak ada Cerita terbit yang cocok."
          />
        </>
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
  entries: CeritaCard[];
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

function EntryCard({ entry }: { entry: CeritaCard }) {
  return (
    <Link
      href={`/cerita/${entry.id}`}
      className="flex gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
        {entry.coverPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- internal thumbnail, no optimisation needed
          <img
            src={entry.coverPhotoUrl}
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

export { CeritaIndex };
