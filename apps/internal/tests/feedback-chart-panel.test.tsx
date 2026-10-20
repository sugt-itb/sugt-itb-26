import { ALL_CHART_PARTS, type ParticipantChartData } from "-/components/feedback-chart";
import { ChartPanel } from "-/components/feedback-chart-dialog";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **Unduh PNG's button** (#511): one under every figure with responses, none under a "Belum ada
 * tanggapan" figure, which has nothing to report.
 */

vi.mock("-/app/(app)/feedback/actions", () => ({ loadParticipantFeedbackCharts: vi.fn() }));

const PROGRAMME = { schoolId: null, sessionId: null, participantType: null };

function render(responseCount: number) {
  const chart: ParticipantChartData = {
    participantType: "GTK-MS",
    figures:
      responseCount === 0
        ? { responseCount, instructor: null, materials: null, relevance: null, handsOnRbl: null }
        : { responseCount, instructor: 8, materials: 7.5, relevance: 9, handsOnRbl: null },
  };
  return renderToStaticMarkup(
    <ChartPanel
      chart={chart}
      scope={PROGRAMME}
      schools={[]}
      parts={ALL_CHART_PARTS}
    />,
  );
}

describe("ChartPanel", () => {
  it("offers Unduh PNG under a figure with responses", () => {
    const html = render(12);
    expect(html).toContain(">Unduh PNG</button>");
    expect(html).not.toContain("Belum ada tanggapan");
  });

  it("offers none under a figure with no responses", () => {
    const html = render(0);
    expect(html).toContain("Belum ada tanggapan");
    expect(html).not.toContain("Unduh PNG");
  });
});
