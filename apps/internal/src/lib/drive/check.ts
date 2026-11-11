import {
  driveCredentials,
  driveFolderIds,
  perjadinDriveFolders,
  recordDriveFolders,
  sessionFootageFolders,
  unsyncedDocuments,
  unsyncedFootage,
  unsyncedTransactions,
  type DriveFolderProblem,
  type Person,
} from "@sugt/db/queries";

import { perjadinFolderName } from "../perjadin-name";
import { refreshDriveToken } from "./access-token";
import { ensureDokumenFolders, ensureFootageFolders } from "./dokumen-folders";
import { readyFolders, type ReadyFolders } from "./fixed-folders";
import { sessionFootageFolderName } from "./footage-files";
import { type DriveClient, isDriveFailure, openDrive } from "./google";
import { reconcileTransaction, type UnsyncedReason } from "./reconcile";
import { type DocumentUnsyncedReason, reconcileDocument } from "./reconcile-document";
import { type FootageUnsyncedReason, reconcileFootage } from "./reconcile-footage";
import { reassertSessionFootageNames } from "./rename-session-footage";

/**
 * **Periksa koneksi** (ADR-0040, #375): whether the company Drive connection works, whether its tree
 * is safe, and finishing what is still owed to it. An Administrator presses it on `/pengaturan`; the
 * reconnect callback runs the sweep half of it too.
 */

/**
 * How many unsynced transactions one press reconciles — and, after them, how many documents, and then
 * how many files of footage.
 */
export const SWEEP_LIMIT = 25;

/**
 * How long one sweep keeps starting reconciles: past this it stops, and what is left is reported as
 * waiting. Well inside the 60 seconds `/pengaturan` and the callback declare as `maxDuration`, so a
 * slow Drive cannot turn a press — or a reconnect that already succeeded — into a timeout. On a
 * press, the folder-name pass after the sweep gets what is left of it (#407).
 */
export const SWEEP_BUDGET_MS = 40_000;

/**
 * After how many renames one press of Periksa koneksi stops re-asserting names (#407): Perjadin
 * folders, and Session footage folders with their files (ADR-0046). Checked between folders.
 */
export const RENAME_LIMIT = 25;

export type SweepFailure = {
  transactionId: string;
  spentOn: string;
  description: string;
  reason: UnsyncedReason | "no-such-transaction";
};

/** A Perjadin Document the sweep could not finish (ADR-0042). */
export type DocumentSweepFailure = {
  documentId: string;
  kind: string;
  /** `null` on an SPPD (#441), named by `schoolName` instead. */
  documentDate: string | null;
  schoolName: string | null;
  reason: DocumentUnsyncedReason | "no-such-document";
};

export type FootageSweepFailure = {
  footageId: string;
  kind: string;
  originalFilename: string;
  reason: FootageUnsyncedReason | "no-such-footage";
};

export type SweepReport = {
  synced: number;
  waiting: number;
  failures: SweepFailure[];
  /** The same for Perjadin Documents, swept after the transactions within the same budget. */
  documents: { synced: number; waiting: number; failures: DocumentSweepFailure[] };
  /** And for Session Footage (ADR-0046), last, within the same budget. */
  footage: { synced: number; waiting: number; failures: FootageSweepFailure[] };
};

/**
 * **The sweep**: reconcile the unsynced transactions in the order `unsyncedTransactions` gives — at
 * most `limit`, one at a time, and none started once `budgetMs` has passed — then the unsynced
 * Perjadin Documents the same way (ADR-0042), then the unsynced Session Footage (ADR-0046), within
 * what is left of the budget. A trashed folder
 * is reported, never recreated (the reconciles' own rule). `waiting` is what is still owed
 * afterwards: the failures, and anything past the bound or the budget.
 */
