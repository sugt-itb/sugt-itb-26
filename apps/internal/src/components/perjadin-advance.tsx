"use client";

import { updatePerjadinAdvanceAction } from "-/app/(app)/perjadin/[id]/actions";
import { formatIdr } from "@sugt/domain";
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
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import { useId, useState, useTransition } from "react";

/**
 * **The Advance (uang muka), and the one way Staff correct it after planning** (#192).
 *
 * `planPerjadin` writes the Advance once; this is the only edit that changes it afterwards. The
 * amount was judged fixed-at-planning before, and this reverses that to Staff-correctable — while
 * money-write-is-Staff-only (ADR-0026) is untouched: the trigger is offered to Staff only, and
 * `updatePerjadinAdvance` re-checks the role because a Server Action is a public endpoint, so a
 * Pimpinan's page simply never renders it (`canEdit` false → nothing).
 *
 * There is no lifecycle gate — the correction is allowed even after the Report is filed — and no
 * coupling to what has already been spent: an Advance below current spend is a real overspend, so
 * the only floor is `>= 0`.
 */
function EditAdvance({
  perjadinId,
  advanceIdr,
  canEdit,
}: {
  perjadinId: string;
  advanceIdr: number;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  // A plain digit string, seeded with the current Advance — the masked input strips every non-digit
  // back out on change, so `Number(...)` and the empty guard stay simple, exactly as the plan form.
  const [amount, setAmount] = useState(String(advanceIdr));
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const fieldId = useId();

  if (!canEdit) return null;

  const empty = amount === "";

  function submit() {
    if (empty) return;
    startSaving(async () => {
      const result = await updatePerjadinAdvanceAction(perjadinId, Number(amount));
      if (result.outcome === "updated") {
        setOpen(false);
        return;
      }
      if (result.outcome === "negative-advance") {
        setRefusal("Uang muka tidak boleh kurang dari nol.");
        return;
      }
      setRefusal("Perjadin ini sudah tidak ada. Muat ulang halaman untuk melihat keadaannya.");
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
            Ubah uang muka
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah uang muka</DialogTitle>
          <DialogDescription>
            Koreksi jumlah uang muka yang diterima. Sisa dihitung ulang otomatis (uang muka
            dikurangi pengeluaran) dan boleh menjadi negatif jika pengeluaran melebihi uang muka.
          </DialogDescription>
        </DialogHeader>

        {refusal !== null && (
          <Alert variant="destructive">
            <AlertTitle>Uang muka belum diubah.</AlertTitle>
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor={fieldId}>Uang muka (Rp)</Label>
          <Input
            id={fieldId}
            type="text"
            inputMode="numeric"
            value={empty ? "" : `Rp ${formatIdr(Number(amount))}`}
            onChange={(event) => {
              setAmount(event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""));
              setRefusal(null);
            }}
          />
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
            disabled={saving || empty}
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Simpan uang muka"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { EditAdvance };
