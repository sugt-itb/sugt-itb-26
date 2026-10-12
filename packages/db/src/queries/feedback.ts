import {
  type ClassKind,
  type PerjadinEvaluationRole,
  rankBySchool,
  type SessionMode,
  type TimeZone,
} from "@sugt/domain";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  ne,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { participantFeedback, perjadinEvaluation } from "../schema/evaluations";
import { province, school, subCluster } from "../schema/reference";
import { perjadin } from "../schema/travel";
import type { Person } from "./caller";
import { tripSchoolNames } from "./perjadin-naming";

/**
 * **The Feedback screen's Peserta tab** — every Participant's submission, lowest-average-first by
 * default (#184), read as a page rather than the whole set. This reads `participant_feedback` directly and for a
 * plain reason: `./participant-feedback.ts` is the write path and holds no read (ADR-0012 gives
 * a `ParticipantToken` write access and no read at all), so a screen that lists submissions
 * cannot route through it.
 *
 * **Why a page and not a one-round-trip whole set.** A submission is not rare: every Participant
 * of every delivered Session leaves one, so the set grows without bound and both the filters and
 * the paging live in the query rather than in memory on the screen. The four summary averages
 * are the exception (`participantFeedbackAverages` below): they follow the tab's **scope** — the
 * School, Session and Tipe Peserta it is narrowed to (#466, #487) — but never its score filters, so
 * they are one scalar read the score filters never touch.
 *
 * Open to anyone signed in, by ADR-0004 — feedback carries no money — so no `requireStaff`. The
 * `caller` is still first by convention 1 even though nothing here gates on it; it is named
 * `_caller` to say so, the way every read here does.
 *
 * **The Perjadin tab lives in this file too**, below its Peserta twin: the same OFFSET/LIMIT+BATCH+1
 * shape, the same `bound()` and `FeedbackFilterValue`, over `perjadin_evaluation` rather than
 * `participant_feedback`. It is the follow-up (#169) that retired the old `/concerns` page.
 *
 * **Paging is OFFSET/LIMIT, not keyset (#184).** The global sort (`FeedbackSort`) makes the row
 * average the primary sort key, and a direction-aware compound keyset over `{average, date, id}`
 * across the four sort combinations is a bug magnet. Both queries page by OFFSET instead: the
 * cursor is the count of rows already loaded, the ORDER BY ends in `id asc` for a total order so
 * OFFSET never drops or duplicates a row, and the dataset is bounded (one submission per
 * Participant/Session, one evaluation per filer/trip) so a scanned OFFSET is cheap enough.
 */

/** The batch size — how many rows a page holds. Ten fits the card list without crowding it. */
const BATCH = 10;

/**
 * The global sort both tabs share: the row **average** is the primary key and the filed/held date
 * is the tiebreak. `score` names the average's direction — `asc` puts the lowest average first —
 * and `date` the tiebreak's, `desc` being newest-first.
 */
export type FeedbackSort = { score: "asc" | "desc"; date: "asc" | "desc" };

/**
 * The default sort: lowest average first (`score: "asc"` — the concerns rise to the top), newest
 * first within a tie (`date: "desc"`). This is what the first server paint uses and what the client
 * seeds its own sort state to.
 */
export const DEFAULT_FEEDBACK_SORT: FeedbackSort = { score: "asc", date: "desc" };

/** One sort direction as its drizzle order helper — `asc` or `desc`, applied to the sort column. */
const dir = (d: "asc" | "desc") => (d === "asc" ? asc : desc);

/**
 * One filter's three-way choice. `all` is off; `le7` keeps rows at or below 7, `gt7` keeps
 * rows above it. The split is `<= 7` / `> 7` so the two non-`all` arms partition the scale
 * with no gap and no overlap — the same 7 the domain's concern threshold sits on.
 */
export type FeedbackFilterValue = "all" | "le7" | "gt7";

/**
 * The five filters, each independent and each ANDed with the others. `reviewType` gates on the
 * **row average** across the Ratings present; the other four gate on their own Aspect column. A
 * row with no Hands-on RBL Rating — GTK, MS, or Siswa filed before it existed (#446) — is in
 * neither `handsOnRbl` arm, since `null <= 7` and `null > 7` are both null. A screen sends all five
 * every time; `all` on any of them contributes no predicate.
 */
export type FeedbackFilters = {
  /** Gates on the present-Ratings average (`rowAverageExpr`) — the row's overall standing. */
  reviewType: FeedbackFilterValue;
  handsOnRbl: FeedbackFilterValue;
  instructor: FeedbackFilterValue;
  materials: FeedbackFilterValue;
  relevance: FeedbackFilterValue;
};

