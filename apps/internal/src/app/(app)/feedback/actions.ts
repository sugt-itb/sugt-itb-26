"use server";

import { requirePerson } from "-/lib/person";
import {
  participantFeedbackAverages,
  participantFeedbackPage,
  perjadinFeedbackAverages,
  perjadinFeedbackPage,
  type FeedbackCursor,
  type FeedbackFilters,
  type FeedbackSort,
  type ParticipantFeedbackAverages,
  type ParticipantFeedbackRow,
  type ParticipantFeedbackScope,
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
 * — the School and Session picked (#466) — travels with every call, and the query validates it.
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
 * **The Peserta averages for a new scope** (#466): a School or Session pick moves the four cards, a
 * score filter never does, so only a scope change calls this. Signed in, as its twin above.
 */
export async function loadParticipantFeedbackAverages(
  scope: ParticipantFeedbackScope,
): Promise<ParticipantFeedbackAverages> {
  const person = await requirePerson();
  return participantFeedbackAverages(person, scope);
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
): Promise<{ lodging: number; transport: number; meals: number; punctuality: number }> {
  const person = await requirePerson();
  return perjadinFeedbackAverages(person, scope);
}
