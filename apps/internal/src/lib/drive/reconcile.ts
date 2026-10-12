import {
  claimPerjadinDriveFolder,
  claimTransactionDriveFolder,
  markTransactionSyncFailed,
  markTransactionSynced,
  perjadinDriveFolder,
  reconcileTarget,
  type Person,
} from "@sugt/db/queries";

import { perjadinFolderName } from "../perjadin-name";
import type { ReadyFolders } from "./fixed-folders";
import { type DriveClient, type DriveFile, isDriveFailure, isLinkShared } from "./google";
import { evidenceFileName, isReceiptContentType, transactionFolderName } from "./receipt-files";

/**
 * **The reconcile** (ADR-0040, #373): put one recorded transaction in its place in the company
 * Drive, and say when it is done. Idempotent — run it again and it does only what is still owed —
 * and tracked by `transaction.drive_synced_at`. It runs inline after Catat transaksi and (#374) after
 * Unggah bukti, and is what Periksa koneksi's sweep and a reconnect re-run (#375).
 *
 * In order:
 * 1. **The Perjadin folder.** Created under `Pelaksanaan Offline` if the Perjadin has none, private,
 *    and claimed by compare-and-set; a caller that lost trashes its own and uses the winner's. An
 *    existing one whose name is stale — its start date corrected since — is renamed back (#376).
 * 2. **The transaction folder.** Created straight in the Perjadin folder if the line has none (a line
 *    from before Drive), by the same compare-and-set. One still in `_staging` — where Catat builds
 *    it — moves into the Perjadin folder. **One a person has moved elsewhere stays there.**
 * 3. **Each receipt still in `_staging`** is renamed and moved into the transaction folder.
 * 4. **The transaction folder is shared** — anyone, reader — if it is not already. Last, so nothing
 *    is public before it is named and in place. Only transaction folders are ever shared.
 * 5. `drive_synced_at` is set — **only if** no receipt on the line arrived after step 3 read
 *    them (`markTransactionSynced`).
 *
 * **A trashed or missing folder — the Perjadin's or the line's — is never recreated**: the line stays
 * unsynced and the answer says why. Any failure from Drive does the same — the database already
 * holds the line, so a failed reconcile costs only the sync, which the next run finishes.
 *
 * **A line deleted while this runs** (Hapus transaksi, #463, ADR-0050) brings nothing back. Its
 * folder is in the trash by then, so the run stops at step 2 — or, if this run made the folder, the
 * claim finds no row, and the folder goes straight to the trash. A receipt moved into a trashed
 * folder is trashed with it. The run answers `no-such-transaction` once it sees the row gone.
 *
 * **It assumes a usable connection**: its `drive` and `folders` are what `driveAccessToken` answers
 * with `ok`, and only then. A caller holding neither cannot call it — that is how "not connected
 * touches nothing" is held.
 */

/** Why a line is still owed after a reconcile. */
/**
 * Names are app-owned: a stale Perjadin folder name — a start date corrected while its rename failed,
 * or a rename by hand — is set back to what the database says (#376). Its receipts folder and its
 * Dokumen folder (ADR-0042) carry the same name, and both reconciles re-assert it through here.
 *
 * **The name is read fresh, right before the rename**, not taken from what this reconcile read at its
 * start: a correction committed meanwhile has already renamed the folder to its new date, and
 * comparing against the older one would undo it. A failed rename is logged and left — it is
 * cosmetic, and it must not hold up the receipts this reconcile is putting in place.
 */
export async function reassertPerjadinFolderName(
  person: Person,
  drive: DriveClient,
  perjadinId: string,
  folder: DriveFile,
): Promise<void> {
  const trip = await perjadinDriveFolder(person, perjadinId);
  if (!trip) return;
  const name = perjadinFolderName(trip.naming);
  if (folder.name === name) return;
  await drive.updateFile(folder.id, { name }).catch((error: unknown) => {
    console.error(
      `Re-asserting the name of Perjadin ${perjadinId}'s folder ${folder.id} failed.`,
      error,
    );
  });
}

export type UnsyncedReason =
  | "folder-trashed"
  | "folder-missing"
  | "drive-failed"
  /** A receipt committed while this ran is still owed; its own run, or the next sweep, does it. */
  | "newer-receipts";

export type ReconcileResult =
  | { outcome: "synced" }
  | { outcome: "unsynced"; reason: UnsyncedReason }
  | { outcome: "no-such-transaction" };

