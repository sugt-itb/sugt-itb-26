import { FeedbackView } from "-/components/feedback-view";
import { requirePerson } from "-/lib/person";
import {
  DEFAULT_FEEDBACK_SORT,
  NO_FEEDBACK_FILTERS,
  NO_PARTICIPANT_FEEDBACK_SCOPE,
  NO_PERJADIN_FEEDBACK_FILTERS,
  NO_PERJADIN_FEEDBACK_SCOPE,
  participantFeedbackAverages,
  participantFeedbackPage,
  participantFeedbackSchools,
  perjadinFeedbackAverages,
  perjadinFeedbackPage,
  perjadinFeedbackTrips,
} from "@sugt/db/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Feedback" };

/**
 * **Feedback** — what Participants said about the Sessions they sat in, and what filers said about
 * the trips they went on. The Peserta tab lists every submission and the Perjadin tab every
 * evaluation, lowest-average-first by default (#184), filtered, sorted and paged in the browser
 * through its own Server Action.
 *
 * One `requirePerson()` and no role check: feedback carries no money, so ADR-0004 opens it to
 * everyone signed in. Six reads on the server for the first paint — each tab's first unfiltered
 * page, its programme-wide averages and its picker options (#466: the Schools and Sessions with
 * responses, the trips with evaluations) — so both tabs are ready before a click and switching
 * between them needs no round trip. Everything after that first paint is the client's, via the
 * actions. (This is the follow-up (#169) that added the Perjadin tab and retired `/concerns`.)
 */
export default async function Page() {
  const person = await requirePerson();
  const [
    participantFirstPage,
    participantAverages,
    participantSchools,
    perjadinFirstPage,
    perjadinAverages,
    perjadinTrips,
  ] = await Promise.all([
    participantFeedbackPage(person, {
      filters: NO_FEEDBACK_FILTERS,
      scope: NO_PARTICIPANT_FEEDBACK_SCOPE,
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    }),
    participantFeedbackAverages(person, NO_PARTICIPANT_FEEDBACK_SCOPE),
    participantFeedbackSchools(person),
    perjadinFeedbackPage(person, {
      filters: NO_PERJADIN_FEEDBACK_FILTERS,
      scope: NO_PERJADIN_FEEDBACK_SCOPE,
      cursor: null,
      sort: DEFAULT_FEEDBACK_SORT,
    }),
    perjadinFeedbackAverages(person, NO_PERJADIN_FEEDBACK_SCOPE),
    perjadinFeedbackTrips(person),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <h1 className="font-heading text-lg font-medium">Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Masukan Peserta atas setiap Sesi dan evaluasi Perjadin, nilai terendah dulu. Saring dan
          urutkan berdasarkan nilai untuk menemukan yang perlu diperhatikan.
        </p>
      </header>

      <FeedbackView
        participantInitialRows={participantFirstPage.rows}
        participantInitialCursor={participantFirstPage.nextCursor}
        participantAverages={participantAverages}
        participantSchools={participantSchools}
        perjadinInitialRows={perjadinFirstPage.rows}
        perjadinInitialCursor={perjadinFirstPage.nextCursor}
        perjadinAverages={perjadinAverages}
        perjadinTrips={perjadinTrips}
      />
    </div>
  );
}
