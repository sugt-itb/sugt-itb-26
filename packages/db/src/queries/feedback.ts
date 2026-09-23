import type { ClassKind, PerjadinEvaluationRole, SessionMode, TimeZone } from "@sugt/domain";
import { and, asc, desc, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { participantFeedback, perjadinEvaluation } from "../schema/evaluations";
import { province, school } from "../schema/reference";
import { perjadin } from "../schema/travel";
import type { Person } from "./caller";

/**
 * **The Feedback screen's Peserta tab** — every Participant's submission, lowest-average-first by
 * default (#184), read as a page rather than the whole set. This reads `participant_feedback` directly and for a
 * plain reason: `./participant-feedback.ts` is the write path and holds no read (ADR-0012 gives
 * a `ParticipantToken` write access and no read at all), so a screen that lists submissions
 * cannot route through it.
 *
 * **Why a page and not a one-round-trip whole set.** A submission is not rare: every Participant
 * of every delivered Session leaves one, so the set grows without bound and both the filters and
 * the paging live in the query rather than in memory on the screen. The three summary averages
 * are the exception (`participantFeedbackAverages` below): they are dataset-wide and unfiltered,
 * so they are one scalar read the page filters never touch.
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
 * The four filters, each independent and each ANDed with the others. `reviewType` gates on the
 * **row average** across the three Aspects; the other three gate on their own Aspect column.
 * A screen sends all four every time; `all` on any of them contributes no predicate.
 */
export type FeedbackFilters = {
  /** Gates on `(materials + instructor + relevance) / 3` — the row's overall standing. */
  reviewType: FeedbackFilterValue;
  instructor: FeedbackFilterValue;
  materials: FeedbackFilterValue;
  relevance: FeedbackFilterValue;
};

/** All filters off — the first page of everything, in the caller's chosen sort. */
export const NO_FEEDBACK_FILTERS: FeedbackFilters = {
  reviewType: "all",
  instructor: "all",
  materials: "all",
  relevance: "all",
};

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
  schoolName: string;
  /** The Session the feedback was filed against — the origin the card links through to (#194). */
  sessionId: string;
  sessionMode: SessionMode;
  /** The Session's date as `YYYY-MM-DD`; a `date` column, so already a string. */
  heldOn: string;
  /** The Session's wall-clock start time (`HH:MM:SS`), local to the School, for `formatSessionStartTime`. */
  startsAt: string;
  /** The School's Province's Time Zone, the zone `startsAt` is rendered in. */
  timeZone: TimeZone;
  materials: number;
  instructor: number;
  relevance: number;
  /** `(materials + instructor + relevance) / 3`, computed in SQL as numeric and mapped to Number. */
  rowAverage: number;
  materialsComment: string | null;
  instructorComment: string | null;
  relevanceComment: string | null;
  /** `submitted_at` as `YYYY-MM-DD`, rendered in SQL — the "Diisi" date the card shows. */
  submittedOn: string;
  submittedAt: Date;
};

/** The raw, unrounded row average — the expression `reviewType` gates on and the row carries. */
const rowAverageExpr = sql<number>`(${participantFeedback.materials} + ${participantFeedback.instructor} + ${participantFeedback.relevance}) / 3.0`;

/**
 * Turn one filter into its predicate, or `null` when it is `all`. `le7` → `<= 7`, `gt7` → `> 7`,
 * against whatever expression the caller passes — an Aspect column for three of the filters, the
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
  args: { filters: FeedbackFilters; cursor: FeedbackCursor | null; sort: FeedbackSort },
): Promise<{ rows: ParticipantFeedbackRow[]; nextCursor: FeedbackCursor | null }> {
  const { filters, cursor, sort } = args;

  // Each `all` filter yields `null` and is filtered out below; the active ones are conjoined by a
  // single `!= null` at the `where`.
  const conditions: (SQL | null | undefined)[] = [
    bound(filters.reviewType, rowAverageExpr),
    bound(filters.instructor, participantFeedback.instructor),
    bound(filters.materials, participantFeedback.materials),
    bound(filters.relevance, participantFeedback.relevance),
  ];

  const rows = await db
    .select({
      id: participantFeedback.id,
      name: participantFeedback.name,
      classKind: participantFeedback.classKind,
      schoolName: school.name,
      // The Session this feedback was filed against, so the card can link through to it (#194). The
      // `session` table is already inner-joined below, so this is just another selected column.
      sessionId: session.id,
      sessionMode: session.mode,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
      timeZone: province.timeZone,
      // The smallint columns already read back as `number`; the row average is a numeric
      // expression, so only it needs the explicit `.mapWith(Number)`.
      materials: participantFeedback.materials,
      instructor: participantFeedback.instructor,
      relevance: participantFeedback.relevance,
      rowAverage: rowAverageExpr.mapWith(Number),
      materialsComment: participantFeedback.materialsComment,
      instructorComment: participantFeedback.instructorComment,
      relevanceComment: participantFeedback.relevanceComment,
      // The filed instant as a `YYYY-MM-DD` string in SQL — the "Diisi" date the card shows,
      // mirroring how the Perjadin tab renders `createdOn`.
      submittedOn: sql<string>`to_char(${participantFeedback.submittedAt}, 'YYYY-MM-DD')`,
      submittedAt: participantFeedback.submittedAt,
    })
    .from(participantFeedback)
    .innerJoin(session, eq(session.id, participantFeedback.sessionId))
    .innerJoin(school, eq(school.id, session.schoolId))
    // The School's Province carries the Time Zone `startsAt` is rendered in. NOT NULL both ways,
    // so an inner join.
    .innerJoin(province, eq(province.code, school.provinceCode))
    .where(and(...conditions.filter((c): c is SQL => c != null)))
    // Average primary, filed date secondary, id last for a total order OFFSET can page safely.
    .orderBy(
      dir(sort.score)(rowAverageExpr),
      dir(sort.date)(participantFeedback.submittedAt),
      asc(participantFeedback.id),
    )
    .limit(BATCH + 1)
    .offset(cursor ?? 0);

  // The (BATCH + 1)th row is the proof a next page exists, never a row to show. Drop it and advance
  // the cursor by one batch; short of a full-plus-one batch there is no next page.
  if (rows.length > BATCH) {
    return { rows: rows.slice(0, BATCH), nextCursor: (cursor ?? 0) + BATCH };
  }
  return { rows, nextCursor: null };
}

/**
 * **The three summary averages, dataset-wide and unfiltered.** The `avg()` runs over the whole
 * `participant_feedback` table and takes no filter argument on purpose: the summary cards are the
 * overall standing, so they must not move when the page's filters narrow the list below them.
 *
 * An empty table makes `avg()` return NULL; `coalesce(…, 0)` turns that into `0` so the caller
 * gets three numbers to format rather than a null to guard. Zero is outside the 1–10 scale, so
 * "0.0" on an empty dataset reads as "nothing yet" rather than as a real low score.
 */