/** All filters off — the first page of everything, in the caller's chosen sort. */
export const NO_FEEDBACK_FILTERS: FeedbackFilters = {
  reviewType: "all",
  handsOnRbl: "all",
  instructor: "all",
  materials: "all",
  relevance: "all",
};

/**
 * **The Peserta tab's Tipe Peserta** (#487): the two-way split of the Daftar Hadir Peserta sheets and
 * `/keuangan`. `Siswa` is the Student Class; `GTK-MS` is the GTK and MS Classes together. A filter
 * value, not a stored one — a Participant still picks GTK, MS or Siswa — so it lives beside the query
 * rather than in `@sugt/domain`, whose sets are glossary terms or the values a column holds.
 */
export type FeedbackParticipantType = "Siswa" | "GTK-MS";

/** Which stored Classes each Tipe Peserta keeps. */
const PARTICIPANT_TYPE_CLASSES: Record<FeedbackParticipantType, ClassKind[]> = {
  Siswa: ["Student"],
  "GTK-MS": ["GTK", "MS"],
};

/**
 * **What the Peserta tab is narrowed to** (#466): one School, and within it one Session, and a Tipe
 * Peserta (#487). `null` is Semua. Unlike the score filters, the scope also narrows the four
 * averages. An id that names nothing — or is not an id at all — matches no row, so the tab reads
 * empty rather than failing: each is compared as text, so a malformed one never reaches a `uuid`
 * cast. A Tipe Peserta that names nothing matches no row either.
 */
export type ParticipantFeedbackScope = {
  schoolId: string | null;
  sessionId: string | null;
  participantType: FeedbackParticipantType | null;
};

/** Every School, every Session, every Tipe Peserta — the tab's first paint. */
export const NO_PARTICIPANT_FEEDBACK_SCOPE: ParticipantFeedbackScope = {
  schoolId: null,
  sessionId: null,
  participantType: null,
};

/** The scope's predicates over the joined `session` and the row's Class, or none for Semua. */
function participantScopeConditions(scope: ParticipantFeedbackScope): SQL[] {
  return [
    scope.schoolId === null ? null : sql`${session.schoolId}::text = ${scope.schoolId}`,
    scope.sessionId === null ? null : sql`${session.id}::text = ${scope.sessionId}`,
    scope.participantType === null ? null : participantTypeCondition(scope.participantType),
  ].filter((condition): condition is SQL => condition !== null);
}

/** The Classes a Tipe Peserta keeps, or none when the value is not one — a Server Action's input. */
function participantTypeCondition(participantType: FeedbackParticipantType): SQL {
  return Object.hasOwn(PARTICIPANT_TYPE_CLASSES, participantType)
    ? inArray(participantFeedback.classKind, PARTICIPANT_TYPE_CLASSES[participantType])
    : sql`false`;
}

/**
 * A Session's zone as the screen shows it: an **online** Session is always WIB (CONTEXT.md, Session;
 * #283), an offline one is in its School's Province's zone. Reads `session` and `province`, so the
 * enclosing query joins both.
 */
const sessionTimeZoneExpr = sql<TimeZone>`case when ${session.mode} = 'online' then 'WIB' else ${province.timeZone} end`;

/**
 * **Each of `schoolIds`' live Sessions' Sesi** (ADR-0027), by Session id: the School's date rank
 * within its mode, over **all** its live Sessions of that mode, by `rankBySchool` — the one ranking,
 * so a Session carries the number the `/monitoring` matrix and the planning note give it. A cancelled
 * Session has none.
 */
async function sesiNumbers(schoolIds: string[]): Promise<Map<string, number>> {
  const numbers = new Map<string, number>();
  if (schoolIds.length === 0) return numbers;
  const live = await db
    .select({
      id: session.id,
      schoolId: session.schoolId,
      mode: session.mode,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
    })
    .from(session)
    .where(and(inArray(session.schoolId, schoolIds), ne(session.status, "cancelled")));
  for (const mode of ["offline", "online"] as const) {
    for (const ranked of rankBySchool(live.filter((row) => row.mode === mode)).values()) {
      ranked.forEach((row, index) => numbers.set(row.id, index + 1));
    }
  }
  return numbers;
}

/**
 * How many rows a page has already loaded — the OFFSET the next page skips. A number, not a
 * keyset (#184): the global sort makes the row average the primary key, so a compound keyset over
 * `{average, date, id}` across four sort combinations is a bug magnet; OFFSET over a total order
 * (the ORDER BY ends in `id asc`) drops and duplicates nothing on this bounded dataset. `null`
 * asks for the first page; a returned cursor is the running count to pass back for the next one.
 */
export type FeedbackCursor = number;

