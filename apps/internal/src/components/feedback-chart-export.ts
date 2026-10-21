import { participantScopeLabel } from "-/components/feedback-scope";
import { slugify } from "-/lib/perjadin-name";
import type {
  FeedbackParticipantType,
  FeedbackSchoolOption,
  ParticipantFeedbackScope,
} from "@sugt/db/queries";

/**
 * **Unduh PNG's pure half** (#511): the on-screen figure's markup made drawable on its own, and the
 * file's name. Plain functions, tested without a DOM; the browser half, `feedback-chart-png.ts`,
 * serialises the `<svg>`, passes it through `exportChartSvg`, and draws the result to a canvas.
 *
 * **Why the markup is rewritten.** An SVG drawn through an `<img>` sees neither the page's stylesheet
 * nor its web fonts, so a `var(--…)` resolves to nothing and a class to no style. The export is
 * therefore always the **light rendering on white**, with every token replaced by its light value,
 * whatever theme the screen is in — the image sits on a white report page, and the screen keeps its
 * own theme.
 */

/**
 * The light theme's value of every token the figure paints with, and of no other, copied from
 * `globals.css`'s `:root` — `tests/feedback-chart-export.test.tsx` holds the two equal and the keys
 * to exactly what the figure uses, so a theme change that forgets this map fails the suite rather
 * than the image. `oklch()` as written there: the browser that draws the canvas is the one already
 * rendering the theme in it.
 */
export const CHART_EXPORT_COLOURS: Record<string, string> = {
  "--foreground": "oklch(0.145 0 0)",
  "--primary": "oklch(0.527 0.16 26.893)",
  "--primary-foreground": "oklch(0.971 0.013 17.38)",
  "--muted-foreground": "oklch(0.556 0 0)",
  "--muted": "oklch(0.97 0 0)",
  "--border": "oklch(0.845 0 0)",
  "--chart-category-1": "oklch(0.546 0.245 262.881)",
  "--chart-category-2": "oklch(0.555 0.163 48.998)",
  "--chart-category-3": "oklch(0.511 0.096 186.391)",
  "--chart-category-4": "oklch(0.541 0.281 293.009)",
};

/**
 * **The image's font — a named stack, not an embedded one.** Montserrat is a web font the `<img>`
 * cannot reach, so the image uses it only where it is installed on the machine; elsewhere it falls
 * to Helvetica or Arial, which every desktop and phone has. Both are narrower than Montserrat, and
 * the layout's text widths were sized for Montserrat, so a fallback never overflows.
 */
export const CHART_EXPORT_FONT = "Montserrat, 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * The PNG is the figure drawn at 2× density from any screen: 2400 px wide, and twice the figure's
 * own height (#522), so it has no blank band above or below.
 */
export const CHART_EXPORT_SCALE = 2;

/** The root's view box, `0 0 <width> <height>` as the figure writes it. A root without one throws. */
function viewBoxSize(markup: string): { width: number; height: number } {
  const match = /^<svg[^>]*\sviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(markup);
  if (match === null) throw new Error("The figure's markup has no view box to size the image by");
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** The PNG's size in pixels: the figure's view box at `CHART_EXPORT_SCALE`. */
export function chartExportSize(markup: string): { width: number; height: number } {
  const { width, height } = viewBoxSize(markup);
  return { width: width * CHART_EXPORT_SCALE, height: height * CHART_EXPORT_SCALE };
}

/**
 * **A figure's markup, made self-contained.** Every `var(--token)` becomes its light value — a token
 * with none throws, rather than leave the image to guess — the class goes, the root gets its view
 * box's own size, the font stack and its namespace, and a white rectangle that size goes under
 * everything. Takes React's markup or a browser's `XMLSerializer` output alike.
 */
export function exportChartSvg(markup: string): string {
  const painted = markup.replaceAll(/var\(\s*(--[\w-]+)\s*\)/g, (_, token: string) => {
    const value = CHART_EXPORT_COLOURS[token];
    if (value === undefined) throw new Error(`No light value to export for ${token}`);
    return value;
  });
  const { width, height } = viewBoxSize(painted);
  return painted.replace(/^<svg([^>]*)>/, (_, attributes: string) => {
    const kept = attributes
      .replaceAll(/\s(class|width|height|font-family|xmlns)="[^"]*"/g, "")
      .trimEnd();
    return (
      `<svg xmlns="http://www.w3.org/2000/svg"${kept} width="${width}" height="${height}"` +
      ` font-family="${CHART_EXPORT_FONT}">` +
      `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    );
  });
}

/**
 * `grafik-peserta-<scope>-<siswa|gtk-ms>-<today>.png`: the School and Sesi as the dialog's titles
 * name them, slugified as Ekspor CSV's file names are, or `semua` with neither; then the figure's own
 * Tipe Peserta. Never `tersaring` — the figures never follow the score filters. `today` is the WIB
 * day, as for the CSVs.
 */
export function chartPngFileName(
  schools: readonly FeedbackSchoolOption[],
  scope: ParticipantFeedbackScope,
  participantType: FeedbackParticipantType,
  today: string,
): string {
  const covers = participantScopeLabel(schools, { ...scope, participantType: null });
  const scopePart = covers === null ? "semua" : slugify(covers) || "semua";
  return `grafik-peserta-${scopePart}-${slugify(participantType)}-${today}.png`;
}
