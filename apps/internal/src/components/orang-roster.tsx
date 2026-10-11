"use client";

import {
  addPersonAction,
  assignGrantAction,
  revokeGrantAction,
  revokePersonAction,
} from "-/app/(app)/orang/actions";
import type { RosterEntry } from "@sugt/db/queries";
import {
  type Grant,
  GRANT_DESCRIPTIONS,
  GRANT_LABELS,
  GRANTS,
  type Role,
  ROLES,
  ROLE_LABELS,
} from "@sugt/domain";
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
import { useMemo, useOptimistic, useState, useTransition } from "react";

import { MultiSelectCombobox } from "./multi-select-combobox";

/**
 * **Orang** — the roster and the invite list, a dense table scanned for a name.
 *
 * **Everything that writes here is an Administrator's** (`canAdminister`; #470, ADR-0028): the add
 * form, Nonaktifkan, and the **Akses** column's Grant picker. Hiding them is a courtesy;
 * `requireGrant("Administrator")` inside each write is the enforcement. Everyone signed in still
 * reads the roster, since a Group is assembled from it. Revoked rows sit behind a foot toggle — they
 * exist because correcting a role is revoke-and-re-add, which leaves the old row beside the new one
 * sharing an email.
 *
 * **An Administrator never locks themselves out** (#470): their own row offers no Nonaktifkan, and
 * their own Administrator chip cannot be removed. Both writes refuse it server-side too.
 */
