import {
  ALL_CHART_PARTS,
  CHART_HEIGHT,
  CHART_WIDTH,
  chartLayout,
  chartParticipantTypes,
  participantChartFigure,
  type ChartParts,
} from "-/components/feedback-chart";
import type {
  FeedbackSchoolOption,
  ParticipantFeedbackFigures,
  ParticipantFeedbackScope,
} from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

/**
 * **The Lihat Grafik figures' rules, without a DOM** (#510): which figures a scope gets, which
 * Aspects a Tipe Peserta has and in what order, `null` → no bar and "—", the title and n line, one
 * colour per Aspect, and bar heights against a fixed 0–10 axis.
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

const PROGRAMME: ParticipantFeedbackScope = {
  schoolId: null,
  sessionId: null,
  participantType: null,
};

const figures = (over: Partial<ParticipantFeedbackFigures> = {}): ParticipantFeedbackFigures => ({
  responseCount: 42,
  instructor: 8.4,
  materials: 7,
  relevance: 9.1,
  handsOnRbl: 6.5,
  ...over,
});

const NO_PARTS: ChartParts = { title: false, legend: false, axes: false, values: false };

describe("chartParticipantTypes", () => {
  it("draws Siswa, then GTK-MS, with no Tipe Peserta picked", () => {
    expect(chartParticipantTypes(null)).toEqual(["Siswa", "GTK-MS"]);
  });

  it("draws only the Tipe Peserta picked", () => {
    expect(chartParticipantTypes("Siswa")).toEqual(["Siswa"]);
    expect(chartParticipantTypes("GTK-MS")).toEqual(["GTK-MS"]);
  });

  it("draws nothing for a Tipe Peserta that names nothing — a Server Action's input", () => {
    expect(chartParticipantTypes("Guru" as never)).toEqual([]);
  });
});

describe("participantChartFigure", () => {
  it("gives Siswa four bars in the average cards' order", () => {
    const figure = participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: figures(),
    });
    expect(figure.bars.map((bar) => bar.label)).toEqual([
      "Narasumber",
      "Materi",
      "Relevansi",
      "Hands-on RBL",
    ]);
    expect(figure.bars.map((bar) => bar.value)).toEqual([8.4, 7, 9.1, 6.5]);
  });

  it("gives GTK-MS three bars, since only the Student Class is asked Hands-on RBL", () => {
    const figure = participantChartFigure(schools, PROGRAMME, {
      participantType: "GTK-MS",
      figures: figures({ handsOnRbl: null }),
    });
    expect(figure.bars.map((bar) => bar.label)).toEqual(["Narasumber", "Materi", "Relevansi"]);
  });

  it("formats each value as the cards do, and an Aspect with no Rating as —, never 0", () => {
    const figure = participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: figures({ materials: 7, handsOnRbl: null }),
    });
    expect(figure.bars.map((bar) => bar.valueLabel)).toEqual(["8.4", "7.0", "9.1", "—"]);
    expect(figure.bars[3]!.value).toBeNull();
    expect(figure.empty).toBe(false);
  });

  it("is empty with no responses in scope", () => {
    const figure = participantChartFigure(schools, PROGRAMME, {
      participantType: "GTK-MS",
      figures: {
        responseCount: 0,
        instructor: null,
        materials: null,
        relevance: null,
        handsOnRbl: null,
      },
    });
    expect(figure.empty).toBe(true);
    expect(figure.countLine).toBe("n = 0 tanggapan");
  });

  it("titles a programme-wide figure with its Tipe Peserta alone", () => {
    const figure = participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: figures(),
    });
    expect(figure.title).toBe("Nilai rata-rata Peserta · Siswa");
    expect(figure.countLine).toBe("n = 42 tanggapan");
  });

  it("titles a scoped figure as the cards name the scope, then its Tipe Peserta", () => {
    const figure = participantChartFigure(
      schools,
      { schoolId: "bontang", sessionId: "sesi-1", participantType: null },
      { participantType: "GTK-MS", figures: figures({ handsOnRbl: null }) },
    );
    expect(figure.title).toBe("Nilai rata-rata Peserta · SMAN 1 Bontang · Sesi 1 Luring · GTK-MS");
  });

  it("gives every Aspect one colour, the same in every figure", () => {
    const siswa = participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: figures(),
    });
    const gtkMs = participantChartFigure(schools, PROGRAMME, {
      participantType: "GTK-MS",
      figures: figures({ handsOnRbl: null }),
    });
    const colours = new Set(siswa.bars.map((bar) => bar.colour));
    expect(colours.size).toBe(4);
    for (const bar of gtkMs.bars) {
      expect(bar.colour).toBe(siswa.bars.find((other) => other.aspect === bar.aspect)!.colour);
    }
  });
});

describe("chartLayout", () => {
  const siswa = (over: Partial<ParticipantFeedbackFigures> = {}) =>
    participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: figures(over),
    });

  it("draws the bars against a fixed 0–10 axis, never auto-scaled", () => {
    const layout = chartLayout(siswa({ instructor: 10, materials: 5 }), ALL_CHART_PARTS);
    const plotHeight = layout.plot.bottom - layout.plot.top;
    expect(layout.slots[0]!.bar!.height).toBeCloseTo(plotHeight, 5);
    expect(layout.slots[1]!.bar!.height).toBeCloseTo(plotHeight / 2, 5);
    expect(layout.slots[0]!.bar!.y + layout.slots[0]!.bar!.height).toBeCloseTo(layout.plot.bottom);
    expect(layout.axes!.yTicks.map((tick) => tick.label)).toEqual(["0", "2", "4", "6", "8", "10"]);
  });

  it("keeps an Aspect with no Rating's slot, with no bar and a — label", () => {
    const layout = chartLayout(siswa({ handsOnRbl: null }), ALL_CHART_PARTS);
    expect(layout.slots).toHaveLength(4);
    expect(layout.slots[3]!.bar).toBeNull();
    expect(layout.slots[3]!.valueLabel!.text).toBe("—");
  });

  it("drops each part when its checkbox is off, and keeps the bars", () => {
    const layout = chartLayout(siswa(), NO_PARTS);
    expect(layout.title).toBeNull();
    expect(layout.legend).toBeNull();
    expect(layout.axes).toBeNull();
    expect(layout.slots.every((slot) => slot.valueLabel === null)).toBe(true);
    expect(layout.slots.every((slot) => slot.bar !== null)).toBe(true);
  });

  it("gives the bars the room a hidden part leaves", () => {
    const all = chartLayout(siswa(), ALL_CHART_PARTS);
    const none = chartLayout(siswa(), NO_PARTS);
    expect(none.plot.bottom - none.plot.top).toBeGreaterThan(all.plot.bottom - all.plot.top);
  });

  it("wraps a long title onto lines that fit the figure", () => {
    const long = participantChartFigure(
      [{ ...schools[0]!, name: "SMA Negeri 1 Unggulan Kabupaten Kutai Kartanegara Tenggarong" }],
      { schoolId: "bontang", sessionId: "sesi-1", participantType: null },
      { participantType: "Siswa", figures: figures() },
    );
    const layout = chartLayout(long, ALL_CHART_PARTS);
    expect(layout.title!.lines.length).toBeGreaterThan(1);
    expect(layout.title!.lines.join(" ")).toBe(long.title);
    for (const line of layout.title!.lines) {
      expect(line.length * layout.title!.fontSize * 0.6).toBeLessThanOrEqual(CHART_WIDTH);
    }
  });

  it("puts the empty notice in place of bars", () => {
    const empty = participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: {
        responseCount: 0,
        instructor: null,
        materials: null,
        relevance: null,
        handsOnRbl: null,
      },
    });
    const layout = chartLayout(empty, ALL_CHART_PARTS);
    expect(layout.emptyNotice).not.toBeNull();
    expect(layout.slots.every((slot) => slot.bar === null && slot.valueLabel === null)).toBe(true);
  });

  it("keeps everything inside the fixed view box", () => {
    const layout = chartLayout(siswa(), ALL_CHART_PARTS);
    expect(layout.plot.top).toBeGreaterThan(0);
    expect(layout.plot.bottom).toBeLessThan(CHART_HEIGHT);
    expect(layout.plot.left).toBeGreaterThan(0);
    expect(layout.plot.right).toBeLessThan(CHART_WIDTH);
  });
});
