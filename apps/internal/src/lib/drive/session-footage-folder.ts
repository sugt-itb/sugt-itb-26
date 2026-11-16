import {
  canWritePerjadin,
  claimPerjadinFootageFolder,
  claimSessionFootageFolder,
  perjadinWriterEmails,
  sessionFootageFolderTarget,
  type FootageTree,
  type DriveCaller,
  type Person,
  type SessionFolderNaming,
  type SessionFootageFolderTarget,
} from "@sugt/db/queries";

import { perjadinFolderName } from "../perjadin-name";
import { driveAccessToken } from "./access-token";
import { ensureFootageFolders } from "./dokumen-folders";
import type { ReadyFolders } from "./fixed-folders";
import { sessionFootageFolderName } from "./footage-files";
import { type DriveClient, isDriveFailure, isLinkShared, openDrive } from "./google";
import { reassertPerjadinFolderName } from "./reconcile";

/**
 * **A Session's two Foto & Video folders in the company Drive** (#561, ADR-0063). Staff put footage
 * straight into the **upload folder** through Drive, as themselves, so the files stay theirs; a daily
 * job (#562) copies them into the **archive**, as the company account. The app only makes the
 * folders, shares them and opens them. Two trees, side by side, with the same folder names:
 *
 * ```
 * Foto & Video/Pelaksanaan Offline/                        ← the archive (ADR-0046)
 * └── {the Perjadin's folder name}/                         private
 *     └── {held_on} · {HH.MM} · {School} · S-{session8}/    anyone with the link can view  ← Lihat arsip
 * Foto & Video — Unggahan/Pelaksanaan Offline/             ← the upload tree
 * └── {the Perjadin's folder name}/                         edit access by email for the trip's writers
 *     └── {held_on} · {HH.MM} · {School} · S-{session8}/    ← Foto & Video
 * ```
 *
 * Making the folders and setting the sharing are the company account's housekeeping, run on whoever
 * clicked — a Pimpinan's Lihat arsip included. Who may add to the upload folder is Drive's sharing.
 */

/** Why the Session's folder cannot be had right now. */
export type FootageFolderUnavailable =
  | "folder-trashed"
  | "folder-missing"
  /** A tree's fixed folders kept changing under this run; the next one finishes it. */
  | "footage-folders-busy";

export type EnsuredFootageFolder =
  | { outcome: "ok"; perjadinFolderId: string; sessionFolderId: string }
  | { outcome: "unavailable"; reason: FootageFolderUnavailable };

/**
 * **Make sure a Session's folders exist in one tree** (the archive unless `tree` says the upload
 * tree), the three steps the footage reconcile and the two buttons share:
 *
 * 1. **The tree's fixed folders** (`ensureFootageFolders`), made if a connection predates them.
 * 2. **The Perjadin's folder** under the tree's `Pelaksanaan Offline/`, named as its receipts
 *    folder, claimed by compare-and-set; its name is re-asserted, as theirs is.
 * 3. **The Session's folder** in it, `{held_on} · {HH.MM} · {School} · S-{session8}`, claimed the
 *    same way. **An archive Session folder made here is link-shared at once** (`shareArchiveFolder`,
 *    best effort): anyone with its link can view it.
 *
 * Two runs at once make one folder each and keep one: the loser of a claim trashes its own. A
 * trashed or missing folder is **not remade** — an Administrator restores it from the Drive trash.
 * A Drive failure throws, for the caller to answer.
 */
export async function ensureSessionFootageFolder(
  person: DriveCaller,
  drive: DriveClient,
  folders: ReadyFolders,
  target: {
    perjadin: NonNullable<SessionFootageFolderTarget["perjadin"]>;
    session: SessionFolderNaming;
    perjadinFolderId: string | null;
    sessionFolderId: string | null;
  },
  tree: FootageTree = "archive",
): Promise<EnsuredFootageFolder> {
  const perjadinId = target.perjadin.id;

  // 1. The tree's fixed folders.
  const fixed = await ensureFootageFolders(person, drive, folders.rootFolderId, tree);
  if (!fixed) return { outcome: "unavailable", reason: "footage-folders-busy" };

  // 2. The Perjadin's folder.
  let perjadinFolderId = target.perjadinFolderId;
  if (!perjadinFolderId) {
    const made = await drive.createFolder({
      name: perjadinFolderName(target.perjadin),
      parentId: fixed.pelaksanaanOfflineFolderId,
      appProperties: { sugtPerjadinId: perjadinId },
    });
    perjadinFolderId = await claimPerjadinFootageFolder(person, perjadinId, made.id, tree);
    if (perjadinFolderId !== made.id) await drive.trashFile(made.id);
  }
  const perjadinFolder = await drive.getFile(perjadinFolderId);
  if (!perjadinFolder) return { outcome: "unavailable", reason: "folder-missing" };
  if (perjadinFolder.trashed) return { outcome: "unavailable", reason: "folder-trashed" };
  await reassertPerjadinFolderName(person, drive, perjadinId, perjadinFolder);

  // 3. The Session's folder.
  let sessionFolderId = target.sessionFolderId;
  if (!sessionFolderId) {
    const made = await drive.createFolder({
      name: sessionFootageFolderName(target.session),
      parentId: perjadinFolderId,
      appProperties: { sugtPerjadinId: perjadinId, sugtSessionId: target.session.sessionId },
    });
    sessionFolderId = await claimSessionFootageFolder(
      person,
      target.session.sessionId,
      made.id,
      tree,
    );
    if (sessionFolderId !== made.id) await drive.trashFile(made.id);
    else if (tree === "archive") {
      // Best effort: the folder is made and claimed, and Lihat arsip re-asserts the share anyway.
      await shareArchiveFolder(drive, sessionFolderId).catch((error: unknown) => {
        if (!isDriveFailure(error)) throw error;
        console.error(`Link-sharing archive folder ${sessionFolderId} failed.`, error);
      });
    }
  }
  const sessionFolder = await drive.getFile(sessionFolderId);
  if (!sessionFolder) return { outcome: "unavailable", reason: "folder-missing" };
  if (sessionFolder.trashed) return { outcome: "unavailable", reason: "folder-trashed" };

  return { outcome: "ok", perjadinFolderId, sessionFolderId };
}

