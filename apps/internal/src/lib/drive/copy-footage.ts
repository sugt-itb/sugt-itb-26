import {
  claimFootageCopyLease,
  footageCopySessions,
  markFootageUploadChecked,
  releaseFootageCopyLease,
  sessionFootageFolderTarget,
  type DriveCaller,
  type FootageCopySession,
} from "@sugt/db/queries";

import type { ReadyFolders } from "./fixed-folders";
import { sessionFootageFolderName } from "./footage-files";
import {
  type DriveChild,
  type DriveClient,
  FOLDER_MIME_TYPE,
  grantsFullDrive,
  isDriveFailure,
  SHORTCUT_MIME_TYPE,
} from "./google";
import { ensureSessionFootageFolder } from "./session-footage-folder";

/**
 * **The daily Foto & Video copy** (#562, ADR-0063): as the company account, copy every file in each
 * Session's upload folder that is not yet in that Session's archive into the archive. A copy is the
 * company's, so a Staff member deleting their original, or their Google account, loses nothing.
 *
 * - **What is already copied is read from Drive**: every copy carries `sugtSourceFileId`, the
 *   original's id, so no row per file is kept. A renamed original is not copied again, and neither is
 *   an edited one (same id, new version).
 * - **Every file, whatever its type or size.** Trashed items and shortcuts are skipped. A subfolder
 *   becomes an archive subfolder of the same name, found again by `sugtSourceFolderId`.
 * - **Originals are never touched**, and nothing in either tree is ever deleted, trashed or moved.
 * - **Bounded and resumable**: it stops when `budgetMs` is up, taking Sessions oldest-checked first,
 *   and a Session goes to the back of the queue only once its whole folder has been gone through
 *   without a failure — so a file Google refused is tried again on the next pass.
 * - **One pass at a time**: a lease on the connection, claimed by compare-and-set.
 * - **Per file, a failure is reported and the pass goes on**, except a rate limit or a refused token,
 *   which stop the pass. Nothing is written to the Activity Log; failures are logged on the server.
 *
 * Run by the daily cron (`/api/cron/foto-video`) and by Periksa koneksi.
 */

/** How long one pass keeps going. Well inside the 60 seconds its routes declare as `maxDuration`. */
export const COPY_BUDGET_MS = 40_000;

/** How long the lease is held at most: past the budget and the route's own limit, so it frees itself. */
const LEASE_MS = 5 * 60_000;

/** Why one file, or one Session's folder, was not copied. */
export type FootageCopyFailureReason =
  /** Google refused for storage: "Penyimpanan Google Drive pengunggah penuh". */
  | "storage-full"
  /** Google refuses to copy this file (its owner forbade copying, say). */
  | "copy-refused"
  /** Too many requests: the pass stopped, and the next one carries on. */
  | "rate-limited"
  /** Google refused the token mid-pass: the pass stopped. */
  | "token-refused"
  /** The archive or upload Session folder is in the Drive trash, or the trip's archive folder is. */
  | "folder-trashed"
  | "folder-missing"
  /** Anything else Google answered: a 5xx, no answer. Tried again on the next pass. */
  | "drive-failed";

export type FootageCopyFailure = {
  sessionId: string;
  /** The Session's folder name — `{held_on} · {HH.MM} · {School} · S-{session8}`. */
  sessionName: string;
  /** The file's own name; `null` when the whole Session's folder failed. */
  fileName: string | null;
  /** The uploader's email, when Drive says who owns the original. */
  uploader: string | null;
  reason: FootageCopyFailureReason;
};

export type FootageCopyReport =
  | {
      ran: true;
      copied: number;
      failed: number;
      /** Sessions this pass did not finish: past the budget, or after a stop. */
      remaining: number;
      failures: FootageCopyFailure[];
    }
  | {
      ran: false;
      /**
       * `scope-missing`: the connection lacks the full `drive` scope — an Administrator reconnects.
       * `busy`: another pass holds the lease.
       */
      reason: "scope-missing" | "busy";
    };

