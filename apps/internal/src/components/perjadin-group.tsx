"use client";

import { changePerjadinPicAction, setPerjadinStaffAction } from "-/app/(app)/perjadin/[id]/actions";
import { MultiSelectCombobox } from "-/components/multi-select-combobox";
import { PersonSelect } from "-/components/person-select";
import type { GroupMemberEntry } from "@sugt/db/queries";
import { MAX_EXTRA_STAFF_PER_GROUP, PERJADIN_ROLE_LABELS } from "@sugt/domain";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import { Label } from "@sugt/ui/components/label";
import { useId, useState, useTransition } from "react";

/**
 * The Group — the PIC plus up to ten other DITSAMA Staff (ADR-0020) — and the way Staff edit it.
 *
 * The Teaching Team have left the Group entirely; a Group is Staff and only Staff now, so editing it
 * is choosing the PIC and the extra Staff. Both are granular writes: the PIC is reassigned through
 * `changePerjadinPic`, which keeps the deferred membership foreign key valid, and the extra Staff are
 * set whole through `setPerjadinStaff`. The Perjadin keeps its id, so its Sessions, Advance and
 * transactions are untouched.
 */
function PerjadinGroup({
  perjadinId,
  group,
  picPersonId,
  staff,
  canEdit,
}: {
  perjadinId: string;
  group: GroupMemberEntry[];
  picPersonId: string;
  staff: { id: string; fullName: string }[];
  canEdit: boolean;
}) {
  return (
    <div className="border-b border-border px-7 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-medium">Group</h2>
        {canEdit && (
          <EditGroup
            perjadinId={perjadinId}
            group={group}
            picPersonId={picPersonId}
            staff={staff}
          />
        )}
      </div>

      <ul className="mt-2.5 space-y-1 text-sm">
        {group.map((member) => (
          <li
            key={member.personId}
            className="text-muted-foreground"
          >
            <span className="text-foreground">{member.fullName}</span>
            {/* The Group is Staff-only, so the PIC is named as such and the rest carry the Pendamping label — the on-Perjadin vantage of the DITSAMA role (#141). */}
            {member.personId === picPersonId ? " · PIC" : ` · ${PERJADIN_ROLE_LABELS.Staff}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Group editor: a PIC picker and a searchable multi-select of the extra Staff.
 *
 * On save the PIC change goes first, so the extra-Staff set is written against the new PIC — a Group
 * holds each person once, and the write refuses an extra-Staff slot naming the PIC. The old PIC is
 * left on the Group as an ordinary Staff member and can be removed from the multi-select.
 */
function EditGroup({
  perjadinId,
  group,
  picPersonId,
  staff,
}: {
  perjadinId: string;
  group: GroupMemberEntry[];
  picPersonId: string;
  staff: { id: string; fullName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pic, setPic] = useState(picPersonId);
  const [extraStaff, setExtraStaff] = useState<string[]>(() =>
    group.filter((member) => member.personId !== picPersonId).map((member) => member.personId),
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const picFieldId = useId();
  const staffFieldId = useId();

  // The extra-Staff multi-select never offers the chosen PIC — they are already on the Group.
  const staffOptions = staff
    .filter((entry) => entry.id !== pic)
    .map((entry) => ({ value: entry.id, label: entry.fullName }));

  function submit() {
    startSaving(async () => {
      if (pic !== picPersonId) {
        const picResult = await changePerjadinPicAction(perjadinId, pic);
        if (picResult.outcome !== "changed") {
          setRefusal(STALE);
          return;
        }
      }

      const result = await setPerjadinStaffAction(
        perjadinId,
        extraStaff.filter((personId) => personId !== pic),
      );
      if (result.outcome === "set") {
        setOpen(false);
        return;
      }
      setRefusal(STAFF_REFUSALS[result.outcome]);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
          >
            Ubah Group
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Group</DialogTitle>
          <DialogDescription>
            PIC dan Pendamping tambahan. Sesi, Uang Perjalanan dan transaksi Perjadin ini tidak ikut
            berubah.
          </DialogDescription>
        </DialogHeader>

        {refusal !== null && (
          <Alert variant="destructive">
            <AlertTitle>Group belum berubah.</AlertTitle>
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor={picFieldId}>PIC</Label>
            <PersonSelect
              id={picFieldId}
              people={staff}
              value={pic}
              placeholder="Pilih PIC"
              onSelect={(personId) => {
                setPic(personId);
                setRefusal(null);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={staffFieldId}>Pendamping tambahan (opsional)</Label>
            <p className="-mt-0.5 text-xs text-muted-foreground">
              Selain PIC, hingga {MAX_EXTRA_STAFF_PER_GROUP} orang.
            </p>
            <MultiSelectCombobox
              id={staffFieldId}
              aria-label="Pendamping tambahan"
              placeholder="Cari Pendamping…"
              emptyLabel="Tidak ada Pendamping."
              options={staffOptions}
              value={extraStaff.filter((personId) => personId !== pic)}
              onValueChange={(next) => {
                if (next.length <= MAX_EXTRA_STAFF_PER_GROUP) setExtraStaff(next);
                setRefusal(null);
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Batal
          </Button>
          <Button
            disabled={saving}
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Simpan Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STALE = "Perjadin ini sudah tidak ada. Muat ulang halaman untuk melihat keadaannya.";

/** What each `setPerjadinStaff` refusal says. */
const STAFF_REFUSALS = {
  "too-many-staff": `Pendamping tambahan terlalu banyak: maksimal ${MAX_EXTRA_STAFF_PER_GROUP}.`,
  "duplicate-staff": "Setiap Pendamping tambahan harus berbeda, dan bukan PIC.",
  "no-such-perjadin": STALE,
} as const;

export { PerjadinGroup };
