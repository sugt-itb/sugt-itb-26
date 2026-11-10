import { driveCredentials, perjadinDriveFolder, type Person } from "@sugt/db/queries";

import { refreshDriveToken } from "./access-token";
import { openDrive } from "./google";
import { applyFootageFolderSharing } from "./session-footage-folder";

/**
 * **Re-share trips' Foto & Video folders after their writers changed** (#553, ADR-0061), so a member
 * who leaves a Group stops writing its footage at once (ADR-0048) rather than at the next click. Called
 * after a Group is set or its PIC changed, and after a Person is revoked, with the trips that touches.
 *
 * **Best effort, after the commit** — the pattern `renamePerjadinFolder` follows. The write has been
 * made; nothing here can fail it or roll it back. A trip with **no footage folder yet** is skipped
 * with no call to Google at all — its first click shares it — and so is every trip while the
 * connection is not `connected`. A failure is logged and left: Periksa koneksi's sharing pass, or the
 * next click on one of the trip's Sessions, puts it right.
 */
export async function reshareFootageFolders(
  person: Person,
  perjadinIds: readonly string[],
): Promise<void> {
  try {
    const trips = await Promise.all(perjadinIds.map((id) => perjadinDriveFolder(person, id)));
    const folders = trips.flatMap((trip) =>
      trip?.driveFootageFolderId
        ? [{ perjadinId: trip.naming.id, folderId: trip.driveFootageFolderId }]
        : [],
    );
    if (folders.length === 0) return;

    const credentials = await driveCredentials(person);
    if (credentials?.status !== "connected") return;
    const token = await refreshDriveToken(person, credentials);
    if (token.outcome !== "ok") return;
    const drive = openDrive(token.accessToken);

    for (const { perjadinId, folderId } of folders) {
      await applyFootageFolderSharing(person, drive, perjadinId, folderId).catch(
        (error: unknown) => {
          console.error(`Re-sharing Perjadin ${perjadinId}'s footage folder failed.`, error);
        },
      );
    }
  } catch (error) {
    console.error(`Re-sharing the footage folders of ${perjadinIds.join(", ")} failed.`, error);
  }
}
