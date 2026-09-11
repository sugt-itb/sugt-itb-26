import { MAX_PREPARATION_CHECKLIST_ITEMS, type PreparationJenis } from "@sugt/domain";
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "../client";
import { preparationCard, preparationChecklistItem } from "../schema/monitoring";
import type { Person } from "./caller";
import { requireGrant } from "./staff-only";

/**
 * **Monitoring Preparation** — the reads and writes behind the `/monitoring` Persiapan tab's
 * free-standing Preparation Cards (ADR-0028). A Card is a title, a Jenis, a date or date-range, and
 * a variable checklist; it is **not** the Perjadin Preparation Checklist (ADR-0018), which is a
 * Perjadin's seven fixed boxes — see `docs` / `CONTEXT.md` for the collision note.
 *
 * **Reading is open** to any signed-in Person, like the rest of `/monitoring` — a Pimpinan reads the
 * tab. **Every write opens with `requireGrant(caller, "Monitoring Editor")`**: writing Monitoring
 * Preparation is the one thing that Grant gates, and an Administrator implies it. A non-holder is
 * refused with `NotGrantedError`, which `staffSurface` turns into a 403 (the UI hides the controls
 * as a courtesy; the guard is the enforcement, since a layout does not run before a Server Action).
 *
 * The `≤ 20 items per Card` ceiling and non-empty title/labels are enforced **here**, server-side,
 * as value outcomes — the DB's non-empty CHECKs are only a backstop, and the count cap is not a
 * column constraint at all.
 */

/** One line of a Card's checklist. Ordered `(checked, position)` by the read: unchecked first. */
export type PreparationChecklistItem = {
  id: string;
  label: string;
  position: number;
  checked: boolean;
};

/** One Preparation Card with its checklist. `endsOn` null means a single-date Card. */
export type PreparationCard = {
  id: string;
  title: string;
  jenis: PreparationJenis;
  startsOn: string;
  endsOn: string | null;
  items: PreparationChecklistItem[];
};

/**
 * Every Preparation Card with its items, cards oldest-date first and each card's items ordered
 * **`(checked, position)`** — all unchecked first by `position`, then all checked by `position`
 * (`false` sorts before `true`). Two reads folded into the nested shape the tab renders; the
 * percentage each card shows is a pure fold over `items` on the app side, kept out of SQL so the
 * suite can drive it without a database.
 */
export async function preparationCards(_caller: Person): Promise<PreparationCard[]> {
  const cards = await db
    .select({
      id: preparationCard.id,
      title: preparationCard.title,
      jenis: preparationCard.jenis,
      startsOn: preparationCard.startsOn,
      endsOn: preparationCard.endsOn,
    })
    .from(preparationCard)
    .orderBy(
      asc(preparationCard.startsOn),
      asc(preparationCard.createdAt),
      asc(preparationCard.id),
    );

  const items = await db
    .select({
      id: preparationChecklistItem.id,
      cardId: preparationChecklistItem.cardId,
      label: preparationChecklistItem.label,
      position: preparationChecklistItem.position,
      checked: preparationChecklistItem.checked,
    })
    .from(preparationChecklistItem)
    .orderBy(
      asc(preparationChecklistItem.cardId),
      asc(preparationChecklistItem.checked),
      asc(preparationChecklistItem.position),
    );

  const byCard = new Map<string, PreparationChecklistItem[]>();
  for (const { cardId, ...item } of items) {
    (byCard.get(cardId) ?? byCard.set(cardId, []).get(cardId)!).push(item);
  }

  return cards.map((card) => ({ ...card, items: byCard.get(card.id) ?? [] }));
}

/** The fields a Card write collects. `endsOn` optional (null ⇒ single-date); `items` are labels. */
export type PreparationCardInput = {
  title: string;
  jenis: PreparationJenis;
  startsOn: string;
  endsOn?: string | null;
  items?: string[];
};

