import type { MyPerjadinSchool, MyPerjadinSession, MyPerjadinTrip } from "@sugt/db/queries";

/**
 * **A `/pendamping` trip card's timeline** (#349). The ordering and the done/pending state are plain
 * functions so each rule is testable without React; the card renders what they return, deciding only
 * which controls a Session row offers. (Its money bar went with the Advance, ADR-0051.)
 *
 * The timeline is the trip's live Sessions and nothing else: a Perjadin carries no departure or
 * return leg (ADR-0041), so there is no journey to draw around them.
 */

/** The fields the timeline reads — a subset of `MyPerjadinTrip`. */
export type TimelineTrip = Pick<MyPerjadinTrip, "schools">;

/** One stop on the timeline — an offline Session at one of the Schools. */
export type TimelineNode = {
  /** The Session's id. */
  key: string;
  /** Carried whole: the row names the School and reads its Time Zone for the start time. */
  school: MyPerjadinSchool;
  session: MyPerjadinSession;
  done: boolean;
};

/**
 * Every non-cancelled Session across the trip's Schools, by date then start time. A Session is done
 * once delivered. Empty when there is no live Session, and the card then leaves the timeline out.
 */
export function tripTimeline(trip: TimelineTrip): TimelineNode[] {
  return (
    trip.schools
      .flatMap((school) => school.sessions.map((session) => ({ school, session })))
      .filter(({ session }) => session.status !== "cancelled")
      // `heldOn` is `YYYY-MM-DD` and `startsAt` is `HH:MM:SS`, so the strings order as the values do.
      // The sort is stable, so a tie keeps the query's School-then-Session order.
      .sort(
        (a, b) =>
          a.session.heldOn.localeCompare(b.session.heldOn) ||
          a.session.startsAt.localeCompare(b.session.startsAt),
      )
      .map(({ school, session }) => ({
        key: session.sessionId,
        school,
        session,
        done: session.status === "delivered",
      }))
  );
}
