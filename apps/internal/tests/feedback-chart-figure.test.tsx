import {
  ALL_CHART_PARTS,
  participantChartFigure,
  type ChartParts,
} from "-/components/feedback-chart";
import { ParticipantChartFigure } from "-/components/feedback-chart-figure";
import type { ParticipantFeedbackFigures } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * **A Lihat Grafik figure, rendered** (#510, #514, #516): one self-contained `<svg>` holding the
 * title, n line, legend, one donut per Aspect with its label and the score in its hole — the PNG
 * export (#511) serialises exactly that — and each of the four checkboxes removing exactly its own
 * part.
 */

const PROGRAMME = { schoolId: null, sessionId: null, participantType: null };

const figures = (over: Partial<ParticipantFeedbackFigures> = {}): ParticipantFeedbackFigures => ({
  responseCount: 42,
  instructor: 8.4,
  materials: 7,
  relevance: 9.1,
  handsOnRbl: 6.5,
  ...over,
});

function render(
  over: Partial<ParticipantFeedbackFigures> = {},
  parts: ChartParts = ALL_CHART_PARTS,
  participantType: "Siswa" | "GTK-MS" = "Siswa",
) {
  const figure = participantChartFigure([], PROGRAMME, {
    participantType,
    figures: figures(over),
  });
  return renderToStaticMarkup(
    <ParticipantChartFigure
      figure={figure}
      parts={parts}
    />,
  );
}

const donuts = (markup: string) => markup.match(/data-part="donut"/g)?.length ?? 0;
const arcs = (markup: string) => markup.match(/data-part="arc"/g)?.length ?? 0;
const PARTS = ["title", "legend", "labels", "values"] as const;

describe("ParticipantChartFigure", () => {
  it("is one <svg> with every part inside it", () => {
    const markup = render();
    expect(markup.startsWith("<svg")).toBe(true);
    expect(markup.endsWith("</svg>")).toBe(true);
    expect(markup.match(/<svg/g)).toHaveLength(1);
    for (const part of PARTS) {
      expect(markup).toContain(`data-part="${part}"`);
    }
  });

  it("draws four donuts for Siswa and three for GTK-MS, and no bars, axes, pies or wedges", () => {
    expect(donuts(render())).toBe(4);
    expect(donuts(render({ handsOnRbl: null }, ALL_CHART_PARTS, "GTK-MS"))).toBe(3);
    expect(render()).not.toMatch(/data-part="(bar|axes|pie|wedge)"/);
    expect(render()).not.toContain("Nilai rata-rata (0–10)");
    expect(render()).not.toContain(">Aspek</text>");
  });

  it("draws every donut's whole ring as a track under its arc, outlined on both edges", () => {
    const markup = render();
    // One even-odd path of two circles: the outline strokes the outer edge and the hole's.
    expect(
      markup.match(
        /<path d="M [^"]+ Z M [^"]+ Z" fill-rule="evenodd" style="fill:var\(--muted\);stroke:var\(--border\);stroke-width:2"><\/path>/g,
      ),
    ).toHaveLength(4);
    expect(arcs(markup)).toBe(4);
    // Nothing fills the hole: no other shape is drawn per donut.
    expect(markup).not.toContain("<circle");
  });

  it("draws a 10.0 arc as the whole ring and a 0.0 one not at all", () => {
    const full = render({ instructor: 10 });
    expect(full).toMatch(
      /<path data-part="arc" d="M [^"]+ Z M [^"]+ Z" fill-rule="evenodd" style="fill:var\(--chart-category-1\)"/,
    );
    const bare = render({ instructor: 0 });
    expect(arcs(bare)).toBe(3);
    expect(bare).toContain(">0.0</text>");
  });

  it("writes the score in the hole in bold foreground at 48, with no halo", () => {
    const markup = render();
    expect(markup).toMatch(
      /<text [^>]*font-size="48" font-weight="700" style="fill:var\(--foreground\)">8\.4<\/text>/,
    );
    expect(markup).not.toContain("paint-order");
    expect(markup).not.toContain("--background");
  });

  it("draws the title and the n line", () => {
    const markup = render();
    expect(markup).toContain(">Nilai rata-rata Peserta · Siswa</tspan>");
    expect(markup).toContain(">n = 42 tanggapan</text>");
  });

  it("leaves an Aspect with no Rating its donut, the bare track labelled —", () => {
    const markup = render({ handsOnRbl: null });
    expect(donuts(markup)).toBe(4);
    expect(arcs(markup)).toBe(3);
    expect(markup).toMatch(
      /data-part="donut" data-aspect="hands_on_rbl"><path [^>]*><\/path><\/g>/,
    );
    expect(markup).toContain(">—</text>");
    expect(markup).toContain(">Hands-on RBL</text>");
  });

  it("shows Belum ada tanggapan in place of the donuts with no responses", () => {
    const markup = render({
      responseCount: 0,
      instructor: null,
      materials: null,
      relevance: null,
      handsOnRbl: null,
    });
    expect(donuts(markup)).toBe(0);
    expect(markup).toContain(">Belum ada tanggapan</text>");
    expect(markup).not.toContain('data-part="values"');
  });

  it.each([
    ["title", "Nilai rata-rata Peserta · Siswa</tspan>"],
    ["legend", 'data-part="legend"'],
    ["labels", ">Narasumber</text>"],
    ["values", ">8.4</text>"],
  ] as const)("removes exactly its part with %s off", (part, marker) => {
    const markup = render({}, { ...ALL_CHART_PARTS, [part]: false });
    expect(markup).not.toContain(`data-part="${part}"`);
    // Narasumber is also the legend's label, so look for it only once the legend is gone.
    const checked =
      part === "labels" ? render({}, { ...ALL_CHART_PARTS, labels: false, legend: false }) : markup;
    expect(checked).not.toContain(marker);
    for (const other of PARTS.filter((name) => name !== part)) {
      expect(markup).toContain(`data-part="${other}"`);
    }
    expect(donuts(markup)).toBe(4);
  });

  it("names each donut under it, and in the legend, which stands in when Label is off", () => {
    const markup = render();
    expect(markup.match(/>Narasumber<\/text>/g)).toHaveLength(2);
    const noLabels = render({}, { ...ALL_CHART_PARTS, labels: false });
    expect(noLabels.match(/>Narasumber<\/text>/g)).toHaveLength(1);
  });

  it("colours each arc and its legend swatch with the Aspect's token", () => {
    const markup = render();
    expect(markup).toContain('data-aspect="instructor"');
    expect(markup.match(/fill:var\(--chart-category-1\)/g)).toHaveLength(2);
    expect(markup.match(/fill:var\(--chart-category-4\)/g)).toHaveLength(2);
  });

  it("keeps an accessible name naming the figure whatever is hidden", () => {
    const markup = render({}, { title: false, legend: false, labels: false, values: false });
    expect(markup).toContain("<title");
    expect(markup).toContain("Nilai rata-rata Peserta · Siswa (n = 42 tanggapan)</title>");
  });
});
