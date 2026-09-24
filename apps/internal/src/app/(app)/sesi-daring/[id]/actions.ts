"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  cancelSession,
  deleteOnlineSession,
  markSessionDelivered,
  updateOnlineSession,
  type CancelSessionResult,
  type DeleteOnlineSessionResult,
  type MarkDeliveredResult,
  type OnlineSessionInput,
  type UpdateOnlineSessionResult,
} from "@sugt/db/queries";
import { revalidatePath } from "next/cache";

/**
 * **Detail Sesi daring's writes**, each beside the route that offers it (#152, #318) — the online
 * counterpart of `/perjadin/[id]/actions.ts`. Each is the same three lines: resolve the Person, hand
 * it to `@sugt/db`, return what came back.
 *
 * None opens a transaction — the boundary is convention 5's and lives in the query function. None
 * re-checks Staff: `requireStaff` inside each query is the only thing that closes this path, since a
 * layout does not run before a Server Action. `staffSurface` turns that thrown `NotStaffError` into a
 * **403** server-side rather than a crash; every other refusal comes back as a value the client
 * renders. `revalidatePath` clears the client router cache for the page just written — called only on
 * the outcome that wrote something, since a refused write left the page correct.
 *
 * The Pengajar add/rename/remove trio is gone (#318): an online Session's two Pengajar are edited in
 * the Session's own field dialog now (`updateOnlineSession`), and a mis-recorded Session is hard-
 * deleted rather than corrected name by name.
 */

/** Edit the Session's fields — School, date, start and end time, and both cohort-named Pengajar (#318) — in one write. */
export async function updateOnlineSessionAction(
  sessionId: string,
  input: OnlineSessionInput,
): Promise<UpdateOnlineSessionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => updateOnlineSession(person, sessionId, input));
  if (result.outcome === "updated") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}

/**
 * **Hapus Sesi** — hard-delete an online Session (#318). On success the row is gone, so the detail
 * route it revalidates would 404 — the client redirects to `/sesi-daring`, which this also revalidates
 * so the deleted row drops out of the list.
 */
export async function deleteOnlineSessionAction(
  sessionId: string,
): Promise<DeleteOnlineSessionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => deleteOnlineSession(person, sessionId));
  if (result.outcome === "deleted") revalidatePath("/sesi-daring");
  return result;
}

/**
 * **Tandai terlaksana** — status only (#152). Legacy for online now (#318): an online Session is born
 * `delivered`, so this reaches only a Session arranged before #318. The shared write with the offline
 * surface; this action revalidates its own route, as convention keeps honest.
 */
export async function markOnlineSessionDeliveredAction(
  sessionId: string,
): Promise<MarkDeliveredResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => markSessionDelivered(person, sessionId));
  if (result.outcome === "delivered") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}

/** **Batalkan Sesi** — the shared cancel write; the reason travels in the same call, by CHECK. Legacy for online (#318). */
export async function cancelOnlineSessionAction(
  sessionId: string,
  reason: string,
): Promise<CancelSessionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => cancelSession(person, sessionId, reason));
  if (result.outcome === "cancelled") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}
