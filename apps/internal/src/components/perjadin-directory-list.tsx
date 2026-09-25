"use client";

import { shortenKabupaten } from "-/lib/format-destination";
import type { DirectoryPerjadin } from "@sugt/db/queries";
import { Input } from "@sugt/ui/components/input";
import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * The Perjadin list, narrowed by a search box.
 *
 * **The filtering happens here and not in the query**, the one-round-trip shape
 * `SchoolDirectoryTable` uses: the page fetches every trip — now carrying the three name arrays the
 * search reads (#334) — and the browser narrows them as you type. A trip matches when the query is a
 * case-insensitive substring of its **destination** (a Perjadin has no separate name — the
 * destination is its identity), its **PIC** name, or any of its **pengajar**, **Group-member** or
 * **School** names. Those three arrays are search-only: nothing below renders them.
 */
function PerjadinDirectoryList({ trips }: { trips: DirectoryPerjadin[] }) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return trips;
    return trips.filter((trip) => {
      const haystack = [
        trip.destination,
        trip.picFullName,
        ...trip.pengajarNames,
        ...trip.groupMemberNames,
        ...trip.schoolNames,
      ];
      return haystack.some((field) => field.toLowerCase().includes(needle));
    });
  }, [trips, query]);

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-7 pt-5">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Cari Perjadin"
          aria-label="Cari Perjadin"
          className="h-8 w-full max-w-72"
        />
        <p className="mt-2.5 text-xs text-muted-foreground">
          Menampilkan {shown.length} dari {trips.length} Perjadin
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="px-7 py-10 text-center text-sm text-muted-foreground">
          Tidak ada Perjadin yang cocok dengan pencarian ini.
        </p>
      ) : (
        <ul className="mt-3 border-t border-border">
          {shown.map((trip) => (
            <li
              key={trip.id}
              className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-border px-7 py-3"
            >
              <Link
                href={`/perjadin/${trip.id}`}
                className="text-sm font-medium hover:underline"
              >
                {shortenKabupaten(trip.destination)}
              </Link>
              <span className="text-sm text-muted-foreground tabular-nums">
                {trip.startsOn} – {trip.endsOn}
              </span>
              <span className="text-xs text-muted-foreground">PIC {trip.picFullName}</span>
              <PreparationPill
                done={trip.preparationDone}
                total={trip.preparationTotal}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {trip.schoolCount} Sekolah
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * **The `Persiapan: x/N` pill**, coloured by progress ([#114](https://github.com/mafiefa02/sugt/issues/114)):
 * neutral before anything is ticked, amber part-way, green when every item is done. `N` is at least
 * the six fixed items, so it is never zero and "complete" is `done === total`.
 */
function PreparationPill({ done, total }: { done: number; total: number }) {
  const tone =
    done === total
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : done > 0
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`}>
      Persiapan: {done}/{total}
    </span>
  );
}

export { PerjadinDirectoryList };