function OrangRoster({
  people,
  viewerId,
  canAdminister,
}: {
  people: RosterEntry[];
  /** The signed-in Person, whose own row offers no lockout. */
  viewerId: string;
  canAdminister: boolean;
}) {
  const [showRevoked, setShowRevoked] = useState(false);
  const [query, setQuery] = useState("");

  // Filtering runs in the browser over the payload the page already fetched — the roster is a
  // bounded set and its rows carry every field the search reads, so a filtered query would buy a
  // round trip per keystroke for nothing (the shape `SchoolDirectoryTable` uses). Name and email
  // both match, because a roster two Staff scan at once is searched either way. Both the active and
  // the revoked lists narrow, so a revoked row is still findable behind its toggle.
  const { active, revoked } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (entry: RosterEntry) =>
      needle === "" ||
      entry.fullName.toLowerCase().includes(needle) ||
      entry.email.toLowerCase().includes(needle);
    const activeRows = people.filter((entry) => entry.active && matches(entry));
    const revokedRows = people.filter((entry) => !entry.active && matches(entry));
    return { active: activeRows, revoked: revokedRows };
  }, [people, query]);

  // The active roster is what shows by default; revoked rows sit behind the toggle below, whose
  // label carries their own matched count. So the headline counts the active set against the active
  // total — counting `active + revoked` would promise matches the default view doesn't show (a query
  // that hits only a revoked row would read "3 dari …" above an empty table).
  const activeTotal = useMemo(
    () => people.reduce((count, entry) => (entry.active ? count + 1 : count), 0),
    [people],
  );
  // Nothing matched in either list — the one case that hides the table entirely, so a revoked-only
  // match still leaves the toggle reachable.
  const shownCount = active.length + revoked.length;

  return (
    <div className="flex min-h-full flex-col p-4 sm:p-7">
      {canAdminister && <AddPersonForm />}

      {/* The roster search, distinct from the add-person form above — this one filters the table,
          it does not create anyone. */}
      <div className="mb-4">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Cari nama atau email"
          aria-label="Cari orang"
          className="h-8 w-full max-w-72"
        />
        <p className="mt-2.5 text-xs text-muted-foreground">
          Menampilkan {active.length} dari {activeTotal} orang aktif
        </p>
      </div>

      {shownCount === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Tidak ada orang yang cocok dengan pencarian ini.
        </p>
      ) : (
        <>
          <Table className="border border-border">
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Peran</TableHead>
                <TableHead>Status</TableHead>
                {canAdminister && <TableHead>Akses</TableHead>}
                {canAdminister && <TableHead className="text-right">Tindakan</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((entry) => (
                <PersonRow
                  key={entry.id}
                  entry={entry}
                  isViewer={entry.id === viewerId}
                  canAdminister={canAdminister}
                />
              ))}

              {showRevoked &&
                revoked.map((entry) => (
                  <PersonRow
                    key={entry.id}
                    entry={entry}
                    isViewer={entry.id === viewerId}
                    canAdminister={canAdminister}
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
        </>
      )}
    </div>
  );
}

/**
 * One row. `canAdminister` decides whether the Akses and actions columns exist at all, so every row
 * keeps the header's column count. Nonaktifkan shows only on an active row — a revoked one is
 * already off — and never on the viewer's own (`isViewer`).
 */
function PersonRow({
  entry,
  isViewer,
  canAdminister,
}: {
  entry: RosterEntry;
  isViewer: boolean;
  canAdminister: boolean;
}) {
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
      {canAdminister && (
        <TableCell>
          {/*
            Grants are Staff-only, so only an active Staff row offers the picker; a Pimpinan or a
            revoked row shows a dash. The assign/revoke writes still enforce this server-side —
            `assignGrant` refuses a non-Staff target — so hiding the picker is the courtesy and the
            write is the gate, the same split the roster's other controls follow.
          */}
          {entry.active && entry.role === "Staff" ? (
            <GrantPicker
              personId={entry.id}
              personName={entry.fullName}
              grants={entry.grants}
              isViewer={isViewer}
            />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      )}
      {canAdminister && (
        <TableCell className="text-right">
          {entry.active && !isViewer && <RevokeButton personId={entry.id} />}
        </TableCell>
      )}
    </TableRow>
  );
}

const GRANT_OPTIONS = GRANTS.map((grant) => ({
  value: grant,
  label: GRANT_LABELS[grant],
  description: GRANT_DESCRIPTIONS[grant],
}));

/**
 * The Grants on one Staff row, as removable chips (#470, ADR-0028). Each add or remove assigns or
 * revokes at once through the Server Action; the optimistic list moves the chip immediately and the
 * action's `revalidatePath("/orang")` re-reads the roster, so `useOptimistic` falls back to the true
 * state — the same shape as the Preparation checklist.
 *
 * Only the Grants stored on the row are chips: an implied one is a guard rule, not a row, so choosing
 * Dashboard Editor shows Dashboard Editor alone. **The viewer's own Administrator chip is locked**,
 * and `revokeGrant` refuses that revoke server-side as `own-administrator`.
 */
function GrantPicker({
  personId,
  personName,
  grants,
  isViewer,
}: {
  personId: string;
  personName: string;
  grants: Grant[];
  isViewer: boolean;
}) {
  const [held, setHeld] = useOptimistic(grants, (_state, next: Grant[]) => next);
  const [, startSaving] = useTransition();

  function change(next: Grant[]) {
    const added = next.filter((grant) => !held.includes(grant));
    const removed = held.filter((grant) => !next.includes(grant));
    startSaving(async () => {
      // Inside the transition so the chips and the pending state are one update, then the actions —
      // their `revalidatePath` re-reads the real grants and `useOptimistic` falls back to them.
      setHeld(next);
      await Promise.all([
        ...added.map((grant) => assignGrantAction(personId, grant)),
        ...removed.map((grant) => revokeGrantAction(personId, grant)),
      ]);
    });
  }

  return (
    <div className="min-w-56">
      <MultiSelectCombobox
        aria-label={`Akses ${personName}`}
        placeholder="Tambah akses"
        emptyLabel="Tidak ada akses yang cocok."
        options={GRANT_OPTIONS}
        value={held}
        locked={isViewer ? ["Administrator"] : []}
        onValueChange={(next) => {
          change(next as Grant[]);
        }}
      />
    </div>
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
 * page was open — the ordinary case for a roster two Administrators scan at once — so it earns a
 * message rather than a silent no-op, because nothing revalidates and the row would otherwise not
 * move. The viewer's own row never shows this button, but `self` (#470) still gets its own sentence.
 */
function RevokeButton({ personId }: { personId: string }) {
  const [saving, startSaving] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={saving}
        onClick={() => {
          startSaving(async () => {
            const result = await revokePersonAction(personId);
            if (result.outcome !== "revoked") setRefusal(REVOKE_REFUSALS[result.outcome]);
          });
        }}
      >
        {saving ? "Menonaktifkan…" : "Nonaktifkan"}
      </Button>
      {refusal !== null && <p className="mt-1 text-xs text-destructive">{refusal}</p>}
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
 * form is an Administrator's (#470), and a Pimpinan added here manages nobody.
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

/** Nonaktifkan's two refusals, by outcome. */
const REVOKE_REFUSALS = {
  "no-such-person": "Sudah dinonaktifkan. Muat ulang halaman untuk melihat keadaannya.",
  self: "Anda tidak bisa menonaktifkan diri sendiri.",
} as const;

const MESSAGES = {
  incomplete: "Nama dan email wajib diisi.",
  "email-taken": "Email itu sudah dipakai oleh orang yang masih aktif.",
} as const;

export { GRANT_OPTIONS, OrangRoster };
