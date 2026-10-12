import { and, eq, sql } from "drizzle-orm";

import { db } from "../client";
import { perjadinPreparationTick } from "../schema/travel";
import type { Person } from "./caller";
import { preparationChecklist } from "./preparation-checklist";
import { requirePerjadinWriter, requireStaff } from "./staff-only";

/**
 * **Ticking and un-ticking one Preparation Checklist box** ([#114](https://github.com/mafiefa02/sugt/issues/114)).
 *
 * The checklist is an internal-monitoring aid — no money, no deadline, not a record — so a box is
 * hand-ticked and nothing ever ticks one automatically. Which items a Perjadin has is resolved at
 * read time (`./preparation-checklist.ts`, ADR-0045); this write stores only the ticks.
 *
 * **The trip's Group, a Perjadin Editor or an Administrator toggles its boxes** (ADR-0048). It opens with
 * the Staff-only choke point and then `requirePerjadinWriter`, because a Server Action is a public
 * endpoint and a layout does not run before one — the same reason every other write here does,
 * though this one carries no money (convention 4: arranging is Staff-only by the surface list).
 */

/**
 * The box to flip, by the item's id. `checked: true` records the tick, `false` clears it. The system
 * item ("Fiksasi Dosen/Narasumber oleh PIC Dosen" at the cutover) is toggled here by hand like any
 * other box — the one thing that clears it *automatically* is a Teaching-Team change, and that DELETE
 * lives in the teacher-mutation queries, not here.
 */
export type TogglePreparationItemInput = {
  perjadinId: string;
  itemId: string;
  checked: boolean;
};

export type TogglePreparationItemResult =
  | { outcome: "toggled" }
  /**
   * The item is not on this Perjadin's checklist — another Cluster's or Perjadin's, retired before
   * it ended, hidden for it — or there is no such Perjadin. A stale page reaches this honestly.
   */
  | { outcome: "not-applicable" };

/**
 * Upsert on tick, delete on un-tick — **idempotent both ways**, and only for an item the Perjadin's
 * resolved checklist holds, so no tick is ever stored that no screen would show.
 *
 * The composite primary key `(perjadin_id, preparation_item_id)` makes a second tick an
 * `onConflictDoUpdate` that rewrites `checked_by`/`checked_at` rather than a duplicate row, and a
 * second un-tick a delete that matches nothing. `checked_at` is `now()` on both the insert and the
 * conflict update — the column's `defaultNow()` only fires on insert, so the update sets it
 * explicitly, keeping the tick's time honest when a box is re-ticked.
 */
export async function togglePreparationItem(
  caller: Person,
  input: TogglePreparationItemInput,
): Promise<TogglePreparationItemResult> {
  requireStaff(caller);

  const { perjadinId, itemId, checked } = input;
  await requirePerjadinWriter(caller, perjadinId);

  const checklist = await preparationChecklist(perjadinId);
  if (!checklist?.some((item) => item.itemId === itemId)) return { outcome: "not-applicable" };

  if (checked) {
    await db
      .insert(perjadinPreparationTick)
      .values({ perjadinId, preparationItemId: itemId, checkedBy: caller.id })
      .onConflictDoUpdate({
        target: [perjadinPreparationTick.perjadinId, perjadinPreparationTick.preparationItemId],
        set: { checkedBy: caller.id, checkedAt: sql`now()` },
      });
  } else {
    await db
      .delete(perjadinPreparationTick)
      .where(
        and(
          eq(perjadinPreparationTick.perjadinId, perjadinId),
          eq(perjadinPreparationTick.preparationItemId, itemId),
        ),
      );
  }

  return { outcome: "toggled" };
}
