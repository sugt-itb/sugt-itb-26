import { tripTimeline, type TimelineTrip } from "-/components/trip-timeline";
import type { MyPerjadinSchool, MyPerjadinSession } from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

/**
 * **Perjalanan Dinas Anda's trip timeline and money bar** (#349), pinned with no database and no DOM.
 * The card only renders what `tripTimeline` returns: every live Session across Schools in
 * date-then-time order, each done once delivered. No departure or return leg — a Perjadin carries
 * none (ADR-0041).
 */

const session = (
  sessionId: string,
  heldOn: string,
  startsAt: string,
  status: MyPerjadinSession["status"] = "arranged",
): MyPerjadinSession => ({ sessionId, heldOn, startsAt, status });

const school = (schoolId: string, sessions: MyPerjadinSession[]): MyPerjadinSchool => ({
  schoolId,
  name: `SMA ${schoolId}`,
  kabupatenKota: "Kabupaten Contoh",
  timeZone: "WIB",
  sessions,
});

const trip = (schools: MyPerjadinSchool[] = []): TimelineTrip => ({ schools });

/** Each node's identity, in order — enough to read the sequence at a glance. */
const keys = (t: TimelineTrip) => tripTimeline(t).map((n) => n.key);

describe("tripTimeline", () => {
  it("is the trip's Sessions only, with no departure or return leg", () => {
    const t = trip([school("a", [session("s1", "2026-09-16", "09:00:00")])]);
    expect(keys(t)).toEqual(["s1"]);
  });

  it("drops cancelled Sessions", () => {
    const t = trip([
      school("a", [
        session("live", "2026-09-16", "09:00:00"),
        session("gone", "2026-09-16", "13:00:00", "cancelled"),
      ]),
    ]);
    expect(keys(t)).toEqual(["live"]);
  });

  it("interleaves Sessions from several Schools by date, then start time", () => {
    const t = trip([
      school("a", [
        session("a-17", "2026-09-17", "08:00:00"),
        session("a-16", "2026-09-16", "13:30:00"),
      ]),
      school("b", [
        session("b-16", "2026-09-16", "09:00:00"),
        session("b-17", "2026-09-17", "10:00:00"),
      ]),
    ]);
    expect(keys(t)).toEqual(["b-16", "a-16", "a-17", "b-17"]);
  });

  it("carries each Session's School for the row's name and time zone", () => {
    const b = school("b", [session("s1", "2026-09-16", "09:00:00")]);
    const node = tripTimeline(trip([b]))[0];
    expect(node).toMatchObject({ key: "s1", school: b, session: b.sessions[0] });
  });

  it("marks a delivered Session done and an arranged one pending", () => {
    const t = trip([
      school("a", [
        session("delivered", "2026-09-16", "09:00:00", "delivered"),
        session("arranged", "2026-09-16", "13:00:00"),
      ]),
    ]);
    expect(tripTimeline(t).map((n) => [n.key, n.done])).toEqual([
      ["delivered", true],
      ["arranged", false],
    ]);
  });

  it("is empty when there are no live Sessions", () => {
    const t = trip([school("a", [session("gone", "2026-09-16", "09:00:00", "cancelled")])]);
    expect(tripTimeline(t)).toEqual([]);
  });
});
