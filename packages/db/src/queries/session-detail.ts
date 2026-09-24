import { type SessionMode, type SessionStatus, type TimeZone } from "@sugt/domain";
import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../client";
import { session } from "../schema/delivery";
import { person } from "../schema/people";
import { province, school } from "../schema/reference";
import { perjadin } from "../schema/travel";
import type { Person } from "./caller";
import { requireStaff } from "./staff-only";

/**
 * **Detail Sesi** — one Session, what has been filed against it, who still owes what,
 * and the three writes it offers: Tandai terlaksana, Batalkan Sesi and moving the date.
 *
 * The read is open to anyone signed in, because a Session carries no money and ADR-0004
 * opens delivery data to both roles. **Every write here is Staff-only**, by the surface
 * list rather than by ADR-0004 — the same one guard for the second of its two reasons,
 * as `./staff-only.ts` sets out.
 *
 * Settled on [#17](https://github.com/mafiefa02/sugt/issues/17): marking delivered is offered
 * only while `arranged`, cancelling likewise, a slipped date is an edit rather than a
 * cancellation, and `delivered` is terminal.
 *
 * **The online Class-Record "who owes what" machinery is gone** (T3, #153). It counted Records
 * expected against the two `session_teacher` professors, but online teachers are free-text names
 * now (ADR-0022) who cannot sign in and file, and `session_teacher` is dropped — so, exactly as
 * offline after ADR-0019/0020, nobody files a Class Record and Class Records are deferred for both
 * modes (the `CONTEXT.md` open question). What survives here is the **Session Record** the Staff
 * PIC owes.
 */

/**
 * One record nobody has filed yet — now the **Session Record** the PIC owes, and nothing else.
 * The online Class-Record variant was retired with `session_teacher` (T3, #153); Class Records
 * are deferred for both modes. `person` is who to chase — the whole point of the list, since
 * nothing is required and nothing is blocked (ADR-0009), and naming who has not filed is the only
 * enforcement this tool has.
 */
export type OwedRecord = { kind: "session-record"; personId: string; fullName: string };

/** The Perjadin an offline Session happens on, and the window its date must sit inside. */
export type SessionPerjadin = {
  id: string;
  startsOn: string;
  endsOn: string;
};

/** Everything Detail Sesi renders, in one round trip. */
export type SessionDetail = {
  id: string;
  schoolName: string;
  /** The School's page is where this Session was reached from, and the way back to it. */
  schoolSlug: string;
  mode: SessionMode;
  heldOn: string;
  /** Wall-clock start time local to the School (`HH:MM:SS`), rendered with its zone. */
  startsAt: string;
  /**
   * The School's Province's Time Zone, for rendering `startsAt` — no Indonesian Province
   * straddles a boundary, so the zone lives on `province`, not `school`.
   */
  timeZone: TimeZone;
  status: SessionStatus;
  /** Set on a cancelled Session and null on every other, by CHECK. */
  cancelledReason: string | null;
  /**
   * The Session's PIC — **only an offline Session has one now (#284)**: it is the PIC of the
   * Perjadin the Session sits on. An **online** Session no longer tracks a PIC (a third-party LMS
   * runs online delivery), so both are `null` for it. This is the offline detail surface, and an
   * online id is redirected away before it renders, so in practice the rendered case always has one.
   */
  picPersonId: string | null;
  picFullName: string | null;
  /** Null for an online Session, which by CHECK has no Perjadin. */
  perjadin: SessionPerjadin | null;
  /**
   * **Empty until the Session is delivered, empty when the PIC has already filed, and always empty
   * for an online Session (#284).** The one thing owed is the offline PIC's Session Record; online
   * Sessions have no PIC and owe no Record, and Class Records are deferred for both modes (T3, #153).
   * Filtering on `delivered` keeps the list from reporting a Record owed for a visit that has not
   * happened — the overdue-shaped state ADR-0006 exists to prevent.
   */
  owed: OwedRecord[];
};

/**
 * Whether a date lies inside a Perjadin's window, both ends inclusive — a trip teaches on
 * the day it arrives and on the day it leaves.
 *
 * **Exported from this module and deliberately not from `./index.ts`.** `docs/data-model.md`
 * says the rule belongs *wherever the date is written*, and there are three such places, all
 * three now calling this: the Session date edit below; `./perjadin-planning.ts`, which checks
 * every Session on a trip before it writes one; and `updatePerjadinLogistics` in
 * `./perjadin-detail.ts`, which resizes the trip's range to its new leg dates and refuses the
 * edit whole if any arranged Session would be stranded outside it (ADR-0021,
 * [#55](https://github.com/mafiefa02/sugt/issues/55)). That third one clamps rather than
 * shifting — a leg-date edit never moves a Session.
 *
 * They are modules *inside* this package and import it from here directly. Putting it on
 * the package's public surface would break convention 3 — nothing is exported that a
 * surface renders, and no surface renders this.
 *
 * A plain string comparison, which is exact rather than lucky: `date` comes back from
 * Postgres as `YYYY-MM-DD`, and that format sorts lexicographically in calendar order.
 * Parsing to `Date` would introduce a time zone where the domain has none — a Session is a
 * calendar day, not an instant, which is why the column is `date` and not `timestamptz`.
 */
