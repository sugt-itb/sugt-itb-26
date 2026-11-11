import type {
  FootageToOpen,
  FootageToRecord,
  OpenFootageUploadResult,
  RecordFootageActionResult,
} from "-/app/(app)/sesi/[id]/foto-video/action-types";
import { type ResumableUploadResult, uploadEach } from "-/lib/drive/resumable-upload";

import { footageFailureText, type PickedFootage } from "./foto-video-form";

/**
 * **One Unggah of Foto & Video** (#425, ADR-0046): each picked file in turn is opened, sent to Drive
 * in pieces, then recorded — its own open → upload → record, so one failing never sinks the rest, and
 * a phone holds one file in flight at a time. Everything that talks to the server or to Drive is
 * passed in, so the order and the outcomes are tested without either.
 */

export type FootageUploadDeps = {
  open: (sessionId: string, file: FootageToOpen) => Promise<OpenFootageUploadResult>;
  /**
   * Send one file to its resumable session. The status line names the file, not the bytes, as every
   * upload's does (#420), so no per-piece progress is asked for.
   */
  send: (sessionUri: string, file: File) => Promise<ResumableUploadResult>;
  record: (input: FootageToRecord) => Promise<RecordFootageActionResult>;
  /** Called as each file starts its upload and its save, for the popup's status line. */
  onStep?: (step: { phase: "uploading" | "saving"; index: number; total: number }) => void;
};

/** What became of one file: recorded — in place in Drive or not yet — or why not. */
export type FootageUploadOutcome = { ok: true; synced: boolean } | { ok: false; reason: string };

export async function uploadFootageBatch(
  sessionId: string,
  picked: readonly PickedFootage[],
  deps: FootageUploadDeps,
) {
  const total = picked.length;
  // `uploadEach` runs the files strictly in order, so the n-th call is the n-th picked file.
  let next = 0;

  return uploadEach<FootageUploadOutcome>(
    picked.map((entry) => entry.file),
    async (file) => {
      const index = next++;
      const entry = picked[index]!;
      deps.onStep?.({ phase: "uploading", index, total });

      const opened = await deps.open(sessionId, {
        size: file.size,
        contentType: entry.contentType,
      });
      if (opened.outcome !== "ready") return { ok: false, reason: footageFailureText(opened) };

      const sent = await deps.send(opened.sessionUri, file);
      if (sent.outcome !== "uploaded") return { ok: false, reason: footageFailureText(sent) };

      deps.onStep?.({ phase: "saving", index, total });
      const recorded = await deps.record({
        sessionId,
        driveFileId: sent.fileId,
        originalFilename: file.name,
        contentType: entry.contentType,
      });
      if (recorded.outcome !== "recorded") {
        return { ok: false, reason: footageFailureText(recorded) };
      }
      return { ok: true, synced: recorded.synced };
    },
    () => ({ ok: false, reason: footageFailureText({ outcome: "error" }) }),
  );
}
