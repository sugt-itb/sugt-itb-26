"use server";

import { randomUUID } from "node:crypto";

import { driveAccessToken } from "-/lib/drive/access-token";
import { type DriveClient, isDriveFailure, openDrive } from "-/lib/drive/google";
import { SNIFF_LENGTH, sniffReceiptType } from "-/lib/drive/receipt-files";
import { reconcileDocument } from "-/lib/drive/reconcile-document";
import { trashIfLive } from "-/lib/drive/trash-if-live";
import { driveRefusal, isStagedUploadFor, staffOnTrip } from "-/lib/drive/upload-guard";
import { requireEnv } from "-/lib/env";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  checkDocumentFields,
  deletePerjadinDocument,
  documentReconcileTarget,
  perjadinDokumen,
  requirePerjadinWriter,
  requireStaff,
  recordPerjadinDocument,
  type DocumentFields,
  type PerjadinDokumen,
} from "@sugt/db/queries";
import { MAX_UPLOAD_BYTES } from "@sugt/domain";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import type {
  DeleteDocumentActionResult,
  DocumentToOpen,
  DocumentToRecord,
  OpenDocumentSessionResult,
  RecordDocumentActionResult,
} from "./action-types";

/**
 * **The Dokumen dialog's Server Actions** (ADR-0042, #397, #398): the trip's documents, uploading
 * one, and deleting one. An upload runs Catat transaksi's order — check, verify, commit,
 * reconcile — and Hapus runs guard, trash, delete; both through the same guards
 * (`-/lib/drive/upload-guard`), because Google is reached before any query runs.
 */

/** The dialog's read: the trip's window, its Schools and its documents. Any signed-in Person. */
export async function perjadinDokumenAction(perjadinId: string): Promise<PerjadinDokumen | null> {
  const person = await requirePerson();
  return perjadinDokumen(person, perjadinId);
}

/**
 * Open one Drive resumable upload session for the dialog's PDF. **Every check runs before Google is
 * asked anything**: Staff and the Perjadin, the declared type — a PDF and nothing else — and size,
 * the document's fields against the trip (`checkDocumentFields`), and only then the connection. So
 * an SPPD for a School that already has one on this trip is refused before a byte is uploaded
 * (#441). The session opens in `_staging`, named `{uuid}.pdf`, carrying `sugtPerjadinId`, declaring
 * the exact size and the page's `Origin`, as a receipt's does.
 */
export async function openDocumentSessionAction(
  perjadinId: string,
  file: DocumentToOpen,
  fields: DocumentFields,
): Promise<OpenDocumentSessionResult> {
  const person = await requirePerson();

  if (!(await staffOnTrip(person, perjadinId))) return { outcome: "no-such-perjadin" };
  if (file.contentType !== "application/pdf") return { outcome: "not-pdf" };
  if (!(file.size > 0) || file.size > MAX_UPLOAD_BYTES) {
    return { outcome: "too-large", limit: MAX_UPLOAD_BYTES };
  }
  const checked = await staffSurface(() => checkDocumentFields(person, perjadinId, fields));
  if (checked.outcome !== "ok") return checked;

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);

  const origin = (await headers()).get("origin") ?? requireEnv("BETTER_AUTH_URL");
  try {
    const session = await openDrive(access.accessToken).openResumableSession({
      name: `${randomUUID()}.pdf`,
      parentId: access.folders.stagingFolderId,
      mimeType: "application/pdf",
      size: file.size,
      origin,
      appProperties: { sugtPerjadinId: perjadinId },
    });
    return { outcome: "ready", sessionUri: session.sessionUri };
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }
}

/**
 * Check the uploaded file in Drive before it is recorded — the server never saw the bytes. It must
 * sit in `_staging`, untrashed, carry this Perjadin's `sugtPerjadinId`, be no larger than the cap,
 * and its first bytes must be a PDF. The size is Drive's.
 */
async function verifyDocument(
  drive: DriveClient,
  stagingFolderId: string,
  perjadinId: string,
  driveFileId: string,
): Promise<{ byteSize: number } | "file-unverified" | "not-pdf"> {
  const file = await drive.getFile(driveFileId);
  if (!isStagedUploadFor(file, stagingFolderId, perjadinId)) return "file-unverified";
  const sniffed = sniffReceiptType(await drive.readRange(driveFileId, 0, SNIFF_LENGTH - 1));
  if (sniffed !== "application/pdf") return "not-pdf";
  return { byteSize: file.size };
}