export function heldOnWithinPerjadin(
  heldOn: string,
  window: { startsOn: string; endsOn: string },
): boolean {
  return heldOn >= window.startsOn && heldOn <= window.endsOn;
}

/**
 * One Session and everything the screen renders, or `null` when the id names none.
 *
 * `null` is a reachable state rather than an error: a link pasted into a message outlives
 * the row it points at, and the screen turns it into a 404.
 *
 * One statement, one row: since `session_teacher` was dropped (T3, #153) there is no teacher
 * join to fan the Session columns out across, and the only fact still derived is whether the
 * offline PIC has filed their Session Record. **This surface renders offline Sessions (#152); an
 * online id resolves here with a null PIC and is redirected to `/sesi-daring/[id]` by the page.**
 */
export async function sessionDetail(_caller: Person, id: string): Promise<SessionDetail | null> {
  const pic = alias(person, "pic");

  const [row] = await db
    .select({
      schoolName: school.name,
      schoolSlug: school.slug,
      mode: session.mode,
      heldOn: session.heldOn,
      startsAt: session.startsAt,
      timeZone: province.timeZone,
      status: session.status,
      cancelledReason: session.cancelledReason,

      picPersonId: pic.id,
      picFullName: pic.fullName,

      perjadinId: perjadin.id,
      perjadinStartsOn: perjadin.startsOn,
      perjadinEndsOn: perjadin.endsOn,

      // Whether the offline PIC's Session Record exists — the one thing still owed on a delivered
      // offline Session now Class Records are deferred (T3, #153). An online Session has no PIC
      // (#284), so `perjadin.pic_person_id` is null for it and this is simply false.
      sessionRecordFiled: sql<boolean>`exists (
        select 1 from session_record sr
        where sr.session_id = ${session.id}
          and sr.filed_by_person_id = ${perjadin.picPersonId}
      )`,
    })
    .from(session)
    .innerJoin(school, eq(school.id, session.schoolId))
    // The School's Province carries the Time Zone `startsAt` is read in. NOT NULL both ways,
    // so an inner join.
    .innerJoin(province, eq(province.code, school.provinceCode))
    // Outer: six of every ten Sessions have no Perjadin.
    .leftJoin(perjadin, eq(perjadin.id, session.perjadinId))
    // **The PIC is the Perjadin's, and only offline Sessions have one (#284).** A LEFT join, not
    // the old `coalesce(online_pic, perjadin.pic)` inner join: an online Session has no PIC now, so
    // it must resolve here with `pic` null rather than be dropped from the read — the page needs the
    // online row back so it can redirect it to `/sesi-daring/[id]`.
    .leftJoin(pic, eq(pic.id, perjadin.picPersonId))
    .where(eq(session.id, id));

  if (!row) return null;

  // The only thing owed is the offline PIC's Session Record, once the visit has happened. An online
  // Session has no PIC (#284) — `picPersonId` is null — so it never owes one.
  const owed: OwedRecord[] =
    row.status === "delivered" && row.picPersonId !== null && !row.sessionRecordFiled
      ? [{ kind: "session-record", personId: row.picPersonId, fullName: row.picFullName! }]
      : [];

  return {
    id,
    schoolName: row.schoolName,
    schoolSlug: row.schoolSlug,
    mode: row.mode,
    heldOn: row.heldOn,
    startsAt: row.startsAt,
    timeZone: row.timeZone,
    status: row.status,
    cancelledReason: row.cancelledReason,
    picPersonId: row.picPersonId,
    picFullName: row.picFullName,
    perjadin:
      row.perjadinId === null || row.perjadinStartsOn === null || row.perjadinEndsOn === null
        ? null
        : {
            id: row.perjadinId,
            startsOn: row.perjadinStartsOn,
            endsOn: row.perjadinEndsOn,
          },
    owed,
  };
}

/**
 * Why a write against a Session did not happen.
 *
 * Every one of these is a **user state and comes back as a value**, never as a throw —
 * the rule settled on [#12](https://github.com/mafiefa02/sugt/issues/12) is that a state
 * reachable from correct UI gets a friendly field-level message rather than an error page.
 * Two Staff on the same Session, one of them holding a page opened before the other
 * cancelled it, is exactly that. `NotStaffError` is the opposite case and still throws.
 */
