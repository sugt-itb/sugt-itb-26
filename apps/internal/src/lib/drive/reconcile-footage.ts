import {
  footageReconcileTarget,
  markFootageSynced,
  markFootageSyncFailed,
  type Person,
} from "@sugt/db/queries";

import type { ReadyFolders } from "./fixed-folders";
import { footageFileName } from "./footage-files";
import { type DriveClient, isDriveFailure, isLinkShared } from "./google";
import {
  ensureSessionFootageFolder,
  type FootageFolderUnavailable,
} from "./session-footage-folder";

/**
 * **Put one file of Session Footage in place in Drive** (#424, ADR-0046) — the footage's counterpart
 * to `reconcileDocument`, one folder deeper. Since #552 (ADR-0061) nothing uploads footage through
 * the app any more, so only Periksa koneksi's sweep runs this, to finish files an upload left
 * unsynced. Idempotent, and holding no row lock across a call to Google:
 *
 * 1–3. **The folders** (`ensureSessionFootageFolder`, shared with the Foto & Video button): the
 *    fixed footage folders, the Perjadin's and the Session's. A trashed or missing folder is not
 *    remade: the footage waits, unsynced, as a document does.
 * 4. **The file**, moved out of `_staging`, named and tagged with `sugtFootageId`.
 * 5. **Shared** anyone/reader — the file only; every folder stays private.
 * 6. **`drive_synced_at`** set.
 *
 * A failure leaves the footage recorded and "belum tersinkron", and remembers the attempt.
 */

export type FootageUnsyncedReason =
  | FootageFolderUnavailable
  | "file-trashed"
  | "file-missing"
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
    // 1–3. The fixed folders, the Perjadin's and the Session's — shared with the Foto & Video button.
    const ensured = await ensureSessionFootageFolder(person, drive, folders, target);
    if (ensured.outcome !== "ok") return { outcome: "unsynced", reason: ensured.reason };
    const { sessionFolderId } = ensured;

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