export async function sweepUnsynced(
  person: Person,
  drive: DriveClient,
  folders: ReadyFolders,
  { limit = SWEEP_LIMIT, budgetMs = SWEEP_BUDGET_MS }: { limit?: number; budgetMs?: number } = {},
): Promise<SweepReport> {
  const owed = await unsyncedTransactions(person, limit);
  const failures: SweepFailure[] = [];
  const startedAt = Date.now();
  let synced = 0;
  for (const line of owed.lines) {
    if (Date.now() - startedAt > budgetMs) break;
    const result = await reconcileTransaction(person, drive, folders, line.id);
    if (result.outcome === "synced") synced += 1;
    else {
      failures.push({
        transactionId: line.id,
        spentOn: line.spentOn,
        description: line.description,
        reason: result.outcome === "unsynced" ? result.reason : result.outcome,
      });
    }
  }

  const owedDocuments = await unsyncedDocuments(person, limit);
  const documentFailures: DocumentSweepFailure[] = [];
  let documentsSynced = 0;
  for (const document of owedDocuments.documents) {
    if (Date.now() - startedAt > budgetMs) break;
    const result = await reconcileDocument(person, drive, folders, document.id);
    if (result.outcome === "synced") documentsSynced += 1;
    else {
      documentFailures.push({
        documentId: document.id,
        kind: document.kind,
        documentDate: document.documentDate,
        schoolName: document.schoolName,
        reason: result.outcome === "unsynced" ? result.reason : result.outcome,
      });
    }
  }

  const owedFootage = await unsyncedFootage(person, limit);
  const footageFailures: FootageSweepFailure[] = [];
  let footageSynced = 0;
  for (const footage of owedFootage.footage) {
    if (Date.now() - startedAt > budgetMs) break;
    const result = await reconcileFootage(person, drive, folders, footage.id);
    if (result.outcome === "synced") footageSynced += 1;
    else {
      footageFailures.push({
        footageId: footage.id,
        kind: footage.kind,
        originalFilename: footage.originalFilename,
        reason: result.outcome === "unsynced" ? result.reason : result.outcome,
      });
    }
  }

  return {
    synced,
    waiting: owed.total - synced,
    failures,
    documents: {
      synced: documentsSynced,
      waiting: owedDocuments.total - documentsSynced,
      failures: documentFailures,
    },
    footage: {
      synced: footageSynced,
      waiting: owedFootage.total - footageSynced,
      failures: footageFailures,
    },
  };
}

/** A Perjadin folder whose name the pass could not re-assert (#407). */
export type FolderNameFailure = {
  perjadinId: string;
  /** The name it should carry — the one Periksa koneksi tells the Administrator about. */
  name: string;
  /** A Perjadin's three folders, then a Session's footage folder (ADR-0046) with its files. */
  folder: "bukti-transaksi" | "dokumen" | "foto-video" | "sesi-foto-video";
  reason: "folder-trashed" | "folder-missing" | "drive-failed";
};

export type FolderNameReport = {
  renamed: number;
  /** Folders this press did not reach — past the bound or the budget. Zero means every one was checked. */
  remaining: number;
  failures: FolderNameFailure[];
};

/**
 * **Re-assert every Perjadin folder's name** (#407): the Drive folders of every Perjadin that has
 * one, receipts then Dokumen then Foto & Video, in trip-id order — and then every Session's footage
 * folder and its files (ADR-0046), named for the Session's date, time and School. A Perjadin folder is
 * read and renamed only when its name is not `perjadinFolderName` — an out-of-date one from before
 * ADR-0044, a Sub-Cluster renamed since, or a rename after a write that did not happen — and a Session
 * folder only when it is not `sessionFootageFolderName`, its files renamed first
 * (`reassertSessionFootageNames`). A folder already right costs a read and no write.
 *
 * **Bounded per press, and re-runnable.** It stops after `limit` renames or once `budgetMs` has
 * passed — inside a Session's files too — and reports how many folders it did not reach; the next
 * press re-reads the ones it already
 * put right and carries on. A folder trashed or deleted by hand is reported and skipped, never
 * recreated — the reconciles' own rule — and never renamed in the trash.
 */
