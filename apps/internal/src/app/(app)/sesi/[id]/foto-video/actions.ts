"use server";

import { randomUUID } from "node:crypto";

import { driveAccessToken } from "-/lib/drive/access-token";
import {
  DECLARABLE_FOOTAGE_TYPES,
  FOOTAGE_SNIFF_LENGTH,
  footageExtension,
  sniffFootageType,
} from "-/lib/drive/footage-files";
import { type DriveClient, isDriveFailure, openDrive } from "-/lib/drive/google";
import { reconcileFootage } from "-/lib/drive/reconcile-footage";
import { trashIfLive } from "-/lib/drive/trash-if-live";
import { driveRefusal, isStagedUploadFor } from "-/lib/drive/upload-guard";
import { requireEnv } from "-/lib/env";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  deleteSessionFootage,
  footageReconcileTarget,
  footageSession,
  recordSessionFootage,
  requirePerjadinWriter,
  requireStaff,
  sessionFootageList,
  type SessionFootageRow,
} from "@sugt/db/queries";
import {
  MAX_FOOTAGE_BYTES,
  MAX_FOOTAGE_VIDEO_BYTES,
  SESSION_FOOTAGE_CONTENT_TYPES,
  type SessionFootageContentType,
} from "@sugt/domain";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import type {
  DeleteFootageActionResult,
  FootageToOpen,
  FootageToRecord,
  OpenFootageUploadResult,
  RecordFootageActionResult,
} from "./action-types";

/**
 * **Foto & Video's Server Actions** (#424, ADR-0046): a Session's footage, opening an upload,
 * recording it once it landed, and deleting it. The upload runs Dokumen's order — check, verify,
 * commit, reconcile — and Hapus runs guard, trash, delete (ADR-0042), every check before Google is
 * asked anything. The trip's Group, a Perjadin Editor or an Administrator uploads and deletes (ADR-0048);
 * anyone signed in lists.
 *
 * **The bytes never pass through Next.** The browser sends the file straight to Drive's resumable
 * session, in 16 MiB pieces (`uploadInPieces`), one file at a time.
 */

/** A Session's footage, newest first. Any signed-in Person. */
export async function sessionFootageAction(sessionId: string): Promise<SessionFootageRow[]> {
  const person = await requirePerson();
  return sessionFootageList(person, sessionId);
}

/**
 * **Open one resumable upload for one file of footage.** Staff, then the Session — offline, not
 * cancelled — then the declared type and size against its kind's cap, and only then the connection.
 * The session opens in `_staging`, named `{uuid}.{ext}`, tagged with the trip's `sugtPerjadinId` and
 * the `sugtSessionId`, declaring the exact size and the page's `Origin`.
 */
export async function openFootageUploadAction(
  sessionId: string,
  file: FootageToOpen,
): Promise<OpenFootageUploadResult> {
  const person = await requirePerson();

  const target = await staffSurface(() => footageSession(person, sessionId));
  if (target.outcome !== "ok") return target;

  const kind = Object.hasOwn(DECLARABLE_FOOTAGE_TYPES, file.contentType)
    ? DECLARABLE_FOOTAGE_TYPES[file.contentType]!
    : null;
  if (!kind) return { outcome: "unsupported-type" };
  const limit = MAX_FOOTAGE_BYTES[kind];
  if (!(file.size > 0) || file.size > limit) return { outcome: "too-large", kind, limit };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);

  const origin = (await headers()).get("origin") ?? requireEnv("BETTER_AUTH_URL");
  // Named for what the browser declared until the reconcile names it for what it is.
  const declared = (
    file.contentType === "image/heif" ? "image/heic" : file.contentType
  ) as SessionFootageContentType;
  try {
    const session = await openDrive(access.accessToken).openResumableSession({
      name: `${randomUUID()}.${footageExtension(declared)}`,
      parentId: access.folders.stagingFolderId,
      mimeType: file.contentType,
      size: file.size,
      origin,
      appProperties: { sugtPerjadinId: target.perjadinId, sugtSessionId: sessionId },
    });
    return { outcome: "ready", sessionUri: session.sessionUri, kind };
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }
}

/**
 * Check the landed file in Drive — the server never saw the bytes. It must sit in `_staging`,
 * untrashed, carry this trip's `sugtPerjadinId` and this Session's `sugtSessionId`, and its first
 * bytes must be one of the six types, of the kind the browser declared, within that kind's cap by
 * Drive's own count.
 */
async function verifyFootage(
  drive: DriveClient,
  stagingFolderId: string,
  perjadinId: string,
  input: FootageToRecord,
): Promise<
  | { contentType: SessionFootageContentType; byteSize: number }
  | Extract<
      RecordFootageActionResult,
      { outcome: "file-unverified" | "unsupported-type" | "type-mismatch" | "too-large" }
    >