export type CreatePreparationCardResult =
  | { outcome: "created"; cardId: string }
  /** A blank title — caught here so it reads as a required field, not an empty row the CHECK refuses. */
  | { outcome: "title-required" }
  /** One of the initial item labels was blank. */
  | { outcome: "label-required" }
  /** More than the app cap of initial items. */
  | { outcome: "too-many-items"; count: number; limit: number };

/**
 * Create a Card, optionally with initial checklist items — **Monitoring-Editor-guarded**. The Card
 * and its items commit together, items numbered `0..n-1` in the order given. Validation is here and
 * comes back as a value; only the missing Grant throws.
 */
export async function createPreparationCard(
  caller: Person,
  input: PreparationCardInput,
): Promise<CreatePreparationCardResult> {
  requireGrant(caller, "Monitoring Editor");

  const title = input.title.trim();
  if (title === "") return { outcome: "title-required" };

  const labels = (input.items ?? []).map((label) => label.trim());
  if (labels.some((label) => label === "")) return { outcome: "label-required" };
  if (labels.length > MAX_PREPARATION_CHECKLIST_ITEMS) {
    return {
      outcome: "too-many-items",
      count: labels.length,
      limit: MAX_PREPARATION_CHECKLIST_ITEMS,
    };
  }

  return db.transaction(async (tx) => {
    const [card] = await tx
      .insert(preparationCard)
      .values({
        title,
        jenis: input.jenis,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
      })
      .returning({ id: preparationCard.id });

    if (labels.length > 0) {
      await tx
        .insert(preparationChecklistItem)
        .values(labels.map((label, position) => ({ cardId: card!.id, label, position })));
    }

    return { outcome: "created", cardId: card!.id };
  });
}

export type EditPreparationCardResult =
  | { outcome: "updated" }
  | { outcome: "title-required" }
  /** The id names no Card — a stale screen. */
  | { outcome: "no-such-card" };

/**
 * Edit a Card's own fields — title, Jenis, dates. Monitoring-Editor-guarded. Its checklist is edited
 * through the item writes below, not here. `updated_at` is bumped so the tab can order on recency.
 */
export async function editPreparationCard(
  caller: Person,
  cardId: string,
  input: PreparationCardInput,
): Promise<EditPreparationCardResult> {
  requireGrant(caller, "Monitoring Editor");

  const title = input.title.trim();
  if (title === "") return { outcome: "title-required" };

  const [row] = await db
    .update(preparationCard)
    .set({
      title,
      jenis: input.jenis,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(preparationCard.id, cardId))
    .returning({ id: preparationCard.id });

  return row ? { outcome: "updated" } : { outcome: "no-such-card" };
}

export type DeletePreparationCardResult = { outcome: "deleted" } | { outcome: "no-such-card" };

/** Delete a Card — Monitoring-Editor-guarded. Its items go with it by `on delete cascade`. */
export async function deletePreparationCard(
  caller: Person,
  cardId: string,
): Promise<DeletePreparationCardResult> {
  requireGrant(caller, "Monitoring Editor");

  const [row] = await db
    .delete(preparationCard)
    .where(eq(preparationCard.id, cardId))
    .returning({ id: preparationCard.id });

  return row ? { outcome: "deleted" } : { outcome: "no-such-card" };
}

export type AddChecklistItemResult =
  | { outcome: "added"; itemId: string }
  | { outcome: "label-required" }
  | { outcome: "no-such-card" }
  | { outcome: "too-many-items"; count: number; limit: number };

/**
 * Append one checklist item to a Card — Monitoring-Editor-guarded. It lands at the end
 * (`max(position) + 1`), and the `≤ 20` cap is enforced here as a value outcome. The count and the
 * insert run in one transaction so a racing add cannot slip a card past the cap.
 */
export async function addChecklistItem(
  caller: Person,
  cardId: string,
  label: string,
): Promise<AddChecklistItemResult> {
  requireGrant(caller, "Monitoring Editor");

  const trimmed = label.trim();
  if (trimmed === "") return { outcome: "label-required" };

  return db.transaction(async (tx) => {
    const [card] = await tx
      .select({ id: preparationCard.id })
      .from(preparationCard)
      .where(eq(preparationCard.id, cardId))
      .limit(1);
    if (!card) return { outcome: "no-such-card" };

    const [{ count, nextPosition }] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        nextPosition: sql<number>`coalesce(max(${preparationChecklistItem.position}), -1) + 1`,
      })
      .from(preparationChecklistItem)
      .where(eq(preparationChecklistItem.cardId, cardId));

    if (count >= MAX_PREPARATION_CHECKLIST_ITEMS) {
      return { outcome: "too-many-items", count, limit: MAX_PREPARATION_CHECKLIST_ITEMS };
    }

    const [item] = await tx
      .insert(preparationChecklistItem)
      .values({ cardId, label: trimmed, position: nextPosition })
      .returning({ id: preparationChecklistItem.id });

    return { outcome: "added", itemId: item!.id };
  });
}

