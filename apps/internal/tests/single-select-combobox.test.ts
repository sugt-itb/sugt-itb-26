import {
  optionMatchesQuery,
  type SingleSelectOption,
} from "-/components/single-select-combobox-filter";
import { describe, expect, it } from "vitest";

/**
 * **The single-select combobox's search seam** (#317) — the two-field "contains" match driven
 * without a DOM, the way `pretest-derive.test.ts` drives its fold. Base UI runs this per keystroke
 * over the in-memory option list; here it is exercised directly.
 */

const SCHOOLS: SingleSelectOption[] = [
  { value: "s1", label: "SMAN 1 Jakarta", keywords: "Jakarta Pusat" },
  { value: "s2", label: "SMAN 2 Bandung", keywords: "Kota Bandung" },
  { value: "s3", label: "MAN 1 Banda Aceh", keywords: "Banda Aceh" },
  { value: "s4", label: "Sekolah Tanpa Daerah" },
];

describe("optionMatchesQuery", () => {
  it("matches everything for an empty or whitespace-only query", () => {
    for (const option of SCHOOLS) {
      expect(optionMatchesQuery(option, "")).toBe(true);
      expect(optionMatchesQuery(option, "   ")).toBe(true);
    }
  });

  it("matches on the label, case-insensitively", () => {
    expect(optionMatchesQuery(SCHOOLS[0]!, "sman 1")).toBe(true);
    expect(optionMatchesQuery(SCHOOLS[2]!, "MAN")).toBe(true);
  });

  it("matches on the keywords too — the Kabupaten/Kota search", () => {
    // "aceh" is in the keywords, not the label proper — the two-field match the ticket asks for.
    expect(optionMatchesQuery(SCHOOLS[2]!, "aceh")).toBe(true);
    expect(optionMatchesQuery(SCHOOLS[1]!, "bandung")).toBe(true);
  });

  it("returns false when neither label nor keywords contain the query", () => {
    expect(optionMatchesQuery(SCHOOLS[0]!, "surabaya")).toBe(false);
  });

  it("handles an option with no keywords without matching a stray query", () => {
    expect(optionMatchesQuery(SCHOOLS[3]!, "jakarta")).toBe(false);
    expect(optionMatchesQuery(SCHOOLS[3]!, "tanpa")).toBe(true);
  });

  it("narrows a list to name- and Kabupaten-matches when used as a filter", () => {
    const shown = SCHOOLS.filter((option) => optionMatchesQuery(option, "band"));
    // "band" hits SMAN 2 Bandung's name and, via keywords, MAN 1 Banda Aceh's Kabupaten.
    expect(shown.map((option) => option.value)).toEqual(["s2", "s3"]);
  });
});
