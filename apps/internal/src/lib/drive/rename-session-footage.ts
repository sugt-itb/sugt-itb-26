import {
  driveCredentials,
  sessionFootageFolders,
  sessionFootageUploadFolders,
  type Person,
  type SessionFootageFolder,
  type SessionFootageUploadFolder,
} from "@sugt/db/queries";

import { refreshDriveToken } from "./access-token";
import { footageFileName, sessionFootageFolderName } from "./footage-files";
import { type DriveClient, openDrive } from "./google";

/**
 * **Keep a Session's footage named for its date and start time** (#424, ADR-0046). The Session's
 * folder and every placed file in it carry the date; the folder carries the start time and the
 * School too. When a Session moves — `/sesi/[id]`'s "Ubah tanggal & jam", or Ubah Sesi on the trip —
 * `renameSessionFootage` renames them right after the change commits; Periksa koneksi re-asserts
 * every Session's (`reassertSessionFootageNames`), which also picks up a School renamed since.
 */

export type SessionFootageNameResult = {
  /** Names changed: the folder and the files together. */
  renamed: number;
  /** The folder could not be named, and so its files were left alone. */
  problem: "folder-trashed" | "folder-missing" | null;
  /** `false` when the deadline came first: the folder keeps its old name, so the next pass resumes. */
  finished: boolean;
};

/**
 * Put one Session's footage folder and its files under their right names. **The files go first and
 * the folder last**, so a folder already carrying its right name means its files do too: a pass over
 * a Session that needs nothing costs one read, however many files it holds. A file that has gone, or
 * is in the trash, is skipped. Past `deadline` it stops between files, before the folder, so a later
 * pass picks up where it stopped. A Drive failure throws, for the caller to answer.
 */
export async function reassertSessionFootageNames(
  drive: DriveClient,
  folder: SessionFootageFolder,
  deadline = Number.POSITIVE_INFINITY,
): Promise<SessionFootageNameResult> {
  const { naming } = folder;
  const found = await drive.getFile(folder.folderId);
  if (!found) return { renamed: 0, problem: "folder-missing", finished: true };
  if (found.trashed) return { renamed: 0, problem: "folder-trashed", finished: true };

  const folderName = sessionFootageFolderName(naming);
  if (found.name === folderName) return { renamed: 0, problem: null, finished: true };

  let renamed = 0;
  for (const placed of folder.files) {
    if (Date.now() > deadline) return { renamed, problem: null, finished: false };
    const file = await drive.getFile(placed.driveFileId);
    if (!file || file.trashed) continue;
    const name = footageFileName({
      ...placed,
      heldOn: naming.heldOn,
      schoolName: naming.schoolName,
    });
    if (file.name !== name) {
      await drive.updateFile(placed.driveFileId, { name });
      renamed += 1;
    }
  }
  await drive.updateFile(folder.folderId, { name: folderName });
  return { renamed: renamed + 1, problem: null, finished: true };
}

/**
 * Put one Session's **upload folder** (#561, ADR-0063) under the archive folder's name. Only the
 * folder: the files in it are Staff-owned, and the app never renames them. A trashed or missing
 * folder is reported and left alone. A Drive failure throws, for the caller to answer.
 */
export async function reassertSessionUploadFolderName(
  drive: DriveClient,
  upload: SessionFootageUploadFolder,
): Promise<Omit<SessionFootageNameResult, "finished">> {
  const found = await drive.getFile(upload.folderId);
  if (!found) return { renamed: 0, problem: "folder-missing" };
  if (found.trashed) return { renamed: 0, problem: "folder-trashed" };
  const name = sessionFootageFolderName(upload.naming);
  if (found.name === name) return { renamed: 0, problem: null };
  await drive.updateFile(upload.folderId, { name });
  return { renamed: 1, problem: null };
}

/**
 * **Rename one Session's footage after its date or time changed** — best effort, after the commit,
 * like `renamePerjadinFolder`: a Session with no footage folder costs one read, and any failure is
 * logged and left to Periksa koneksi. Never throws, so it cannot undo the change it follows.
 */
export async function renameSessionFootage(person: Person, sessionId: string): Promise<void> {
  try {
    const [[folder], [upload]] = await Promise.all([
      sessionFootageFolders(person, sessionId),
      sessionFootageUploadFolders(person, sessionId),
    ]);
    if (!folder && !upload) return;

    const credentials = await driveCredentials(person);
    if (credentials?.status !== "connected") return;
    const token = await refreshDriveToken(person, credentials);
    if (token.outcome !== "ok") return;

    const drive = openDrive(token.accessToken);
    if (folder) await reassertSessionFootageNames(drive, folder);
    // The upload folder (#561) takes the same name; the Staff-owned files in it are never renamed.
    if (upload) await reassertSessionUploadFolderName(drive, upload);
  } catch (error) {
    console.error(`Renaming the footage of Session ${sessionId} in Drive failed.`, error);
  }
}
