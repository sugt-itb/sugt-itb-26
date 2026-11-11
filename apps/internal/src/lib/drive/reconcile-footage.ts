import {
  claimPerjadinFootageFolder,
  claimSessionFootageFolder,
  footageReconcileTarget,
  markFootageSynced,
  markFootageSyncFailed,
  type Person,
} from "@sugt/db/queries";

import { perjadinFolderName } from "../perjadin-name";
import { ensureFootageFolders } from "./dokumen-folders";
import type { ReadyFolders } from "./fixed-folders";
import { footageFileName, sessionFootageFolderName } from "./footage-files";
import { type DriveClient, isDriveFailure, isLinkShared } from "./google";
import { reassertPerjadinFolderName } from "./reconcile";

/**
 * **Put one file of Session Footage in place in Drive** (#424, ADR-0046) — the footage's counterpart
 * to `reconcileDocument`, one folder deeper. Idempotent, so the upload, Periksa koneksi's sweep and a
 * reconnect all run the same code, and holding no row lock across a call to Google:
 *
 * 1. **The fixed footage folders** (`ensureFootageFolders`), made if a connection predates them.
 * 2. **The Perjadin's folder** under `Foto & Video/Pelaksanaan Offline`, named as its receipts and
 *    Dokumen folders, claimed by compare-and-set; its name is re-asserted, as theirs is.
 * 3. **The Session's folder** in it, `{held_on} · {HH.MM} · {School} · S-{session8}`, claimed the same
 *    way. A trashed or missing folder is not remade: the footage waits, unsynced, as a document does.
 * 4. **The file**, moved out of `_staging`, named and tagged with `sugtFootageId`.
 * 5. **Shared** anyone/reader — the file only; every folder stays private.
 * 6. **`drive_synced_at`** set.
 *
 * A failure leaves the footage recorded and "belum tersinkron", and remembers the attempt.
 */

export type FootageUnsyncedReason =
  | "folder-trashed"
  | "folder-missing"
  | "file-trashed"
  | "file-missing"
  /** `Foto & Video/` kept changing under this run; the next one finishes it. */
  | "footage-folders-busy"
  | "drive-failed";

export type FootageReconcileResult =
  | { outcome: "synced" }
  | { outcome: "unsynced"; reason: FootageUnsyncedReason }
  | { outcome: "no-such-footage" };

export async function reconcileFootage(
  person: Person,
  drive: DriveClient,
  folders: ReadyFolders,
  footageId: string,
): Promise<FootageReconcileResult> {
  const result = await reconcileOnce(person, drive, folders, footageId);
  if (result.outcome === "unsynced") await markFootageSyncFailed(person, footageId);
  return result;
}

async function reconcileOnce(
  person: Person,
  drive: DriveClient,
  folders: ReadyFolders,
  footageId: string,
): Promise<FootageReconcileResult> {
  const target = await footageReconcileTarget(person, footageId);
  if (!target) return { outcome: "no-such-footage" };
  const perjadinId = target.perjadin.id;

  try {
    // 1. The fixed footage folders.
    const fixed = await ensureFootageFolders(person, drive, folders.rootFolderId);
    if (!fixed) return { outcome: "unsynced", reason: "footage-folders-busy" };

    // 2. The Perjadin's footage folder.
    let tripFolderId = target.perjadinFolderId;
    if (!tripFolderId) {
      const made = await drive.createFolder({
        name: perjadinFolderName(target.perjadin),
        parentId: fixed.pelaksanaanOfflineFolderId,
        appProperties: { sugtPerjadinId: perjadinId },
      });
      tripFolderId = await claimPerjadinFootageFolder(person, perjadinId, made.id);
      if (tripFolderId !== made.id) await drive.trashFile(made.id);
    }
    const tripFolder = await drive.getFile(tripFolderId);
    if (!tripFolder) return { outcome: "unsynced", reason: "folder-missing" };
    if (tripFolder.trashed) return { outcome: "unsynced", reason: "folder-trashed" };
    await reassertPerjadinFolderName(person, drive, perjadinId, tripFolder);

    // 3. The Session's folder.
    let sessionFolderId = target.sessionFolderId;
    if (!sessionFolderId) {
      const made = await drive.createFolder({
        name: sessionFootageFolderName(target.session),
        parentId: tripFolderId,
        appProperties: { sugtPerjadinId: perjadinId, sugtSessionId: target.session.sessionId },
      });
      sessionFolderId = await claimSessionFootageFolder(person, target.session.sessionId, made.id);
      if (sessionFolderId !== made.id) await drive.trashFile(made.id);
    }
    const sessionFolder = await drive.getFile(sessionFolderId);
    if (!sessionFolder) return { outcome: "unsynced", reason: "folder-missing" };
    if (sessionFolder.trashed) return { outcome: "unsynced", reason: "folder-trashed" };

    // 4. The file, out of `_staging`.
    const file = await drive.getFile(target.driveFileId);
    if (!file) return { outcome: "unsynced", reason: "file-missing" };
    if (file.trashed) return { outcome: "unsynced", reason: "file-trashed" };
    if (file.parents.includes(folders.stagingFolderId)) {
      await drive.updateFile(target.driveFileId, {
        name: footageFileName({
          footageId: target.footageId,
          heldOn: target.session.heldOn,
          schoolName: target.session.schoolName,
          kind: target.kind,
          contentType: target.contentType,
        }),
        addParent: sessionFolderId,
        removeParent: folders.stagingFolderId,
        appProperties: { sugtPerjadinId: perjadinId, sugtFootageId: target.footageId },
      });
    }

    // 5. Share the file, last — and only the file.
    const shared = isLinkShared(await drive.listPermissions(target.driveFileId));
    if (!shared) {
      await drive.createPermission(target.driveFileId, { type: "anyone", role: "reader" });
    }
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "unsynced", reason: "drive-failed" };
    throw error;
  }

  // 6.
  await markFootageSynced(person, footageId);
  return { outcome: "synced" };
}
