import { participantScopeNames } from "-/components/feedback-scope";
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
 * **The Lihat Grafik figures' pure rules** (#510, #514, #516, #518): which figures a scope gets,
 * which Aspects a Tipe Peserta has, `null` → no arc, the title block, and where every part of a
 * figure sits in its fixed view box. Plain functions, tested without a DOM, the way
 * `feedback-scope.ts` sits beside the tab; `feedback-chart-figure.tsx` only draws what
 * `chartLayout` returns. Types only from `@sugt/db/queries`, as in `feedback-view.tsx`.
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

/**
 * The two checkboxes: which parts of every figure are drawn. Both on to start. The Aspects' names
 * are not one of them — with no legend (#518), a donut without its name would name nothing.
 */
export type ChartParts = { title: boolean; values: boolean };

export const ALL_CHART_PARTS: ChartParts = { title: true, values: true };

/** One Tipe Peserta's figures over the dialog's scope — what the Server Action returns. */
export type ParticipantChartData = {
  participantType: FeedbackParticipantType;
  figures: ParticipantFeedbackFigures;
};

/**
 * **Donut order is the average cards'**: Narasumber, Materi, Relevansi, Hands-on RBL. Each Aspect
 * has one categorical colour token (`globals.css`), the same in every figure, so the same Aspect
 * reads the same across two figures. The tokens are named, not resolved, so the PNG export (#511)
 * can swap in concrete values.
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

/** One Aspect's donut. `value` is `null` when no response in scope Rated it: no arc. */
export type ChartAspect = {
  aspect: ParticipantFeedbackAspect;
  label: string;
  value: number | null;
  /** As the average cards show it — one decimal — or "—", never "0.0". */
  valueLabel: string;
  /** The CSS custom property that colours it, e.g. `--chart-category-1`. */
  colour: string;
};

/**
 * A figure's title block (#518), before layout: `Feedback Peserta ·` and the Tipe Peserta, in its
 * pill, on the first line; then the School, or `Semua Sekolah`; then the Sesi, only when one is
 * picked. No count — the page states it (#519).
 */
export type ChartTitle = {
  heading: string;
  /** The School's name or `Semua Sekolah`, then the Sesi's short label if one is picked. */
  scope: string[];
  /** Every line joined with ` · `: the figure's accessible name, whatever the checkboxes hide. */
  name: string;
};

/** One Tipe Peserta's figure, before layout. */
export type ChartFigure = {
  participantType: FeedbackParticipantType;
  title: ChartTitle;
  aspects: ChartAspect[];
  /** No response in scope: the frame shows "Belum ada tanggapan" in place of the donuts. */
  empty: boolean;
};

/**
 * One Tipe Peserta's figure: the Aspects its Classes are asked, in the cards' order, each the mean
 * Rating over the scope — the same number its average card shows with that Tipe Peserta picked. The
 * title names the figure's own Tipe Peserta, then the School and Sesi as the cards name them. A
 * Sesi is only ever picked with its School, so with no School there is no Sesi line.
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
  const { school, sesi } = participantScopeNames(schools, scope);
  const heading = "Feedback Peserta ·";
  const scopeLines = [school ?? "Semua Sekolah"];
  if (sesi !== null) scopeLines.push(sesi);
  return {
    participantType,
    title: {
      heading,
      scope: scopeLines,
      name: [`${heading} ${participantType}`, ...scopeLines].join(" · "),
    },
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
/**
 * **The Tipe Peserta's pill.** Its width is the word's estimated width plus this much either side,
 * generous on purpose: the estimate is 0.6 em a character, but `GTK-MS` is all capitals, which run
 * nearer 0.65 em in Montserrat and in the PNG's Helvetica or Arial alike. Centring the word in the
 * pill splits whatever the estimate misses between its two ends.
 */
const PILL_PAD_X = 28;
const PILL_HEIGHT = 60;
/** Between the heading's end and the pill. */
const PILL_GAP = 14;
/** From the pill's line to the first scope line: the pill stands taller than the text. */
const PILL_LEADING = 68;
/**
 * **Every donut is this size, in every figure and whatever the checkboxes hide**, so a Siswa and a
 * GTK-MS figure compare by eye (#514). Four fit across the view box with room between them and
 * under them for the longest label, Hands-on RBL. The ring is 36 wide; the hole holds the widest
 * score, "10.0" in bold at `VALUE_SIZE` — about 115 units — with room to spare.
 */
