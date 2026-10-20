import { participantScopeLabel } from "-/components/feedback-scope";
import { PARTICIPANT_ASPECT_LABELS } from "-/lib/participant-feedback-copy";
import type {
  FeedbackParticipantType,
  FeedbackSchoolOption,
  ParticipantFeedbackFigures,
  ParticipantFeedbackScope,
} from "@sugt/db/queries";
import {
  PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS,
  type ParticipantFeedbackAspect,
} from "@sugt/domain";

/**
 * **The Lihat Grafik figures' pure rules** (#510): which figures a scope gets, which Aspects a Tipe
 * Peserta has, `null` → no bar, the title and n line, and where every part of a figure sits in its
 * fixed view box. Plain functions, tested without a DOM, the way `feedback-scope.ts` sits beside the
 * tab; `feedback-chart-figure.tsx` only draws what `chartLayout` returns. Types only from
 * `@sugt/db/queries`, as in `feedback-view.tsx`.
 */

/**
 * The Tipe Peserta, in the figures' order — Siswa (the Student Class), then GTK-MS (the GTK and MS
 * Classes together), the split of the Tipe Peserta picker and the Daftar Hadir Peserta sheets — and
 * the stored Classes each pools, as `PARTICIPANT_TYPE_CLASSES` on the query. Declared here rather
 * than imported, for the reason `feedback-view.tsx` gives: a runtime value from `@sugt/db` would drag
 * the Postgres client into the browser.
 */
const CLASSES_BY_TYPE = {
  Siswa: ["Student"],
  "GTK-MS": ["GTK", "MS"],
} as const satisfies Record<
  FeedbackParticipantType,
  (keyof typeof PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS)[]
>;

/**
 * The figures a scope gets: one per Tipe Peserta, or only the one picked. A value that names no Tipe
 * Peserta — a Server Action's input is anyone's — gets none.
 */
export function chartParticipantTypes(
  participantType: FeedbackParticipantType | null,
): FeedbackParticipantType[] {
  return (Object.keys(CLASSES_BY_TYPE) as FeedbackParticipantType[]).filter(
    (type) => participantType === null || type === participantType,
  );
}

/** The four checkboxes: which parts of every figure are drawn. All on to start. */
export type ChartParts = { title: boolean; legend: boolean; axes: boolean; values: boolean };

export const ALL_CHART_PARTS: ChartParts = { title: true, legend: true, axes: true, values: true };

/** One Tipe Peserta's figures over the dialog's scope — what the Server Action returns. */
export type ParticipantChartData = {
  participantType: FeedbackParticipantType;
  figures: ParticipantFeedbackFigures;
};

/**
 * **Bar order is the average cards'**: Narasumber, Materi, Relevansi, Hands-on RBL. Each Aspect has
 * one categorical colour token (`globals.css`), the same in every figure, which is what lets the
 * legend stand in for the x-axis labels when Sumbu is off. The tokens are named, not resolved, so
 * the PNG export (#511) can swap in concrete values.
 */
const CHART_ASPECTS: readonly {
  aspect: ParticipantFeedbackAspect;
  figure: keyof Omit<ParticipantFeedbackFigures, "responseCount">;
  colour: string;
}[] = [
  { aspect: "instructor", figure: "instructor", colour: "--chart-category-1" },
  { aspect: "materials", figure: "materials", colour: "--chart-category-2" },
  { aspect: "relevance", figure: "relevance", colour: "--chart-category-3" },
  { aspect: "hands_on_rbl", figure: "handsOnRbl", colour: "--chart-category-4" },
];

/** One Aspect's bar. `value` is `null` when no response in scope Rated it: a slot with no bar. */
export type ChartBar = {
  aspect: ParticipantFeedbackAspect;
  label: string;
  value: number | null;
  /** As the average cards show it — one decimal — or "—", never "0.0". */
  valueLabel: string;
  /** The CSS custom property that colours it, e.g. `--chart-category-1`. */
  colour: string;
};

/** One Tipe Peserta's figure, before layout. */
export type ChartFigure = {
  participantType: FeedbackParticipantType;
  title: string;
  /** "n = 42 tanggapan" — indicative, not a census (ADR-0009), so a figure says what it stands on. */
  countLine: string;
  bars: ChartBar[];
  /** No response in scope: the frame shows "Belum ada tanggapan" in place of bars. */
  empty: boolean;
};

/**
 * One Tipe Peserta's figure: the Aspects its Classes are asked, in the cards' order, each the mean
 * Rating over the scope — the same number its average card shows with that Tipe Peserta picked. The
 * title is the scope as the cards name it, then the Tipe Peserta.
 */
