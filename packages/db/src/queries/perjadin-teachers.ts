import { MAX_TEACHING_TEAM_PER_PERJADIN } from "@sugt/domain";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import {
  perjadin,
  perjadinPreparationTick,
  perjadinTeacher,
  preparationItem,
} from "../schema/travel";
import type { Person } from "./caller";
import { requirePerjadinWriter, requireStaff } from "./staff-only";

/**
 * **A Perjadin's Teaching Team, edited per name.** Adding, renaming and removing one trip-scoped
 * teacher name at a time on `/perjadin/[id]` (ADR-0020) — the Group's professors are no longer
 * `person` rows and no longer `group_member` rows, so there is no wholesale replacement here, only
 * these three granular writes.
 *
 * Every write is **Staff-only**, by the surface list — arranging and administering a trip is Staff's
 * ([#12](https://github.com/mafiefa02/sugt/issues/12), and see `./staff-only.ts`) — and, inside
 * that, the trip's Group's, a Perjadin Editor's or an Administrator's (`requirePerjadinWriter`, ADR-0048).
 * Each refusal that a person could reach honestly comes back as a value; `NotStaffError` and
 * `NotOnPerjadinError` are the opposite case and still throw.
 *
 * **Each of the three clears the system Preparation Item's tick** — "Fiksasi Dosen/Narasumber oleh
 * PIC Dosen" at the cutover — so that changing the team forces a fresh manual confirmation it is
 * complete (the amendment to ADR-0018, ADR-0045). The item is found by its
 * `clears_on_teaching_team_change` flag, not by an id or a label, so a rewording keeps the coupling;
 * this is the one place in the system that clears a tick automatically. A `DELETE` matching no row is
 * not an error, so clearing an already-unticked box is a harmless no-op.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The Perjadin a trip-scoped teacher name belongs to, locked for the write that follows — or `null`
 * for no such name. The rename and the removal take the name's id, so this is how they find the
 * trip whose Group may write it (ADR-0048).
 */
async function teacherTrip(tx: Tx, teacherId: string): Promise<string | null> {
  const [row] = await tx
    .select({ perjadinId: perjadinTeacher.perjadinId })
    .from(perjadinTeacher)
    .where(eq(perjadinTeacher.id, teacherId))
    .for("update");
  return row?.perjadinId ?? null;
}

/** Clear the system item's tick for one trip — whichever item carries the flag. */
async function clearSystemItemTick(tx: Tx, perjadinId: string): Promise<void> {
  await tx
    .delete(perjadinPreparationTick)
    .where(
      and(
        eq(perjadinPreparationTick.perjadinId, perjadinId),
        inArray(
          perjadinPreparationTick.preparationItemId,
          tx
            .select({ id: preparationItem.id })
            .from(preparationItem)
            .where(eq(preparationItem.clearsOnTeachingTeamChange, true)),
        ),
      ),
    );
}

export type AddPerjadinTeacherResult =
  | { outcome: "added"; teacherId: string }
  /** A blank name — caught here so it reads as a required field, not an empty `perjadin_teacher` row. */
  | { outcome: "name-required" }
  /** The trip already holds `MAX_TEACHING_TEAM_PER_PERJADIN` names — the app cap, not a DB rule. */
  | { outcome: "too-many-teachers"; count: number; limit: number }
  /** The id names no Perjadin — a stale link, which is reachable. */
  | { outcome: "no-such-perjadin" };

/**
 * Add one trip-scoped teacher name. Staff-only, capped at twenty, and clears the completeness tick.
 *
 * The cap is a count across sibling rows, so it is checked here rather than by a CHECK — and the
 * Perjadin row is locked for the transaction so two concurrent adds cannot both slip past a count of
 * nineteen.
 */
export async function addPerjadinTeacher(
  caller: Person,
  perjadinId: string,
  name: string,
): Promise<AddPerjadinTeacherResult> {
  requireStaff(caller);

  const trimmed = name.trim();
  if (trimmed === "") return { outcome: "name-required" };

  return db.transaction(async (tx) => {
    await requirePerjadinWriter(caller, perjadinId, tx);

    const [trip] = await tx
      .select({ id: perjadin.id })
      .from(perjadin)
      .where(eq(perjadin.id, perjadinId))
      .for("update");
    if (!trip) return { outcome: "no-such-perjadin" };

    const existing = await tx
      .select({ id: perjadinTeacher.id })
      .from(perjadinTeacher)
      .where(eq(perjadinTeacher.perjadinId, perjadinId));
    if (existing.length >= MAX_TEACHING_TEAM_PER_PERJADIN) {
      return {
        outcome: "too-many-teachers",
        count: existing.length,
        limit: MAX_TEACHING_TEAM_PER_PERJADIN,
      };
    }

    const [created] = await tx
      .insert(perjadinTeacher)
      .values({ perjadinId, name: trimmed })
      .returning({ id: perjadinTeacher.id });

    await clearSystemItemTick(tx, perjadinId);
    return { outcome: "added", teacherId: created!.id };
  });
}

export type RenamePerjadinTeacherResult =
  | { outcome: "renamed" }
  | { outcome: "name-required" }
  /** The id names no teacher — one was removed while this page was open, say. */
  | { outcome: "no-such-teacher" };

/**
 * Rename one trip-scoped teacher name. Staff-only, and clears the completeness tick.
 *
 * A rename never disturbs a `session_teaching_team` link — those glue to the teacher's id, not its
 * text — so the set of who taught each Session is untouched. The trip to clear the tick for is read
 * back from the updated row rather than passed in.
 */
export async function renamePerjadinTeacher(
  caller: Person,
  teacherId: string,
  name: string,
): Promise<RenamePerjadinTeacherResult> {
  requireStaff(caller);

  const trimmed = name.trim();
  if (trimmed === "") return { outcome: "name-required" };

  return db.transaction(async (tx) => {
    const tripId = await teacherTrip(tx, teacherId);
    if (tripId === null) return { outcome: "no-such-teacher" };
    await requirePerjadinWriter(caller, tripId, tx);

    const [updated] = await tx
      .update(perjadinTeacher)
      .set({ name: trimmed })
      .where(eq(perjadinTeacher.id, teacherId))
      .returning({ perjadinId: perjadinTeacher.perjadinId });
    if (!updated) return { outcome: "no-such-teacher" };

    await clearSystemItemTick(tx, updated.perjadinId);
    return { outcome: "renamed" };
  });
}

export type RemovePerjadinTeacherResult = { outcome: "removed" } | { outcome: "no-such-teacher" };

/**
 * Remove one trip-scoped teacher name. Staff-only, and clears the completeness tick.
 *
 * `session_teaching_team` cascades from `perjadin_teacher`, so removing a name also strips it from
 * the "Diajar oleh" of every Session it taught — a link is meaningless once the name is gone.
 */
export async function removePerjadinTeacher(
  caller: Person,
  teacherId: string,
): Promise<RemovePerjadinTeacherResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const tripId = await teacherTrip(tx, teacherId);
    if (tripId === null) return { outcome: "no-such-teacher" };
    await requirePerjadinWriter(caller, tripId, tx);

    const [deleted] = await tx
      .delete(perjadinTeacher)
      .where(eq(perjadinTeacher.id, teacherId))
      .returning({ perjadinId: perjadinTeacher.perjadinId });
    if (!deleted) return { outcome: "no-such-teacher" };

    await clearSystemItemTick(tx, deleted.perjadinId);
    return { outcome: "removed" };
  });
}
