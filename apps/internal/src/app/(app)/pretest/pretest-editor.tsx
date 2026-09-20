"use client";

import { setPretestCompletionAction } from "-/app/(app)/pretest/actions";
import type { PretestEditorData, PretestSchool } from "@sugt/db/queries";
import { Checkbox } from "@sugt/ui/components/checkbox";
import { Input } from "@sugt/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sugt/ui/components/table";
import { useMemo, useOptimistic, useState, useTransition } from "react";

import {
  completionKey,
  completionKeySet,
  groupSchoolsByCluster,
  PRETEST_COLUMNS,
  type PretestColumn,
} from "./pretest-derive";

/**
 * **The `/pretest` editor grid** — one row per School under its Cluster heading, four Pretest
 * checkboxes each (STEM·Siswa, STEM·GTK-MS, Research·Siswa, Research·GTK-MS), a name-search box
 * above. Each toggle writes on its own through the grant-gated Server Action, optimistically, with
 * no bulk save — the same `useOptimistic` + `useTransition` shape as `GrantToggles` on the roster:
 * the box flips at once, and the action's `revalidatePath("/pretest")` re-reads the true rows so the
 * optimistic set falls back to them. Presence of a completion = ticked; un-ticking removes it.
 */
function PretestEditor({ clusters, schools, completions }: PretestEditorData) {
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startToggle] = useTransition();

  const base = useMemo(() => completionKeySet(completions), [completions]);
  const [done, setDone] = useOptimistic(base, (state, patch: { key: string; done: boolean }) => {
    const next = new Set(state);
    if (patch.done) next.add(patch.key);
    else next.delete(patch.key);
    return next;
  });

  const groups = useMemo(
    () => groupSchoolsByCluster(clusters, schools, search),
    [clusters, schools, search],
  );

  function toggle(school: PretestSchool, column: PretestColumn, next: boolean) {
    const key = completionKey(school.id, column.stream, column.participantType);
    startToggle(async () => {
      // Inside the transition so the flip and the pending state are one update, then the action —
      // its `revalidatePath` re-reads the real rows and `useOptimistic` falls back to them.
      setDone({ key, done: next });
      try {
        await setPretestCompletionAction({
          schoolId: school.id,
          stream: column.stream,
          participantType: column.participantType,
          done: next,
        });
        setError(null);
      } catch {
        // The optimistic set reverts to the server truth when the transition ends without a
        // committed change; surface why nothing moved.
        setError("Gagal menyimpan perubahan. Muat ulang halaman lalu coba lagi.");
      }
    });
  }

  return (
    <div className="flex min-h-full flex-col gap-4 p-7">
      <Input
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
        placeholder="Cari sekolah…"
        aria-label="Cari sekolah"
        className="h-9 w-full max-w-80"
      />

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <Table className="border border-border">
        <TableHeader>
          <TableRow>
            <TableHead>Sekolah</TableHead>
            {PRETEST_COLUMNS.map((column) => (
              <TableHead
                key={completionKey("", column.stream, column.participantType)}
                className="text-center whitespace-nowrap"
              >
                {column.stream} · {column.participantType}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={PRETEST_COLUMNS.length + 1}
                className="text-center text-sm text-muted-foreground"
              >
                Tidak ada sekolah yang cocok.
              </TableCell>
            </TableRow>
          ) : (
            groups.map((group) => (
              <ClusterGroup
                key={group.id}
                name={group.name}
                schools={group.schools}
                done={done}
                onToggle={toggle}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** One Cluster's heading row followed by its School rows. */
function ClusterGroup({
  name,
  schools,
  done,
  onToggle,
}: {
  name: string;
  schools: PretestSchool[];
  done: Set<string>;
  onToggle: (school: PretestSchool, column: PretestColumn, next: boolean) => void;
}) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell
          colSpan={PRETEST_COLUMNS.length + 1}
          className="font-medium text-muted-foreground"
        >
          {name}
        </TableCell>
      </TableRow>
      {schools.map((school) => (
        <TableRow key={school.id}>
          <TableCell className="font-medium">{school.name}</TableCell>
          {PRETEST_COLUMNS.map((column) => {
            const key = completionKey(school.id, column.stream, column.participantType);
            return (
              <TableCell
                key={key}
                className="text-center"
              >
                <Checkbox
                  checked={done.has(key)}
                  onCheckedChange={(checked) => {
                    onToggle(school, column, checked === true);
                  }}
                  aria-label={`${school.name} — ${column.stream} · ${column.participantType}`}
                />
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
}

export { PretestEditor };
