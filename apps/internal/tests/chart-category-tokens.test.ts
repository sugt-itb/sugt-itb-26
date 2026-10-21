import { describe, expect, it } from "vitest";

import { themeTokens as block } from "./support/theme-tokens";

/**
 * **The four categorical chart tokens** (#510), read straight from the shared stylesheet: each has a
 * light and a dark value, and each reaches **3:1 against the background its figure sits on** in both
 * themes — WCAG's non-text contrast for a bar or a legend swatch. The Lihat Grafik dialog is a
 * popover, so `--popover` is checked beside `--background`.
 */

/** An opaque `oklch(L C h)` to its WCAG relative luminance, through linear sRGB (Ottosson's OKLab). */
function luminance(value: string): number {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (match === null) throw new Error(`not an opaque oklch(): ${value}`);
  const [lightness, chroma, hue] = match.slice(1).map(Number) as [number, number, number];
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const [red, green, blue] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const TOKENS = [1, 2, 3, 4].map((index) => `--chart-category-${index}`);

describe("the categorical chart tokens", () => {
  it.each([":root", ".dark"] as const)("are all declared in %s", (selector) => {
    const theme = block(selector);
    for (const token of TOKENS) {
      expect(theme.get(token)).toBeDefined();
    }
  });

  it("differ between the light and the dark theme", () => {
    for (const token of TOKENS) {
      expect(block(".dark").get(token)).not.toBe(block(":root").get(token));
    }
  });

  it.each([":root", ".dark"] as const)(
    "reach 3:1 against the background and the popover in %s",
    (selector) => {
      const theme = block(selector);
      for (const token of TOKENS) {
        for (const surface of ["--background", "--popover"]) {
          expect(
            contrast(theme.get(token)!, theme.get(surface)!),
            `${selector} ${token} on ${surface}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    },
  );

  it("are four distinct colours in each theme", () => {
    for (const selector of [":root", ".dark"] as const) {
      expect(new Set(TOKENS.map((token) => block(selector).get(token))).size).toBe(4);
    }
  });
});