export type RemoveChecklistItemResult = { outcome: "removed" } | { outcome: "no-such-item" };

/** Remove one checklist item — Monitoring-Editor-guarded. */
export async function removeChecklistItem(
  caller: Person,
  itemId: string,
): Promise<RemoveChecklistItemResult> {
  requireGrant(caller, "Monitoring Editor");

  const [row] = await db
    .delete(preparationChecklistItem)
    .where(eq(preparationChecklistItem.id, itemId))
    .returning({ id: preparationChecklistItem.id });

  return row ? { outcome: "removed" } : { outcome: "no-such-item" };
}

export type ReorderChecklistItemsResult = { outcome: "reordered" } | { outcome: "no-such-card" };

/**
 * Rewrite the checklist order for the **unchecked** items of a Card — Monitoring-Editor-guarded.
 * `orderedItemIds` is the unchecked items in their new order; each is written `position = index`.
 * Checked items keep their positions and still sort after every unchecked one, because the read
 * orders `(checked, position)`. Only rows that belong to the Card **and** are unchecked are touched,
 * so a stale or checked id in the list is ignored rather than reordering something it should not.
 */
export async function reorderChecklistItems(
  caller: Person,
  cardId: string,
  orderedItemIds: string[],
): Promise<ReorderChecklistItemsResult> {
  requireGrant(caller, "Monitoring Editor");

  return db.transaction(async (tx) => {
    const [card] = await tx
      .select({ id: preparationCard.id })
      .from(preparationCard)
      .where(eq(preparationCard.id, cardId))
      .limit(1);
    if (!card) return { outcome: "no-such-card" };

    for (const [position, itemId] of orderedItemIds.entries()) {
      await tx
        .update(preparationChecklistItem)
        .set({ position, updatedAt: sql`now()` })
        .where(
          and(
            eq(preparationChecklistItem.id, itemId),
            eq(preparationChecklistItem.cardId, cardId),
            eq(preparationChecklistItem.checked, false),
          ),
        );
    }

    return { outcome: "reordered" };
  });
}

export type SetChecklistItemCheckedResult = { outcome: "updated" } | { outcome: "no-such-item" };

/**
 * Tick or untick one checklist item — Monitoring-Editor-guarded. Both directions: a checked item
 * **can be unchecked**, which is what lets a Card's percentage go down as well as up.
 */
export async function setChecklistItemChecked(
  caller: Person,
  itemId: string,
  checked: boolean,
): Promise<SetChecklistItemCheckedResult> {
  requireGrant(caller, "Monitoring Editor");

  const [row] = await db
    .update(preparationChecklistItem)
    .set({ checked, updatedAt: sql`now()` })
    .where(eq(preparationChecklistItem.id, itemId))
    .returning({ id: preparationChecklistItem.id });

  return row ? { outcome: "updated" } : { outcome: "no-such-item" };
}