> {
  const file = await drive.getFile(input.driveFileId);
  if (
    !isStagedUploadFor(file, stagingFolderId, perjadinId, MAX_FOOTAGE_VIDEO_BYTES) ||
    // Opened for this very Session: not another Session's upload, nor a receipt still in `_staging`.
    file.appProperties.sugtSessionId !== input.sessionId
  ) {
    return { outcome: "file-unverified" };
  }
  const sniffed = sniffFootageType(
    await drive.readRange(input.driveFileId, 0, FOOTAGE_SNIFF_LENGTH - 1),
  );
  if (!sniffed) return { outcome: "unsupported-type" };
  const kind = SESSION_FOOTAGE_CONTENT_TYPES[sniffed];
  if (DECLARABLE_FOOTAGE_TYPES[input.contentType] !== kind) return { outcome: "type-mismatch" };
  if (file.size > MAX_FOOTAGE_BYTES[kind]) {
    return { outcome: "too-large", kind, limit: MAX_FOOTAGE_BYTES[kind] };
  }
  return { contentType: sniffed, byteSize: file.size };
}

/**
 * **Record one file of footage that has landed in Drive** (ADR-0046):
 *
 * 1. **Check** — Staff, the Session, the connection — before any Drive call.
 * 2. **Verify** the file (`verifyFootage`). A refusal records nothing and leaves the file unnamed in
 *    private `_staging`.
 * 3. **Commit** the row and its `footage_uploaded` entry in one transaction (`recordSessionFootage`),
 *    under the sniffed type and Drive's size.
 * 4. **Reconcile** (`reconcileFootage`): the folders, the name, the file shared. If that fails the
 *    footage still stands: `synced: false`, never an error.
 */
export async function recordFootageAction(
  input: FootageToRecord,
): Promise<RecordFootageActionResult> {
  const person = await requirePerson();

  const target = await staffSurface(() => footageSession(person, input.sessionId));
  if (target.outcome !== "ok") return target;

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);
  const drive = openDrive(access.accessToken);

  let verified;
  try {
    verified = await verifyFootage(drive, access.folders.stagingFolderId, target.perjadinId, input);
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }
  if ("outcome" in verified) return verified;

  const footageId = randomUUID();
  const result = await staffSurface(() =>
    recordSessionFootage(person, {
      footageId,
      sessionId: input.sessionId,
      contentType: verified.contentType,
      originalFilename: input.originalFilename,
      driveFileId: input.driveFileId,
      byteSize: verified.byteSize,
    }),
  );
  if (result.outcome !== "recorded") return result;

  // After the commit nothing may throw. A retry is safe anyway: the same file answers its first row.
  const synced = await reconcileFootage(person, drive, access.folders, result.footageId).then(
    (reconciled) => reconciled.outcome === "synced",
    (error: unknown) => {
      console.error(`Reconcile of footage ${result.footageId} threw after its commit.`, error);
      return false;
    },
  );
  revalidatePath(`/sesi/${input.sessionId}`);
  revalidatePath("/pendamping");
  return { outcome: "recorded", footageId: result.footageId, synced };
}

/**
 * **Hapus — delete one file of footage** (ADR-0042's order, ADR-0046). **The file is trashed first,
 * then the row**, so a row never vanishes while its public file stays live:
 *
 * 1. **Guard** — Staff, the footage and its trip's writer (ADR-0048) — then the connection, before
 *    any Drive call.
 * 2. **Trash the file.** One already in the trash, or gone, counts as done: a retry is safe. If
 *    trashing fails the row stays, and Hapus can be pressed again.
 * 3. **Delete the row and log `footage_deleted`**, in one transaction (`deleteSessionFootage`).
 */
export async function deleteFootageAction(footageId: string): Promise<DeleteFootageActionResult> {
  const person = await requirePerson();

  const target = await staffSurface(async () => {
    requireStaff(person);
    const found = await footageReconcileTarget(person, footageId);
    // The trip's Group, a Perjadin Editor or an Administrator (ADR-0048), before the file is trashed.
    if (found) await requirePerjadinWriter(person, found.perjadin.id);
    return found;
  });
  if (!target) return { outcome: "no-such-footage" };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);

  try {
    await trashIfLive(openDrive(access.accessToken), target.driveFileId);
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }

  const result = await staffSurface(() => deleteSessionFootage(person, footageId));
  if (result.outcome === "no-such-footage") return result;
  revalidatePath(`/sesi/${result.sessionId}`);
  revalidatePath("/pendamping");
  return { outcome: "deleted" };
}
