"use client";

import { SingleSelectCombobox } from "-/components/single-select-combobox";
import { perjadinName } from "-/lib/perjadin-name";
import type { KeuanganPerjadinOption } from "@sugt/db/queries";
import { useMemo, useState } from "react";

/**
 * **`/keuangan`'s Perjadin filter** (#472): the searchable picker over the trips with transactions,
 * by their ADR-0044 name, "Semua Perjadin" while none is picked. It sits in the page's GET form, so the
 * pick travels as a hidden `perjadin` field and applies with the form's other filters.
 */
export function PerjadinPicker({
  options,
  initial,
}: {
  options: KeuanganPerjadinOption[];
  initial: string | null;
}) {
  const [value, setValue] = useState(initial);
  const items = useMemo(
    () => options.map((trip) => ({ value: trip.id, label: perjadinName(trip) })),
    [options],
  );

  return (
    <>
      <SingleSelectCombobox
        id="keuangan-perjadin"
        aria-label="Perjadin"
        placeholder="Semua Perjadin"
        emptyLabel="Tidak ada Perjadin yang cocok."
        options={items}
        value={value}
        onValueChange={setValue}
      />
      <input
        type="hidden"
        name="perjadin"
        value={value ?? ""}
      />
    </>
  );
}