/**
 * **Link-share an archive Session folder** (#561): anyone with the link can view it, added only if
 * the folder has no `anyone`/`reader` permission of its own. Nothing else is touched. Only a Session's
 * archive folder is ever shared this way — the Perjadin's archive folder and everything above it stay
 * private, and the upload tree has no link share at all. A Drive failure throws.
 */
export async function shareArchiveFolder(drive: DriveClient, folderId: string): Promise<void> {
  const permissions = await drive.listPermissions(folderId);
  if (!isLinkShared(permissions)) {
    await drive.createPermission(folderId, { type: "anyone", role: "reader" });
  }
}

/**
 * **Give exactly `writerEmails` edit access to an upload folder** (#561). Set on the Perjadin's
 * upload folder, so every Session folder inside it inherits it.
 *
 * - **The writers are re-applied in full**: a `user`/`writer` permission whose email is not in the
 *   list is removed — an editor someone added by hand in Drive included — and a missing one is added,
 *   with no notification email.
 * - **No link share is added**: the upload tree is shared with named people only.
 * - Nothing else is touched: the owner, a commenter, anything inherited.
 * - **An email Drive refuses** (not a Google account, say) is skipped and logged; it fails nothing.
 *
 * Any other Drive failure throws.
 */
export async function shareUploadFolder(
  drive: DriveClient,
  folderId: string,
  writerEmails: readonly string[],
): Promise<void> {
  const own = (await drive.listPermissions(folderId)).filter((permission) => !permission.inherited);

  const wanted = new Set(writerEmails.map((email) => email.toLowerCase()));
  const writers = own.filter(
    (permission) => permission.type === "user" && permission.role === "writer",
  );
  const present = new Set<string>();
  for (const writer of writers) {
    const email = writer.emailAddress?.toLowerCase();
    if (email && wanted.has(email)) present.add(email);
    else await drive.deletePermission(folderId, writer.id);
  }

  for (const email of wanted) {
    if (present.has(email)) continue;
    try {
      await drive.createPermission(folderId, { type: "user", role: "writer", emailAddress: email });
    } catch (error) {
      if (!isDriveFailure(error)) throw error;
      console.error(`Drive refused to share upload folder ${folderId} with ${email}.`, error);
    }
  }
}

/**
 * **Apply a Perjadin's upload-folder sharing** from who may write the trip now (ADR-0048,
 * `perjadinWriterEmails`): its Group's active members, every active Perjadin Editor and every active
 * Administrator. The one function #563 — re-sharing the moment a Group, Grant or Person changes —
 * calls too.
 */
export async function applyFootageUploadSharing(
  person: Person,
  drive: DriveClient,
  perjadinId: string,
  uploadPerjadinFolderId: string,
): Promise<void> {
  await shareUploadFolder(
    drive,
    uploadPerjadinFolderId,
    await perjadinWriterEmails(person, perjadinId),
  );
}

/** Which button: Foto & Video opens the upload tree's folder, Lihat arsip the archive's. */
export type FootageFolderKind = FootageTree;

export type OpenFootageFolderResult =
  | { outcome: "open"; folderId: string }
  /**
   * No such Session, an online one, a cancelled one with no folder, or — for the upload folder — a
   * caller who does not write the trip: the route's 404.
   */
  | { outcome: "no-such-folder" }
  /** Drive cannot be used and the Session has no folder yet: "coba lagi nanti". */
  | { outcome: "drive-unavailable" }
  /** A folder on the way is in the Drive trash or gone: an Administrator restores it. */
  | { outcome: "folder-gone" };

