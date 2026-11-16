import {
  claimDokumenFolder,
  claimFootageFolder,
  dokumenFolderIds,
  footageFolderIds,
  type FootageTree,
  type Person,
} from "@sugt/db/queries";

import { PELAKSANAAN_OFFLINE_FOLDER_NAME } from "./fixed-folders";
import type { DriveClient } from "./google";

/**
 * **`Dokumen/`, `Foto & Video/` and `Foto & Video — Unggahan/`, each with its `Pelaksanaan Offline/`**
 * (ADR-0042, ADR-0046, ADR-0063), the fixed part of the documents', the Session Footage archive's and
 * the footage upload tree's, under the root beside `Bukti Transaksi/`:
 *
 * ```
 * SUGT ITB 2026 Internal App Object Storage/
 * ├── Bukti Transaksi/Pelaksanaan Offline/
 * ├── Dokumen/Pelaksanaan Offline/
 * ├── Foto & Video/Pelaksanaan Offline/
 * └── Foto & Video — Unggahan/Pelaksanaan Offline/
 * ```
 *
 * **Ensured wherever a document or footage needs them** — a connect, Periksa koneksi, and the
 * reconciles — so a connection made before them gets them without reconnecting. No new document is
 * uploaded (ADR-0061), but `Dokumen/` is still ensured, so one recorded before that and left
 * unsynced can still be finished by the sweep. One rule for both
 * trees (`ensureTree`), each with its own two stored ids and its own claim. They are kept out of
 * `ensureFixedFolders`' readiness on purpose: a receipt never waits on them.
 *
 * The rule is `Bukti Transaksi`'s: an id that is unset, missing or trashed gets a fresh folder, and
 * a fresh `Dokumen/` gets a fresh `Pelaksanaan Offline/` with it. Each id is claimed by
 * compare-and-set (`claimDokumenFolder`, `claimFootageFolder`); a caller that lost trashes its own and reads the ids
 * again. **`null`** means it lost every time — another caller kept changing them — and the next
 * ensure tries again. A Drive failure throws, for the caller to answer.
 */

export const DOKUMEN_FOLDER_NAME = "Dokumen";
export const FOOTAGE_FOLDER_NAME = "Foto & Video";
export const FOOTAGE_UPLOAD_FOLDER_NAME = "Foto & Video — Unggahan";

/** One tree's two fixed folders, as ensured. */
export type EnsuredTreeFolders = {
  /** `Dokumen/` or `Foto & Video/`. */
  treeFolderId: string;
  pelaksanaanOfflineFolderId: string;
  /** Whether either folder had to be made just now — what Periksa koneksi reports. */
  created: boolean;
};

export type EnsuredDokumenFolders = Omit<EnsuredTreeFolders, "treeFolderId"> & {
  dokumenFolderId: string;
};

async function usable(drive: DriveClient, id: string | null): Promise<boolean> {
  if (!id) return false;
  const file = await drive.getFile(id);
  return Boolean(file && !file.trashed);
}

/** How many times one ensure reads the ids again after losing a claim, before it gives up. */
const CLAIM_ATTEMPTS = 3;

/** What `ensureTree` needs of one tree: its name, its two stored ids, and how to claim each. */
type Tree = {
  name: string;
  read: () => Promise<{ treeFolderId: string | null; pelaksanaanOfflineFolderId: string | null }>;
  claimTree: (expected: string | null, next: string) => Promise<boolean>;
  claimPelaksanaan: (expected: string | null, next: string, parentId: string) => Promise<boolean>;
};

async function ensureTree(
  drive: DriveClient,
  rootFolderId: string,
  tree: Tree,
): Promise<EnsuredTreeFolders | null> {
  let created = false;
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const stored = await tree.read();

    let treeFolderId = stored.treeFolderId;
    if (!treeFolderId || !(await usable(drive, treeFolderId))) {
      const made = await drive.createFolder({ name: tree.name, parentId: rootFolderId });
      if (!(await tree.claimTree(treeFolderId, made.id))) {
        await drive.trashFile(made.id);
        continue;
      }
      created = true;
      // The claim cleared `Pelaksanaan Offline/`: a new tree folder holds none yet.
      treeFolderId = made.id;
      stored.pelaksanaanOfflineFolderId = null;
    }

    const pelaksanaanId = stored.pelaksanaanOfflineFolderId;
    if (pelaksanaanId && (await usable(drive, pelaksanaanId))) {
      return { treeFolderId, pelaksanaanOfflineFolderId: pelaksanaanId, created };
    }
    const made = await drive.createFolder({
      name: PELAKSANAAN_OFFLINE_FOLDER_NAME,
      parentId: treeFolderId,
    });
    if (!(await tree.claimPelaksanaan(pelaksanaanId, made.id, treeFolderId))) {
      await drive.trashFile(made.id);
      continue;
    }
    return { treeFolderId, pelaksanaanOfflineFolderId: made.id, created: true };
  }
  return null;
}

/** `Dokumen/` and its `Pelaksanaan Offline/` (ADR-0042). */
export async function ensureDokumenFolders(
  person: Person,
  drive: DriveClient,
  rootFolderId: string,
): Promise<EnsuredDokumenFolders | null> {
  const ensured = await ensureTree(drive, rootFolderId, {
    name: DOKUMEN_FOLDER_NAME,
    read: async () => {
      const ids = await dokumenFolderIds(person);
      return {
        treeFolderId: ids?.dokumenFolderId ?? null,
        pelaksanaanOfflineFolderId: ids?.dokumenPelaksanaanOfflineFolderId ?? null,
      };
    },
    claimTree: (expected, next) =>
      claimDokumenFolder(person, { folder: "dokumenFolderId", expected, next }),
    claimPelaksanaan: (expected, next, parentId) =>
      claimDokumenFolder(person, {
        folder: "dokumenPelaksanaanOfflineFolderId",
        expected,
        next,
        parentId,
      }),
  });
  if (!ensured) return null;
  const { treeFolderId, ...rest } = ensured;
  return { dokumenFolderId: treeFolderId, ...rest };
}

/**
 * `Foto & Video/` and its `Pelaksanaan Offline/` (ADR-0046) — the archive — or, with `tree: "upload"`,
 * `Foto & Video — Unggahan/` and its `Pelaksanaan Offline/` (#561, ADR-0063).
 */
export async function ensureFootageFolders(
  person: Person,
  drive: DriveClient,
  rootFolderId: string,
  tree: FootageTree = "archive",
): Promise<EnsuredTreeFolders | null> {
  return ensureTree(drive, rootFolderId, {
    name: tree === "archive" ? FOOTAGE_FOLDER_NAME : FOOTAGE_UPLOAD_FOLDER_NAME,
    read: async () => {
      const ids = await footageFolderIds(person, tree);
      return {
        treeFolderId: ids?.footageFolderId ?? null,
        pelaksanaanOfflineFolderId: ids?.footagePelaksanaanOfflineFolderId ?? null,
      };
    },
    claimTree: (expected, next) =>
      claimFootageFolder(person, { tree, folder: "footageFolderId", expected, next }),
    claimPelaksanaan: (expected, next, parentId) =>
      claimFootageFolder(person, {
        tree,
        folder: "footagePelaksanaanOfflineFolderId",
        expected,
        next,
        parentId,
      }),
  });
}