/** One Participant's submission, as the card renders it. */
export type ParticipantFeedbackRow = {
  id: string;
  /** The Participant's own typed name — referenced by nothing, exactly as stored. */
  name: string;
  classKind: ClassKind;
  /** The School the Session was at — what the Sekolah filter narrows on (#466). */
  schoolId: string;
  schoolName: string;
  /** The Session the feedback was filed against — the origin the card links through to (#194). */
  sessionId: string;
  sessionMode: SessionMode;
  /** The Session's Sesi (ADR-0027, `rankBySchool`); `null` once it is cancelled. */
  sesi: number | null;
  /** The Session's date as `YYYY-MM-DD`; a `date` column, so already a string. */
  heldOn: string;
  /** The Session's wall-clock start time (`HH:MM:SS`), for `formatSessionStartTime`. */
  startsAt: string;
  /** The zone `startsAt` is in: WIB for an online Session, else the School's Province's. */
  timeZone: TimeZone;
  /** The Student Class's alone (#446); null on GTK, MS and Siswa rows filed before it existed. */
  handsOnRbl: number | null;
  materials: number;
  instructor: number;
  relevance: number;
  /** The mean of the Ratings present, computed in SQL as numeric and mapped to Number. */
  rowAverage: number;
  handsOnRblComment: string | null;
  materialsComment: string | null;
  instructorComment: string | null;
  relevanceComment: string | null;
  /** The two written answers (#446): not Aspects, never averaged. Null when left empty. */
  knowledgeGain: string | null;
  suggestions: string | null;
  /** `submitted_at` as `YYYY-MM-DD`, rendered in SQL — the "Diisi" date the card shows. */
  submittedOn: string;
  submittedAt: Date;
};

/**
 * The raw, unrounded row average — the expression `reviewType` gates on and the row carries —
 * **over the Ratings present**, as `perjadinRowAverageExpr` is for a missing `lodging`. A row with
 * no Hands-on RBL Rating averages its three; one with it, all four. A missing Rating never counts
 * as 0.
 */
const rowAverageExpr = sql<number>`(${participantFeedback.materials} + ${participantFeedback.instructor} + ${participantFeedback.relevance} + coalesce(${participantFeedback.handsOnRbl}, 0)) / (3.0 + (case when ${participantFeedback.handsOnRbl} is null then 0 else 1 end))`;

/**
 * Turn one filter into its predicate, or `null` when it is `all`. `le7` → `<= 7`, `gt7` → `> 7`,
 * against whatever expression the caller passes — an Aspect column for every filter but one, the
 * row-average expression for `reviewType`.
 */
function bound(value: FeedbackFilterValue, expr: SQLWrapper): SQL | null {
  if (value === "le7") return sql`${expr} <= 7`;
  if (value === "gt7") return sql`${expr} > 7`;
  return null;
}

/**
 * One page of Participant Feedback, filtered and sorted by the caller's `FeedbackSort`, OFFSET-paged.
 *
 * **The filters AND together and only the active ones appear in the WHERE.** Each `all` filter
 * drops out; what remains is conjoined. `reviewType` gates on the raw (unrounded) row average so
 * the cut matches the number the card shows before it is rounded for display.
 *
 * **The sort is compound: row average primary, `submitted_at` secondary, `id` last (#184).** The
 * caller's `sort.score` and `sort.date` set the first two directions; the final `id asc` is fixed
 * and makes the order total — no two rows compare equal — which is what lets OFFSET page safely.
 *
 * **Paging is OFFSET/LIMIT, not keyset.** The average being the primary key would need a
 * direction-aware compound keyset over `{average, date, id}` across four sort combinations, a bug
 * magnet the ruling on #184 traded away. The cursor is the count of rows already loaded, passed as
 * the OFFSET; the total order above means one page read drops or duplicates nothing. What OFFSET
 * gives up versus keyset is insert-stability — a submission arriving before the current offset
 * between two "load more" clicks shifts the boundary, so a row could repeat or be skipped. On this
 * bounded, near-static dataset (one submission per Participant/Session) that window is acceptable,
 * which is exactly the trade #184 made.
 *
 * **Fetch one more than the batch to know whether there is a next page.** The query asks for
 * `BATCH + 1` rows; if it gets them, the extra one proves a next page exists — so the extra is
 * dropped and the cursor advances by `BATCH`. The 11th row never leaves this function.
 */
export async function participantFeedbackPage(
  _caller: Person,
  args: {
    filters: FeedbackFilters;
    scope: ParticipantFeedbackScope;
    cursor: FeedbackCursor | null;
    sort: FeedbackSort;
  },
): Promise<{ rows: ParticipantFeedbackRow[]; nextCursor: FeedbackCursor | null }> {
  const { cursor } = args;
  const rows = await participantFeedbackRows(args, { limit: BATCH + 1, offset: cursor ?? 0 });

  // The (BATCH + 1)th row is the proof a next page exists, never a row to show. Drop it and advance
  // the cursor by one batch; short of a full-plus-one batch there is no next page.
  return {
    rows: await withSesi(rows.slice(0, BATCH)),
    nextCursor: rows.length > BATCH ? (cursor ?? 0) + BATCH : null,
  };
}

