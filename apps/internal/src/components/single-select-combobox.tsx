"use client";

import type { SchoolOption } from "@sugt/db/queries";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@sugt/ui/components/combobox";
import { useMemo } from "react";

import { optionMatchesQuery, type SingleSelectOption } from "./single-select-combobox-filter";

/**
 * A searchable single-select over a fixed list of options: type to filter, pick exactly one. The
 * companion to `MultiSelectCombobox` — same `@sugt/ui` `Combobox` primitive, same app-level home
 * (AGENTS rule 4 keeps `@sugt/ui` presentational, and this takes domain-shaped lists) — but single
 * selection, so the choice travels as one `value` string, or `null` when cleared, rather than an
 * array, and it shows as the input's value rather than a chip.
 *
 * **`value` is the source of truth.** Base UI wants the selected *object*; it is derived from `value`
 * against `options` on every render, so the two never drift and a caller keeps only ids. Equality is
 * by `value` (`isItemEqualToValue`), so rebuilding the option objects each render is harmless.
 *
 * Filtering runs client-side over the already-loaded `options`: `optionMatchesQuery`, handed to Base
 * UI's `filter`, matches `label` and each option's optional `keywords`. No per-keystroke round trip —
 * the same in-memory narrowing `SchoolDirectoryTable` does, for the same reason (a small, fixed list).
 */
function SingleSelectCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  emptyLabel = "Tidak ada pilihan.",
  id,
  "aria-label": ariaLabel,
}: {
  options: SingleSelectOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  /** Shown in the popup when the filter matches nothing. */
  emptyLabel?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const byValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const selected = value === null ? null : (byValue.get(value) ?? null);

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(next: SingleSelectOption | null) => {
        onValueChange(next ? next.value : null);
      }}
      isItemEqualToValue={(a: SingleSelectOption, b: SingleSelectOption) => a.value === b.value}
      itemToStringLabel={(option: SingleSelectOption) => option.label}
      filter={(option: SingleSelectOption, query: string) => optionMatchesQuery(option, query)}
    >
      <ComboboxInput
        id={id}
        aria-label={ariaLabel}
        placeholder={placeholder}
        showClear
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(option: SingleSelectOption) => (
            <ComboboxItem
              key={option.value}
              value={option}
            >
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * The School-picking usage of `SingleSelectCombobox` (#317): a `SchoolOption` list becomes options
 * whose `label` is the School name and whose `keywords` is its Kabupaten/Kota, so typing either one
 * narrows the list — the search the plain `Select` on the online-session form cannot do. The chosen
 * School travels as its id. The online-session rework (#318) wires it into that form in place of the
 * Select; this ticket ships the control.
 */
function SchoolCombobox({
  schools,
  value,
  onValueChange,
  placeholder = "Cari Sekolah…",
  id,
  "aria-label": ariaLabel = "Sekolah",
}: {
  schools: SchoolOption[];
  value: string | null;
  onValueChange: (schoolId: string | null) => void;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const options = useMemo<SingleSelectOption[]>(
    () =>
      schools.map((school) => ({
        value: school.id,
        label: school.name,
        keywords: school.kabupatenKota,
      })),
    [schools],
  );

  return (
    <SingleSelectCombobox
      options={options}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      emptyLabel="Tidak ada Sekolah yang cocok."
      id={id}
      aria-label={ariaLabel}
    />
  );
}

export { SingleSelectCombobox, SchoolCombobox };
export type { SingleSelectOption };
