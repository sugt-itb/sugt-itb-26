import { readFileSync } from "node:fs";

/** The shared stylesheet that declares every theme token, as written. */
const globalsCss = readFileSync(
  new URL("../../../../packages/ui/src/styles/globals.css", import.meta.url),
  "utf8",
);

/** One theme block's custom properties — `:root` or `.dark` — as written in `globals.css`. */
export function themeTokens(selector: ":root" | ".dark"): Map<string, string> {
  const start = globalsCss.indexOf(`${selector} {`);
  const body = globalsCss.slice(start, globalsCss.indexOf("}", start));
  return new Map(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
}