export async function reassertPerjadinFolderNames(
  person: Person,
  drive: DriveClient,
  { limit = RENAME_LIMIT, budgetMs = SWEEP_BUDGET_MS }: { limit?: number; budgetMs?: number } = {},
): Promise<FolderNameReport> {
  const folders = (await perjadinDriveFolders(person)).flatMap((trip) => {
    const name = perjadinFolderName(trip.naming);
    const owned = [
      ["bukti-transaksi", trip.driveFolderId],
      ["dokumen", trip.driveDokumenFolderId],
      ["foto-video", trip.driveFootageFolderId],
    ] as const;
    return owned.flatMap(([folder, id]) =>
      id ? [{ perjadinId: trip.naming.id, folder, id, name }] : [],
    );
  });

  const failures: FolderNameFailure[] = [];
  const startedAt = Date.now();
  let renamed = 0;
  let checked = 0;
  for (const { id, ...folder } of folders) {
    if (renamed >= limit || Date.now() - startedAt > budgetMs) break;
    checked += 1;
    try {
      const file = await drive.getFile(id);
      if (!file || file.trashed) {
        failures.push({ ...folder, reason: file ? "folder-trashed" : "folder-missing" });
      } else if (file.name !== folder.name) {
        await drive.updateFile(id, { name: folder.name });
        renamed += 1;
      }
    } catch (error) {
      if (!isDriveFailure(error)) throw error;
      failures.push({ ...folder, reason: "drive-failed" });
    }
  }

  const sessions = await sessionFootageFolders(person);
  let sessionsChecked = 0;
  for (const folder of sessions) {
    if (renamed >= limit || Date.now() - startedAt > budgetMs) break;
    sessionsChecked += 1;
    const failure = {
      perjadinId: folder.perjadinId,
      name: sessionFootageFolderName(folder.naming),
      folder: "sesi-foto-video" as const,
    };
    try {
      const named = await reassertSessionFootageNames(drive, folder, startedAt + budgetMs);
      renamed += named.renamed;
      if (named.problem) failures.push({ ...failure, reason: named.problem });
      if (!named.finished) {
        // Out of time inside this Session: it counts as not reached, and the next press resumes it.
        sessionsChecked -= 1;
        break;
      }
    } catch (error) {
      if (!isDriveFailure(error)) throw error;
      failures.push({ ...failure, reason: "drive-failed" });
    }
  }

  return {
    renamed,
    remaining: folders.length - checked + (sessions.length - sessionsChecked),
    failures,
  };
}

/** One of the four fixed folders, as Periksa koneksi found it. */
export type FolderCheck = {
  folder: "root" | "staging" | "bukti-transaksi" | "pelaksanaan-offline";
  state: "ok" | "trashed" | "missing";
};

/** The two folders that must never be reachable by a link: what the safety check looks at. */
export type ExposableFolder = Extract<FolderCheck["folder"], "root" | "staging">;

export type DriveCheckReport =
  /** No connection to check. */
  | { token: "not-connected" }
  /** Google refused the token, or it would not decrypt: the connection is now marked broken. */
  | { token: "broken" }
  /** It was already broken — this page was older than that. Google was not asked. */
  | { token: "already-broken" }
  /** Google could not be reached. Nothing was concluded or changed. */
  | { token: "unreachable" }
  | {
      token: "ok";
      folders: FolderCheck[];
      /** Which of the root and `_staging` an `anyone` permission reaches, inherited or direct. */
      exposed: ExposableFolder[];
      /**
       * `Dokumen/` and its `Pelaksanaan Offline/` (ADR-0042): there, or made just now — a
       * connection made before them gets them here. `busy` when another caller kept changing them;
       * `skipped` while the tree is not usable.
       */
      dokumen: "ok" | "created" | "busy" | "skipped";
      /** `Foto & Video/` and its `Pelaksanaan Offline/` (ADR-0046), the same way. */
      footage: "ok" | "created" | "busy" | "skipped";
      /** The sweep — or, when the tree is not usable and it did not run, how much waits. */
      sweep:
        | ({ ran: true } & SweepReport)
        | { ran: false; waiting: number; documentsWaiting: number; footageWaiting: number };
      /** The Perjadin folder names re-asserted (#407) — skipped, like the sweep, while the tree is not usable. */
      names: ({ ran: true } & FolderNameReport) | { ran: false };
    };

/**
 * Run Periksa koneksi, **in order**, stopping where there is nothing more to learn:
 *
 * 1. **Refresh the token.** `invalid_grant` marks the connection broken (`refreshDriveToken`) and
 *    stops. A successful refresh updates `last_used_at`.
 * 2. **`files.get` on the root, `_staging`, `Bukti Transaksi` and `Pelaksanaan Offline`**, each
 *    reported ok, trashed or missing — and **recorded** as the connection's `folder_problem`, so the
 *    card, the sidebar badge and the upload gate all stop treating the tree as usable at once. Found
 *    whole again, a problem it had recorded is cleared.
 * 3. **The safety check**: `permissions.list` on the root and on `_staging`. An `anyone` permission
 *    on either — inherited or direct — means the folder has been moved under a link-shared folder, or
 *    shared by hand, and files nobody should see can be opened by link.
 * 4. **The Dokumen and Foto & Video folders** (`ensureDokumenFolders`, `ensureFootageFolders`), made
 *    if missing, when the tree is usable.
 * 5. **The sweep** (`sweepUnsynced`), only when the tree is usable; otherwise how much waits.
 * 6. **The folder names** (`reassertPerjadinFolderNames`, #407), only when the tree is usable, within
 *    what the sweep left of `SWEEP_BUDGET_MS`. This is how folders made before ADR-0044 take the new
 *    name: the Administrator presses again until none is left.
 *
 * The caller has already checked the Administrator Grant.
 */
