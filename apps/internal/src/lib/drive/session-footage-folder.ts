import {
  claimPerjadinFootageFolder,
  claimSessionFootageFolder,
  perjadinWriterEmails,
  sessionFootageFolderTarget,
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
 * **A Session's Foto & Video folder in the company Drive** (#552, ADR-0061). Staff put footage
 * straight into it through Drive; the app only makes the folder, shares it and opens it. The tree is
 * ADR-0046's, unchanged:
 *
 * ```
 * Foto & Video/Pelaksanaan Offline/
 * └── {the Perjadin's folder name}/        ← shared here, inherited below
 *     └── {held_on} · {HH.MM} · {School} · S-{session8}/   ← the button opens this
 * ```
 *
 * Making the folders and setting the sharing are the company account's housekeeping, run on whoever
 * clicked — a Pimpinan included. Who may add to the folder is Drive's sharing, not this code.
 */

/** Why the Session's folder cannot be had right now. */
export type FootageFolderUnavailable =
  | "folder-trashed"
  | "folder-missing"
  /** `Foto & Video/` kept changing under this run; the next one finishes it. */
  | "footage-folders-busy";

export type EnsuredFootageFolder =
  | { outcome: "ok"; perjadinFolderId: string; sessionFolderId: string }
  | { outcome: "unavailable"; reason: FootageFolderUnavailable };

/**
 * **Make sure a Session's footage folders exist**, the three steps the footage reconcile and the Foto &
 * Video button share:
 *
 * 1. **The fixed footage folders** (`ensureFootageFolders`), made if a connection predates them.
 * 2. **The Perjadin's folder** under `Foto & Video/Pelaksanaan Offline`, named as its receipts and
 *    Dokumen folders, claimed by compare-and-set; its name is re-asserted, as theirs is.
 * 3. **The Session's folder** in it, `{held_on} · {HH.MM} · {School} · S-{session8}`, claimed the
 *    same way.
 *
 * Two runs at once make one folder each and keep one: the loser of a claim trashes its own. A
 * trashed or missing folder is **not remade** — an Administrator restores it from the Drive trash.
 * A Drive failure throws, for the caller to answer.
 */
export async function ensureSessionFootageFolder(
  person: Person,
  drive: DriveClient,
  folders: ReadyFolders,
  target: {
    perjadin: NonNullable<SessionFootageFolderTarget["perjadin"]>;
    session: SessionFolderNaming;
    perjadinFolderId: string | null;
    sessionFolderId: string | null;
  },
): Promise<EnsuredFootageFolder> {
  const perjadinId = target.perjadin.id;

  // 1. The fixed footage folders.
  const fixed = await ensureFootageFolders(person, drive, folders.rootFolderId);
  if (!fixed) return { outcome: "unavailable", reason: "footage-folders-busy" };

  // 2. The Perjadin's footage folder.
  let perjadinFolderId = target.perjadinFolderId;
  if (!perjadinFolderId) {
    const made = await drive.createFolder({
      name: perjadinFolderName(target.perjadin),
      parentId: fixed.pelaksanaanOfflineFolderId,
      appProperties: { sugtPerjadinId: perjadinId },
    });
    perjadinFolderId = await claimPerjadinFootageFolder(person, perjadinId, made.id);
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
    sessionFolderId = await claimSessionFootageFolder(person, target.session.sessionId, made.id);
    if (sessionFolderId !== made.id) await drive.trashFile(made.id);
  }
  const sessionFolder = await drive.getFile(sessionFolderId);
  if (!sessionFolder) return { outcome: "unavailable", reason: "folder-missing" };
  if (sessionFolder.trashed) return { outcome: "unavailable", reason: "folder-trashed" };

  return { outcome: "ok", perjadinFolderId, sessionFolderId };
}

/**
 * **Share a Perjadin's footage folder** (#552): anyone with the link can view, and exactly
 * `writerEmails` can edit. Everything is set on the Perjadin's folder, so every Session folder inside
 * it inherits it.
 *
 * - The `anyone`/`reader` share is added if the folder has none of its own.
 * - **The writers are re-applied in full**: a `user`/`writer` permission whose email is not in the
 *   list is removed — an editor someone added by hand in Drive included — and a missing one is added,
 *   with no notification email.
 * - Nothing else is touched: the owner, the link share, a commenter, anything inherited.
 * - **An email Drive refuses** (not a Google account, say) is skipped and logged; it fails nothing.
 *
 * Answers whether it changed anything: a folder already right costs one list and no write. Any other
 * Drive failure throws.
 */
export async function shareFootageFolder(
  drive: DriveClient,
  folderId: string,
  writerEmails: readonly string[],
): Promise<boolean> {
  let changed = false;
  const own = (await drive.listPermissions(folderId)).filter((permission) => !permission.inherited);
  if (!isLinkShared(own)) {
    await drive.createPermission(folderId, { type: "anyone", role: "reader" });
    changed = true;
  }

  const wanted = new Set(writerEmails.map((email) => email.toLowerCase()));
  const writers = own.filter(
    (permission) => permission.type === "user" && permission.role === "writer",
  );
  const present = new Set<string>();
  for (const writer of writers) {
    const email = writer.emailAddress?.toLowerCase();
    if (email && wanted.has(email)) present.add(email);
    else {
      await drive.deletePermission(folderId, writer.id);
      changed = true;
    }
  }

  for (const email of wanted) {
    if (present.has(email)) continue;
    try {
      await drive.createPermission(folderId, { type: "user", role: "writer", emailAddress: email });
      changed = true;
    } catch (error) {
      if (!isDriveFailure(error)) throw error;
      console.error(`Drive refused to share footage folder ${folderId} with ${email}.`, error);
    }
  }
  return changed;
}

/**
 * **Apply a Perjadin's footage-folder sharing** from who may write the trip now (ADR-0048,
 * `perjadinWriterEmails`): its Group's active members, every active Perjadin Editor and every active
 * Administrator. The one function the follow-up — re-sharing the moment a Group, Grant or Person
 * changes — calls too (#553). Answers whether the folder's sharing changed.
 */
export async function applyFootageFolderSharing(
  person: Person,
  drive: DriveClient,
  perjadinId: string,
  perjadinFolderId: string,
): Promise<boolean> {
  return shareFootageFolder(
    drive,
    perjadinFolderId,
    await perjadinWriterEmails(person, perjadinId),
  );
}

export type OpenFootageFolderResult =
  | { outcome: "open"; folderId: string }
  /** No such Session, an online one, or a cancelled one with no folder: the route's 404. */
  | { outcome: "no-such-folder" }
  /** Drive cannot be used and the Session has no folder yet: "coba lagi nanti". */
  | { outcome: "drive-unavailable" }
  /** A folder on the way is in the Drive trash or gone: an Administrator restores it. */
  | { outcome: "folder-gone" };

/**
 * **What the Foto & Video button does** (#552), in the ticket's order:
 *
 * 1. Load the Session. An online one has no folder, and a **cancelled** one never gets one made: it
 *    opens the folder it already has, or nothing.
 * 2. **Drive not usable**: an existing folder still opens — the link works without the app — and a
 *    missing one cannot be made.
 * 3. **Make sure the folders exist** (`ensureSessionFootageFolder`). A trashed or missing one is not
 *    remade.
 * 4. **Share the Perjadin's folder** (`applyFootageFolderSharing`), best effort: a failure is logged
 *    and the folder still opens.
 * 5. Open the Session's folder.
 *
 * Any signed-in Person may run it: opening is a read, and the rest is housekeeping.
 */
export async function openSessionFootageFolder(
  person: Person,
  sessionId: string,
): Promise<OpenFootageFolderResult> {
  const target = await sessionFootageFolderTarget(person, sessionId);
  if (!target || target.mode !== "offline" || target.perjadin === null) {
    return { outcome: "no-such-folder" };
  }
  const existing: OpenFootageFolderResult | null = target.sessionFolderId
    ? { outcome: "open", folderId: target.sessionFolderId }
    : null;
  if (target.status === "cancelled") return existing ?? { outcome: "no-such-folder" };
  // When Drive cannot be used now: the folder it already has, else "coba lagi nanti".
  const unavailable = existing ?? { outcome: "drive-unavailable" };

  const access = await driveAccessToken(person);
  if (access.outcome !== "ok") return unavailable;
  const drive = openDrive(access.accessToken);
  const perjadin = target.perjadin;

  let ensured: EnsuredFootageFolder;
  try {
    ensured = await ensureSessionFootageFolder(person, drive, access.folders, {
      ...target,
      perjadin,
    });
  } catch (error) {
    if (!isDriveFailure(error)) throw error;
    return unavailable;
  }
  if (ensured.outcome !== "ok") {
    return ensured.reason === "footage-folders-busy" ? unavailable : { outcome: "folder-gone" };
  }

  await applyFootageFolderSharing(person, drive, perjadin.id, ensured.perjadinFolderId).catch(
    (error: unknown) => {
      console.error(`Sharing Perjadin ${perjadin.id}'s footage folder failed.`, error);
    },
  );
  return { outcome: "open", folderId: ensured.sessionFolderId };
}