/**
 * **Every Participant Feedback row the Peserta tab's choices match** (#490), for its CSV: the same
 * scope, score filters and sort as `participantFeedbackPage` — the one read below, so the file and
 * the screen cannot disagree — with no page. Open to anyone signed in, as the page.
 */
export async function participantFeedbackExport(
  _caller: Person,
  args: { filters: FeedbackFilters; scope: ParticipantFeedbackScope; sort: FeedbackSort },
): Promise<ParticipantFeedbackRow[]> {
  return withSesi(await participantFeedbackRows(args, null));
}

/** Each row with its Session's Sesi, read once for the Schools the rows are at. */
async function withSesi(
  rows: Omit<ParticipantFeedbackRow, "sesi">[],
): Promise<ParticipantFeedbackRow[]> {
  const sesi = await sesiNumbers([...new Set(rows.map((row) => row.schoolId))]);
  return rows.map((row) => ({ ...row, sesi: sesi.get(row.sessionId) ?? null }));
}

/**
 * The Peserta rows the scope and score filters match, in the sort's order — a window of them for a
 * page, or all of them (`window` null) for the export. Both readers go through here.
 */
async function participantFeedbackRows(
  args: { filters: FeedbackFilters; scope: ParticipantFeedbackScope; sort: FeedbackSort },
  window: { limit: number; offset: number } | null,
) {
  const { filters, scope, sort } = args;

  // Each `all` filter yields `null` and is filtered out below; the active ones are conjoined by a
  // single `!= null` at the `where`, with the scope's (#466).
  const conditions: (SQL | null | undefined)[] = [
    ...participantScopeConditions(scope),
    bound(filters.reviewType, rowAverageExpr),
    bound(filters.handsOnRbl, participantFeedback.handsOnRbl),
    bound(filters.instructor, participantFeedback.instructor),
    bound(filters.materials, participantFeedback.materials),
    bound(filters.relevance, participantFeedback.relevance),
  ];

  const query = db
    .select({
      id: participantFeedback.id,
      name: participantFeedback.name,
      classKind: participantFeedback.classKind,
      schoolId: school.id,
      schoolName: school.name,
      // The Session this feedback was filed against, so the card can link through to it (#194). The
      // `session` table is already inner-joined below, so this is just another selected column.
      sessionId: session.id,
      sessionMode: session.mode,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
      timeZone: sessionTimeZoneExpr,
      // The smallint columns already read back as `number` (or null for `handsOnRbl`); the row
      // average is a numeric expression, so only it needs the explicit `.mapWith(Number)`.
      handsOnRbl: participantFeedback.handsOnRbl,
      materials: participantFeedback.materials,
      instructor: participantFeedback.instructor,
      relevance: participantFeedback.relevance,
      rowAverage: rowAverageExpr.mapWith(Number),
      handsOnRblComment: participantFeedback.handsOnRblComment,
      materialsComment: participantFeedback.materialsComment,
      instructorComment: participantFeedback.instructorComment,
      relevanceComment: participantFeedback.relevanceComment,
      knowledgeGain: participantFeedback.knowledgeGain,
      suggestions: participantFeedback.suggestions,
      // The filed instant as a `YYYY-MM-DD` string in SQL — the "Diisi" date the card shows,
      // mirroring how the Perjadin tab renders `createdOn`.
      submittedOn: sql<string>`to_char(${participantFeedback.submittedAt}, 'YYYY-MM-DD')`,
      submittedAt: participantFeedback.submittedAt,
    })
    .from(participantFeedback)
    .innerJoin(session, eq(session.id, participantFeedback.sessionId))
    .innerJoin(school, eq(school.id, session.schoolId))
    // The School's Province carries an offline Session's Time Zone. NOT NULL both ways, so an inner
    // join.
    .innerJoin(province, eq(province.code, school.provinceCode))
    .where(and(...conditions.filter((c): c is SQL => c != null)))
    // Average primary, filed date secondary, id last for a total order OFFSET can page safely.
    .orderBy(
      dir(sort.score)(rowAverageExpr),
      dir(sort.date)(participantFeedback.submittedAt),
      asc(participantFeedback.id),
    )
    .$dynamic();

  return window ? query.limit(window.limit).offset(window.offset) : query;
}