const DONUT_OUTER_RADIUS = 120;
const DONUT_INNER_RADIUS = 84;
const LABEL_SIZE = 30;
const LABEL_GAP = 20;
const VALUE_SIZE = 48;

/**
 * A text's width in view-box units, estimated: SVG cannot measure text without a DOM. 0.6 em per
 * character is an estimate, not a measurement. Checked in Chromium against Montserrat: a wrapped
 * long School name stayed inside the view box without overlapping (#510, #518).
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
 * A donut's filled part, `d` its path: the whole ring at 10.0 — one SVG arc cannot draw 360°, so it
 * is the track's own two circles — or a ring sector from 12 o'clock. Drawn with even-odd fill.
 */
export type ChartArc = { kind: "full" | "sector"; d: string };

/** Two decimals is far below a pixel at any size the figure is drawn. */
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * **The whole ring**: the outer circle and the hole's, each as two half-arcs, so one path outlines
 * both edges and even-odd fill leaves the hole empty.
 */
function ring(centre: Point): string {
  const circle = (radius: number) =>
    `M ${centre.x} ${centre.y - radius} ` +
    `A ${radius} ${radius} 0 1 0 ${centre.x} ${centre.y + radius} ` +
    `A ${radius} ${radius} 0 1 0 ${centre.x} ${centre.y - radius} Z`;
  return `${circle(DONUT_OUTER_RADIUS)} ${circle(DONUT_INNER_RADIUS)}`;
}

/**
 * **An arc filled to `value / 10` of the ring, like a progress indicator.** It starts at 12 o'clock
 * and runs counter-clockwise, toward 9 o'clock first — SVG's sweep flag 0 on screen — along the
 * outer edge, then a line in and back along the hole's edge. Its ends are flat: a rounded cap would
 * reach past the true angle by half the ring's width, so 0.3 would read as 1.0. 0.0 fills nothing,
 * so the donut is its bare track; `null` likewise, told apart only by its label.
 */
function arc(centre: Point, value: number | null): ChartArc | null {
  if (value === null || value <= 0) return null;
  if (value >= 10) return { kind: "full", d: ring(centre) };
  const angle = (value / 10) * 2 * Math.PI;
  const at = (radius: number) =>
    `${round(centre.x - radius * Math.sin(angle))} ${round(centre.y - radius * Math.cos(angle))}`;
  const large = value > 5 ? 1 : 0;
  const [outer, inner] = [DONUT_OUTER_RADIUS, DONUT_INNER_RADIUS];
  return {
    kind: "sector",
    d:
      `M ${centre.x} ${centre.y - outer} A ${outer} ${outer} 0 ${large} 0 ${at(outer)} ` +
      `L ${at(inner)} A ${inner} ${inner} 0 ${large} 1 ${centre.x} ${centre.y - inner} Z`,
  };
}

/** Where every part of a figure sits. A part its checkbox hides is `null`. */
export type ChartLayout = {
  title: {
    fontSize: number;
    /** `Feedback Peserta ·`, ending at `x` — right-anchored, so it never runs into the pill. */
    heading: Point & { text: string };
    /** The Tipe Peserta's filled rect, `x`/`y` its top left; the word centred on `textX`. */
    pill: {
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      textX: number;
      textY: number;
    };
    /** The School or `Semua Sekolah`, wrapped, then the Sesi if picked. */
    lines: string[];
    /** Each line's baseline, centred on `x`. */
    baselines: number[];
    x: number;
  } | null;
  /**
   * One donut per Aspect, in order — kept for an Aspect with no Rating, whose `arc` is `null` — and
   * none at all when the figure has no responses.
   */
  slots: {
    aspect: ParticipantFeedbackAspect;
    colour: string;
    centre: Point;
    outerRadius: number;
    innerRadius: number;
    /** The whole ring, always drawn: the track the arc fills. Even-odd fill. */
    track: string;
    arc: ChartArc | null;
    /** The score, centred in the hole: `y` is its baseline. */
    valueLabel: (Point & { text: string; fontSize: number }) | null;
    /** The Aspect's name under the donut, always: `y` is its baseline. */
    nameLabel: Point & { text: string; fontSize: number };
  }[];
  /** "Belum ada tanggapan", centred where the donuts would be, when the figure has no responses. */
  emptyNotice: (Point & { text: string }) | null;
};

