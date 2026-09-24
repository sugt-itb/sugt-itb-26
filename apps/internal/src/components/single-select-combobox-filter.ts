/**
 * **The single-select combobox's pure search seam** (#317). The option shape and the two-field
 * "contains" match, folded here so the matching is unit-testable without a DOM — the same split
 * `pretest-derive.ts` keeps from `pretest-editor.tsx`.
 */

/**
 * One option a `SingleSelectCombobox` offers: a stable `value`, the `label` shown for it, and
 * optional `keywords` — extra text the search matches alongside `label` (a School's Kabupaten/Kota,
 * say) while the input still displays only `label`.
 */
export type SingleSelectOption = { value: string; label: string; keywords?: string };

/**
 * Case-insensitive "contains" match over an option's `label` and its optional `keywords` — the
 * two-field search `school-directory-table.tsx` does by hand (name *or* Kabupaten/Kota). Pure and
 * DOM-free so it can be unit-tested; the combobox hands it to Base UI's `filter` prop, which runs it
 * per keystroke over the in-memory option list, so there is no query round trip. An empty or
 * whitespace-only query matches everything.
 */
export function optionMatchesQuery(option: SingleSelectOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (option.label.toLowerCase().includes(needle)) return true;
  return option.keywords !== undefined && option.keywords.toLowerCase().includes(needle);
}