/**
 * **Record one Perjadin Document whose PDF has landed in Drive** (ADR-0042):
 *
 * 1. **Check** — Staff, the Perjadin, the connection — before any Drive call.
 * 2. **Verify** the file (`verifyDocument`), then **validate** the fields against the trip
 *    (`checkDocumentFields`): the date inside it, a Peserta's or an SPPD's School one of the trip's
 *    Schools (#410), the times in order, no second SPPD for one School (#441). Either refusal
 *    records nothing, and leaves the file unnamed in private `_staging`.
 * 3. **Commit** the row and its Activity Log entry in one transaction (`recordPerjadinDocument`).
 * 4. **Reconcile** (`reconcileDocument`): name it, move it into its kind folder, share the file. If
 *    that fails the document still stands: `synced: false`, never an error.
 */
export async function recordDocumentAction(
  input: DocumentToRecord,
): Promise<RecordDocumentActionResult> {
  const person = await requirePerson();

  if (!(await staffOnTrip(person, input.perjadinId))) return { outcome: "no-such-perjadin" };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);
  const drive = openDrive(access.accessToken);

  let verified;
  try {
    verified = await verifyDocument(
      drive,
      access.folders.stagingFolderId,
      input.perjadinId,
      input.driveFileId,
    );
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }
  if (typeof verified === "string") return { outcome: verified };

  const { perjadinId, driveFileId, ...fields } = input;
  const checked = await staffSurface(() => checkDocumentFields(person, perjadinId, fields));
  if (checked.outcome !== "ok") return checked;

  const documentId = randomUUID();
  const result = await staffSurface(() =>
    recordPerjadinDocument(person, {
      ...fields,
      perjadinId,
      documentId,
      driveFileId,
      byteSize: verified.byteSize,
    }),
  );
  if (result.outcome !== "recorded") return result;

  // After the commit nothing may throw: an error would invite a retry that records the document
  // twice.
  const synced = await reconcileDocument(person, drive, access.folders, documentId).then(
    (reconciled) => reconciled.outcome === "synced",
    (error: unknown) => {
      console.error(`Reconcile of document ${documentId} threw after its commit.`, error);
      return false;
    },
  );
  revalidatePath("/pendamping");
  return { outcome: "recorded", documentId, synced };
}

/**
 * **Hapus — delete one Perjadin Document** (#398, ADR-0042). **The file is trashed first, then the
 * row**, so a row never vanishes while its public file stays live:
 *
 * 1. **Guard** — Staff, the document and its trip's writer (ADR-0048) — then the connection,
 *    before any Drive call. While Drive is not connected or is broken, Hapus is refused with the
 *    upload gate's reason.
 * 2. **Trash the file.** One already in the trash, or gone, counts as done: a retry is safe.
 * 3. **Delete the row and log `document_deleted`**, in one transaction (`deletePerjadinDocument`).
 *    If that fails after the trash, the row stays, pointing at a trashed file; Hapus again ends it.
 *
 * A document still unsynced, its file in `_staging`, is deleted the same way. An emptied kind
 * folder is left as it is.
 */
export async function deleteDocumentAction(
  documentId: string,
): Promise<DeleteDocumentActionResult> {
  const person = await requirePerson();

  const target = await staffSurface(async () => {
    requireStaff(person);
    const found = await documentReconcileTarget(person, documentId);
    // The trip's Group, a Perjadin Editor or an Administrator (ADR-0048), before the file is trashed.
    if (found) await requirePerjadinWriter(person, found.perjadin.id);
    return found;
  });
  if (!target) return { outcome: "no-such-document" };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return driveRefusal(person, access.outcome);

  try {
    await trashIfLive(openDrive(access.accessToken), target.driveFileId);
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "drive-unreachable" };
    throw error;
  }

  const result = await staffSurface(() => deletePerjadinDocument(person, documentId));
  if (result.outcome === "no-such-document") return result;
  revalidatePath("/pendamping");
  revalidatePath(`/perjadin/${result.perjadinId}`);
  return { outcome: "deleted" };
}
