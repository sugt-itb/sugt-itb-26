"use client";

import { setPerjadinPimpinanAction } from "-/app/(app)/perjadin/[id]/actions";
import { Checkbox } from "@sugt/ui/components/checkbox";
import { Label } from "@sugt/ui/components/label";
import { useId, useState, useTransition } from "react";

/**
 * The Pimpinan recorded on a trip — a subset of the Pimpinan roster (real People of role Pimpinan,
 * #181). Record-only: a Pimpinan is not a Group member, files no Evaluation and adds nothing to the
 * Preparation Checklist, so this is a plain checkbox editor and nothing more.
 *
 * Staff toggle the set by Person id; each toggle writes the whole set. A professor sees the recorded
 * names read-only. The roster is empty until Pimpinan are added on `/orang`, so the editor shows a
 * muted hint rather than an empty list in that case.
 */
function PerjadinPimpinan({
  perjadinId,
  pimpinan,
  roster,
  canEdit,
}: {
  perjadinId: string;
  pimpinan: { personId: string; name: string }[];
  roster: { id: string; fullName: string }[];
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(pimpinan.map((p) => p.personId));
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const idPrefix = useId();

  function toggle(personId: string, checked: boolean) {
    const next = checked ? [...selected, personId] : selected.filter((id) => id !== personId);
    const previous = selected;
    setSelected(next);
    setRefusal(null);
    startSaving(async () => {
      const result = await setPerjadinPimpinanAction(perjadinId, next);
      if (result.outcome !== "set") {
        setSelected(previous);
        setRefusal("Perubahan gagal. Muat ulang halaman untuk melihat keadaannya.");
      }
    });
  }

  return (
    <div className="border-b border-border px-7 py-5">
      <h2 className="font-heading text-sm font-medium">Pimpinan</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pimpinan DITSAMA yang ikut memantau — tercatat saja, bukan anggota Group.
      </p>

      {refusal !== null && <p className="mt-2 text-sm text-destructive">{refusal}</p>}

      {canEdit ? (
        roster.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Belum ada Pimpinan di roster — tambahkan lewat /orang.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {roster.map((person) => {
              const checkboxId = `${idPrefix}-${person.id}`;
              return (
                <li
                  key={person.id}
                  className="flex items-center gap-2.5"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={selected.includes(person.id)}
                    disabled={saving}
                    onCheckedChange={(checked) => {
                      toggle(person.id, checked === true);
                    }}
                  />
                  <Label
                    htmlFor={checkboxId}
                    className="text-sm font-normal"
                  >
                    {person.fullName}
                  </Label>
                </li>
              );
            })}
          </ul>
        )
      ) : pimpinan.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {pimpinan.map((entry) => (
            <li key={entry.personId}>{entry.name}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Tidak ada.</p>
      )}
    </div>
  );
}

export { PerjadinPimpinan };
