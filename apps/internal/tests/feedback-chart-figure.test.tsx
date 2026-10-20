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
 * **A Lihat Grafik figure, rendered** (#510): one self-contained `<svg>` holding the title, n line,
 * legend, axes, bars and value labels — the PNG export (#511) serialises exactly that — and each of
 * the four checkboxes removing exactly its own part.
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

const bars = (markup: string) => markup.match(/data-part="bar"/g)?.length ?? 0;

describe("ParticipantChartFigure", () => {
  it("is one <svg> with every part inside it", () => {
    const markup = render();
    expect(markup.startsWith("<svg")).toBe(true);
    expect(markup.endsWith("</svg>")).toBe(true);
    expect(markup.match(/<svg/g)).toHaveLength(1);
    for (const part of ["title", "legend", "axes", "values"]) {
      expect(markup).toContain(`data-part="${part}"`);
    }
  });

  it("draws four bars for Siswa and three for GTK-MS", () => {
    expect(bars(render())).toBe(4);
    expect(bars(render({ handsOnRbl: null }, ALL_CHART_PARTS, "GTK-MS"))).toBe(3);
  });

  it("draws the title and the n line", () => {
    const markup = render();
    expect(markup).toContain(">Nilai rata-rata Peserta · Siswa</tspan>");
    expect(markup).toContain(">n = 42 tanggapan</text>");
  });

  it("leaves an Aspect with no Rating its slot, labelled —, with no bar", () => {
    const markup = render({ handsOnRbl: null });
    expect(bars(markup)).toBe(3);
    expect(markup).not.toContain('data-aspect="hands_on_rbl"');
    expect(markup).toContain(">—</text>");
    expect(markup).toContain(">Hands-on RBL</text>");
  });

  it("shows Belum ada tanggapan in place of bars with no responses", () => {
    const markup = render({
      responseCount: 0,
      instructor: null,
      materials: null,
      relevance: null,
      handsOnRbl: null,
    });
    expect(bars(markup)).toBe(0);
    expect(markup).toContain(">Belum ada tanggapan</text>");
    expect(markup).not.toContain('data-part="values"');
  });

  it.each([
    ["title", "Nilai rata-rata Peserta · Siswa</tspan>"],
    ["legend", 'data-part="legend"'],
    ["axes", "Nilai rata-rata (0–10)"],
    ["values", ">8.4</text>"],
  ] as const)("removes exactly its part with %s off", (part, marker) => {
    const markup = render({}, { ...ALL_CHART_PARTS, [part]: false });
    expect(markup).not.toContain(`data-part="${part}"`);
    expect(markup).not.toContain(marker);
    for (const other of ["title", "legend", "axes", "values"].filter((name) => name !== part)) {
      expect(markup).toContain(`data-part="${other}"`);
    }
    expect(bars(markup)).toBe(4);
  });

  it("colours each bar and its legend swatch with the Aspect's token", () => {
    const markup = render();
    expect(markup).toContain('data-aspect="instructor"');
    expect(markup.match(/fill:var\(--chart-category-1\)/g)).toHaveLength(2);
    expect(markup.match(/fill:var\(--chart-category-4\)/g)).toHaveLength(2);
  });

  it("keeps an accessible name naming the figure whatever is hidden", () => {
    const markup = render({}, { title: false, legend: false, axes: false, values: false });
    expect(markup).toContain("<title");
    expect(markup).toContain("Nilai rata-rata Peserta · Siswa (n = 42 tanggapan)</title>");
  });
});
