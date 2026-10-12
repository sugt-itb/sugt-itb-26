import { participantScopeLabel, perjadinScopeLabel } from "-/components/feedback-scope";
import { sesiLabel } from "-/components/session-labels";
import { csvDocument, type CsvCell } from "-/lib/csv";
import {
  PARTICIPANT_ASPECT_LABELS,
  PARTICIPANT_CLASS_LABELS,
  PARTICIPANT_WRITTEN_QUESTIONS,
} from "-/lib/participant-feedback-copy";
import { perjadinName, slugify } from "-/lib/perjadin-name";
import type {
  FeedbackFilterValue,
  FeedbackPerjadinOption,
  FeedbackSchoolOption,
  ParticipantFeedbackRow,
  ParticipantFeedbackScope,
  PerjadinFeedbackRow,
  PerjadinFeedbackScope,
} from "@sugt/db/queries";

import { anyFilterOn } from "../feedback-params";

/**
 * **`/feedback`'s two exports, as pure text** (#490): one row per submission or evaluation, in the
 * order the query hands them over — the tab's own sort — written by the shared `csvDocument`, so
 * the files open in Excel as `/keuangan`'s and the Laporan's do. A Rating is a number cell; **one
 * that was not given is an empty cell, never 0** — Hands-on RBL outside Siswa, Penginapan on a day
 * trip, Bantuan Pendamping from a Pendamping or before #481. Rata-rata is the row's average over
 * the Ratings present, rounded to one decimal as the card shows it. Tanggal is the day it was
 * filed, the card's "Diisi".
 */

/** A Rating, or an empty cell when it was not given. */
const rating = (value: number | null): CsvCell => value ?? "";
/** Free text, or an empty cell when left empty. */
const text = (value: string | null): CsvCell => value ?? "";
/** The row average to one decimal, as `AverageBadge` shows it. */
const average = (value: number): CsvCell => Math.round(value * 10) / 10;

export function participantFeedbackCsv(rows: readonly ParticipantFeedbackRow[]): string {
  const aspect = PARTICIPANT_ASPECT_LABELS;
  return csvDocument([
    [
      "Tanggal",
      "Sekolah",
      "Sesi",
      "Tipe Peserta",
      "Nama",
      aspect.materials,
      `Komentar ${aspect.materials}`,
      aspect.instructor,
      `Komentar ${aspect.instructor}`,
      aspect.relevance,
      `Komentar ${aspect.relevance}`,
      aspect.hands_on_rbl,
      `Komentar ${aspect.hands_on_rbl}`,
      PARTICIPANT_WRITTEN_QUESTIONS.knowledgeGain.heading,
      PARTICIPANT_WRITTEN_QUESTIONS.suggestions.heading,
      "Rata-rata",
    ],
    ...rows.map((row) => [
      row.submittedOn,
      row.schoolName,
      sesiLabel({ ...row, mode: row.sessionMode }),
      PARTICIPANT_CLASS_LABELS[row.classKind],
      row.name,
      row.materials,
      text(row.materialsComment),
      row.instructor,
      text(row.instructorComment),
      row.relevance,
      text(row.relevanceComment),
      rating(row.handsOnRbl),
      text(row.handsOnRblComment),
      text(row.knowledgeGain),
      text(row.suggestions),
      average(row.rowAverage),
    ]),
  ]);
}

export function perjadinFeedbackCsv(rows: readonly PerjadinFeedbackRow[]): string {
  const aspects = [
    "Penginapan",
    "Transportasi",
    "Konsumsi",
    "Ketepatan Waktu",
    "Bantuan Pendamping",
  ] as const;
  return csvDocument([
    [
      "Tanggal",
      "Perjadin",
      "Peran",
      "Nama",
      ...aspects.flatMap((label) => [label, `Komentar ${label}`]),
      "Rata-rata",
    ],
    ...rows.map((row) => [
      row.createdOn,
      perjadinName(row),
      row.filedByRole,
      row.filedByName,
      rating(row.lodging),
      text(row.lodgingComment),
      row.transport,
      text(row.transportComment),
      row.meals,
      text(row.mealsComment),
      row.punctuality,
      text(row.punctualityComment),
      rating(row.pendampingSupport),
      text(row.pendampingSupportComment),
      average(row.rowAverage),
    ]),
  ]);
}

/**
 * The filter part of a file name, in `/keuangan`'s style: what the scope covers, slugified, then
 * `tersaring` when a score filter is on; `semua` with neither. A scope naming a School or trip the
 * picker does not know — an id with no responses — exports nothing, and says `tanpa-masukan`.
 */
function filterPart(
  label: string | null,
  unknown: boolean,
  filters: Record<string, FeedbackFilterValue>,
): string {
  const parts = [
    unknown ? "tanpa-masukan" : label === null ? null : slugify(label),
    anyFilterOn(filters) ? "tersaring" : null,
  ].filter((part): part is string => part !== null && part !== "");
  return parts.length > 0 ? parts.join("-") : "semua";
}

/** `feedback-peserta-<filter>-<today>.csv`; `today` is the WIB day. */
export function participantFeedbackCsvFileName(
  view: { scope: ParticipantFeedbackScope; filters: Record<string, FeedbackFilterValue> },
  schools: readonly FeedbackSchoolOption[],
  today: string,
): string {
  const { scope, filters } = view;
  const school = schools.find((option) => option.id === scope.schoolId);
  const unknown =
    (scope.schoolId !== null && school === undefined) ||
    (scope.sessionId !== null && !school?.sessions.some((option) => option.id === scope.sessionId));
  const label = participantScopeLabel(schools, scope);
  return `feedback-peserta-${filterPart(label, unknown, filters)}-${today}.csv`;
}

/** `feedback-perjadin-<filter>-<today>.csv`; `today` is the WIB day. */
export function perjadinFeedbackCsvFileName(
  view: { scope: PerjadinFeedbackScope; filters: Record<string, FeedbackFilterValue> },
  trips: readonly FeedbackPerjadinOption[],
  today: string,
): string {
  const { scope, filters } = view;
  const unknown =
    scope.perjadinId !== null && !trips.some((option) => option.id === scope.perjadinId);
  const label = perjadinScopeLabel(trips, scope);
  return `feedback-perjadin-${filterPart(label, unknown, filters)}-${today}.csv`;
}