/** A failure that stops the whole pass rather than one file. */
class StopPass extends Error {
  constructor(readonly reason: "rate-limited" | "token-refused") {
    super(reason);
  }
}

/** What Google's refusal means for one file, or that the pass must stop. */
function failureOf(error: unknown): FootageCopyFailureReason {
  if (!isDriveFailure(error)) throw error;
  const { status, reason } = error;
  if (status === 401) throw new StopPass("token-refused");
  if (
    status === 429 ||
    reason === "rateLimitExceeded" ||
    reason === "userRateLimitExceeded" ||
    reason === "RESOURCE_EXHAUSTED"
  ) {
    throw new StopPass("rate-limited");
  }
  if (reason === "storageQuotaExceeded" || reason === "quotaExceeded") return "storage-full";
  if (status === 403 || status === 400) return "copy-refused";
  return "drive-failed";
}

/**
 * **Run one pass**, as `caller` — the cron, or an Administrator's Periksa koneksi. `scope` is what the
 * token just refreshed carries: without the full `drive` scope nothing runs. `folders` is the usable
 * fixed tree, for making a missing archive folder.
 */
export async function copyFootageToArchive(
  caller: DriveCaller,
  drive: DriveClient,
  folders: ReadyFolders,
  { scope, budgetMs = COPY_BUDGET_MS }: { scope: string; budgetMs?: number },
): Promise<FootageCopyReport> {
  if (!grantsFullDrive(scope)) return { ran: false, reason: "scope-missing" };

  const lease = await claimFootageCopyLease(caller, new Date(Date.now() + LEASE_MS));
  if (!lease) return { ran: false, reason: "busy" };
  try {
    return await copyAll(caller, drive, folders, Date.now() + budgetMs);
  } finally {
    await releaseFootageCopyLease(caller, lease);
  }
}

async function copyAll(
  caller: DriveCaller,
  drive: DriveClient,
  folders: ReadyFolders,
  deadline: number,
): Promise<FootageCopyReport & { ran: true }> {
  const sessions = await footageCopySessions(caller);
  const failures: FootageCopyFailure[] = [];
  // Counted as each copy lands, so a pass stopped part-way still reports what it did.
  const tally = { copied: 0 };
  let finished = 0;

  for (const session of sessions) {
    if (Date.now() > deadline) break;
    try {
      const done = await copySession(caller, drive, folders, session, deadline, failures, tally);
      if (!done.finished) break;
      finished += 1;
      if (done.clean) await markFootageUploadChecked(caller, session.sessionId);
    } catch (error) {
      if (!(error instanceof StopPass)) throw error;
      failures.push({
        sessionId: session.sessionId,
        sessionName: await sessionName(caller, session.sessionId),
        fileName: null,
        uploader: null,
        reason: error.reason,
      });
      break;
    }
  }

  for (const failure of failures) {
    console.error(
      `Copying Foto & Video of Session ${failure.sessionId}${failure.fileName ? ` (${failure.fileName})` : ""} failed: ${failure.reason}.`,
    );
  }
  return {
    ran: true,
    copied: tally.copied,
    failed: failures.length,
    remaining: sessions.length - finished,
    failures,
  };
}

/** The Session's folder name, for a report; its id when it is gone. */
async function sessionName(caller: DriveCaller, sessionId: string): Promise<string> {
  const target = await sessionFootageFolderTarget(caller, sessionId);
  return target ? sessionFootageFolderName(target.session) : sessionId;
}

/**
 * Go through one Session's upload folder, counting each copy into `tally`. `finished` is false when
 * the deadline came first (its Session stays at the front of the queue); `clean` when no file failed.
 */