/**
 * A Session past the point a write is offered.
 *
 * `arranged` is excluded rather than merely absent: every refusal below is *because* the
 * Session left that state, so a `status` of `arranged` would be a refusal with no reason.
 * The screens read this to choose a sentence, and the narrower type is what keeps them
 * from having to write one for a case that cannot arrive.
 */
export type PastArranged = Exclude<SessionStatus, "arranged">;

export type MarkDeliveredResult =
  | { outcome: "delivered" }
  | { outcome: "not-arranged"; status: PastArranged };

export type CancelSessionResult =
  | { outcome: "cancelled" }
  | { outcome: "reason-required" }
  | { outcome: "not-arranged"; status: PastArranged };

export type MoveSessionDateResult =
  | { outcome: "moved" }
  | { outcome: "not-arranged"; status: PastArranged }
  /** The School already has an online Session that still stands on the new date. */
  | { outcome: "collided"; constraint: "session_one_online_per_school_per_day" }
  /** An arranged offline Session may not leave the trip it happens on. */
  | { outcome: "outside-perjadin"; startsOn: string; endsOn: string };

/**
 * The Session's status, locked for the rest of the transaction.
 *
 * `for update` is what makes every status check below mean something. Without it two Staff
 * pressing a button at once both read `arranged`, and the second overwrites the first.
 *
 * **A missing row throws rather than coming back as a refusal**, and that is the same rule
 * `requirePerson` states in the app: a state that can only be reached from a bug must not
 * get a friendly path, or somebody eventually builds a form that relies on it. Nothing in
 * this system deletes a `session` row, and the screen 404s on an unknown id before it
 * offers a single one of these writes — so an id that names nothing here arrived by a
 * hand-edited request, which is not a user state to be helpful about.
 */
async function lockedSession(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sessionId: string,
): Promise<{ status: SessionStatus }> {
  const [row] = await tx
    .select({ status: session.status })
    .from(session)
    .where(eq(session.id, sessionId))
    .for("update");

  if (!row) {
    throw new Error(
      `No Session has id ${sessionId}. Detail Sesi 404s on an unknown id before offering ` +
        "any write, and nothing deletes a Session, so this is a bug or a hand-edited request.",
    );
  }
  return row;
}

/**
 * **Tandai terlaksana** — mark a Session delivered. **Status only, for both modes**
 * (ADR-0019, ADR-0020, ADR-0022, #140, #152, #153).
 *
 * It writes nothing but `session.status = 'delivered'`, and it names nobody. Both modes name their
 * teachers as **free-text names**: an offline Session's are trip-scoped `session_teaching_team` names
 * edited on the Perjadin, and an online Session's are the two cohort-named Pengajar columns on the
 * `session` row itself (#318, superseding ADR-0022's `session_teacher_name` list). Neither is a
 * `person`, so there is no who-taught prompt on either side. **This path is legacy for online now**
 * (#318): an online Session is born `delivered` by `arrangeOnlineSession`, so only an offline Session
 * — or an online Session arranged before #318 — reaches this. Class Records and the offline progress
 * metric stay deferred (the `CONTEXT.md` open question), so nothing is owed off the back of this.
 *
 * The transaction and the `for update` lock are still here, by convention 5: the status check means
 * nothing without the lock — two Staff pressing the button at once both read `arranged` otherwise,
 * and the second overwrites the first — even now that the write is a single statement.
 */
export async function markSessionDelivered(
  caller: Person,
  sessionId: string,
): Promise<MarkDeliveredResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const { status } = await lockedSession(tx, sessionId);
    if (status !== "arranged") return { outcome: "not-arranged", status };

    await tx.update(session).set({ status: "delivered" }).where(eq(session.id, sessionId));
    return { outcome: "delivered" };
  });
}

/**
 * **Batalkan Sesi** — offered only while the Session is `arranged`.
 *
 * Once delivered it happened, and "un-delivering" is a correction rather than a
 * cancellation: conflating the two would put a reason field on an event that already has
 * one, and would leave filed Class Records describing a Session that claims not to have
 * happened.
 *
 * The reason travels in the same write because `session_cancelled_iff_reason` refuses the
 * pair apart. A blank one is caught here rather than at the database, so it reads as a
 * required field and not as an error page.
 */
export async function cancelSession(
  caller: Person,
  sessionId: string,
  reason: string,
): Promise<CancelSessionResult> {
  requireStaff(caller);

  const cancelledReason = reason.trim();
  if (cancelledReason === "") return { outcome: "reason-required" };

  return db.transaction(async (tx) => {
    const { status } = await lockedSession(tx, sessionId);
    if (status !== "arranged") return { outcome: "not-arranged", status };

    await tx
      .update(session)
      .set({ status: "cancelled", cancelledReason })
      .where(eq(session.id, sessionId));

    return { outcome: "cancelled" };
  });
}

