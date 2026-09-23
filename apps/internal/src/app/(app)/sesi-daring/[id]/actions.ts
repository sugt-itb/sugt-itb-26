"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  addOnlineSessionTeacher,
  cancelSession,
  markSessionDelivered,
  removeOnlineSessionTeacher,
  renameOnlineSessionTeacher,
  updateOnlineSession,
  type AddOnlineSessionTeacherResult,
  type CancelSessionResult,
  type MarkDeliveredResult,
  type OnlineSessionInput,
  type RemoveOnlineSessionTeacherResult,
  type RenameOnlineSessionTeacherResult,
  type UpdateOnlineSessionResult,
} from "@sugt/db/queries";
import { revalidatePath } from "next/cache";

/**
 * **Detail Sesi daring's writes**, each beside the route that offers it (#152) — the online
 * counterpart of `/perjadin/[id]/actions.ts`. Each is the same three lines: resolve the Person, hand
 * it to `@sugt/db`, return what came back.
 *
 * None opens a transaction — the boundary is convention 5's and lives in the query function. None
 * re-checks Staff: `requireStaff` inside each query is the only thing that closes this path, since a
 * layout does not run before a Server Action. `staffSurface` turns that thrown `NotStaffError` into a
 * **403** server-side rather than a crash; every other refusal comes back as a value the client
 * renders. `revalidatePath` clears the client router cache for the page just written — called only on
 * the outcome that wrote something, since a refused write left the page correct.
 */

/** Edit the Session's scalar fields — School, Peserta, date, start and end time (#284: no PIC, no Aliran) — in one write. */
export async function updateOnlineSessionAction(
  sessionId: string,
  input: OnlineSessionInput,
): Promise<UpdateOnlineSessionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => updateOnlineSession(person, sessionId, input));
  if (result.outcome === "updated") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}

/** Add one session-scoped Pengajar name. */
export async function addOnlineSessionTeacherAction(
  sessionId: string,
  name: string,
): Promise<AddOnlineSessionTeacherResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => addOnlineSessionTeacher(person, sessionId, name));
  if (result.outcome === "added") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}

/**
 * Rename one Pengajar name. `sessionId` is passed for revalidation only — the query takes the name's
 * id and needs no Session to find it.
 */
export async function renameOnlineSessionTeacherAction(
  sessionId: string,
  teacherId: string,
  name: string,
): Promise<RenameOnlineSessionTeacherResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => renameOnlineSessionTeacher(person, teacherId, name));
  if (result.outcome === "renamed") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}

/** Remove one Pengajar name. */
export async function removeOnlineSessionTeacherAction(
  sessionId: string,
  teacherId: string,
): Promise<RemoveOnlineSessionTeacherResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => removeOnlineSessionTeacher(person, teacherId));
  if (result.outcome === "removed") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}

/**
 * **Tandai terlaksana** — status only now (#152), so no teachers travel. The shared write with the
 * offline surface; this action revalidates its own route, as convention keeps honest.
 */
export async function markOnlineSessionDeliveredAction(
  sessionId: string,
): Promise<MarkDeliveredResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => markSessionDelivered(person, sessionId));
  if (result.outcome === "delivered") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}

/** **Batalkan Sesi** — the shared cancel write; the reason travels in the same call, by CHECK. */
export async function cancelOnlineSessionAction(
  sessionId: string,
  reason: string,
): Promise<CancelSessionResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => cancelSession(person, sessionId, reason));
  if (result.outcome === "cancelled") revalidatePath(`/sesi-daring/${sessionId}`);
  return result;
}
