import type { DriveFolderIds, DriveFolderProblem } from "@sugt/db/queries";

import type { DriveClient } from "./google";

/**
 * **The fixed part of ADR-0040's tree**, ensured on every connect:
 *
 * ```
 * My Drive/
 * ├── SUGT ITB 2026 _staging — jangan dibagikan/      ← a SIBLING of the root, never inside it
 * └── SUGT ITB 2026 Internal App Object Storage/      ← the root
 *     ├── README
 *     └── Bukti Transaksi/
 *         └── Pelaksanaan Offline/
 * ```
 *
 * `Dokumen/` beside `Bukti Transaksi/` is ADR-0042's, and outside this readiness on purpose: it is
 * ensured where a document needs it (`dokumen-folders.ts`), so a receipt never waits on it. Nothing
 * uploads a document any more (ADR-0061); it is kept for the ones already recorded.
 *
 * `_staging` sits outside the root because Drive permissions are inherited: if someone ever moves the
 * root under a link-shared company folder, files nobody has verified yet must not come with it.
 *
 * **First connect** creates all five. **A reconnect** reuses every stored id that `getFile` still
 * finds untrashed, and recreates a missing subfolder or README. **A trashed or missing root or
 * `_staging` is reported, never recreated**: a fresh root would orphan every Perjadin folder under
 * the old one, and the Administrator can restore it from the trash and reconnect.
 *
 * **It never throws.** If Drive fails partway — a 5xx, the network — it stops and answers what it had
 * made by then with `folders-unfinished`, so those ids are still recorded and the next reconnect
 * reuses them rather than making a second root.
 */

export const ROOT_FOLDER_NAME = "SUGT ITB 2026 Internal App Object Storage";
export const STAGING_FOLDER_NAME = "SUGT ITB 2026 _staging — jangan dibagikan";
export const BUKTI_TRANSAKSI_FOLDER_NAME = "Bukti Transaksi";
export const PELAKSANAAN_OFFLINE_FOLDER_NAME = "Pelaksanaan Offline";
export const README_NAME = "README";
export const README_TEXT =
  "Dikelola aplikasi SUGT ITB — jangan hapus, jangan ganti nama, jangan bagikan folder ini.";

export type EnsuredFolders = DriveFolderIds & { folderProblem: DriveFolderProblem | null };

/** The fixed tree, every id settled — what an upload, and the Terhubung card, need. */
export type ReadyFolders = { [K in keyof DriveFolderIds]: string };

/**
 * **Is the fixed tree usable?** Only when the last connect reported no problem **and** every id is
 * set. The second half matters: a connect writes the token before it ensures the folders, so a row
 * can briefly — or, if that second write never landed, for good — hold a working token and no tree.
 * The one predicate behind both the card's Terhubung and `driveAccessToken`.
 */
export function readyFolders(connection: EnsuredFolders): ReadyFolders | null {
  const { folderProblem, ...ids } = connection;
  if (folderProblem) return null;
  const {
    rootFolderId,
    stagingFolderId,
    buktiTransaksiFolderId,
    pelaksanaanOfflineFolderId,
    readmeFileId,
  } = ids;
  if (
    !rootFolderId ||
    !stagingFolderId ||
    !buktiTransaksiFolderId ||
    !pelaksanaanOfflineFolderId ||
    !readmeFileId
  ) {
    return null;
  }
  return {
    rootFolderId,
    stagingFolderId,
    buktiTransaksiFolderId,
    pelaksanaanOfflineFolderId,
    readmeFileId,
  };
}

/** Is the stored id still a live item? `missing` and `trashed` are the two ways it is not. */
async function probe(
  drive: DriveClient,
  id: string | null,
): Promise<"absent" | "ok" | "missing" | "trashed"> {
  if (!id) return "absent";
  const file = await drive.getFile(id);
  if (!file) return "missing";
  return file.trashed ? "trashed" : "ok";
}

export async function ensureFixedFolders(
  drive: DriveClient,
  stored: DriveFolderIds,
): Promise<EnsuredFolders> {
  const folders: DriveFolderIds = { ...stored };
  try {
    const folderProblem = await ensureInto(drive, stored, folders);
    return { ...folders, folderProblem };
  } catch {
    return { ...folders, folderProblem: "folders-unfinished" };
  }
}

/** The work itself, filling `folders` in place as each id is settled. Answers the problem, if any. */
async function ensureInto(
  drive: DriveClient,
  stored: DriveFolderIds,
  folders: DriveFolderIds,
): Promise<DriveFolderProblem | null> {
  let folderProblem: DriveFolderProblem | null = null;

  const root = await probe(drive, stored.rootFolderId);
  if (root === "absent") {
    folders.rootFolderId = (await drive.createFolder({ name: ROOT_FOLDER_NAME })).id;
  } else if (root !== "ok") {
    folderProblem = root === "trashed" ? "root-trashed" : "root-missing";
  }

  const staging = await probe(drive, stored.stagingFolderId);
  if (staging === "absent") {
    folders.stagingFolderId = (await drive.createFolder({ name: STAGING_FOLDER_NAME })).id;
  } else if (staging !== "ok") {
    folderProblem ??= staging === "trashed" ? "staging-trashed" : "staging-missing";
  }

  // Everything else lives under the root; with the root unresolved there is nowhere to put it.
  if (root !== "ok" && root !== "absent") return folderProblem;
  const rootId = folders.rootFolderId!;

  if ((await probe(drive, stored.buktiTransaksiFolderId)) !== "ok") {
    folders.buktiTransaksiFolderId = (
      await drive.createFolder({ name: BUKTI_TRANSAKSI_FOLDER_NAME, parentId: rootId })
    ).id;
    // A recreated parent cannot still hold the old child.
    folders.pelaksanaanOfflineFolderId = null;
  }
  if ((await probe(drive, folders.pelaksanaanOfflineFolderId)) !== "ok") {
    folders.pelaksanaanOfflineFolderId = (
      await drive.createFolder({
        name: PELAKSANAAN_OFFLINE_FOLDER_NAME,
        parentId: folders.buktiTransaksiFolderId!,
      })
    ).id;
  }
  if ((await probe(drive, stored.readmeFileId)) !== "ok") {
    folders.readmeFileId = (
      await drive.createFile({
        name: README_NAME,
        parentId: rootId,
        mimeType: "text/plain",
        content: README_TEXT,
      })
    ).id;
  }

  return folderProblem;
}