/** The Peserta tab's four summary averages. Hands-on RBL's is `null` until any row has one. */
export type ParticipantFeedbackAverages = {
  handsOnRbl: number | null;
  instructor: number;
  materials: number;
  relevance: number;
};

/**
 * **The four summary averages, over the tab's scope and never its score filters** (#466). With no
 * School, Session or Tipe Peserta picked they are programme-wide, over the whole
 * `participant_feedback` table; a scope narrows them to its School, Session or Tipe Peserta (#487),
 * so under GTK-MS Hands-on RBL is `null`. The score filters are deliberately not an argument:
 * averaging only the rows at or below 7 would read as the standing and mislead.
 *
 * An empty table makes `avg()` return NULL; `coalesce(…, 0)` turns that into `0` for the three
 * every row has, so the caller gets numbers to format rather than a null to guard. Zero is outside
 * the 1–10 scale, so "0.0" on an empty dataset reads as "nothing yet" rather than as a real low
 * score. **Hands-on RBL's average is over the rows that have one** (#446) — `avg()` skips a null,
 * so GTK, MS and older Siswa rows never count as 0 — and stays `null`, shown as "—", while none do.
 */
export async function participantFeedbackAverages(
  _caller: Person,
  scope: ParticipantFeedbackScope,
): Promise<ParticipantFeedbackAverages> {
  const [row] = await db
    .select({
      handsOnRbl: sql<number | null>`avg(${participantFeedback.handsOnRbl})`.mapWith((value) =>
        value === null ? null : Number(value),
      ),
      instructor: sql<number>`coalesce(avg(${participantFeedback.instructor}), 0)`.mapWith(Number),
      materials: sql<number>`coalesce(avg(${participantFeedback.materials}), 0)`.mapWith(Number),
      relevance: sql<number>`coalesce(avg(${participantFeedback.relevance}), 0)`.mapWith(Number),
    })
    .from(participantFeedback)
    .innerJoin(session, eq(session.id, participantFeedback.sessionId))
    .where(and(...participantScopeConditions(scope)));

  return row ?? { handsOnRbl: null, instructor: 0, materials: 0, relevance: 0 };
}

/**
 * The six Perjadin filters, each independent and each ANDed with the others — one per Aspect, the
 * four logistics ones and Pendamping Support (#482), and `reviewType`, which gates on the **row
 * average** across the ratings that are present (see `perjadinRowAverageExpr`); the other five gate
 * on their own Aspect column. A screen sends all six every time; `all` on any of them contributes no
 * predicate.
 */
export type PerjadinFeedbackFilters = {
  /** Gates on the present-ratings average — the row's overall standing. */
  reviewType: FeedbackFilterValue;
  lodging: FeedbackFilterValue;
  transport: FeedbackFilterValue;
  meals: FeedbackFilterValue;
  punctuality: FeedbackFilterValue;
  /** Narasumber and Pimpinan only (ADR-0054): a row without one is in neither arm, as for `lodging`. */
  pendampingSupport: FeedbackFilterValue;
};

/** All Perjadin filters off — the first page of everything, in the caller's chosen sort. */
export const NO_PERJADIN_FEEDBACK_FILTERS: PerjadinFeedbackFilters = {
  reviewType: "all",
  lodging: "all",
  transport: "all",
  meals: "all",
  punctuality: "all",
  pendampingSupport: "all",
};

/**
 * **What the Perjadin tab is narrowed to** (#466): one trip, and one self-declared `filed_by_role`.
 * `null` is Semua. There is no School: an evaluation is about a whole trip, often over several
 * Schools, and the Perjadin picker already finds a trip by its Schools. Like the Peserta scope it
 * narrows the averages too, and a value that names nothing — compared as text — matches no row.
 */
export type PerjadinFeedbackScope = {
  perjadinId: string | null;
  role: PerjadinEvaluationRole | null;
};

/** Every trip, every Peran — the tab's first paint. */
export const NO_PERJADIN_FEEDBACK_SCOPE: PerjadinFeedbackScope = { perjadinId: null, role: null };

/** The scope's predicates over `perjadin_evaluation`, or none for Semua. */
function perjadinScopeConditions(scope: PerjadinFeedbackScope): SQL[] {
  return [
    scope.perjadinId === null
      ? null
      : sql`${perjadinEvaluation.perjadinId}::text = ${scope.perjadinId}`,
    scope.role === null ? null : sql`${perjadinEvaluation.filedByRole} = ${scope.role}`,
  ].filter((condition): condition is SQL => condition !== null);
}

/**
 * How many Perjadin rows a page has already loaded — the OFFSET the next page skips, the twin of
 * `FeedbackCursor`. A number, not a keyset (#184): the same reasoning as the Peserta tab, over
 * `perjadin_evaluation` rather than `participant_feedback`. `null` asks for the first page.
 */
