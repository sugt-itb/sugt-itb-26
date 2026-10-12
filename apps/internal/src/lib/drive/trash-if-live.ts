import { type DriveClient, DriveRequestError } from "./google";

/**
 * **Move a file to the Drive trash, unless it is there already or gone** — both count as done, so a
 * Hapus that failed after this step can simply be pressed again (ADR-0042). Shared by the Dokumen, the
 * Foto & Video and the receipt Hapus.
 */
export async function trashIfLive(drive: DriveClient, driveFileId: string): Promise<void> {
  const file = await drive.getFile(driveFileId);
  if (!file || file.trashed) return;
  await drive.trashFile(driveFileId).catch((error: unknown) => {
    // Gone between the read and the trash: done all the same.
    if (error instanceof DriveRequestError && error.status === 404) return;
    throw error;
  });
}

/**
 * **Take a file back out of the Drive trash** — a receipt Hapus whose delete the database refused
 * after the trash, because a concurrent Hapus left this receipt the line's only one (ADR-0050). Its
 * row stands, so its link must open again. A file gone for good cannot come back: done all the same.
 */
export async function untrashIfPresent(drive: DriveClient, driveFileId: string): Promise<void> {
  await drive.untrashFile(driveFileId).catch((error: unknown) => {
    if (error instanceof DriveRequestError && error.status === 404) return;
    throw error;
  });
}