export function participantChartFigure(
  schools: readonly FeedbackSchoolOption[],
  scope: ParticipantFeedbackScope,
  { participantType, figures }: ParticipantChartData,
): ChartFigure {
  const asked = new Set(
    CLASSES_BY_TYPE[participantType].flatMap(
      (classKind) => PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS[classKind],
    ),
  );
  const covers = participantScopeLabel(schools, { ...scope, participantType });
  return {
    participantType,
    title: `Nilai rata-rata Peserta · ${covers}`,
    countLine: `n = ${figures.responseCount} tanggapan`,
    empty: figures.responseCount === 0,
    bars: CHART_ASPECTS.filter(({ aspect }) => asked.has(aspect)).map(
      ({ aspect, figure, colour }) => {
        const value = figures[figure];
        return {
          aspect,
          label: PARTICIPANT_ASPECT_LABELS[aspect],
          value,
          valueLabel: value === null ? "—" : value.toFixed(1),
          colour,
        };
      },
    ),
  };
}

/**
 * **The fixed view box.** Every figure is laid out at 1200×800 and scales to its container, so the
 * same markup serves the dialog and the 2400×1600 PNG (#511). Sizes below are in its units.
 */
export const CHART_WIDTH = 1200;
export const CHART_HEIGHT = 800;

const PAD = 48;
const TITLE_SIZE = 42;
const TITLE_LEADING = 52;
const COUNT_SIZE = 32;
const LEGEND_SIZE = 32;
const LEGEND_SWATCH = 28;
const LEGEND_ROW = 48;
const TICK_SIZE = 30;
const AXIS_TITLE_SIZE = 28;
const VALUE_SIZE = 36;
const TICK_LENGTH = 10;

/**
 * A text's width in view-box units, estimated: SVG cannot measure text without a DOM. 0.6 em per
 * character is an estimate, not a measurement. Checked in Chromium against Montserrat, a wrapped
 * long School title, the legend and the tick labels all stayed inside the view box without
 * overlapping (#510).
 */
function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

/** Greedy word wrap to lines no wider than `width`. A single word wider than that keeps its line. */
function wrap(text: string, fontSize: number, width: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && textWidth(`${last} ${word}`, fontSize) <= width) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}

type Point = { x: number; y: number };

/** Where every part of a figure sits. A part its checkbox hides is `null`. */
export type ChartLayout = {
  title: {
    lines: string[];
    fontSize: number;
    /** Each line's baseline, centred on `x`. */
    baselines: number[];
    x: number;
    count: Point & { text: string; fontSize: number };
  } | null;
  legend: {
    fontSize: number;
    swatch: number;
    items: { label: string; colour: string; swatch: Point; text: Point }[];
  } | null;
  plot: { top: number; bottom: number; left: number; right: number };
  axes: {
    fontSize: number;
    tickLength: number;
    yTicks: { label: string; y: number }[];
    xTicks: { label: string; x: number }[];
    /** Baseline of the x tick labels. */
    xTickBaseline: number;
    xTitle: Point & { text: string };
    /** The y title is rotated a quarter-turn anticlockwise about this point. */
    yTitle: Point & { text: string };
  } | null;
  /** One per Aspect, in order — kept for an Aspect with no Rating, whose `bar` is `null`. */
  slots: {
    aspect: ParticipantFeedbackAspect;
    colour: string;
    centre: number;
    bar: { x: number; y: number; width: number; height: number } | null;
    valueLabel: (Point & { text: string; fontSize: number }) | null;
  }[];
  /** "Belum ada tanggapan", centred in the plot, when the figure has no responses. */
  emptyNotice: (Point & { text: string }) | null;
};

/**
 * **A figure's layout in the fixed view box.** Top to bottom: the title and n line (Judul), the
 * legend (Legenda), the plot with its value labels (Nilai), then the x tick labels and axis title
 * (Sumbu); the y ticks and title sit to the plot's left. A hidden part gives its room to the bars.
 * **The value axis is 0–10, always**, so two figures compare by eye.
 */