export async function participantFeedbackAverages(
  _caller: Person,
): Promise<{ instructor: number; materials: number; relevance: number }> {
  const [row] = await db
    .select({
      instructor: sql<number>`coalesce(avg(${participantFeedback.instructor}), 0)`.mapWith(Number),
      materials: sql<number>`coalesce(avg(${participantFeedback.materials}), 0)`.mapWith(Number),
      relevance: sql<number>`coalesce(avg(${participantFeedback.relevance}), 0)`.mapWith(Number),
    })
    .from(participantFeedback);

  return row ?? { instructor: 0, materials: 0, relevance: 0 };
}

/**
 * The five Perjadin filters, each independent and each ANDed with the others — the Peserta tab's
 * four plus one, because a Perjadin has four Aspects. `reviewType` gates on the **row average**
 * across the ratings that are present (see `perjadinRowAverageExpr`); the other four gate on their
 * own Aspect column. A screen sends all five every time; `all` on any of them contributes no
 * predicate.
 */
export type PerjadinFeedbackFilters = {
  /** Gates on the present-ratings average — the row's overall standing. */
  reviewType: FeedbackFilterValue;
  lodging: FeedbackFilterValue;
  transport: FeedbackFilterValue;
  meals: FeedbackFilterValue;
  punctuality: FeedbackFilterValue;
};

/** All Perjadin filters off — the first page of everything, in the caller's chosen sort. */
export const NO_PERJADIN_FEEDBACK_FILTERS: PerjadinFeedbackFilters = {
  reviewType: "all",
  lodging: "all",
  transport: "all",
  meals: "all",
  punctuality: "all",
};

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
  /** The trip's destination line, from the joined `perjadin`. */
  destination: string;
  /** The trip's id, for the card's link to `/perjadin/[id]`. */
  perjadinId: string;
  /** The trip's start date as `YYYY-MM-DD`, from the joined `perjadin` — a `date` column, so a string. */
  startsOn: string;
  /** The trip's end date as `YYYY-MM-DD`, from the joined `perjadin` — shown as a range beside the name. */
  endsOn: string;
  /** `created_at` as `YYYY-MM-DD`, rendered in SQL — the "Diisi" date the card shows. */
  createdOn: string;
  /** The one nullable Rating: a day trip with no hotel leaves it null and omits the row. */
  lodging: number | null;
  transport: number;
  meals: number;
  punctuality: number;
  /** The present-ratings average, computed in SQL as numeric and mapped to Number. */
  rowAverage: number;
  lodgingComment: string | null;
  transportComment: string | null;
  mealsComment: string | null;
  punctualityComment: string | null;
};

/**
 * The raw, unrounded Perjadin row average — **over the ratings that are present**. A day trip with
 * no hotel has a null `lodging`, so it must not count as a zero and must not divide by four: the
 * numerator `coalesce`s the absent hotel to 0 and the denominator drops it, so the average is over
 * three ratings when `lodging` is null and over four when it is not. `reviewType` gates on this,
 * and the row carries it.
 */
const perjadinRowAverageExpr = sql<number>`(${perjadinEvaluation.transport} + ${perjadinEvaluation.meals} + ${perjadinEvaluation.punctuality} + coalesce(${perjadinEvaluation.lodging}, 0)) / (3.0 + (case when ${perjadinEvaluation.lodging} is null then 0 else 1 end))`;