async function copySession(
  caller: DriveCaller,
  drive: DriveClient,
  folders: ReadyFolders,
  session: FootageCopySession,
  deadline: number,
  failures: FootageCopyFailure[],
  tally: { copied: number },
): Promise<{ finished: boolean; clean: boolean }> {
  const target = await sessionFootageFolderTarget(caller, session.sessionId);
  const name = target ? sessionFootageFolderName(target.session) : session.sessionId;
  const fail = (reason: FootageCopyFailureReason, child?: DriveChild) => {
    failures.push({
      sessionId: session.sessionId,
      sessionName: name,
      fileName: child?.name ?? null,
      uploader: child?.ownerEmail ?? null,
      reason,
    });
  };

  // The archive Session folder: made if missing (with its trip's), never remade when trashed or gone.
  let archiveId = session.archiveFolderId;
  try {
    if (!archiveId) {
      if (!target?.perjadin) return { finished: true, clean: true };
      const ensured = await ensureSessionFootageFolder(caller, drive, folders, {
        perjadin: target.perjadin,
        session: target.session,
        perjadinFolderId: target.perjadinFolderId,
        sessionFolderId: null,
      });
      if (ensured.outcome !== "ok") {
        // `footage-folders-busy` is a race with another maker: the next pass finishes it.
        if (ensured.reason !== "footage-folders-busy") fail(ensured.reason);
        return { finished: true, clean: false };
      }
      archiveId = ensured.sessionFolderId;
    } else {
      const archive = await drive.getFile(archiveId);
      if (!archive || archive.trashed) {
        fail(archive ? "folder-trashed" : "folder-missing");
        return { finished: true, clean: false };
      }
    }
  } catch (error) {
    fail(failureOf(error));
    return { finished: true, clean: false };
  }

  // What the archive already holds: copies by their original's id, subfolders by their source's.
  const copiedFrom = new Set<string>();
  const subfolderFor = new Map<string, string>();
  try {
    await readArchive(drive, archiveId, copiedFrom, subfolderFor);
  } catch (error) {
    fail(failureOf(error));
    return { finished: true, clean: false };
  }

  let clean = true;
  // Breadth-first through the upload folder, each folder paired with where its copies go.
  const queue: { uploadId: string; archiveId: string }[] = [
    { uploadId: session.uploadFolderId, archiveId },
  ];
  while (queue.length > 0) {
    const { uploadId, archiveId: into } = queue.shift()!;
    let children: DriveChild[];
    try {
      children = await drive.listChildren(uploadId);
    } catch (error) {
      fail(failureOf(error));
      clean = false;
      continue;
    }
    for (const child of children) {
      if (Date.now() > deadline) return { finished: false, clean: false };
      if (child.trashed || child.mimeType === SHORTCUT_MIME_TYPE) continue;
      try {
        if (child.mimeType === FOLDER_MIME_TYPE) {
          let sub = subfolderFor.get(child.id);
          if (!sub) {
            sub = (
              await drive.createFolder({
                name: child.name,
                parentId: into,
                appProperties: { sugtSourceFolderId: child.id, sugtSessionId: session.sessionId },
              })
            ).id;
            subfolderFor.set(child.id, sub);
          }
          queue.push({ uploadId: child.id, archiveId: sub });
        } else if (!copiedFrom.has(child.id)) {
          await drive.copyFile(child.id, {
            name: child.name,
            parentId: into,
            appProperties: { sugtSourceFileId: child.id, sugtSessionId: session.sessionId },
          });
          copiedFrom.add(child.id);
          tally.copied += 1;
        }
      } catch (error) {
        // A file gone between the list and the copy has nothing left to copy.
        if (isDriveFailure(error) && error.status === 404) continue;
        fail(failureOf(error), child);
        clean = false;
      }
    }
  }
  return { finished: true, clean };
}

/** Read the archive Session folder, subfolders included, into the two lookups. */
async function readArchive(
  drive: DriveClient,
  folderId: string,
  copiedFrom: Set<string>,
  subfolderFor: Map<string, string>,
): Promise<void> {
  const queue = [folderId];
  while (queue.length > 0) {
    for (const child of await drive.listChildren(queue.shift()!)) {
      const source = child.appProperties.sugtSourceFileId;
      if (source) copiedFrom.add(source);
      if (child.mimeType === FOLDER_MIME_TYPE) {
        const sourceFolder = child.appProperties.sugtSourceFolderId;
        if (sourceFolder && !child.trashed) subfolderFor.set(sourceFolder, child.id);
        queue.push(child.id);
      }
    }
  }
}
