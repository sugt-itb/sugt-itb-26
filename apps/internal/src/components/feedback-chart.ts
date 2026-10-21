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
 * **The Lihat Grafik figures' pure rules** (#510, #514): which figures a scope gets, which Aspects a
 * Tipe Peserta has, `null` → no wedge, the title and n line, and where every part of a figure sits
 * in its fixed view box. Plain functions, tested without a DOM, the way `feedback-scope.ts` sits beside the
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
export type ChartParts = { title: boolean; legend: boolean; labels: boolean; values: boolean };

export const ALL_CHART_PARTS: ChartParts = {
  title: true,
  legend: true,
  labels: true,
  values: true,
};

/** One Tipe Peserta's figures over the dialog's scope — what the Server Action returns. */
export type ParticipantChartData = {
  participantType: FeedbackParticipantType;
  figures: ParticipantFeedbackFigures;
};

/**
 * **Pie order is the average cards'**: Narasumber, Materi, Relevansi, Hands-on RBL. Each Aspect has
 * one categorical colour token (`globals.css`), the same in every figure, which is what lets the
 * legend stand in for the pies' labels when Label is off. The tokens are named, not resolved, so
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

/** One Aspect's pie. `value` is `null` when no response in scope Rated it: a pie with no wedge. */
export type ChartAspect = {
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
  aspects: ChartAspect[];
  /** No response in scope: the frame shows "Belum ada tanggapan" in place of the pies. */
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
    aspects: CHART_ASPECTS.filter(({ aspect }) => asked.has(aspect)).map(
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
/**
 * **Every pie is this size, in every figure and whatever the checkboxes hide**, so a Siswa and a
 * GTK-MS figure compare by eye (#514). Four fit across the view box with room between them and
 * under them for the longest label, Hands-on RBL.
 */
const PIE_RADIUS = 120;
const LABEL_SIZE = 30;
const LABEL_GAP = 20;
const VALUE_SIZE = 48;

/**
 * A text's width in view-box units, estimated: SVG cannot measure text without a DOM. 0.6 em per
 * character is an estimate, not a measurement. Checked in Chromium against Montserrat, a wrapped
 * long School title and the legend stayed inside the view box without overlapping (#510).
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

/**
 * A pie's filled part: the whole circle at 10.0 — one SVG arc cannot draw 360°, so it is a circle —
 * or a sector from 12 o'clock, apex at the centre, `d` its path.
 */
export type ChartWedge = { kind: "full" } | { kind: "sector"; d: string };

/** Two decimals is far below a pixel at any size the figure is drawn. */
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * **A wedge filled to `value / 10` of the circle, like a progress indicator.** It starts at 12
 * o'clock and sweeps counter-clockwise, toward 9 o'clock first — SVG's sweep flag 0 on screen. 0.0
 * fills nothing, so the pie is its bare track; `null` likewise, told apart only by its label.
 */
function wedge(centre: Point, radius: number, value: number | null): ChartWedge | null {
  if (value === null || value <= 0) return null;
  if (value >= 10) return { kind: "full" };
  const angle = (value / 10) * 2 * Math.PI;
  const end = { x: centre.x - radius * Math.sin(angle), y: centre.y - radius * Math.cos(angle) };
  return {
    kind: "sector",
    d:
      `M ${centre.x} ${centre.y} L ${centre.x} ${centre.y - radius} ` +
      `A ${radius} ${radius} 0 ${value > 5 ? 1 : 0} 0 ${round(end.x)} ${round(end.y)} Z`,
  };
}

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
  /**
   * One pie per Aspect, in order — kept for an Aspect with no Rating, whose `wedge` is `null` — and
   * none at all when the figure has no responses.
   */
  slots: {
    aspect: ParticipantFeedbackAspect;
    colour: string;
    centre: Point;
    radius: number;
    wedge: ChartWedge | null;
    /** The score, centred on the pie: `y` is its baseline. */
    valueLabel: (Point & { text: string; fontSize: number }) | null;
    /** The Aspect's name under the pie: `y` is its baseline. */
    nameLabel: (Point & { text: string; fontSize: number }) | null;
  }[];
  /** "Belum ada tanggapan", centred where the pies would be, when the figure has no responses. */
  emptyNotice: (Point & { text: string }) | null;
};

/**
 * **A figure's layout in the fixed view box.** Top to bottom: the title and n line (Judul), the
 * legend (Legenda), then one row of pies, each with its score on its centre (Nilai) and its
 * Aspect's name under it (Label). The row is centred in the room the parts above leave; a hidden
 * part gives that room back, but **never changes a pie's size**.
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
    const sized = figure.aspects.map((aspect) => ({
      aspect,
      width: LEGEND_SWATCH + gap + textWidth(aspect.label, LEGEND_SIZE),
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
      return row.map(({ aspect, width }) => {
        const item = {
          label: aspect.label,
          colour: aspect.colour,
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

  // The row — pies, then their labels — centred in what is left, or pinned to its top if a long
  // title leaves less than that.
  const top = cursor + 12;
  const bottom = CHART_HEIGHT - PAD;
  const rowHeight = 2 * PIE_RADIUS + (parts.labels ? LABEL_GAP + LABEL_SIZE : 0);
  const centreY = Math.round(top + Math.max(0, (bottom - top - rowHeight) / 2) + PIE_RADIUS);
  const slotWidth = contentWidth / figure.aspects.length;

  const slots = figure.empty
    ? []
    : figure.aspects.map((aspect, index) => {
        const centre = { x: PAD + slotWidth * (index + 0.5), y: centreY };
        return {
          aspect: aspect.aspect,
          colour: aspect.colour,
          centre,
          radius: PIE_RADIUS,
          wedge: wedge(centre, PIE_RADIUS, aspect.value),
          valueLabel: parts.values
            ? {
                text: aspect.valueLabel,
                fontSize: VALUE_SIZE,
                x: centre.x,
                y: centre.y + VALUE_SIZE * 0.35,
              }
            : null,
          nameLabel: parts.labels
            ? {
                text: aspect.label,
                fontSize: LABEL_SIZE,
                x: centre.x,
                y: centre.y + PIE_RADIUS + LABEL_GAP + LABEL_SIZE * 0.8,
              }
            : null,
        };
      });

  return {
    title,
    legend,
    slots,
    emptyNotice: figure.empty
      ? { text: "Belum ada tanggapan", x: CHART_WIDTH / 2, y: (top + bottom) / 2 }
      : null,
  };
}
