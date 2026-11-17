"use client";

import { formatRupiah } from "@sugt/domain";
import { Alert, AlertDescription } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import { useId, useState, useTransition } from "react";

import { type KeuanganSourceSaveResult, setKeuanganSourceAction } from "./actions";

/**
 * What a save says. A good one gives the tab's Kelompok count and its grand total Realisasi, rounded
 * to the rupiah, so the Administrator can check it against the sheet's own total row at once (#571).
 * A refused one gives the reader's specific reason, naming the row or column.
 */
export function keuanganSaveMessage(result: KeuanganSourceSaveResult): string {
  return result.ok
    ? `Tersimpan: ${result.kelompok} Kelompok, total Realisasi ${formatRupiah(Math.round(result.totalRealisasi))}.`
    : result.detail;
}

/**
 * **The paste-and-save form** on the Block B source card: one field for the Block B tab's browser
 * address and **Simpan**. Saving reads the whole tab before storing anything (`setKeuanganSourceAction`),
 * so the answer — the confirmation, or why the tab was refused — shows beneath the field.
 */
export function KeuanganSourceForm() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<KeuanganSourceSaveResult | null>(null);
  const [saving, startSaving] = useTransition();
  const inputId = useId();
  const resultId = useId();
  const refused = result !== null && !result.ok;

  return (
    <form
      className="flex w-full flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startSaving(async () => {
          const answer = await setKeuanganSourceAction(text);
          setResult(answer);
          if (answer.ok) setText("");
        });
      }}
    >
      <Label htmlFor={inputId}>Alamat tab Blok B</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* `type="text"`, not `url`: the browser's own check would pre-empt the reason the server gives. */}
        <Input
          id={inputId}
          type="text"
          inputMode="url"
          required
          aria-invalid={refused || undefined}
          aria-describedby={result ? resultId : undefined}
          placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <Button
          type="submit"
          disabled={saving}
        >
          {saving ? "Membaca…" : "Simpan"}
        </Button>
      </div>
      {result && (
        <Alert
          id={resultId}
          variant={result.ok ? "default" : "destructive"}
        >
          <AlertDescription>{keuanganSaveMessage(result)}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
