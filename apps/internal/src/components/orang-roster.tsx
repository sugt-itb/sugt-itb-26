"use client";

import { addPersonAction, revokePersonAction } from "-/app/(app)/orang/actions";
import type { RosterEntry } from "@sugt/db/queries";
import { type Role, ROLES, ROLE_LABELS } from "@sugt/domain";
import { Badge } from "@sugt/ui/components/badge";
import { Button } from "@sugt/ui/components/button";
import { Input } from "@sugt/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sugt/ui/components/table";
import { Lock } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

/**
 * **Orang** — the roster and the invite list, a dense table scanned for a name.
 *
 * The add form and the revoke controls render only for Staff (`canWrite`); hiding them is a
 * courtesy, and `requireStaff` inside each write is the enforcement. Revoked rows sit behind a
 * foot toggle — they exist because correcting a role is revoke-and-re-add, which leaves the old
 * row beside the new one sharing an email.
 */
function OrangRoster({ people, canWrite }: { people: RosterEntry[]; canWrite: boolean }) {
  const [showRevoked, setShowRevoked] = useState(false);

  const { active, revoked } = useMemo(() => {
    const activeRows = people.filter((entry) => entry.active);
    const revokedRows = people.filter((entry) => !entry.active);
    return { active: activeRows, revoked: revokedRows };
  }, [people]);

  return (
    <div className="flex min-h-full flex-col p-7">
      {canWrite && <AddPersonForm />}

      <Table className="border border-border">
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Peran</TableHead>
            <TableHead>Status</TableHead>
            {canWrite && <TableHead className="text-right">Tindakan</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {active.map((entry) => (
            <PersonRow
              key={entry.id}
              entry={entry}
              canWrite={canWrite}
            />
          ))}

          {showRevoked &&
            revoked.map((entry) => (
              <PersonRow
                key={entry.id}
                entry={entry}
                canWrite={canWrite}
              />
            ))}
        </TableBody>
      </Table>

      {revoked.length > 0 && (
        <button
          type="button"
          className="mt-3 self-start text-sm text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => {
            setShowRevoked((previous) => !previous);
          }}
        >
          {showRevoked
            ? "Sembunyikan yang dinonaktifkan"
            : `Tampilkan yang dinonaktifkan (${revoked.length})`}
        </button>
      )}
    </div>
  );
}

/**
 * One row. `canWrite` is whether the viewer is Staff — it decides whether the actions column
 * exists at all, so every row a Staff member sees keeps the column count of the header. The
 * revoke button inside it shows only on an active row: a revoked one is already off.
 */
function PersonRow({ entry, canWrite }: { entry: RosterEntry; canWrite: boolean }) {
  return (
    <TableRow className={entry.active ? undefined : "text-muted-foreground"}>
      <TableCell className="font-medium">{entry.fullName}</TableCell>
      <TableCell className="text-muted-foreground">{entry.email}</TableCell>
      <TableCell>
        {/*
          The row says whether the role is fixed. It is write-once once a Person is used — the
          database refuses the change — so a used row shows a lock and an unused one says, in the
          title, that the role can still change. Correcting a role either way is revoke-and-re-add,
          never an in-place edit the database would reject.
        */}
        <span
          className="inline-flex items-center gap-1.5"
          title={
            entry.used
              ? "Peran terkunci karena sudah dipakai"
              : "Peran masih bisa diubah dengan menonaktifkan lalu menambahkan ulang"
          }
        >
          {ROLE_LABELS[entry.role]}
          {entry.used && (
            <Lock
              className="size-3.5 text-muted-foreground"
              aria-label="Peran terkunci karena sudah dipakai"
            />
          )}
        </span>
      </TableCell>
      <TableCell>
        <StateBadge entry={entry} />
      </TableCell>
      {canWrite && (
        <TableCell className="text-right">
          {entry.active && <RevokeButton personId={entry.id} />}
        </TableCell>
      )}
    </TableRow>
  );
}

/** The three states, one badge each. `signedIn` distinguishes an invited row from a used account. */
function StateBadge({ entry }: { entry: RosterEntry }) {
  if (!entry.active) return <Badge variant="secondary">Nonaktif</Badge>;
  if (entry.signedIn) return <Badge>Aktif</Badge>;
  return <Badge variant="outline">Diundang</Badge>;
}

/**
 * Revoking is one write. `no-such-person` means somebody else already revoked this row while the
 * page was open — the ordinary case for a roster two Staff scan at once — so it earns a message
 * rather than a silent no-op, because nothing revalidates and the row would otherwise not move.
 */
function RevokeButton({ personId }: { personId: string }) {
  const [saving, startSaving] = useTransition();
  const [stale, setStale] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={saving}
        onClick={() => {
          startSaving(async () => {
            const result = await revokePersonAction(personId);
            if (result.outcome !== "revoked") setStale(true);
          });
        }}
      >
        {saving ? "Menonaktifkan…" : "Nonaktifkan"}
      </Button>
      {stale && (
        <p className="mt-1 text-xs text-destructive">
          Sudah dinonaktifkan. Muat ulang halaman untuk melihat keadaannya.
        </p>
      )}
    </>
  );
}

/**
 * The single-row add form above the table. The gate is the invite list alone (ADR-0003, amended
 * by #115) — any Google address may be listed — so the only failures the form surfaces are an
 * incomplete row and a duplicate active email the database's partial index refuses.
 *
 * **The picker is back, now Staff | Pimpinan** (#179). It was dropped in T3 (#153) when the
 * `Teaching Team` Person role was retired and Staff stood alone; `Pimpinan` — a signed-in, read-only
 * role — is the second role a Person may hold, so an invite chooses which. The options iterate
 * `ROLES` and are labelled through `ROLE_LABELS`, so the picker cannot drift from the role set. The
 * gating above is unchanged: only Staff manage the roster, and a Pimpinan added here manages nobody.
 */
function AddPersonForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Staff");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const canSubmit = fullName.trim() !== "" && email.trim() !== "";

  function submit() {
    if (!canSubmit) return;

    startSaving(async () => {
      const result = await addPersonAction({ fullName, email, role });
      if (result.outcome === "added") {
        setFullName("");
        setEmail("");
        setRole("Staff");
        setError(null);
        return;
      }
      setError(MESSAGES[result.outcome]);
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-border p-3.5">
      <div className="flex flex-wrap items-end gap-2.5">
        <Input
          value={fullName}
          onChange={(event) => {
            setFullName(event.target.value);
            setError(null);
          }}
          placeholder="Nama"
          aria-label="Nama"
          className="h-8 w-full max-w-56"
        />
        <Input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          placeholder="Email"
          aria-label="Email"
          className="h-8 w-full max-w-64"
        />
        {/* Staff or Pimpinan (#179). The trigger shows the current role's label; options iterate ROLES. */}
        <Select
          items={ROLE_LABELS}
          value={role}
          onValueChange={(next) => {
            setRole(next as Role);
          }}
        >
          <SelectTrigger
            aria-label="Peran"
            className="h-8 w-full max-w-40"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem
                key={r}
                value={r}
              >
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={saving || !canSubmit}
          onClick={submit}
        >
          {saving ? "Menambah…" : "Tambah"}
        </Button>
      </div>

      {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

const MESSAGES = {
  incomplete: "Nama dan email wajib diisi.",
  "email-taken": "Email itu sudah dipakai oleh orang yang masih aktif.",
} as const;

export { OrangRoster };