export function chartLayout(figure: ChartFigure, parts: ChartParts): ChartLayout {
  const contentWidth = CHART_WIDTH - 2 * PAD;
  let cursor = PAD;

  let title: ChartLayout["title"] = null;
  if (parts.title) {
    const lines = wrap(figure.title, TITLE_SIZE, contentWidth);
    const baselines = lines.map((_, index) => cursor + TITLE_SIZE + index * TITLE_LEADING);
    const countBaseline = baselines.at(-1)! + 16 + COUNT_SIZE;
    title = {
      lines,
      fontSize: TITLE_SIZE,
      baselines,
      x: CHART_WIDTH / 2,
      count: { text: figure.countLine, fontSize: COUNT_SIZE, x: CHART_WIDTH / 2, y: countBaseline },
    };
    cursor = countBaseline + 28;
  }

  let legend: ChartLayout["legend"] = null;
  if (parts.legend) {
    // Each item is a swatch, a gap and its label; items run in centred rows, wrapping when full.
    const gap = 12;
    const between = 40;
    const sized = figure.bars.map((bar) => ({
      bar,
      width: LEGEND_SWATCH + gap + textWidth(bar.label, LEGEND_SIZE),
    }));
    const rows: (typeof sized)[] = [];
    for (const item of sized) {
      const row = rows.at(-1);
      const rowWidth = row?.reduce((sum, other) => sum + other.width + between, 0) ?? 0;
      if (row !== undefined && rowWidth + item.width <= contentWidth) row.push(item);
      else rows.push([item]);
    }
    const items = rows.flatMap((row, index) => {
      const top = cursor + index * LEGEND_ROW;
      const rowWidth = row.reduce((sum, item) => sum + item.width, 0) + between * (row.length - 1);
      let x = (CHART_WIDTH - rowWidth) / 2;
      return row.map(({ bar, width }) => {
        const item = {
          label: bar.label,
          colour: bar.colour,
          swatch: { x, y: top + (LEGEND_SIZE - LEGEND_SWATCH) / 2 + 2 },
          text: { x: x + LEGEND_SWATCH + gap, y: top + LEGEND_SIZE * 0.85 },
        };
        x += width + between;
        return item;
      });
    });
    legend = { fontSize: LEGEND_SIZE, swatch: LEGEND_SWATCH, items };
    cursor += rows.length * LEGEND_ROW;
  }

  // Headroom above a 10 bar for its value label, and below the plot for the x tick labels and title.
  const top = cursor + (parts.values ? VALUE_SIZE + 24 : 12);
  const bottom =
    CHART_HEIGHT - PAD - (parts.axes ? TICK_LENGTH + 12 + TICK_SIZE + 24 + AXIS_TITLE_SIZE : 0);
  const left =
    PAD + (parts.axes ? AXIS_TITLE_SIZE + 24 + textWidth("10", TICK_SIZE) + 12 + TICK_LENGTH : 0);
  const right = CHART_WIDTH - PAD;
  const plot = { top, bottom, left, right };
  const plotHeight = bottom - top;
  const slotWidth = (right - left) / figure.bars.length;
  const barWidth = Math.min(slotWidth * 0.6, 180);

  const slots = figure.bars.map((bar, index) => {
    const centre = left + slotWidth * (index + 0.5);
    const height = bar.value === null ? 0 : (bar.value / 10) * plotHeight;
    const drawn = !figure.empty && bar.value !== null;
    return {
      aspect: bar.aspect,
      colour: bar.colour,
      centre,
      bar: drawn ? { x: centre - barWidth / 2, y: bottom - height, width: barWidth, height } : null,
      valueLabel:
        parts.values && !figure.empty
          ? { text: bar.valueLabel, fontSize: VALUE_SIZE, x: centre, y: bottom - height - 14 }
          : null,
    };
  });

  const axes: ChartLayout["axes"] = parts.axes
    ? {
        fontSize: TICK_SIZE,
        tickLength: TICK_LENGTH,
        yTicks: [0, 2, 4, 6, 8, 10].map((value) => ({
          label: String(value),
          y: bottom - (value / 10) * plotHeight,
        })),
        xTicks: figure.bars.map((bar, index) => ({ label: bar.label, x: slots[index]!.centre })),
        xTickBaseline: bottom + TICK_LENGTH + 12 + TICK_SIZE * 0.8,
        xTitle: { text: "Aspek", x: (left + right) / 2, y: CHART_HEIGHT - PAD },
        yTitle: {
          text: "Nilai rata-rata (0–10)",
          x: PAD + AXIS_TITLE_SIZE * 0.8,
          y: (top + bottom) / 2,
        },
      }
    : null;

  return {
    title,
    legend,
    plot,
    axes,
    slots,
    emptyNotice: figure.empty
      ? { text: "Belum ada tanggapan", x: (left + right) / 2, y: (top + bottom) / 2 }
      : null,
  };
}
