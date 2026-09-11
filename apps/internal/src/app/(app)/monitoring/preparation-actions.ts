"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  addChecklistItem,
  createPreparationCard,
  deletePreparationCard,
  editPreparationCard,
  removeChecklistItem,
  reorderChecklistItems,
  setChecklistItemChecked,
  type AddChecklistItemResult,
  type CreatePreparationCardResult,
  type DeletePreparationCardResult,
  type EditPreparationCardResult,
  type PreparationCardInput,
  type RemoveChecklistItemResult,
  type ReorderChecklistItemsResult,
  type SetChecklistItemCheckedResult,
} from "@sugt/db/queries";
import { revalidatePath } from "next/cache";

/**
 * **Monitoring Preparation's writes** — create/edit/delete a Card and add/remove/reorder/tick its
 * items, every one behind `requireGrant(person, "Monitoring Editor")` inside the `@sugt/db` write
 * (ADR-0028). `staffSurface` turns a non-holder's `NotGrantedError` into a 403 — the same
 * translation the Staff-only surfaces use — because a layout does not run before a Server Action, so
 * hiding the tab's controls (sibling UI ticket) is only a courtesy and the guard is the real gate.
 *
 * Every write that changed something revalidates `/monitoring` so the tab re-reads the cards. The
 * reachable refusals (`no-such-card`, `title-required`, `too-many-items`, …) come back as values for
 * the form to place on a field; only the missing Grant throws.
 */

export async function createPreparationCardAction(
  input: PreparationCardInput,
): Promise<CreatePreparationCardResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => createPreparationCard(person, input));
  if (result.outcome === "created") revalidatePath("/monitoring");
  return result;
}

export async function editPreparationCardAction(
  cardId: string,
  input: PreparationCardInput,
): Promise<EditPreparationCardResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => editPreparationCard(person, cardId, input));
  if (result.outcome === "updated") revalidatePath("/monitoring");
  return result;
}

export async function deletePreparationCardAction(
  cardId: string,
): Promise<DeletePreparationCardResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => deletePreparationCard(person, cardId));
  if (result.outcome === "deleted") revalidatePath("/monitoring");
  return result;
}

export async function addChecklistItemAction(
  cardId: string,
  label: string,
): Promise<AddChecklistItemResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => addChecklistItem(person, cardId, label));
  if (result.outcome === "added") revalidatePath("/monitoring");
  return result;
}

export async function removeChecklistItemAction(
  itemId: string,
): Promise<RemoveChecklistItemResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => removeChecklistItem(person, itemId));
  if (result.outcome === "removed") revalidatePath("/monitoring");
  return result;
}

export async function reorderChecklistItemsAction(
  cardId: string,
  orderedItemIds: string[],
): Promise<ReorderChecklistItemsResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => reorderChecklistItems(person, cardId, orderedItemIds));
  if (result.outcome === "reordered") revalidatePath("/monitoring");
  return result;
}

export async function setChecklistItemCheckedAction(
  itemId: string,
  checked: boolean,
): Promise<SetChecklistItemCheckedResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => setChecklistItemChecked(person, itemId, checked));
  if (result.outcome === "updated") revalidatePath("/monitoring");
  return result;
}