export type PerjadinFeedbackCursor = number;

/** One Perjadin Evaluation, as the card renders it. */
export type PerjadinFeedbackRow = {
  id: string;
  /** The filer's own typed name (ADR-0024), exactly as stored — referenced by nothing. */
  filedByName: string;
  /** The self-declared role, stored as one of three Indonesian words — shown as-is. */
  filedByRole: PerjadinEvaluationRole;
  /** The trip is named `{subClusterName} · {dates}` (ADR-0044), from the joined `sub_cluster`. */
  subClusterName: string;
  /** The trip's id, for the card's link to `/perjadin/[id]`. */
  perjadinId: string;
  /** The trip's start date as `YYYY-MM-DD`, from the joined `perjadin` — a `date` column, so a string. */
  startsOn: string;
  /** The trip's end date as `YYYY-MM-DD`, from the joined `perjadin` — the name's second date. */
  endsOn: string;
  /** `created_at` as `YYYY-MM-DD`, rendered in SQL — the "Diisi" date the card shows. */
  createdOn: string;
  /** Nullable: a day trip with no hotel leaves it null and omits the row. */
  lodging: number | null;
  transport: number;
  meals: number;
  punctuality: number;
  /**
   * Nullable: a Pendamping is not asked it (ADR-0054), and an evaluation filed before #481 holds
   * none. Like a null `lodging`, the card omits the row.
   */
  pendampingSupport: number | null;
  /** The present-ratings average, computed in SQL as numeric and mapped to Number. */
  rowAverage: number;
  lodgingComment: string | null;
  transportComment: string | null;
  mealsComment: string | null;
  punctualityComment: string | null;
  pendampingSupportComment: string | null;
};

/**
 * The raw, unrounded Perjadin row average — **over the ratings that are present**. Two Aspects may
 * be null: `lodging` on a day trip with no hotel, and `pendamping_support` from a Pendamping or on
 * an evaluation filed before #481 (ADR-0054). Neither may count as a zero or as a divisor: the
 * numerator `coalesce`s each to 0 and the denominator counts only the present ones, so a row
 * averages over three, four or five ratings. `reviewType` gates on this, and the row carries it.
 */
const perjadinRowAverageExpr = sql<number>`(${perjadinEvaluation.transport} + ${perjadinEvaluation.meals} + ${perjadinEvaluation.punctuality} + coalesce(${perjadinEvaluation.lodging}, 0) + coalesce(${perjadinEvaluation.pendampingSupport}, 0)) / (3.0 + (case when ${perjadinEvaluation.lodging} is null then 0 else 1 end) + (case when ${perjadinEvaluation.pendampingSupport} is null then 0 else 1 end))`;

/**
 * One page of Perjadin Evaluations, filtered and sorted by the caller's `FeedbackSort`, OFFSET-paged
 * — the twin of `participantFeedbackPage`, over `perjadin_evaluation` joined to `perjadin` and its
 * `sub_cluster` for the trip's name (ADR-0044) and the link target.
 *
 * **The six filters AND together and only the active ones appear in the WHERE.** Each `all` drops
 * out. `reviewType` gates on the present-ratings average so the cut matches the number the card
 * shows before rounding. **A null-`lodging` row is naturally excluded from both lodging arms**:
 * `lodging <= 7` and `lodging > 7` are each NULL for it, so a `lodging` filter never keeps a day
 * trip with no hotel — no explicit null guard is needed. A null `pendamping_support` falls out of
 * both of its arms the same way.
 *
 * **The sort is compound: row average primary, `created_at` secondary, `id` last (#184)** — the
 * caller's `sort.score` and `sort.date` set the first two directions, the fixed `id asc` makes the
 * order total. **Paging is OFFSET/LIMIT, not keyset**, for the same reason as the Peserta tab: the
 * cursor is the count of rows already loaded, passed as the OFFSET, and the total order means OFFSET
 * drops or duplicates nothing. Fetch `BATCH + 1` to learn whether a next page exists; drop the
 * sentinel and advance the cursor by one batch.
 */
export async function perjadinFeedbackPage(
  _caller: Person,
  args: {
    filters: PerjadinFeedbackFilters;
    scope: PerjadinFeedbackScope;
    cursor: PerjadinFeedbackCursor | null;
    sort: FeedbackSort;
  },
): Promise<{ rows: PerjadinFeedbackRow[]; nextCursor: PerjadinFeedbackCursor | null }> {
  const { cursor } = args;
  const rows = await perjadinFeedbackRows(args, { limit: BATCH + 1, offset: cursor ?? 0 });

  // The (BATCH + 1)th row proves a next page exists; it is never shown. Drop it and advance the
  // cursor by one batch; short of a full-plus-one batch there is no next page.
  if (rows.length > BATCH) {
    return { rows: rows.slice(0, BATCH), nextCursor: (cursor ?? 0) + BATCH };
  }
  return { rows, nextCursor: null };
}

