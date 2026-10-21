import {
  ALL_CHART_PARTS,
  CHART_HEIGHT,
  CHART_WIDTH,
  chartLayout,
  chartParticipantTypes,
  participantChartFigure,
  type ChartLayout,
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
 * Aspects a Tipe Peserta has and in what order, `null` → no wedge and "—", the title and n line, one
 * colour per Aspect, and each pie's wedge filled to its mean out of 10 (#514).
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

const NO_PARTS: ChartParts = { title: false, legend: false, labels: false, values: false };

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
  it("gives Siswa four Aspects in the average cards' order", () => {
    const figure = participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: figures(),
    });
    expect(figure.aspects.map((aspect) => aspect.label)).toEqual([
      "Narasumber",
      "Materi",
      "Relevansi",
      "Hands-on RBL",
    ]);
    expect(figure.aspects.map((aspect) => aspect.value)).toEqual([8.4, 7, 9.1, 6.5]);
  });

  it("gives GTK-MS three Aspects, since only the Student Class is asked Hands-on RBL", () => {
    const figure = participantChartFigure(schools, PROGRAMME, {
      participantType: "GTK-MS",
      figures: figures({ handsOnRbl: null }),
    });
    expect(figure.aspects.map((aspect) => aspect.label)).toEqual([
      "Narasumber",
      "Materi",
      "Relevansi",
    ]);
  });

  it("formats each value as the cards do, and an Aspect with no Rating as —, never 0", () => {
    const figure = participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: figures({ materials: 7, handsOnRbl: null }),
    });
    expect(figure.aspects.map((aspect) => aspect.valueLabel)).toEqual(["8.4", "7.0", "9.1", "—"]);
    expect(figure.aspects[3]!.value).toBeNull();
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
    const colours = new Set(siswa.aspects.map((aspect) => aspect.colour));
    expect(colours.size).toBe(4);
    for (const aspect of gtkMs.aspects) {
      expect(aspect.colour).toBe(
        siswa.aspects.find((other) => other.aspect === aspect.aspect)!.colour,
      );
    }
  });
});