export async function checkDriveConnection(person: Person): Promise<DriveCheckReport> {
  const credentials = await driveCredentials(person);
  if (!credentials) return { token: "not-connected" };
  if (credentials.status === "broken") return { token: "already-broken" };
  const token = await refreshDriveToken(person, credentials);
  if (token.outcome === "drive-unreachable") return { token: "unreachable" };
  if (token.outcome === "drive-disconnected") return { token: "broken" };

  const drive = openDrive(token.accessToken);
  const stored = token.credentials;
  try {
    const named = [
      ["root", stored.rootFolderId],
      ["staging", stored.stagingFolderId],
      ["bukti-transaksi", stored.buktiTransaksiFolderId],
      ["pelaksanaan-offline", stored.pelaksanaanOfflineFolderId],
    ] as const;
    const folders = await Promise.all(
      named.map(async ([folder, id]): Promise<FolderCheck> => {
        const file = id ? await drive.getFile(id) : null;
        return { folder, state: !file ? "missing" : file.trashed ? "trashed" : "ok" };
      }),
    );

    const problem = folderProblemOf(folders);
    if (problem !== stored.folderProblem) {
      await recordDriveFolders(person, { ...driveFolderIds(stored), folderProblem: problem });
    }

    const exposed: ExposableFolder[] = [];
    for (const [folder, id] of named.slice(0, 2) as [ExposableFolder, string | null][]) {
      const found = folders.find((check) => check.folder === folder);
      if (!id || found?.state !== "ok") continue;
      const permissions = await drive.listPermissions(id);
      if (permissions.some((permission) => permission.type === "anyone")) exposed.push(folder);
    }

    const ready = problem === null ? readyFolders({ ...stored, folderProblem: null }) : null;
    const ensured = ready ? await ensureDokumenFolders(person, drive, ready.rootFolderId) : null;
    const dokumen = !ready
      ? ("skipped" as const)
      : !ensured
        ? ("busy" as const)
        : ensured.created
          ? ("created" as const)
          : ("ok" as const);
    const ensuredFootage = ready
      ? await ensureFootageFolders(person, drive, ready.rootFolderId)
      : null;
    const footage = !ready
      ? ("skipped" as const)
      : !ensuredFootage
        ? ("busy" as const)
        : ensuredFootage.created
          ? ("created" as const)
          : ("ok" as const);
    const sweptFrom = Date.now();
    const sweep = ready
      ? { ran: true as const, ...(await sweepUnsynced(person, drive, ready)) }
      : {
          ran: false as const,
          waiting: (await unsyncedTransactions(person, 0)).total,
          documentsWaiting: (await unsyncedDocuments(person, 0)).total,
          footageWaiting: (await unsyncedFootage(person, 0)).total,
        };
    const names = ready
      ? {
          ran: true as const,
          ...(await reassertPerjadinFolderNames(person, drive, {
            budgetMs: SWEEP_BUDGET_MS - (Date.now() - sweptFrom),
          })),
        }
      : { ran: false as const };
    return { token: "ok", folders, exposed, dokumen, footage, sweep, names };
  } catch (error) {
    if (isDriveFailure(error)) return { token: "unreachable" };
    throw error;
  }
}

/**
 * The problem the four folders amount to, as `ensureFixedFolders` names them: the root's first, then
 * `_staging`'s; a missing or trashed subfolder is "unfinished", which a reconnect recreates.
 */
function folderProblemOf(folders: FolderCheck[]): DriveFolderProblem | null {
  const state = (folder: FolderCheck["folder"]) =>
    folders.find((check) => check.folder === folder)!.state;
  for (const folder of ["root", "staging"] as const) {
    const found = state(folder);
    if (found !== "ok") return `${folder}-${found}`;
  }
  const subfoldersOk = state("bukti-transaksi") === "ok" && state("pelaksanaan-offline") === "ok";
  return subfoldersOk ? null : "folders-unfinished";
}
