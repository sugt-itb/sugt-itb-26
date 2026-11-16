import {
  driveCredentials,
  perjadinDriveFolder,
  uploadPerjadinsOfMember,
  type Person,
} from "@sugt/db/queries";

import { refreshDriveToken } from "./access-token";
import { openDrive } from "./google";
import { applyFootageUploadSharing } from "./session-footage-folder";

/**
 * **Re-share trips' Foto & Video upload folders after their writers changed** (#563, ADR-0063), so a
 * member who leaves a Group stops being able to add footage at once (ADR-0048) rather than at the next
 * Foto & Video click. Called after a Group is set or its PIC changed, and after a Person is revoked,
 * with the trips that touches. Only the upload tree: the archive's link shares name nobody.
 *
 * **Best effort, after the commit** — the pattern `renamePerjadinFolder` follows. The write has been
 * made; nothing here can fail it or roll it back. A trip with **no upload folder yet** is skipped with
 * no call to Google at all — its first Foto & Video click shares it — and so is every trip while the
 * connection is not `connected`. A folder in the Drive trash, or gone, is skipped. A failure is logged
 * and left: Periksa koneksi's sharing pass, or the next Foto & Video click on the trip, puts it right.
 */
export async function reshareUploadFolders(
  person: Person,
  perjadinIds: readonly string[],
): Promise<void> {
  try {
    const trips = await Promise.all(perjadinIds.map((id) => perjadinDriveFolder(person, id)));
    const folders = trips.flatMap((trip) =>
      trip?.driveFootageUploadFolderId
        ? [{ perjadinId: trip.naming.id, folderId: trip.driveFootageUploadFolderId }]
        : [],
    );
    if (folders.length === 0) return;

    const credentials = await driveCredentials(person);
    if (credentials?.status !== "connected") return;
    const token = await refreshDriveToken(person, credentials);
    if (token.outcome !== "ok") {
      console.error(
        `Re-sharing Foto & Video upload folders skipped: Drive answered ${token.outcome}.`,
      );
      return;
    }
    const drive = openDrive(token.accessToken);

    for (const { perjadinId, folderId } of folders) {
      try {
        const folder = await drive.getFile(folderId);
        if (!folder || folder.trashed) continue;
        await applyFootageUploadSharing(person, drive, perjadinId, folderId);
      } catch (error) {
        console.error(`Re-sharing Perjadin ${perjadinId}'s upload folder failed.`, error);
      }
    }
  } catch (error) {
    console.error(`Re-sharing the upload folders of ${perjadinIds.join(", ")} failed.`, error);
  }
}

/**
 * **Re-share the upload folders of every trip whose Group this Person is in** — after they are
 * revoked (#563). The read of those trips is inside the same best effort: once the revocation has
 * committed, nothing here may fail it, a database hiccup included. A Perjadin Editor's or an
 * Administrator's reach over every trip is left to Periksa koneksi's sharing pass.
 */
export async function reshareMemberUploadFolders(person: Person, personId: string): Promise<void> {
  let perjadinIds: string[];
  try {
    perjadinIds = await uploadPerjadinsOfMember(person, personId);
  } catch (error) {
    console.error(
      `Reading the trips of Person ${personId} to re-share their upload folders failed.`,
      error,
    );
    return;
  }
  await reshareUploadFolders(person, perjadinIds);
}
