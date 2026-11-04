import {
  CLASS_RECORD_ASPECTS,
  CONCERN_AT_OR_BELOW,
  PARTICIPANT_FEEDBACK_ASPECTS,
  SESSION_RECORD_ASPECTS,
  type ClassRecordAspect,
  type ParticipantFeedbackAspect,
  type SessionMode,
  type SessionRecordAspect,
  type SessionStatus,
  type TimeZone,
} from "@sugt/domain";
import { asc, eq, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { db } from "../client";
import { session } from "../schema/delivery";
import { classRecord, participantFeedback, sessionRecord } from "../schema/evaluations";
import { cluster, province, school } from "../schema/reference";
import type { Person } from "./caller";
import { countsTowardsProgress } from "./delivered-sessions";

/**
 * **Detail Sekolah** — one School's Sessions: how many are delivered, and which of them
 * carry a concern. The screen folds the delivered count into Kegiatan terlaksana, over 10
 * (#540, ADR-0031), with the boxes from `schoolAssessmentCompletions`.
 *
 * Open to anyone signed in, so the signature takes a `Person` and applies no further
 * check: delivery data carries no money, and ADR-0004 opens it to both roles.
 *
 * **Only the Sessions that exist are listed.** A School is due eight and the number is
 * fixed from the start, but a Session comes into existence when it is arranged and
 * never before ([ADR-0006](../../../../docs/adr/0006-sessions-are-created-when-arranged.md)),
 * so there is no such thing as a row for a Session nobody has arranged. The eight are part
 * of a denominator and nothing else. The design handoff lays them all out with *"Belum
 * dijadwalkan"* against the unplanned ones; that is the schedule ADR-0006 rejects, and
 * it is not built.
 */

/**
 * An Aspect any of the three Session-scoped rubrics can name. Most of them are never
 * a concern, which is why this is not called one.
 *
 * **Three sources, not the concerns list's four.** A Perjadin Evaluation is about the journey
 * rather than the teaching, and `docs/data-model.md` § *The concerns list in full* shows what that
 * costs it here: its branch of that query reports the trip's Kelompok and dates — its name
 * (ADR-0044) — as its subject, because it has no Session and no School to report. One Perjadin may
 * carry several Schools, so attributing a bad hotel to each of their Sessions would flag teaching
 * nobody complained about.
 */
export type SessionAspect = ClassRecordAspect | SessionRecordAspect | ParticipantFeedbackAspect;

/**
 * The worst thing anybody said about one Session, when that is at or below
 * `CONCERN_AT_OR_BELOW`.
 *
 * The lowest single Rating, and **never an average**: one person scoring something low
 * is the signal, and averaging it away under three cheerful scores defeats the reason
 * more than one person is asked. The Aspect travels with it because a number alone
 * says a Session went badly, where an Aspect says what did.
 *
 * Which of the three sources it came from is **not** here. The concerns list keeps the
 * source so a professor's 3 and a student's 3 stay distinguishable; this screen shows
 * one chip per Session and offers the Session as the way to read the rest.
 */
export type SessionConcern = {
  aspect: SessionAspect;
  rating: number;
};

/** One Session of this School, in whatever state it reached. */
export type SchoolSession = {
  id: string;
  mode: SessionMode;
  /** The date it is arranged for, and the date it happened once delivered. */
  heldOn: string;
  /** Wall-clock start time local to the School (`HH:MM:SS`), rendered with its zone. */
  startsAt: string;
  /** The School's Province's Time Zone, for rendering `startsAt`. */
  timeZone: TimeZone;
  status: SessionStatus;
  /** Set on a cancelled Session and null on every other, by CHECK. */
  cancelledReason: string | null;
  /**
   * How many Ratings anybody has filed about this Session, across the three sources.
   *
   * It is here to keep the screen from claiming something nobody said. Nothing is
   * required and nothing is blocked
   * ([ADR-0009](../../../../docs/adr/0009-the-tool-tracks-delivery-not-outcomes.md)),
   * so a delivered Session with no records at all is ordinary — and "no concern" reads
   * as a verdict on it. Zero here is what separates *nothing was flagged* from
   * *nobody has said anything yet*.
   */
  ratingsFiled: number;
  /** Null when nothing was filed, and null when everything filed was above the threshold. */
  concern: SessionConcern | null;
};

/**
 * What the Detail Sekolah screen renders — and nothing besides.
 *
 * No `id` and no `slug`: the screen renders neither, and the slug is this function's
 * own argument handed back. No `clusterTopic` either — the Cluster's Topic is what
 * Cluster detail is about, and this surface's row on
 * [#9](https://github.com/mafiefa02/sugt/issues/9) reads *"Ten Sessions, delivered
 * count, flagged Sessions"*. The Cluster's **name** stays, because it says where this
 * School sits.
 */
export type SchoolDetail = {
  name: string;
  kabupatenKota: string;
  clusterName: string;
  /** Delivered Sessions. **Arranged and cancelled count for nothing.** */
  deliveredSessions: number;
  /** Every Session that exists, oldest first. A cancelled one stays in the list. */
  sessions: SchoolSession[];
};

/**
 * One source's Ratings, one row per Aspect.
 *
 * Ratings are columns beside the prose rather than rows in a child table — which is
 * what makes the elaboration rule expressible as a CHECK at all — so reading them as a
 * list means unpivoting them, and the Aspect names double as the column names.
 * `@sugt/domain` says so where it declares them: *"Note these name **columns**, not
 * values … The arrays exist so each form and the concerns query are built from the
 * same list the table is."*
 *
 * That is why the names are interpolated as SQL text rather than bound as parameters.
 * A column name cannot be a bind parameter, and these are `as const` arrays in a
 * package this one depends on — nothing here ever sees a value from a request. The
 * cost is that a name which drifts from its column fails at runtime, so every source
 * is exercised by a test, `school_support` most of all.
 */
function ratingsFrom(table: PgTable, aspects: readonly string[]): SQL {
  const unpivot = sql.raw(aspects.map((aspect) => `('${aspect}', src.${aspect})`).join(", "));

  return sql`
    select src.session_id, r.aspect, r.rating
      from ${table} as src
      cross join lateral (values ${unpivot}) as r(aspect, rating)
  `;
}

/**
 * Everything said about one Session, folded to the three numbers the screen wants.
 *
 * A correlated LATERAL rather than a grouped subquery over the whole table: it is
 * evaluated per Session of the one School being read, so it never aggregates Ratings
 * belonging to the other forty-one.
 *
 * With no `group by` the aggregates always return exactly one row, so a Session nobody
 * has filed anything about yields `0` and two nulls rather than no row at all. It counts
 * Ratings, not unpivoted rows: a Participant not asked Hands-on RBL (#446) unpivots a null
 * for it, which `count(r.rating)` and `min` skip and the `array_agg` order puts last. The
 * `order by` inside `array_agg` carries a tie-break on the Aspect name, so two equally
 * low Ratings pick the same one every time instead of whichever the plan reached first.
 */
const RATINGS_ON_THIS_SESSION = sql`(
  select count(r.rating)::int as ratings_filed,
         min(r.rating) as lowest_rating,
         (array_agg(r.aspect order by r.rating asc, r.aspect asc))[1] as lowest_aspect
    from (
      ${ratingsFrom(classRecord, CLASS_RECORD_ASPECTS)}
      union all
      ${ratingsFrom(sessionRecord, SESSION_RECORD_ASPECTS)}
      union all
      ${ratingsFrom(participantFeedback, PARTICIPANT_FEEDBACK_ASPECTS)}
    ) as r
   where r.session_id = ${session.id}
) as concern`;

/**
 * The threshold applies to the lowest Rating, and it is *at or below* — a Rating of
 * exactly `CONCERN_AT_OR_BELOW` is a concern, and one above it is not.
 */
function concernOf(aspect: SessionAspect | null, rating: number | null): SessionConcern | null {
  if (aspect === null || rating === null || rating > CONCERN_AT_OR_BELOW) return null;
  return { aspect, rating };
}

/**
 * One School and its Sessions, in one round trip.
 *
 * Keyed on `slug`, which is what the URL carries. Returns `null` when no School has
 * that slug — a reachable state, since a mistyped or stale URL is one — and the screen
 * turns it into a 404.
 */
export async function schoolDetail(_caller: Person, slug: string): Promise<SchoolDetail | null> {
  const rows = await db
    .select({
      name: school.name,
      kabupatenKota: school.kabupatenKota,
      clusterName: cluster.name,

      sessionId: session.id,
      mode: session.mode,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
      timeZone: province.timeZone,
      status: session.status,
      cancelledReason: session.cancelledReason,

      ratingsFiled: sql<number>`concern.ratings_filed`.mapWith(Number),
      lowestRating: sql<number | null>`concern.lowest_rating`,
      lowestAspect: sql<SessionAspect | null>`concern.lowest_aspect`,
    })
    .from(school)
    // Inner, never outer: `school.cluster_id` is NOT NULL.
    .innerJoin(cluster, eq(cluster.id, school.clusterId))
    // The School's Province carries the Time Zone `startsAt` is read in. `province_code` is
    // NOT NULL, so an inner join.
    .innerJoin(province, eq(province.code, school.provinceCode))
    // Outer, and unfiltered by status. A School nobody has reached still has a page,
    // and a cancelled Session stays visible — it counts for nothing, but a School that
    // was planned for and missed looks different from one nobody has reached yet.
    .leftJoin(session, eq(session.schoolId, school.id))
    // After the Session join, never before: a LATERAL may only reference what precedes
    // it in the FROM clause, and this one reads `session.id`.
    .leftJoinLateral(RATINGS_ON_THIS_SESSION, sql`true`)
    .where(eq(school.slug, slug))
    // Oldest first — this reads as the School's history. `session.id` breaks the tie,
    // since two Sessions may share a date.
    .orderBy(asc(session.heldOn), asc(session.id));

  const [first] = rows;
  if (!first) return null;

  const sessions: SchoolSession[] = [];
  for (const row of rows) {
    const { sessionId, mode, heldOn, startsAt, status } = row;
    // The outer join is all-or-nothing: a School with no Sessions comes back as one row
    // with every Session column null, and any Session at all brings them together.
    if (
      sessionId === null ||
      mode === null ||
      heldOn === null ||
      startsAt === null ||
      status === null
    )
      continue;

    sessions.push({
      id: sessionId,
      mode,
      heldOn,
      startsAt,
      // `province` joins off `school`, so `timeZone` is present on every row, session or not.
      timeZone: row.timeZone,
      status,
      cancelledReason: row.cancelledReason,
      ratingsFiled: row.ratingsFiled,
      concern: concernOf(row.lowestAspect, row.lowestRating),
    });
  }

  return {
    name: first.name,
    kabupatenKota: first.kabupatenKota,
    clusterName: first.clusterName,
    // Counted from the rows already in hand rather than by a second aggregate: the list
    // is every Session this School has, so asking the database to recount it would buy
    // nothing. **Which statuses count** is still not decided here — that rule lives in
    // `./delivered-sessions.ts` with the SQL saying the same thing, so the two cannot
    // drift apart.
    deliveredSessions: sessions.filter((entry) => countsTowardsProgress(entry.status)).length,
    sessions,
  };
}
