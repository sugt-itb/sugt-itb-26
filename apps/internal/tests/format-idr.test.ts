import { formatIdr, formatRupiah } from "@sugt/domain";
import { describe, expect, it } from "vitest";

/**
 * The one helper behind every Rupiah amount on screen: `id-ID` grouping with dot
 * separators, no `Rp` prefix — the amount inputs render this directly. It exists so a
 * seven-figure advance reads as `1.000.000` at the point it is entered and everywhere it is
 * read back, from one implementation rather than five inline `toLocaleString` calls.
 */
describe("formatIdr", () => {
  it("groups thousands with id-ID dot separators", () => {
    expect(formatIdr(1000000)).toBe("1.000.000");
    expect(formatIdr(1500)).toBe("1.500");
    expect(formatIdr(12345678)).toBe("12.345.678");
  });

  it("leaves values below a thousand ungrouped", () => {
    expect(formatIdr(0)).toBe("0");
    expect(formatIdr(7)).toBe("7");
    expect(formatIdr(999)).toBe("999");
  });
});

/**
 * The one way money is displayed: `Rp` immediately followed by the grouped digits, with no
 * space. The prefix lives only here, so no display site carries its own literal `"Rp "`.
 */
describe("formatRupiah", () => {
  it("prefixes Rp with no space before the grouped digits", () => {
    expect(formatRupiah(15000000000)).toBe("Rp15.000.000.000");
    expect(formatRupiah(100000)).toBe("Rp100.000");
    expect(formatRupiah(7000)).toBe("Rp7.000");
  });
});