/**
 * **A figure's layout in the fixed view box.** Top to bottom: the title block (Judul), then one row
 * of donuts, each with its score in its hole (Nilai) and its Aspect's name under it. The row is
 * centred in the room the title leaves; hiding it gives that room back, but **never changes a
 * donut's size**.
 */
export function chartLayout(figure: ChartFigure, parts: ChartParts): ChartLayout {
  const contentWidth = CHART_WIDTH - 2 * PAD;
  let cursor = PAD;

  let title: ChartLayout["title"] = null;
  if (parts.title) {
    // The first line — heading, gap, pill — is centred as a whole on the estimated widths.
    const { participantType } = figure;
    const { heading, scope } = figure.title;
    const headingWidth = textWidth(heading, TITLE_SIZE);
    const pillWidth = textWidth(participantType, TITLE_SIZE) + 2 * PILL_PAD_X;
    const left = (CHART_WIDTH - headingWidth - PILL_GAP - pillWidth) / 2;
    const pillX = left + headingWidth + PILL_GAP;
    const firstBaseline = cursor + TITLE_SIZE + 4;
    // Capitals stand about 0.7 em over the baseline; the pill is centred on them.
    const pillY = Math.round(firstBaseline - TITLE_SIZE * 0.35 - PILL_HEIGHT / 2);
    const lines = scope.flatMap((line) => wrap(line, TITLE_SIZE, contentWidth));
    const baselines = lines.map((_, index) => firstBaseline + PILL_LEADING + index * TITLE_LEADING);
    title = {
      fontSize: TITLE_SIZE,
      heading: { text: heading, x: pillX - PILL_GAP, y: firstBaseline },
      pill: {
        x: pillX,
        y: pillY,
        width: pillWidth,
        height: PILL_HEIGHT,
        text: participantType,
        textX: pillX + pillWidth / 2,
        textY: firstBaseline,
      },
      lines,
      baselines,
      x: CHART_WIDTH / 2,
    };
    // Past the last line's descenders, and no further: no blank line under the block.
    cursor = baselines.at(-1)! + TITLE_SIZE * 0.3;
  }

  // The row — donuts, then their labels — centred in what is left, or pinned to its top if a long
  // title leaves less than that.
  const top = cursor + 12;
  const bottom = CHART_HEIGHT - PAD;
  const rowHeight = 2 * DONUT_OUTER_RADIUS + LABEL_GAP + LABEL_SIZE;
  const centreY = Math.round(
    top + Math.max(0, (bottom - top - rowHeight) / 2) + DONUT_OUTER_RADIUS,
  );
  const slotWidth = contentWidth / figure.aspects.length;

  const slots = figure.empty
    ? []
    : figure.aspects.map((aspect, index) => {
        const centre = { x: PAD + slotWidth * (index + 0.5), y: centreY };
        return {
          aspect: aspect.aspect,
          colour: aspect.colour,
          centre,
          outerRadius: DONUT_OUTER_RADIUS,
          innerRadius: DONUT_INNER_RADIUS,
          track: ring(centre),
          arc: arc(centre, aspect.value),
          valueLabel: parts.values
            ? {
                text: aspect.valueLabel,
                fontSize: VALUE_SIZE,
                x: centre.x,
                y: centre.y + VALUE_SIZE * 0.35,
              }
            : null,
          nameLabel: {
            text: aspect.label,
            fontSize: LABEL_SIZE,
            x: centre.x,
            y: centre.y + DONUT_OUTER_RADIUS + LABEL_GAP + LABEL_SIZE * 0.8,
          },
        };
      });

  return {
    title,
    slots,
    emptyNotice: figure.empty
      ? { text: "Belum ada tanggapan", x: CHART_WIDTH / 2, y: (top + bottom) / 2 }
      : null,
  };
}
