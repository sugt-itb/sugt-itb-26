import type { AssessmentCompletion, MonitoringSession, ProgrammeDelivery } from "@sugt/db/queries";
import {
  ASSESSMENT_KINDS,
  type AssessmentKind,
  KEGIATAN_UNITS_PER_SCHOOL,
  PRETEST_PARTICIPANT_TYPES,
  SESSIONS_PER_SCHOOL,
  STREAMS,
  type SessionMode,
} from "@sugt/domain";

/**
 * **The Programme's progress figures — the one derivation two readers share (#503).** The
 * Dashboard (`/`, `app/(app)/dashboard-derive.ts`) shows their percentages; the Unified Dashboard's
 * summary route (`lib/unified-dashboard.ts`) shows the counts and percentages. Both fold the same
 * rows through `deriveProgress`, so the two cannot disagree. `/sekolah` and `/sekolah/[slug]` take
 * the same assessment rule per School (#540). Pure: no React, no database, and no money — which is
 * what lets the Unified Dashboard be handed it.
 */

/**
 * A count over its denominator, with the whole-number percent the screen shows — **computed from
 * those two numbers and nothing else**: `percent` is `count / total` rounded to a whole percent, or
 * 0 when `total` is 0. The Unified Dashboard (#503) shows all three; `/` shows the percent.
 */
export type Fraction = { count: number; total: number; percent: number };

/**
 * **The Programme's progress figures — the one derivation `/` and the Unified Dashboard share
 * (#503).** Every percentage the Pelaksanaan tab shows, each with the count and denominator behind
 * it. Nothing here reads money.
 */
export type ProgrammeProgress = {
  /** Kegiatan terlaksana — delivered Sessions plus all-or-nothing assessment units, over Schools × 10. */
  kegiatan: Fraction;
  /** Delivered offline Sessions over Schools × `SESSIONS_PER_SCHOOL.offline` — the Luring figure. */
  offline: Fraction;
  /** Delivered online Sessions over Schools × `SESSIONS_PER_SCHOOL.online` — the Daring figure. */
  online: Fraction;
  /** Schools with all four Pretest boxes ticked, over the School count (#551). */
  pretest: Fraction;
  /** Schools with all four Posttest boxes ticked, over the School count — an honest 0 until posttest rows exist. */
  posttest: Fraction;
};

/** `count` over `total` as a `Fraction`. A zero denominator is 0%, not a division by zero. */
function fraction(count: number, total: number): Fraction {
  return { count, total, percent: total === 0 ? 0 : Math.round((count / total) * 100) };
}

/**
 * How much of the programme is done — **Kegiatan terlaksana** — out of every School's ten units
 * (`KEGIATAN_UNITS_PER_SCHOOL`: 8 Sessions + a pretest unit + a posttest unit, ADR-0031/#249).
 * `completedUnits` is the numerator the caller assembles — delivered Sessions plus the assessment
 * units from `completedAssessmentUnits`. An empty programme is 0%, not a division by zero.
 */
export function kegiatanTerlaksana(completedUnits: number, schoolCount: number): Fraction {
  return fraction(completedUnits, schoolCount * KEGIATAN_UNITS_PER_SCHOOL);
}

/** Every `(stream, participant-type)` box a School must tick for one assessment kind to count. */
export const BOXES_PER_ASSESSMENT_UNIT = STREAMS.length * PRETEST_PARTICIPANT_TYPES.length;

/** How many of its boxes one School has ticked, for each assessment kind. */
export type AssessmentBoxes = Record<AssessmentKind, number>;

/** The boxes ticked among these rows, which are one School's. */
export function assessmentBoxes(completions: AssessmentCompletion[]): AssessmentBoxes {
  const boxes: AssessmentBoxes = { pretest: 0, posttest: 0 };
  for (const c of completions) boxes[c.kind]++;
  return boxes;
}

/** Each School's boxes. A School with none ticked has no entry. */
export function assessmentBoxesBySchool(
  completions: AssessmentCompletion[],
): Map<string, AssessmentBoxes> {
  const rowsBySchool = new Map<string, AssessmentCompletion[]>();
  for (const c of completions) {
    rowsBySchool.set(c.schoolId, [...(rowsBySchool.get(c.schoolId) ?? []), c]);
  }
  return new Map([...rowsBySchool].map(([id, rows]) => [id, assessmentBoxes(rows)]));
}

/**
 * The **all-or-nothing** assessment units one School has earned, the one place the rule lives
 * (ADR-0031/#249). It earns one unit for a kind only when **all four** of that kind's boxes
 * (STREAMS × PRETEST_PARTICIPANT_TYPES) are present; three of four contributes nothing. Written
 * generically over `ASSESSMENT_KINDS`, so **posttest is already counted** — it simply stays 0 until
 * posttest rows exist, which is what caps the KPI near 90% this iteration. The unique constraint on
 * the completion row means a `(school, kind)` count of `BOXES_PER_ASSESSMENT_UNIT` is exactly "all
 * four distinct boxes", so a plain tally is the rollup.
 */
