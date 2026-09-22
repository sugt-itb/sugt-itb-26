"use client";

import type { DirectorySchool } from "@sugt/db/queries";
import { TOTAL_SESSIONS_PER_SCHOOL } from "@sugt/domain";
import { Button } from "@sugt/ui/components/button";
import { Input } from "@sugt/ui/components/input";
import { Progress } from "@sugt/ui/components/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sugt/ui/components/table";
import { cn } from "@sugt/ui/lib/utils";
import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * Every School, narrowed by a search box and a Cluster.
 *
 * **The filtering happens here and not in the query**, which is what keeps the screen
 * one round trip: forty-seven is a fixed and small set, so the payload carries all of
 * them and the browser narrows them as you type. A filtered query would cost a round
 * trip per keystroke to search a list that fits in memory twice over.
 *
 * The Cluster filter is four chips rather than a menu. There are exactly four Clusters
 * and they are fixed, so a control that hides them behind a click hides the whole
 * axis; the Cluster is also the only grouping the Programme is organised by, which
 * makes it worth spending the width on.
 */
function SchoolDirectoryTable({ schools }: { schools: DirectorySchool[] }) {
  const [query, setQuery] = useState("");
  const [clusterId, setClusterId] = useState<string | null>(null);

  /** In payload order, so the chips read the same way the table does. */
  const clusters = useMemo(() => {
    const byId = new Map<string, string>();
    for (const school of schools) byId.set(school.clusterId, school.clusterName);
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [schools]);

  const shown = useMemo(() => {
    // Kabupaten/Kota is searched alongside the name: six Schools are in Jakarta and
    // three in Banda Aceh, so "aceh" is a question somebody will type.
    const needle = query.trim().toLowerCase();
    return schools.filter((school) => {
      if (clusterId !== null && school.clusterId !== clusterId) return false;
      if (needle === "") return true;
      return (
        school.name.toLowerCase().includes(needle) ||
        school.kabupatenKota.toLowerCase().includes(needle)
      );
    });
  }, [schools, query, clusterId]);

  return (
    <div className="flex min-h-full flex-col p-7">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Cari Sekolah atau Kabupaten/Kota"
          aria-label="Cari Sekolah atau Kabupaten/Kota"
          className="h-8 w-full max-w-72"
        />

        <div className="flex flex-wrap gap-1.5">
          <ClusterChip
            label="Semua Cluster"
            selected={clusterId === null}
            onSelect={() => {
              setClusterId(null);
            }}
          />
          {clusters.map((cluster) => (
            <ClusterChip
              key={cluster.id}
              label={cluster.name}
              selected={clusterId === cluster.id}
              onSelect={() => {
                setClusterId(cluster.id);
              }}
            />
          ))}
        </div>
      </div>

      <p className="mb-2.5 text-xs text-muted-foreground">
        Menampilkan {shown.length} dari {schools.length} Sekolah
      </p>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Tidak ada Sekolah yang cocok dengan pencarian ini.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sekolah</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead>Kabupaten/Kota</TableHead>
              <TableHead className="text-right">Sesi terlaksana</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((school) => (
              <TableRow key={school.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/sekolah/${school.slug}`}
                    className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    {school.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{school.clusterName}</TableCell>
                <TableCell className="text-muted-foreground">{school.kabupatenKota}</TableCell>
                <TableCell className="text-right">
                  {/*
                    The count and its meter, inline — number then bar, right-aligned. A plain
                    restatement of the count: one length, one colour, no threshold and no ramp. It
                    carries the same `<Progress>` the retired `/coverage` page used, because the
                    directory now tells the whole "where are we" story and Coverage showed the same
                    count over the same Schools (#154). A Rating's severity ramp belongs to the
                    Rating controls (`docs/product.md`), deliberately not to a delivery count.
                  */}
                  <div className="flex items-center justify-end gap-3">
                    <span className="tabular-nums">
                      {school.deliveredSessions} / {TOTAL_SESSIONS_PER_SCHOOL}
                    </span>
                    <Progress
                      className="w-21 shrink-0"
                      value={school.deliveredSessions}
                      max={TOTAL_SESSIONS_PER_SCHOOL}
                      aria-label={`${school.name}: ${school.deliveredSessions} dari ${TOTAL_SESSIONS_PER_SCHOOL} Sesi terlaksana`}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * One Cluster of the filter. `aria-pressed` rather than a radio group: these are
 * toggles over a list already on screen, and nothing is submitted.
 */
function ClusterChip({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      variant={selected ? "default" : "ghost"}
      size="sm"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(!selected && "text-muted-foreground")}
    >
      {label}
    </Button>
  );
}

export { SchoolDirectoryTable };
