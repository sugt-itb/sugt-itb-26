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
 * Aspects a Tipe Peserta has and in what order, `null` → no arc and "—", the title and n line, one
 * colour per Aspect, and each donut's arc filled to its mean out of 10 (#516).
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

  type Slot = ChartLayout["slots"][number];
  const N = String.raw`(-?[\d.]+)`;
  /**
   * An arc's ring sector, read back from its path: outer arc from 12 o'clock, a line in, the inner
   * arc back, closed — each arc's large-arc and sweep flags, and its four corners.
   */
  const sector = (slot: Slot) => {
    const arc = slot.arc;
    if (arc?.kind !== "sector") throw new Error("not a sector");
    const match = new RegExp(
      `^M ${N} ${N} A ${N} ${N} 0 ([01]) ([01]) ${N} ${N} L ${N} ${N} A ${N} ${N} 0 ([01]) ([01]) ${N} ${N} Z$`,
    ).exec(arc.d);
    if (match === null) throw new Error(`not a ring sector: ${arc.d}`);
    const n = match.slice(1).map(Number);
    return {
      start: { x: n[0]!, y: n[1]! },
      outer: { radius: n[2]!, largeArc: n[4] === 1, sweep: n[5]! },
      outerEnd: { x: n[6]!, y: n[7]! },
      innerEnd: { x: n[8]!, y: n[9]! },
      inner: { radius: n[10]!, largeArc: n[12] === 1, sweep: n[13]! },
      innerStart: { x: n[14]!, y: n[15]! },
    };
  };
  const distance = (slot: Slot, point: { x: number; y: number }) =>
    Math.hypot(point.x - slot.centre.x, point.y - slot.centre.y);

  /** An arc's end, as an angle from 12 o'clock counter-clockwise, in turns. */
  const turns = (slot: Slot) => {
    const end = sector(slot).outerEnd;
    const angle = Math.atan2(-(end.x - slot.centre.x), -(end.y - slot.centre.y));
    return (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI);
  };

  it("draws one donut per Aspect, outer radius 120 and hole 84, in both figures", () => {
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
    for (const slot of [...four.slots, ...three.slots]) {
      expect(slot.outerRadius).toBe(120);
      expect(slot.innerRadius).toBe(84);
    }
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

  it("keeps the size whatever the checkboxes hide, so figures compare by eye", () => {
    const none = chartLayout(siswa(), NO_PARTS);
    expect(none.slots[0]!.outerRadius).toBe(120);
    expect(none.slots[0]!.innerRadius).toBe(84);
  });

  it("leaves a hole wide enough for the widest score, 10.0, at the score size", () => {
    const slot = chartLayout(siswa({ instructor: 10 }), ALL_CHART_PARTS).slots[0]!;
    expect(slot.valueLabel!.text).toBe("10.0");
    // Bold Montserrat runs about 0.6 em a character, so 10.0 at 48 is about 115 units.
    expect("10.0".length * slot.valueLabel!.fontSize * 0.6).toBeLessThan(2 * slot.innerRadius - 40);
  });

  it("draws the track as the whole ring, both edges, with an unfilled hole", () => {
    const slot = chartLayout(siswa(), ALL_CHART_PARTS).slots[0]!;
    const { x, y } = slot.centre;
    // Two closed circles — the outer edge and the hole's — so even-odd fill leaves the hole empty.
    expect(slot.track).toBe(
      `M ${x} ${y - 120} A 120 120 0 1 0 ${x} ${y + 120} A 120 120 0 1 0 ${x} ${y - 120} Z ` +
        `M ${x} ${y - 84} A 84 84 0 1 0 ${x} ${y + 84} A 84 84 0 1 0 ${x} ${y - 84} Z`,
    );
  });

  it("starts each arc at 12 o'clock and keeps it between the hole and the outer edge", () => {
    const layout = chartLayout(siswa({ instructor: 2.5, materials: 7.8 }), ALL_CHART_PARTS);
    for (const slot of layout.slots.slice(0, 2)) {
      const ring = sector(slot);
      expect(ring.start).toEqual({ x: slot.centre.x, y: slot.centre.y - 120 });
      expect(ring.innerStart).toEqual({ x: slot.centre.x, y: slot.centre.y - 84 });
      expect(ring.outer.radius).toBe(120);
      expect(ring.inner.radius).toBe(84);
      expect(distance(slot, ring.outerEnd)).toBeCloseTo(120, 1);
      expect(distance(slot, ring.innerEnd)).toBeCloseTo(84, 1);
    }
  });

  it("runs counter-clockwise, toward 9 o'clock first, to mean / 10 of the ring", () => {
    const quarter = chartLayout(siswa({ instructor: 2.5 }), ALL_CHART_PARTS).slots[0]!;
    const ring = sector(quarter);
    // A quarter is 9 o'clock: left of the centre, level with it, on both edges.
    expect(ring.outerEnd.x).toBeCloseTo(quarter.centre.x - 120, 1);
    expect(ring.outerEnd.y).toBeCloseTo(quarter.centre.y, 1);
    expect(ring.innerEnd.x).toBeCloseTo(quarter.centre.x - 84, 1);
    // SVG's sweep flag 0 is counter-clockwise on screen; the inner arc runs back, clockwise.
    expect(ring.outer.sweep).toBe(0);
    expect(ring.inner.sweep).toBe(1);

    const layout = chartLayout(siswa({ materials: 7.8, relevance: 4.2 }), ALL_CHART_PARTS);
    expect(turns(layout.slots[1]!)).toBeCloseTo(0.78, 3);
    expect(turns(layout.slots[2]!)).toBeCloseTo(0.42, 3);
  });

  it("sets the large-arc flag on both edges above 5 and on neither below", () => {
    const layout = chartLayout(siswa({ materials: 7.8, relevance: 4.2 }), ALL_CHART_PARTS);
    expect(sector(layout.slots[1]!).outer.largeArc).toBe(true);
    expect(sector(layout.slots[1]!).inner.largeArc).toBe(true);
    expect(sector(layout.slots[2]!).outer.largeArc).toBe(false);
    expect(sector(layout.slots[2]!).inner.largeArc).toBe(false);
  });

  it("draws 10.0 as the full ring, which a single SVG arc cannot", () => {
    const slot = chartLayout(siswa({ instructor: 10 }), ALL_CHART_PARTS).slots[0]!;
    expect(slot.arc).toEqual({ kind: "full", d: slot.track });
  });

  it("draws 0.0 as the bare track, labelled 0.0", () => {
    const slot = chartLayout(siswa({ instructor: 0 }), ALL_CHART_PARTS).slots[0]!;
    expect(slot.arc).toBeNull();
    expect(slot.valueLabel!.text).toBe("0.0");
  });

  it("keeps an Aspect with no Rating's slot: the track, no arc, and a — label", () => {
    const layout = chartLayout(siswa({ handsOnRbl: null }), ALL_CHART_PARTS);
    expect(layout.slots).toHaveLength(4);
    expect(layout.slots[3]!.arc).toBeNull();
    expect(layout.slots[3]!.valueLabel!.text).toBe("—");
    expect(layout.slots[3]!.nameLabel!.text).toBe("Hands-on RBL");
  });

  it("centres the score in the hole and puts the Aspect's name under the donut", () => {
    const slot = chartLayout(siswa(), ALL_CHART_PARTS).slots[0]!;
    expect(slot.valueLabel!.x).toBe(slot.centre.x);
    expect(slot.valueLabel!.text).toBe("8.4");
    expect(slot.valueLabel!.fontSize).toBe(48);
    expect(slot.nameLabel!.x).toBe(slot.centre.x);
    expect(slot.nameLabel!.text).toBe("Narasumber");
    expect(slot.nameLabel!.y).toBeGreaterThan(slot.centre.y + slot.outerRadius);
  });

  it("drops each part when its checkbox is off, and keeps the donuts", () => {
    const layout = chartLayout(siswa(), NO_PARTS);
    expect(layout.title).toBeNull();
    expect(layout.legend).toBeNull();
    expect(layout.slots.every((slot) => slot.valueLabel === null)).toBe(true);
    expect(layout.slots.every((slot) => slot.nameLabel === null)).toBe(true);
    expect(layout.slots.every((slot) => slot.arc !== null)).toBe(true);
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
    // The donuts sit below the title and the legend, never under them.
    const legendBottom = Math.max(...layout.legend!.items.map((item) => item.swatch.y));
    const donut = layout.slots[0]!;
    expect(donut.centre.y - donut.outerRadius).toBeGreaterThan(
      legendBottom + layout.legend!.swatch,
    );
    expect(donut.nameLabel!.y).toBeLessThan(CHART_HEIGHT);
  });

  it("puts the empty notice in place of the donuts", () => {
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

  it("keeps every donut and its label inside the fixed view box", () => {
    const layout = chartLayout(siswa(), ALL_CHART_PARTS);
    for (const slot of layout.slots) {
      expect(slot.centre.x - slot.outerRadius).toBeGreaterThan(0);
      expect(slot.centre.x + slot.outerRadius).toBeLessThan(CHART_WIDTH);
      expect(slot.centre.y - slot.outerRadius).toBeGreaterThan(0);
      expect(slot.nameLabel!.y).toBeLessThan(CHART_HEIGHT);
    }
    // Neighbouring donuts never touch.
    const [first, second] = layout.slots;
    expect(second!.centre.x - first!.centre.x).toBeGreaterThan(2 * first!.outerRadius);
  });
});