function assessmentUnits(boxes: AssessmentBoxes): number {
  return ASSESSMENT_KINDS.filter((kind) => hasAssessmentUnit(boxes, kind)).length;
}

/** Whether one School has earned `kind`'s unit — all four of its boxes ticked, the rule above. */
function hasAssessmentUnit(boxes: AssessmentBoxes, kind: AssessmentKind): boolean {
  return boxes[kind] >= BOXES_PER_ASSESSMENT_UNIT;
}

/** The assessment units complete across all Schools, summed over both kinds. */
export function completedAssessmentUnits(completions: AssessmentCompletion[]): number {
  let units = 0;
  for (const boxes of assessmentBoxesBySchool(completions).values()) {
    units += assessmentUnits(boxes);
  }
  return units;
}

/**
 * **One School's Kegiatan terlaksana** (#540), the figure `/sekolah` and `/sekolah/[slug]` show over
 * `KEGIATAN_UNITS_PER_SCHOOL`: its delivered Sessions plus its assessment units, so these add up
 * across the Schools to the Dashboard's numerator. **Not capped**, as the Dashboard is not: the
 * Session limit is deliberately unenforced, so a School that over-delivers can read above its true
 * progress, or above 10. `undefined` is a School with no boxes ticked.
 */
export function schoolKegiatan(
  deliveredSessions: number,
  boxes: AssessmentBoxes | undefined,
): number {
  return deliveredSessions + (boxes === undefined ? 0 : assessmentUnits(boxes));
}

/**
 * A summary figure for one delivery mode (#313): every `delivered` Session of that mode over the
 * mode's capacity — `schoolCount × perSchool` (2 offline, 6 online), not the Sessions arranged so
 * far. Session-level, not all-or-nothing per School — the same `status === "delivered"` count
 * `deliveryMatrix` sums, just rolled up rather than split by Sesi and Cluster. Guards a 0-School
 * denominator at 0%.
 */
export function deliveryProgress(
  sessions: MonitoringSession[],
  mode: SessionMode,
  schoolCount: number,
  perSchool: number,
): Fraction {
  const delivered = sessions.filter((s) => s.mode === mode && s.status === "delivered").length;
  return fraction(delivered, schoolCount * perSchool);
}

/**
 * A summary figure for one assessment kind (#313, #551): the Schools that have earned that kind's
 * unit — **all four** `STREAMS × PRETEST_PARTICIPANT_TYPES` boxes ticked, the all-or-nothing rule
 * Kegiatan terlaksana and `/sekolah` use (ADR-0031) — over `schoolCount`. A School with three of
 * four boxes counts nothing, so the percent and the card's "{n}/{school count} sekolah" line always
 * agree. Posttest stays 0% until posttest rows exist, by construction. Guards a 0-School
 * denominator at 0%.
 */
export function assessmentProgress(
  completions: AssessmentCompletion[],
  kind: AssessmentKind,
  schoolCount: number,
): Fraction {
  let complete = 0;
  for (const boxes of assessmentBoxesBySchool(completions).values()) {
    if (hasAssessmentUnit(boxes, kind)) complete++;
  }
  return fraction(complete, schoolCount);
}

/**
 * Every progress figure, from the delivery rows and the completion rows (#503). `deriveDashboard`
 * takes its percentages from here, and the Unified Dashboard's summary route takes its counts and
 * percentages from here, so the two cannot disagree. Every denominator is the always-47 School count
 * times a programme constant, or the School count itself for pretest and posttest; posttest is
 * honestly 0 until posttest rows exist.
 */
export function deriveProgress(
  data: Pick<ProgrammeDelivery, "schools" | "sessions">,
  completions: AssessmentCompletion[],
): ProgrammeProgress {
  const schoolCount = data.schools.length;
  const deliveredTotal = data.sessions.filter((s) => s.status === "delivered").length;
  return {
    // Kegiatan terlaksana folds the all-or-nothing pretest/posttest units into the numerator, over
    // the ×10 denominator (ADR-0031/#249).
    kegiatan: kegiatanTerlaksana(
      deliveredTotal + completedAssessmentUnits(completions),
      schoolCount,
    ),
    offline: deliveryProgress(data.sessions, "offline", schoolCount, SESSIONS_PER_SCHOOL.offline),
    online: deliveryProgress(data.sessions, "online", schoolCount, SESSIONS_PER_SCHOOL.online),
    pretest: assessmentProgress(completions, "pretest", schoolCount),
    posttest: assessmentProgress(completions, "posttest", schoolCount),
  };
}