/**
 * **What the Foto & Video and Lihat arsip buttons do** (#561), in the ticket's order:
 *
 * 1. Load the Session. An online one has no folder, and a **cancelled** one never gets one made: it
 *    opens the folder it already has — re-sharing it as in step 4 when Drive is usable — or nothing. **The upload folder is the trip's writers' only**
 *    (ADR-0048): anyone else is answered as if there were no folder.
 * 2. **Drive not usable**: an existing folder still opens — the link works without the app — and a
 *    missing one cannot be made.
 * 3. **Make sure the folders exist** (`ensureSessionFootageFolder`): the archive's always — so the
 *    daily copy (#562) always has somewhere to copy to — and, for the upload folder, the upload
 *    tree's after it. A trashed or missing one is not remade.
 * 4. **Share** (best effort: a failure is logged and the folder still opens): the archive Session
 *    folder's link share, and for the upload folder the Perjadin upload folder's writers
 *    (`applyFootageUploadSharing`).
 * 5. Open the Session's folder of that kind.
 *
 * Making and sharing the folders is housekeeping, so Lihat arsip runs for any signed-in Person.
 */
export async function openSessionFootageFolder(
  person: Person,
  sessionId: string,
  kind: FootageFolderKind,
): Promise<OpenFootageFolderResult> {
  const target = await sessionFootageFolderTarget(person, sessionId);
  if (!target || target.mode !== "offline" || target.perjadin === null) {
    return { outcome: "no-such-folder" };
  }
  const perjadin = target.perjadin;
  if (kind === "upload" && !(await canWritePerjadin(person, perjadin.id))) {
    return { outcome: "no-such-folder" };
  }

  const existingId = kind === "upload" ? target.uploadSessionFolderId : target.sessionFolderId;
  const existing: OpenFootageFolderResult | null = existingId
    ? { outcome: "open", folderId: existingId }
    : null;
  if (target.status === "cancelled" && !existing) return { outcome: "no-such-folder" };
  // When Drive cannot be used now: the folder it already has, else "coba lagi nanti".
  const unavailable = existing ?? { outcome: "drive-unavailable" };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return unavailable;
  const drive = openDrive(access.accessToken);

  // A cancelled Session never gets a folder made, but the one it has is still shared as any other.
  if (target.status === "cancelled") {
    await shareExisting(person, drive, kind, perjadin.id, {
      archiveSessionFolderId: target.sessionFolderId,
      uploadPerjadinFolderId: target.uploadPerjadinFolderId,
    });
    return existing!;
  }

  let archive: EnsuredFootageFolder;
  let upload: EnsuredFootageFolder | null = null;
  try {
    archive = await ensureSessionFootageFolder(person, drive, access.folders, {
      perjadin,
      session: target.session,
      perjadinFolderId: target.perjadinFolderId,
      sessionFolderId: target.sessionFolderId,
    });
    if (archive.outcome === "ok" && kind === "upload") {
      upload = await ensureSessionFootageFolder(
        person,
        drive,
        access.folders,
        {
          perjadin,
          session: target.session,
          perjadinFolderId: target.uploadPerjadinFolderId,
          sessionFolderId: target.uploadSessionFolderId,
        },
        "upload",
      );
    }
  } catch (error) {
    if (!isDriveFailure(error)) throw error;
    return unavailable;
  }
  const opened = kind === "upload" ? upload : archive;
  for (const ensured of [archive, upload]) {
    if (ensured?.outcome === "unavailable") {
      return ensured.reason === "footage-folders-busy" ? unavailable : { outcome: "folder-gone" };
    }
  }
  if (archive.outcome !== "ok" || opened?.outcome !== "ok") return unavailable;

  await shareExisting(person, drive, kind, perjadin.id, {
    archiveSessionFolderId: archive.sessionFolderId,
    uploadPerjadinFolderId: opened.perjadinFolderId,
  });
  return { outcome: "open", folderId: opened.sessionFolderId };
}

/**
 * Step 4, best effort: re-assert the archive Session folder's link share and, for Foto & Video, the
 * Perjadin upload folder's writers. A folder not made yet is skipped; any failure is logged, and the
 * folder still opens.
 */
async function shareExisting(
  person: Person,
  drive: DriveClient,
  kind: FootageFolderKind,
  perjadinId: string,
  folders: { archiveSessionFolderId: string | null; uploadPerjadinFolderId: string | null },
): Promise<void> {
  const { archiveSessionFolderId, uploadPerjadinFolderId } = folders;
  if (archiveSessionFolderId) {
    await shareArchiveFolder(drive, archiveSessionFolderId).catch((error: unknown) => {
      console.error(`Link-sharing archive folder ${archiveSessionFolderId} failed.`, error);
    });
  }
  if (kind === "upload" && uploadPerjadinFolderId) {
    await applyFootageUploadSharing(person, drive, perjadinId, uploadPerjadinFolderId).catch(
      (error: unknown) => {
        console.error(`Sharing Perjadin ${perjadinId}'s upload folder failed.`, error);
      },
    );
  }
}