/**
 * **Every Perjadin Evaluation the Perjadin tab's choices match** (#490), for its CSV — the twin of
 * `participantFeedbackExport`: the page's scope, score filters and sort through the same read, with
 * no page.
 */
export async function perjadinFeedbackExport(
  _caller: Person,
  args: { filters: PerjadinFeedbackFilters; scope: PerjadinFeedbackScope; sort: FeedbackSort },
): Promise<PerjadinFeedbackRow[]> {
  return perjadinFeedbackRows(args, null);
}

/**
 * The Perjadin rows the choices match, in order — a page's window, or all of them for the export.
 */
async function perjadinFeedbackRows(
  args: { filters: PerjadinFeedbackFilters; scope: PerjadinFeedbackScope; sort: FeedbackSort },
  window: { limit: number; offset: number } | null,
): Promise<PerjadinFeedbackRow[]> {
  const { filters, scope, sort } = args;

  const conditions: (SQL | null | undefined)[] = [
    ...perjadinScopeConditions(scope),
    bound(filters.reviewType, perjadinRowAverageExpr),
    bound(filters.lodging, perjadinEvaluation.lodging),
    bound(filters.transport, perjadinEvaluation.transport),
    bound(filters.meals, perjadinEvaluation.meals),
    bound(filters.punctuality, perjadinEvaluation.punctuality),
    bound(filters.pendampingSupport, perjadinEvaluation.pendampingSupport),
  ];

  const query = db
    .select({
      id: perjadinEvaluation.id,
      filedByName: perjadinEvaluation.filedByName,
      filedByRole: perjadinEvaluation.filedByRole,
      subClusterName: subCluster.name,
      perjadinId: perjadinEvaluation.perjadinId,
      // The trip's window, from the joined `perjadin` — both `date` columns, so already strings.
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      // The filed instant rendered to a `YYYY-MM-DD` string in SQL — the "Diisi" date the card shows.
      createdOn: sql<string>`to_char(${perjadinEvaluation.createdAt}, 'YYYY-MM-DD')`.mapWith(
        String,
      ),
      // The smallint columns already read back as `number` (or null for `lodging` and
      // `pendampingSupport`); the row average is a numeric expression, so only it needs the explicit
      // `.mapWith(Number)`.
      lodging: perjadinEvaluation.lodging,
      transport: perjadinEvaluation.transport,
      meals: perjadinEvaluation.meals,
      punctuality: perjadinEvaluation.punctuality,
      pendampingSupport: perjadinEvaluation.pendampingSupport,
      rowAverage: perjadinRowAverageExpr.mapWith(Number),
      lodgingComment: perjadinEvaluation.lodgingComment,
      transportComment: perjadinEvaluation.transportComment,
      mealsComment: perjadinEvaluation.mealsComment,
      punctualityComment: perjadinEvaluation.punctualityComment,
      pendampingSupportComment: perjadinEvaluation.pendampingSupportComment,
    })
    .from(perjadinEvaluation)
    .innerJoin(perjadin, eq(perjadin.id, perjadinEvaluation.perjadinId))
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(and(...conditions.filter((c): c is SQL => c != null)))
    // Average primary, filed date secondary, id last for a total order OFFSET can page safely.
    .orderBy(
      dir(sort.score)(perjadinRowAverageExpr),
      dir(sort.date)(perjadinEvaluation.createdAt),
      asc(perjadinEvaluation.id),
    )
    .$dynamic();

  return window ? query.limit(window.limit).offset(window.offset) : query;
}

/** The Perjadin tab's five summary averages. Pendamping Support's is `null` while no row has one. */
export type PerjadinFeedbackAverages = {
  lodging: number;
  transport: number;
  meals: number;
  punctuality: number;
  pendampingSupport: number | null;
};

/**
 * **The five Perjadin summary averages, over the tab's scope and never its score filters** (#466),
 * as the Peserta tab's are: programme-wide with no trip or Peran picked, narrowed to them once one
 * is. The score filters are not an argument, so the cards never average only the low rows.
 *
 * `avg(lodging)` ignores NULL naturally — a day trip with no hotel is not a zero in the hotel
 * average, it is simply not in it. `coalesce(…, 0)` turns the empty-table NULL into `0` for the
 * four logistics Aspects, so the caller gets numbers to format; "0.0" reads as "nothing yet" rather
 * than a real low score. **Pendamping Support's average is over the rows that have one** (#482)
 * and stays `null`, shown as "—", while none in scope does — as Hands-on RBL's is on the Peserta
 * tab. Under Peran Pendamping it is always "—": a Pendamping is never asked it (ADR-0054).
 */