/**
 * One page of Perjadin Evaluations, filtered and sorted by the caller's `FeedbackSort`, OFFSET-paged
 * — the twin of `participantFeedbackPage`, over `perjadin_evaluation` joined to `perjadin` for the
 * destination, the date range and the link target.
 *
 * **The five filters AND together and only the active ones appear in the WHERE.** Each `all` drops
 * out. `reviewType` gates on the present-ratings average so the cut matches the number the card
 * shows before rounding. **A null-`lodging` row is naturally excluded from both lodging arms**:
 * `lodging <= 7` and `lodging > 7` are each NULL for it, so a `lodging` filter never keeps a day
 * trip with no hotel — no explicit null guard is needed.
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
    cursor: PerjadinFeedbackCursor | null;
    sort: FeedbackSort;
  },
): Promise<{ rows: PerjadinFeedbackRow[]; nextCursor: PerjadinFeedbackCursor | null }> {
  const { filters, cursor, sort } = args;

  const conditions: (SQL | null | undefined)[] = [
    bound(filters.reviewType, perjadinRowAverageExpr),
    bound(filters.lodging, perjadinEvaluation.lodging),
    bound(filters.transport, perjadinEvaluation.transport),
    bound(filters.meals, perjadinEvaluation.meals),
    bound(filters.punctuality, perjadinEvaluation.punctuality),
  ];

  const rows = await db
    .select({
      id: perjadinEvaluation.id,
      filedByName: perjadinEvaluation.filedByName,
      filedByRole: perjadinEvaluation.filedByRole,
      destination: perjadin.destination,
      perjadinId: perjadinEvaluation.perjadinId,
      // The trip's window, from the joined `perjadin` — both `date` columns, so already strings.
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
      // The filed instant rendered to a `YYYY-MM-DD` string in SQL — the "Diisi" date the card shows.
      createdOn: sql<string>`to_char(${perjadinEvaluation.createdAt}, 'YYYY-MM-DD')`.mapWith(
        String,
      ),
      // The smallint columns already read back as `number` (or null for `lodging`); the row average
      // is a numeric expression, so only it needs the explicit `.mapWith(Number)`.
      lodging: perjadinEvaluation.lodging,
      transport: perjadinEvaluation.transport,
      meals: perjadinEvaluation.meals,
      punctuality: perjadinEvaluation.punctuality,
      rowAverage: perjadinRowAverageExpr.mapWith(Number),
      lodgingComment: perjadinEvaluation.lodgingComment,
      transportComment: perjadinEvaluation.transportComment,
      mealsComment: perjadinEvaluation.mealsComment,
      punctualityComment: perjadinEvaluation.punctualityComment,
    })
    .from(perjadinEvaluation)
    .innerJoin(perjadin, eq(perjadin.id, perjadinEvaluation.perjadinId))
    .where(and(...conditions.filter((c): c is SQL => c != null)))
    // Average primary, filed date secondary, id last for a total order OFFSET can page safely.
    .orderBy(
      dir(sort.score)(perjadinRowAverageExpr),
      dir(sort.date)(perjadinEvaluation.createdAt),
      asc(perjadinEvaluation.id),
    )
    .limit(BATCH + 1)
    .offset(cursor ?? 0);

  // The (BATCH + 1)th row proves a next page exists; it is never shown. Drop it and advance the
  // cursor by one batch; short of a full-plus-one batch there is no next page.
  if (rows.length > BATCH) {
    return { rows: rows.slice(0, BATCH), nextCursor: (cursor ?? 0) + BATCH };
  }
  return { rows, nextCursor: null };
}

/**
 * **The four Perjadin summary averages, dataset-wide and unfiltered.** The `avg()` runs over the
 * whole `perjadin_evaluation` table and takes no filter argument, so the summary cards read the
 * overall standing and never move when the page's filters narrow the list below them.
 *
 * `avg(lodging)` ignores NULL naturally — a day trip with no hotel is not a zero in the hotel
 * average, it is simply not in it. `coalesce(…, 0)` turns the empty-table NULL into `0` so the
 * caller gets four numbers to format; "0.0" reads as "nothing yet" rather than a real low score.
 */
export async function perjadinFeedbackAverages(
  _caller: Person,
): Promise<{ lodging: number; transport: number; meals: number; punctuality: number }> {
  const [row] = await db
    .select({
      lodging: sql<number>`coalesce(avg(${perjadinEvaluation.lodging}), 0)`.mapWith(Number),
      transport: sql<number>`coalesce(avg(${perjadinEvaluation.transport}), 0)`.mapWith(Number),
      meals: sql<number>`coalesce(avg(${perjadinEvaluation.meals}), 0)`.mapWith(Number),
      punctuality: sql<number>`coalesce(avg(${perjadinEvaluation.punctuality}), 0)`.mapWith(Number),
    })
    .from(perjadinEvaluation);

  return row ?? { lodging: 0, transport: 0, meals: 0, punctuality: 0 };
}