export async function reconcileTransaction(
  person: Person,
  drive: DriveClient,
  folders: ReadyFolders,
  transactionId: string,
): Promise<ReconcileResult> {
  const result = await reconcileOnce(person, drive, folders, transactionId);
  // A failure is remembered so the sweep tries other lines first next time (#375). `newer-receipts`
  // is not one: the line is fine, and the newer receipt's own run is under way.
  if (result.outcome === "unsynced" && result.reason !== "newer-receipts") {
    await markTransactionSyncFailed(person, transactionId);
  }
  return result;
}

async function reconcileOnce(
  person: Person,
  drive: DriveClient,
  folders: ReadyFolders,
  transactionId: string,
): Promise<ReconcileResult> {
  const target = await reconcileTarget(person, transactionId);
  if (!target) return { outcome: "no-such-transaction" };

  try {
    // 1. The Perjadin folder.
    let perjadinFolderId = target.perjadinDriveFolderId;
    if (!perjadinFolderId) {
      const made = await drive.createFolder({
        name: perjadinFolderName(target.perjadin),
        parentId: folders.pelaksanaanOfflineFolderId,
        appProperties: { sugtPerjadinId: target.perjadin.id },
      });
      perjadinFolderId = await claimPerjadinDriveFolder(person, target.perjadin.id, made.id);
      if (perjadinFolderId !== made.id) await drive.trashFile(made.id);
    }
    // An existing Perjadin folder is checked like the transaction's below: nothing is put into a
    // folder that is in the trash or gone, and neither is recreated.
    const perjadinFolder = await drive.getFile(perjadinFolderId);
    if (!perjadinFolder) return { outcome: "unsynced", reason: "folder-missing" };
    if (perjadinFolder.trashed) return { outcome: "unsynced", reason: "folder-trashed" };
    await reassertPerjadinFolderName(person, drive, target.perjadin.id, perjadinFolder);

    // 2. The transaction folder.
    let transactionFolderId = target.driveFolderId;
    if (!transactionFolderId) {
      const made = await drive.createFolder({
        name: transactionFolderName(target.spentOn, target.category, target.transactionId),
        parentId: perjadinFolderId,
        appProperties: {
          sugtPerjadinId: target.perjadin.id,
          sugtTransactionId: target.transactionId,
        },
      });
      const claimed = await claimTransactionDriveFolder(person, target.transactionId, made.id);
      if (claimed !== made.id) await drive.trashFile(made.id);
      // Deleted by a Hapus transaksi since `reconcileTarget` read it (#463): nothing to put in place.
      if (claimed === null) return { outcome: "no-such-transaction" };
      transactionFolderId = claimed;
    }

    const folder = await drive.getFile(transactionFolderId);
    if (!folder) return { outcome: "unsynced", reason: "folder-missing" };
    if (folder.trashed) return { outcome: "unsynced", reason: "folder-trashed" };
    if (folder.parents.includes(folders.stagingFolderId)) {
      await drive.updateFile(transactionFolderId, {
        addParent: perjadinFolderId,
        removeParent: folders.stagingFolderId,
      });
    }

    // 3. Receipts still in `_staging`.
    await Promise.all(
      target.evidence.map(async (receipt) => {
        const file = await drive.getFile(receipt.driveFileId);
        if (!file || !file.parents.includes(folders.stagingFolderId)) return;
        if (!isReceiptContentType(receipt.contentType)) return;
        await drive.updateFile(receipt.driveFileId, {
          name: evidenceFileName(
            target.spentOn,
            target.category,
            target.transactionId,
            receipt.id,
            receipt.contentType,
          ),
          addParent: transactionFolderId,
          removeParent: folders.stagingFolderId,
          appProperties: { sugtTransactionId: target.transactionId },
        });
      }),
    );

    // 4. Share, last.
    const shared = isLinkShared(await drive.listPermissions(transactionFolderId));
    if (!shared) {
      await drive.createPermission(transactionFolderId, { type: "anyone", role: "reader" });
    }
  } catch (error) {
    if (isDriveFailure(error)) return { outcome: "unsynced", reason: "drive-failed" };
    throw error;
  }

  // 5. Only for the receipts handled here — a newer one, committed meanwhile, keeps the line owed.
  const marked = await markTransactionSynced(
    person,
    target.transactionId,
    target.evidence.map((receipt) => receipt.id),
  );
  if (marked === "gone") return { outcome: "no-such-transaction" };
  return marked === "synced"
    ? { outcome: "synced" }
    : { outcome: "unsynced", reason: "newer-receipts" };
}
