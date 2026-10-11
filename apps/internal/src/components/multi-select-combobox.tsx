"use client";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@sugt/ui/components/combobox";
import { useMemo } from "react";

/**
 * One option a `MultiSelectCombobox` offers: a stable `value`, the `label` shown for it, and an
 * optional `description` — a muted second line in the list, never on the chip.
 */
type ComboboxOption = { value: string; label: string; description?: string };

/**
 * A searchable multi-select over a fixed list of options: type to filter, and each choice becomes a
 * removable chip. The selection travels as an array of the chosen `value`s, so a caller keeps its
 * own ids (Person ids for the extra Staff, teacher-name indexes for "Diajar oleh") and never sees
 * the option objects this wraps them in.
 *
 * It lives in the app rather than in `@sugt/ui` because, like `PersonSelect`, it is handed
 * domain-shaped lists (a roster, a trip's teacher names); `@sugt/ui` stays presentational — AGENTS
 * rule 4 — and owns only the `combobox` primitive this composes.
 *
 * **`value` is the source of truth.** The Base UI combobox wants the selected *objects*; those are
 * derived from `value` against `options` on every render, so the two never drift and referential
 * identity is not something a caller has to preserve. Equality is by `value`, so rebuilding the
 * option objects each render is harmless.
 *
 * **`locked` values stay chosen**: their chips carry no remove button, and a change that would drop
 * one — a Backspace, a click on its row — keeps it, so the caller never sees it leave.
 */
function MultiSelectCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  emptyLabel = "Tidak ada pilihan.",
  locked = [],
  id,
  "aria-label": ariaLabel,
}: {
  options: ComboboxOption[];
  value: string[];
  onValueChange: (values: string[]) => void;
  placeholder?: string;
  /** Shown in the popup when the filter matches nothing. */
  emptyLabel?: string;
  /** Chosen values that cannot be removed. */
  locked?: string[];
  id?: string;
  "aria-label"?: string;
}) {
  const anchor = useComboboxAnchor();
  const byValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const selected = value
    .map((chosen) => byValue.get(chosen))
    .filter((option): option is ComboboxOption => option !== undefined);

  return (
    <Combobox
      items={options}
      multiple
      value={selected}
      onValueChange={(next: ComboboxOption[]) => {
        const values = next.map((option) => option.value);
        const kept = locked.filter((held) => value.includes(held) && !values.includes(held));
        onValueChange([...values, ...kept]);
      }}
      isItemEqualToValue={(a: ComboboxOption, b: ComboboxOption) => a.value === b.value}
    >
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(chosen: ComboboxOption[]) => (
            <>
              {chosen.map((option) => (
                <ComboboxChip
                  key={option.value}
                  aria-label={option.label}
                  showRemove={!locked.includes(option.value)}
                >
                  {option.label}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                id={id}
                aria-label={ariaLabel}
                placeholder={chosen.length > 0 ? "" : placeholder}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(option: ComboboxOption) => (
            <ComboboxItem
              key={option.value}
              value={option}
            >
              {option.description === undefined ? (
                option.label
              ) : (
                <span className="flex min-w-0 flex-col">
                  <span>{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export { MultiSelectCombobox, type ComboboxOption };