/** `HH:MM[:SS]` → minutes since midnight; seconds are dropped, a Session's time is hour-and-minute. */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/**
 * A new time that keeps `end`'s distance from `oldStart` when the start moves to `newStart` — used to
 * carry a Session's end time along with its start so the duration is preserved. Returns `HH:MM`; the
 * inputs are wall-clock times within one day and the delta small, so no wrap handling is needed.
 */
function shiftTime(end: string, newStart: string, oldStart: string): string {
  const shifted = timeToMinutes(newStart) + (timeToMinutes(end) - timeToMinutes(oldStart));
  const hh = String(Math.floor(shifted / 60)).padStart(2, "0");
  const mm = String(shifted % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Move an arranged Session's date. **A slipped date is not a cancellation** — it demands
 * no reason and leaves no dead row on the School's list.
 *
 * Cancel-and-re-arrange was the alternative and the schema does permit it, both partial
 * unique indexes being predicated on `status <> 'cancelled'` for exactly that. It was
 * rejected for cost rather than for feasibility.
 *
 * The two modes are refused by different rules, and both are checked:
 *
 * - **Online** — the new date must not collide with another online Session for the same
 *   School. That is `session_one_online_per_school_per_day`, and it is left to refuse the
 *   write rather than pre-read: a pre-read is a race, and the index is not.
 * - **Offline** — the new date must stay inside the Perjadin's window. No CHECK can carry
 *   that, since the range sits on another table, so it is held here beside the write.
 *
 * **The start time moves with the date, in the same write** ([#72](https://github.com/mafiefa02/sugt/issues/72)):
 * moving a Session is one act, and a dialog that changed the date while silently keeping a
 * time nobody can see would be a trap. The index keys on `(school_id, held_on)`, not
 * `starts_at`, so the collision rule is unaffected by carrying the time.
 *
 * **`ends_at` (#283) moves with the start, preserving the Session's duration.** Offline Sessions
 * hold no end time (it is an online-only field), so this is a no-op for them — but the query is not
 * mode-gated, and an online Session's `session_ends_after_starts_check` would otherwise reject a new
 * start later than the old end. Shifting the end by the same delta keeps the row valid whatever the
 * new start, without the move dialog having to ask for an end it does not show.
 */
export async function moveSessionDate(
  caller: Person,
  sessionId: string,
  heldOn: string,
  startsAt: string,
): Promise<MoveSessionDateResult> {
  requireStaff(caller);

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          status: session.status,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          startsOn: perjadin.startsOn,
          endsOn: perjadin.endsOn,
        })
        .from(session)
        .leftJoin(perjadin, eq(perjadin.id, session.perjadinId))
        .where(eq(session.id, sessionId))
        .for("update", { of: session });
      // The one status read that is not `lockedSession`, because it needs the Perjadin's
      // window in the same locked read. A missing row throws for the same reason.
      if (!row) {
        throw new Error(
          `No Session has id ${sessionId}. Detail Sesi 404s on an unknown id before ` +
            "offering any write, and nothing deletes a Session, so this is a bug or a " +
            "hand-edited request.",
        );
      }
      if (row.status !== "arranged") return { outcome: "not-arranged", status: row.status };

      // An offline Session always has a Perjadin, by `session_offline_iff_perjadin`, so
      // this narrows to "this is the offline case" rather than to "the join found a row".
      if (row.startsOn !== null && row.endsOn !== null) {
        const window = { startsOn: row.startsOn, endsOn: row.endsOn };
        if (!heldOnWithinPerjadin(heldOn, window)) {
          return { outcome: "outside-perjadin", ...window };
        }
      }

      // Carry the end time with the start, preserving the duration, so an online Session's
      // `session_ends_after_starts_check` cannot reject the move. Null for an offline Session, which
      // has no end time — a no-op, since the column was already null.
      const endsAt = row.endsAt === null ? null : shiftTime(row.endsAt, startsAt, row.startsAt);
      await tx.update(session).set({ heldOn, startsAt, endsAt }).where(eq(session.id, sessionId));
      return { outcome: "moved" };
    });
  } catch (error) {
    // Named rather than caught wholesale: this row satisfies several CHECKs, and swallowing any of
    // those as "that date is taken" would report a bug as a user state. (The `session` table has no
    // composite foreign keys any more — the online PIC one was dropped in #284.)
    const constraint = (error as { cause?: { constraint_name?: string } }).cause?.constraint_name;
    if (constraint === "session_one_online_per_school_per_day") {
      return { outcome: "collided", constraint };
    }
    throw error;
  }
}
