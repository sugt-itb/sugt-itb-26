"use server";

import { chartParticipantTypes, type ParticipantChartData } from "-/components/feedback-chart";
import { requirePerson } from "-/lib/person";
import {
  participantFeedbackAverages,
  participantFeedbackFigures,
  participantFeedbackPage,
  perjadinFeedbackAverages,
  perjadinFeedbackPage,
  type FeedbackCursor,
  type FeedbackFilters,
  type FeedbackSort,
  type ParticipantFeedbackAverages,
  type ParticipantFeedbackRow,
  type ParticipantFeedbackScope,
  type PerjadinFeedbackAverages,
  type PerjadinFeedbackCursor,
  type PerjadinFeedbackFilters,
  type PerjadinFeedbackRow,
  type PerjadinFeedbackScope,
} from "@sugt/db/queries";

/**
 * **The Feedback list's one read, driven from the client.** The filter change, the sort change and
 * the "load more" button all call it: a filter or sort change sends the chosen filters and sort with
 * a `null` cursor and gets the first page back to REPLACE the list; "load more" sends the same
 * filters and sort with the current cursor (the OFFSET) and gets the next page to APPEND. One action
 * serves all three because they are the same query — only the cursor and sort differ. The `scope`
 * — the School, Session and Tipe Peserta picked (#466, #487) — travels with every call, and the
 * query validates it.
 *
 * `requirePerson()` here is the check that counts. A Next.js layout does not run before a Server
 * Action (see `./caller.ts`), so resolving the Person at the top of the action is what closes the
 * path a layout-only check would leave open. No role gate and no `staffSurface`: feedback carries
 * no money, so ADR-0004 opens it to anyone signed in — the same stance as the page and the query.
 *
 * No `revalidatePath`: this returns data to the caller and writes nothing, so there is no cache
 * entry to bust.
 */
export async function loadParticipantFeedback(
  filters: FeedbackFilters,
  scope: ParticipantFeedbackScope,
  cursor: FeedbackCursor | null,
  sort: FeedbackSort,
): Promise<{ rows: ParticipantFeedbackRow[]; nextCursor: FeedbackCursor | null }> {
  const person = await requirePerson();
  return participantFeedbackPage(person, { filters, scope, cursor, sort });
}

/**
 * **The Peserta averages for a new scope** (#466): a School, Session or Tipe Peserta pick moves the
 * four cards, a score filter never does, so only a scope change calls this. Signed in, as its twin
 * above.
 */
export async function loadParticipantFeedbackAverages(
  scope: ParticipantFeedbackScope,
): Promise<ParticipantFeedbackAverages> {
  const person = await requirePerson();
  return participantFeedbackAverages(person, scope);
}

/**
 * **The Lihat Grafik figures for the dialog's scope** (#510): one per Tipe Peserta — or only the one
 * picked — each from `participantFeedbackFigures`, the read behind every Peserta average, called with
 * that Tipe Peserta. So a donut is the number its average card shows under the same scope, but raw: an
 * Aspect with no Rating stays `null`, and `responseCount` says how many responses a figure stands
 * on. The cards' `participantFeedbackAverages` turns a missing Narasumber, Materi or Relevansi into
 * 0, an arc a figure must never draw, and drops the count. The score filters are not an argument, as
 * for the cards. Signed in, as its twins.
 */
export async function loadParticipantFeedbackCharts(
  scope: ParticipantFeedbackScope,
): Promise<ParticipantChartData[]> {
  const person = await requirePerson();
  return Promise.all(
    chartParticipantTypes(scope.participantType).map(async (participantType) => ({
      participantType,
      figures: await participantFeedbackFigures(person, { ...scope, participantType }),
    })),
  );
}

/**
 * **The Perjadin tab's one read**, the twin of `loadParticipantFeedback` over `perjadin_evaluation`
 * (#169). Both tabs' filter changes, sort changes and "load more" buttons drive their own action;
 * the two share nothing but the shape, so a mistaken cursor from one can never reach the other's
 * query.
 *
 * `requirePerson()` for the same reason as its twin: a Server Action runs with no layout before it,
 * so resolving the Person here is the check that counts. No role gate — feedback carries no money.
 */
export async function loadPerjadinFeedback(
  filters: PerjadinFeedbackFilters,
  scope: PerjadinFeedbackScope,
  cursor: PerjadinFeedbackCursor | null,
  sort: FeedbackSort,
): Promise<{ rows: PerjadinFeedbackRow[]; nextCursor: PerjadinFeedbackCursor | null }> {
  const person = await requirePerson();
  return perjadinFeedbackPage(person, { filters, scope, cursor, sort });
}

/** **The Perjadin averages for a new scope** (#466), the twin of `loadParticipantFeedbackAverages`. */
export async function loadPerjadinFeedbackAverages(
  scope: PerjadinFeedbackScope,
): Promise<PerjadinFeedbackAverages> {
  const person = await requirePerson();
  return perjadinFeedbackAverages(person, scope);
}
