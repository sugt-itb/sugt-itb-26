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
 * Aspects a Tipe Peserta has and in what order, `null` → no arc and "—", the title block and its
 * Tipe Peserta pill (#518), one colour per Aspect, and each donut's arc filled to its mean out of 10
 * (#516).
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
      {
        id: "batal",
        mode: "online",
        sesi: null,
        heldOn: "2026-10-14",
        startsAt: "09:00:00",
        timeZone: "WIB",
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

const NO_PARTS: ChartParts = { title: false, values: false };

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
  });

  const titled = (scope: Partial<ParticipantFeedbackScope>, participantType: "Siswa" | "GTK-MS") =>
    participantChartFigure(
      schools,
      { ...PROGRAMME, ...scope },
      { participantType, figures: figures() },
    ).title;

  it("titles a programme-wide figure Semua Sekolah, on two lines", () => {
    expect(titled({}, "Siswa")).toEqual({
      heading: "Feedback Peserta ·",
      participantType: "Siswa",
      scope: ["Semua Sekolah"],
      name: "Feedback Peserta · Siswa · Semua Sekolah",
    });
  });

  it("titles a School's figure by the School, on two lines, with no Sesi line", () => {
    const title = titled({ schoolId: "bontang" }, "GTK-MS");
    expect(title.scope).toEqual(["SMAN 1 Bontang"]);
    expect(title.name).toBe("Feedback Peserta · GTK-MS · SMAN 1 Bontang");
  });

  it("adds the Sesi picked as a third line, in its short form", () => {
    const title = titled({ schoolId: "bontang", sessionId: "sesi-1" }, "Siswa");
    expect(title.scope).toEqual(["SMAN 1 Bontang", "Sesi 1 Luring"]);
    expect(title.name).toBe("Feedback Peserta · Siswa · SMAN 1 Bontang · Sesi 1 Luring");
  });

  it("writes a cancelled Session's dated form, as the cards do", () => {
    expect(titled({ schoolId: "bontang", sessionId: "batal" }, "Siswa").scope).toEqual([
      "SMAN 1 Bontang",
      "Daring 14 Okt 2026 (dibatalkan)",
    ]);
  });

  it("names its own Tipe Peserta, not the scope's, and never a count", () => {
    const title = titled({ participantType: "GTK-MS" }, "GTK-MS");
    expect(title.participantType).toBe("GTK-MS");
    expect(title.name).not.toContain("tanggapan");
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
  const NUMBER = String.raw`(-?[\d.]+)`;
  /**
   * An arc's ring sector, read back from its path: outer arc from 12 o'clock, a line in, the inner
   * arc back, closed — each arc's large-arc and sweep flags, and its four corners.
   */
  const sector = (slot: Slot) => {
    const arc = slot.arc;
    if (arc?.kind !== "sector") throw new Error("not a sector");
    const match = new RegExp(
      `^M ${NUMBER} ${NUMBER} A ${NUMBER} ${NUMBER} 0 ([01]) ([01]) ${NUMBER} ${NUMBER} ` +
        `L ${NUMBER} ${NUMBER} A ${NUMBER} ${NUMBER} 0 ([01]) ([01]) ${NUMBER} ${NUMBER} Z$`,
    ).exec(arc.d);
    if (match === null) throw new Error(`not a ring sector: ${arc.d}`);
    // Captures in path order: start, outer radii, outer flags, outer end, inner end, inner radii,
    // inner flags, back to the hole's 12 o'clock.
    const [
      sx,
      sy,
      outerR,
      ,
      outerLarge,
      outerSweep,
      ox,
      oy,
      ix,
      iy,
      innerR,
      ,
      innerLarge,
      innerSweep,
      bx,
      by,
    ] = match.slice(1).map(Number) as number[];
    return {
      start: { x: sx!, y: sy! },
      outer: { radius: outerR!, largeArc: outerLarge === 1, sweep: outerSweep! },
      outerEnd: { x: ox!, y: oy! },
      innerEnd: { x: ix!, y: iy! },
      inner: { radius: innerR!, largeArc: innerLarge === 1, sweep: innerSweep! },
      innerStart: { x: bx!, y: by! },
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
    for (const parts of [ALL_CHART_PARTS, NO_PARTS, { title: true, values: false }]) {
      for (const slot of chartLayout(siswa(), parts).slots) {
        expect(slot.outerRadius).toBe(120);
        expect(slot.innerRadius).toBe(84);
      }
    }
  });

  it("centres the row in the room the title block leaves", () => {
    const withTitle = chartLayout(siswa(), ALL_CHART_PARTS);
    const without = chartLayout(siswa(), NO_PARTS);
    const slot = without.slots[0]!;
    // With no title the row is centred in the view box's padded height.
    const rowTop = slot.centre.y - slot.outerRadius;
    const rowBottom = slot.nameLabel.y;
    expect(Math.abs(rowTop - (CHART_HEIGHT - rowBottom))).toBeLessThan(40);
    // The title pushes it down, but never so far it leaves the space below empty.
    expect(withTitle.slots[0]!.centre.y).toBeGreaterThan(slot.centre.y);
    const titleBottom = withTitle.title!.baselines.at(-1)!;
    const top = withTitle.slots[0]!.centre.y - 120;
    const bottom = withTitle.slots[0]!.nameLabel.y;
    expect(Math.abs(top - titleBottom - (CHART_HEIGHT - bottom))).toBeLessThan(60);
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
    expect(layout.slots[3]!.nameLabel.text).toBe("Hands-on RBL");
  });

  it("centres the score in the hole and puts the Aspect's name under the donut", () => {
    const slot = chartLayout(siswa(), ALL_CHART_PARTS).slots[0]!;
    expect(slot.valueLabel!.x).toBe(slot.centre.x);
    expect(slot.valueLabel!.text).toBe("8.4");
    expect(slot.valueLabel!.fontSize).toBe(48);
    expect(slot.nameLabel.x).toBe(slot.centre.x);
    expect(slot.nameLabel.text).toBe("Narasumber");
    expect(slot.nameLabel.y).toBeGreaterThan(slot.centre.y + slot.outerRadius);
  });

  it("drops each part when its checkbox is off, and keeps the donuts and their names", () => {
    const layout = chartLayout(siswa(), NO_PARTS);
    expect(layout.title).toBeNull();
    expect(layout.slots.every((slot) => slot.valueLabel === null)).toBe(true);
    expect(layout.slots.map((slot) => slot.nameLabel.text)).toEqual([
      "Narasumber",
      "Materi",
      "Relevansi",
      "Hands-on RBL",
    ]);
    expect(layout.slots.every((slot) => slot.arc !== null)).toBe(true);
  });

  describe("the title block", () => {
    const scoped = (scope: Partial<ParticipantFeedbackScope>, name = "SMAN 1 Bontang") =>
      participantChartFigure(
        [{ ...schools[0]!, name }],
        { ...PROGRAMME, ...scope },
        { participantType: "Siswa", figures: figures() },
      );

    it("puts the heading and the pill on the first line, then the scope's lines under it", () => {
      const title = chartLayout(
        scoped({ schoolId: "bontang", sessionId: "sesi-1" }),
        ALL_CHART_PARTS,
      ).title!;
      expect(title.heading.text).toBe("Feedback Peserta ·");
      expect(title.pill.text).toBe("Siswa");
      expect(title.lines).toEqual(["SMAN 1 Bontang", "Sesi 1 Luring"]);
      expect(title.baselines).toHaveLength(2);
      // Each line below the last, and the first scope line clear of the pill.
      expect(title.baselines[0]!).toBeGreaterThan(title.pill.y + title.pill.height + 8);
      expect(title.baselines[1]!).toBeGreaterThan(title.baselines[0]!);
    });

    it("has two lines, Semua Sekolah, with no School", () => {
      const title = chartLayout(scoped({}), ALL_CHART_PARTS).title!;
      expect(title.lines).toEqual(["Semua Sekolah"]);
    });

    it("ends at its last line: no blank line under it", () => {
      const two = chartLayout(scoped({ schoolId: "bontang" }), ALL_CHART_PARTS);
      const three = chartLayout(
        scoped({ schoolId: "bontang", sessionId: "sesi-1" }),
        ALL_CHART_PARTS,
      );
      // The Sesi line costs the row one line's height, centred: half of it.
      expect(three.slots[0]!.centre.y - two.slots[0]!.centre.y).toBeLessThan(40);
    });

    it.each(["Siswa", "GTK-MS"] as const)(
      "encloses %s in its pill with room to spare, centred on it",
      (participantType) => {
        const figure = participantChartFigure(schools, PROGRAMME, {
          participantType,
          figures: figures(),
        });
        const { pill, heading, fontSize } = chartLayout(figure, ALL_CHART_PARTS).title!;
        expect(pill.text).toBe(participantType);
        expect(pill.textX).toBe(pill.x + pill.width / 2);
        // Room for the word at 0.75 em a character — wider than Montserrat's or Helvetica's caps —
        // so the word stays inside whichever font draws it.
        expect(pill.width).toBeGreaterThan(participantType.length * fontSize * 0.75);
        // The text's cap height sits inside the pill, top and bottom.
        expect(pill.y).toBeLessThan(pill.textY - fontSize * 0.75);
        expect(pill.y + pill.height).toBeGreaterThan(pill.textY + fontSize * 0.1);
        // The heading ends before the pill begins, and the whole line is centred.
        expect(heading.x).toBeLessThan(pill.x);
        const left = heading.x - heading.text.length * fontSize * 0.6;
        expect(Math.abs(left - (CHART_WIDTH - pill.x - pill.width))).toBeLessThan(fontSize);
        expect(pill.x + pill.width).toBeLessThan(CHART_WIDTH);
      },
    );

    it("wraps a long School name onto lines that fit, without reaching the donuts", () => {
      const long = scoped(
        { schoolId: "bontang", sessionId: "sesi-1" },
        "SMA Negeri 1 Unggulan Kabupaten Kutai Kartanegara Tenggarong Seberang Timur",
      );
      const layout = chartLayout(long, ALL_CHART_PARTS);
      const title = layout.title!;
      expect(title.lines.length).toBeGreaterThan(2);
      expect(title.lines.slice(0, -1).join(" ")).toBe(long.title.scope[0]);
      expect(title.lines.at(-1)).toBe("Sesi 1 Luring");
      for (const line of title.lines) {
        expect(line.length * title.fontSize * 0.6).toBeLessThanOrEqual(CHART_WIDTH);
      }
      // The donuts sit below the last line's descenders, and their names inside the view box.
      const donut = layout.slots[0]!;
      expect(donut.centre.y - donut.outerRadius).toBeGreaterThan(
        title.baselines.at(-1)! + title.fontSize * 0.3,
      );
      expect(donut.nameLabel.y).toBeLessThan(CHART_HEIGHT);
    });
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
      expect(slot.nameLabel.y).toBeLessThan(CHART_HEIGHT);
    }
    // Neighbouring donuts never touch.
    const [first, second] = layout.slots;
    expect(second!.centre.x - first!.centre.x).toBeGreaterThan(2 * first!.outerRadius);
  });
});
