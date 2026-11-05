import { driveCredentials, perjadinDriveFolder, type Person } from "@sugt/db/queries";

import { perjadinFolderName } from "../perjadin-name";
import { refreshDriveToken } from "./access-token";
import { openDrive } from "./google";

/**
 * **Rename a Perjadin's Drive folders after its name changed** (#376, #407, ADR-0040), so the company
 * Drive shows `perjadinFolderName` (ADR-0044) — its receipts folder and, once it has one, its Dokumen
 * folder (ADR-0042). Called when either of the trip's dates is corrected, and when a Session write
 * changes the trip's Schools: a Session added at a School not yet on it, one moved to another
 * School, or a School's last live Session cancelled. File names carry neither, so nothing else moves.
 * A Sub-Cluster rename calls nothing: the next reconcile on each trip, or Periksa koneksi, re-asserts
 * the name.
 *
 * **Best effort, after the commit.** The write has already been made; nothing here can fail it or
 * roll it back. A trip with no Drive folder yet, or a connection that is not `connected`, makes no
 * call to Google at all. The fixed tree need not be resolved — renaming one folder by its id needs
 * none of it. A rename that fails is logged and left: the next reconcile that touches this Perjadin —
 * an Unggah bukti on it, or a sweep that reaches one of its unsynced lines — or the
 * next press of Periksa koneksi re-asserts the name, because names are app-owned. Until one does, the
 * folder keeps the old name.
 */
export async function renamePerjadinFolder(person: Person, perjadinId: string): Promise<void> {
  try {
    const trip = await perjadinDriveFolder(person, perjadinId);
    // The receipts folder, the Dokumen folder (ADR-0042) and the Foto & Video folder (ADR-0046)
    // carry the same name.
    const folderIds = [
      trip?.driveFolderId,
      trip?.driveDokumenFolderId,
      trip?.driveFootageFolderId,
    ].filter((id): id is string => Boolean(id));
    if (!trip || folderIds.length === 0) return;

    const credentials = await driveCredentials(person);
    if (credentials?.status !== "connected") return;
    const token = await refreshDriveToken(person, credentials);
    if (token.outcome !== "ok") return;

    const drive = openDrive(token.accessToken);
    const name = perjadinFolderName(trip.naming);
    await Promise.all(folderIds.map((id) => drive.updateFile(id, { name })));
  } catch (error) {
    console.error(`Renaming the Drive folder of Perjadin ${perjadinId} failed.`, error);
  }
}
