import { formatWib } from "-/lib/format-wib";
import { driveUploadState, type Person } from "@sugt/db/queries";

import { readyFolders } from "./fixed-folders";
import { DRIVE_FOLDERS_UNRESOLVED, DRIVE_NOT_CONNECTED, driveBrokenSince } from "./upload-messages";

/**
 * **Can a file be uploaded to Drive right now?** (ADR-0040, #373) Every row's Unggah bukti and the
 * Dokumen dialog (ADR-0042) render disabled, with this reason, when it cannot
 * — wherever they render: the acquittal and the trip cards on `/pendamping`.
 *
 * The page's answer is a courtesy. The Server Actions refuse the same states themselves
 * (`driveAccessToken`), since nothing a page renders runs before a Server Action, and answer with
 * this same reason.
 */
export type UploadGate = { open: true } | { open: false; reason: string };

export async function uploadGate(person: Person): Promise<UploadGate> {
  const state = await driveUploadState(person);
  if (!state) return { open: false, reason: DRIVE_NOT_CONNECTED };
  if (state.status === "broken") {
    // `drive_connection_broken_at_check` guarantees a broken row has `broken_at`.
    return { open: false, reason: driveBrokenSince(formatWib(state.brokenAt!)) };
  }
  if (!readyFolders(state)) return { open: false, reason: DRIVE_FOLDERS_UNRESOLVED };
  return { open: true };
}