export async function perjadinFeedbackAverages(
  _caller: Person,
  scope: PerjadinFeedbackScope,
): Promise<PerjadinFeedbackAverages> {
  const [row] = await db
    .select({
      lodging: sql<number>`coalesce(avg(${perjadinEvaluation.lodging}), 0)`.mapWith(Number),
      transport: sql<number>`coalesce(avg(${perjadinEvaluation.transport}), 0)`.mapWith(Number),
      meals: sql<number>`coalesce(avg(${perjadinEvaluation.meals}), 0)`.mapWith(Number),
      punctuality: sql<number>`coalesce(avg(${perjadinEvaluation.punctuality}), 0)`.mapWith(Number),
      pendampingSupport: sql<number | null>`avg(${perjadinEvaluation.pendampingSupport})`.mapWith(
        (value) => (value === null ? null : Number(value)),
      ),
    })
    .from(perjadinEvaluation)
    .where(and(...perjadinScopeConditions(scope)));

  return row ?? { lodging: 0, transport: 0, meals: 0, punctuality: 0, pendampingSupport: null };
}

/** One Session a Peserta response was filed against, as the Sesi picker offers it (#466). */
export type FeedbackSessionOption = {
  id: string;
  mode: SessionMode;
  /** Its Sesi (ADR-0027), the number on the response cards; `null` once it is cancelled. */
  sesi: number | null;
  heldOn: string;
  startsAt: string;
  /** WIB for an online Session, else the School's Province's zone, as on the cards. */
  timeZone: TimeZone;
};

/** One School with Peserta responses, and the Sessions it has them for, in date order. */
export type FeedbackSchoolOption = {
  id: string;
  name: string;
  /** Searched beside the name, as every School picker does. */
  kabupatenKota: string;
  sessions: FeedbackSessionOption[];
};

/**
 * **The Peserta tab's Sekolah and Sesi pickers** (#466): every School with at least one response,
 * by name, each with the Sessions — offline and online alike, by date — it has responses for. Only
 * those, so a pick never reads empty. One read for both pickers: picking a School then needs no
 * round trip to list its Sessions.
 */
export async function participantFeedbackSchools(_caller: Person): Promise<FeedbackSchoolOption[]> {
  const rows = await db
    .selectDistinct({
      schoolId: school.id,
      schoolName: school.name,
      kabupatenKota: school.kabupatenKota,
      id: session.id,
      mode: session.mode,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
      timeZone: sessionTimeZoneExpr,
    })
    .from(participantFeedback)
    .innerJoin(session, eq(session.id, participantFeedback.sessionId))
    .innerJoin(school, eq(school.id, session.schoolId))
    .innerJoin(province, eq(province.code, school.provinceCode))
    .orderBy(
      asc(school.name),
      asc(school.id),
      asc(session.heldOn),
      asc(session.startsAt),
      asc(session.id),
    );

  const sesi = await sesiNumbers([...new Set(rows.map((row) => row.schoolId))]);
  const schools: FeedbackSchoolOption[] = [];
  for (const { schoolId, schoolName, kabupatenKota, ...option } of rows) {
    const sessionOption = { ...option, sesi: sesi.get(option.id) ?? null };
    const last = schools.at(-1);
    if (last?.id === schoolId) last.sessions.push(sessionOption);
    else schools.push({ id: schoolId, name: schoolName, kabupatenKota, sessions: [sessionOption] });
  }
  return schools;
}

/** One trip with Perjadin Evaluations, as the Perjadin picker offers it (#466). */
export type FeedbackPerjadinOption = {
  id: string;
  /** The trip is named `{subClusterName} · {dates}` (ADR-0044). */
  subClusterName: string;
  startsOn: string;
  endsOn: string;
  /** The trip's Schools (`tripSchoolNames`): the picker's second line, and searched. */
  schoolNames: string[];
};

/**
 * **The Perjadin tab's Perjadin picker** (#466): every trip with at least one evaluation, earliest
 * first, with what its name (ADR-0044) and its School line are built from.
 */
export async function perjadinFeedbackTrips(_caller: Person): Promise<FeedbackPerjadinOption[]> {
  return db
    .select({
      id: perjadin.id,
      subClusterName: subCluster.name,
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      schoolNames: tripSchoolNames(perjadin.id),
    })
    .from(perjadin)
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(
      exists(
        db
          .select({ id: perjadinEvaluation.id })
          .from(perjadinEvaluation)
          .where(eq(perjadinEvaluation.perjadinId, perjadin.id)),
      ),
    )
    .orderBy(asc(perjadin.startsOn), asc(perjadin.id));
}
