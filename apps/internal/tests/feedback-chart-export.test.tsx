import {
  ALL_CHART_PARTS,
  participantChartFigure,
  type ChartParts,
} from "-/components/feedback-chart";
import {
  CHART_EXPORT_COLOURS,
  CHART_EXPORT_HEIGHT,
  CHART_EXPORT_WIDTH,
  chartPngFileName,
  exportChartSvg,
} from "-/components/feedback-chart-export";
import { ParticipantChartFigure } from "-/components/feedback-chart-figure";
import type { FeedbackSchoolOption } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { themeTokens } from "./support/theme-tokens";

/**
 * **Unduh PNG's pure half** (#511): the on-screen figure's markup turned into a light-on-white SVG an
 * `<img>` can draw — no `var(…)`, no class, a fixed 1200×800 size, a named font stack — and the
 * file's name. The canvas step is the browser's; it draws exactly this.
 */

const schools: FeedbackSchoolOption[] = [
  {
    id: "bontang",
    name: "SMAN 1 Bontang",
    kabupatenKota: "Kota Bontang",
    sessions: [
      {
        id: "sesi-1",
        mode: "offline",
        sesi: 1,
        heldOn: "2026-10-12",
        startsAt: "08:00:00",
        timeZone: "WITA",
      },
    ],
  },
];

const PROGRAMME = { schoolId: null, sessionId: null, participantType: null };

function screenMarkup(parts: ChartParts = ALL_CHART_PARTS) {
  const figure = participantChartFigure(schools, PROGRAMME, {
    participantType: "Siswa",
    figures: {
      responseCount: 42,
      instructor: 8.4,
      materials: 7,
      relevance: 9.1,
      handsOnRbl: null,
    },
  });
  return renderToStaticMarkup(
    <ParticipantChartFigure
      figure={figure}
      parts={parts}
    />,
  );
}

describe("exportChartSvg", () => {
  it("leaves no var(…) and no class, so nothing depends on the page's stylesheet", () => {
    const markup = exportChartSvg(screenMarkup());
    expect(screenMarkup()).toContain("var(");
    expect(markup).not.toContain("var(");
    expect(markup).not.toMatch(/\sclass=/);
  });

  it("paints every token with its light-theme value, whatever theme the screen is in", () => {
    const markup = exportChartSvg(screenMarkup());
    expect(markup).toContain(`fill:${CHART_EXPORT_COLOURS["--chart-category-1"]}`);
    expect(markup).toContain(`fill:${CHART_EXPORT_COLOURS["--foreground"]}`);
    expect(markup).toContain(`stroke:${CHART_EXPORT_COLOURS["--muted-foreground"]}`);
  });

  it("is laid out at 1200×800 on a white background, in a named font stack", () => {
    const markup = exportChartSvg(screenMarkup());
    expect(CHART_EXPORT_WIDTH).toBe(2400);
    expect(CHART_EXPORT_HEIGHT).toBe(1600);
    const root = /^<svg[^>]*>/.exec(markup)![0];
    expect(root).toContain('width="1200"');
    expect(root).toContain('height="800"');
    expect(root).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(root).toMatch(/font-family="Montserrat, [^"]*sans-serif"/);
    expect(markup).toMatch(/^<svg[^>]*><rect width="1200" height="800" fill="#ffffff"\/>/);
  });

  it.each(["title", "legend", "axes", "values"] as const)(
    "leaves out exactly %s when its checkbox is off",
    (part) => {
      const markup = exportChartSvg(screenMarkup({ ...ALL_CHART_PARTS, [part]: false }));
      expect(markup).not.toContain(`data-part="${part}"`);
      for (const other of ["title", "legend", "axes", "values"].filter((name) => name !== part)) {
        expect(markup).toContain(`data-part="${other}"`);
      }
    },
  );

  it("keeps exactly the parts the checkboxes leave on", () => {
    const markup = exportChartSvg(
      screenMarkup({ title: false, legend: true, axes: false, values: true }),
    );
    expect(markup).not.toContain('data-part="title"');
    expect(markup).not.toContain('data-part="axes"');
    expect(markup).toContain('data-part="legend"');
    expect(markup).toContain('data-part="values"');
  });

  it("works on a browser's serialisation too — spaced style, xmlns already present", () => {
    const serialised =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" class="h-auto w-full">' +
      '<rect style="fill: var(--chart-category-2);"/><text style="fill: var( --foreground )"/></svg>';
    const markup = exportChartSvg(serialised);
    expect(markup.match(/xmlns=/g)).toHaveLength(1);
    expect(markup).toContain(`fill: ${CHART_EXPORT_COLOURS["--chart-category-2"]};`);
    expect(markup).not.toContain("var(");
    expect(markup).not.toContain("class=");
  });

  it("refuses a token it has no light value for, rather than leave it unresolved", () => {
    expect(() => exportChartSvg('<svg><rect style="fill:var(--primary)"/></svg>')).toThrow(
      "--primary",
    );
  });
});

describe("CHART_EXPORT_COLOURS", () => {
  it("is the light theme's value of each token, as globals.css declares it", () => {
    const light = themeTokens(":root");
    for (const [token, value] of Object.entries(CHART_EXPORT_COLOURS)) {
      expect(value, token).toBe(light.get(token));
    }
  });
});

describe("chartPngFileName", () => {
  const today = "2026-10-20";

  it("names a programme-wide figure semua", () => {
    expect(chartPngFileName(schools, PROGRAMME, "Siswa", today)).toBe(
      "grafik-peserta-semua-siswa-2026-10-20.png",
    );
  });

  it("names a School's figure by the School, slugified as Ekspor CSV does", () => {
    expect(chartPngFileName(schools, { ...PROGRAMME, schoolId: "bontang" }, "Siswa", today)).toBe(
      "grafik-peserta-sman-1-bontang-siswa-2026-10-20.png",
    );
  });

  it("names a School and Sesi figure by both, then its own Tipe Peserta", () => {
    expect(
      chartPngFileName(
        schools,
        { schoolId: "bontang", sessionId: "sesi-1", participantType: "GTK-MS" },
        "GTK-MS",
        today,
      ),
    ).toBe("grafik-peserta-sman-1-bontang-sesi-1-luring-gtk-ms-2026-10-20.png");
  });

  it("never says tersaring: figures never follow the score filters", () => {
    expect(chartPngFileName(schools, PROGRAMME, "GTK-MS", today)).not.toContain("tersaring");
  });
});