describe("chartLayout", () => {
  const siswa = (over: Partial<ParticipantFeedbackFigures> = {}) =>
    participantChartFigure(schools, PROGRAMME, {
      participantType: "Siswa",
      figures: figures(over),
    });

  /** A sector's arc, read back from its path: the large-arc flag and where it ends. */
  const arc = (slot: ChartLayout["slots"][number]) => {
    const wedge = slot.wedge;
    if (wedge?.kind !== "sector") throw new Error("not a sector");
    const [, large, x, y] = / A [\d.]+ [\d.]+ 0 ([01]) 0 (-?[\d.]+) (-?[\d.]+) Z$/.exec(wedge.d)!;
    return { largeArc: large === "1", end: { x: Number(x), y: Number(y) } };
  };

  /** A wedge's end, as an angle from 12 o'clock counter-clockwise, in turns. */
  const turns = (slot: ChartLayout["slots"][number]) => {
    const { end } = arc(slot);
    const angle = Math.atan2(-(end.x - slot.centre.x), -(end.y - slot.centre.y));
    return (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI);
  };

  it("draws one pie per Aspect, the same diameter in a Siswa and a GTK-MS figure", () => {
    const four = chartLayout(siswa(), ALL_CHART_PARTS);
    const three = chartLayout(
      participantChartFigure(schools, PROGRAMME, {
        participantType: "GTK-MS",
        figures: figures({ handsOnRbl: null }),
      }),
      ALL_CHART_PARTS,
    );
    expect(four.slots).toHaveLength(4);
    expect(three.slots).toHaveLength(3);
    const radii = new Set([...four.slots, ...three.slots].map((slot) => slot.radius));
    expect(radii.size).toBe(1);
    // In one row, in the cards' order, left to right.
    expect(new Set(four.slots.map((slot) => slot.centre.y)).size).toBe(1);
    const xs = four.slots.map((slot) => slot.centre.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(four.slots.map((slot) => slot.aspect)).toEqual([
      "instructor",
      "materials",
      "relevance",
      "hands_on_rbl",
    ]);
  });

  it("keeps the diameter whatever the checkboxes hide, so figures compare by eye", () => {
    const all = chartLayout(siswa(), ALL_CHART_PARTS);
    const none = chartLayout(siswa(), NO_PARTS);
    expect(none.slots[0]!.radius).toBe(all.slots[0]!.radius);
  });

  it("starts each wedge at 12 o'clock with its apex at the centre", () => {
    const slot = chartLayout(siswa({ instructor: 2.5 }), ALL_CHART_PARTS).slots[0]!;
    const wedge = slot.wedge;
    expect(wedge?.kind).toBe("sector");
    if (wedge?.kind !== "sector") return;
    expect(wedge.d.startsWith(`M ${slot.centre.x} ${slot.centre.y} L ${slot.centre.x} `)).toBe(
      true,
    );
    expect(wedge.d).toContain(` ${slot.centre.y - slot.radius} A `);
    expect(wedge.d.endsWith(" Z")).toBe(true);
  });

  it("sweeps counter-clockwise, toward 9 o'clock first, to mean / 10 of the circle", () => {
    const quarter = chartLayout(siswa({ instructor: 2.5 }), ALL_CHART_PARTS).slots[0]!;
    if (quarter.wedge?.kind !== "sector") throw new Error("not a sector");
    // A quarter is 9 o'clock: left of the centre, level with it.
    expect(arc(quarter).end.x).toBeCloseTo(quarter.centre.x - quarter.radius, 1);
    expect(arc(quarter).end.y).toBeCloseTo(quarter.centre.y, 1);
    expect(arc(quarter).largeArc).toBe(false);
    // SVG's sweep flag 0 is counter-clockwise on screen.
    expect(quarter.wedge.d).toMatch(/ A [\d.]+ [\d.]+ 0 0 0 /);

    const layout = chartLayout(siswa({ materials: 7.8, relevance: 4.2 }), ALL_CHART_PARTS);
    expect(turns(layout.slots[1]!)).toBeCloseTo(0.78, 3);
    expect(turns(layout.slots[2]!)).toBeCloseTo(0.42, 3);
    expect(arc(layout.slots[1]!).largeArc).toBe(true);
    expect(arc(layout.slots[2]!).largeArc).toBe(false);
  });

  it("draws 10.0 as a full circle, which a single SVG arc cannot", () => {
    const slot = chartLayout(siswa({ instructor: 10 }), ALL_CHART_PARTS).slots[0]!;
    expect(slot.wedge).toEqual({ kind: "full" });
  });

  it("draws 0.0 as the bare track, labelled 0.0", () => {
    const slot = chartLayout(siswa({ instructor: 0 }), ALL_CHART_PARTS).slots[0]!;
    expect(slot.wedge).toBeNull();
    expect(slot.valueLabel!.text).toBe("0.0");
  });

  it("keeps an Aspect with no Rating's slot: the track, no wedge, and a — label", () => {
    const layout = chartLayout(siswa({ handsOnRbl: null }), ALL_CHART_PARTS);
    expect(layout.slots).toHaveLength(4);
    expect(layout.slots[3]!.wedge).toBeNull();
    expect(layout.slots[3]!.valueLabel!.text).toBe("—");
    expect(layout.slots[3]!.nameLabel!.text).toBe("Hands-on RBL");
  });

  it("centres the score on the pie and puts the Aspect's name under it", () => {
    const slot = chartLayout(siswa(), ALL_CHART_PARTS).slots[0]!;
    expect(slot.valueLabel!.x).toBe(slot.centre.x);
    expect(slot.valueLabel!.text).toBe("8.4");
    expect(slot.nameLabel!.x).toBe(slot.centre.x);
    expect(slot.nameLabel!.text).toBe("Narasumber");
    expect(slot.nameLabel!.y).toBeGreaterThan(slot.centre.y + slot.radius);
  });

  it("drops each part when its checkbox is off, and keeps the pies", () => {
    const layout = chartLayout(siswa(), NO_PARTS);
    expect(layout.title).toBeNull();
    expect(layout.legend).toBeNull();
    expect(layout.slots.every((slot) => slot.valueLabel === null)).toBe(true);
    expect(layout.slots.every((slot) => slot.nameLabel === null)).toBe(true);
    expect(layout.slots.every((slot) => slot.wedge !== null)).toBe(true);
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
    // The pies sit below the title and the legend, never under them.
    const legendBottom = Math.max(...layout.legend!.items.map((item) => item.swatch.y));
    const pie = layout.slots[0]!;
    expect(pie.centre.y - pie.radius).toBeGreaterThan(legendBottom + layout.legend!.swatch);
    expect(pie.nameLabel!.y).toBeLessThan(CHART_HEIGHT);
  });

  it("puts the empty notice in place of the pies", () => {
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
    expect(layout.slots).toEqual([]);
  });

  it("keeps every pie and its label inside the fixed view box", () => {
    const layout = chartLayout(siswa(), ALL_CHART_PARTS);
    for (const slot of layout.slots) {
      expect(slot.centre.x - slot.radius).toBeGreaterThan(0);
      expect(slot.centre.x + slot.radius).toBeLessThan(CHART_WIDTH);
      expect(slot.centre.y - slot.radius).toBeGreaterThan(0);
      expect(slot.nameLabel!.y).toBeLessThan(CHART_HEIGHT);
    }
    // Neighbouring pies never touch.
    const [first, second] = layout.slots;
    expect(second!.centre.x - first!.centre.x).toBeGreaterThan(2 * first!.radius);
  });
});
