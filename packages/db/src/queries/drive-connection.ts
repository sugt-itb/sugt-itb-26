import { eq, sql } from "drizzle-orm";

import { db } from "../client";
import {
  driveConnection,
  type DriveConnectionStatus,
  type DriveFolderProblem,
} from "../schema/drive";
import { person } from "../schema/people";
import type { Person } from "./caller";
import { requireGrant, requireStaff } from "./staff-only";

/**
 * **The company Google Drive connection** (ADR-0040, #372) — the one `drive_connection` row.
 *
 * Two audiences, two guards, and the split is ADR-0040's "Who":
 * - **Only an Administrator connects, reconnects or inspects it.** The card's read and the two
 *   connect writes open with `requireGrant(caller, "Administrator")`.
 * - **Any Staff member uploads through it**, so the credential read and the two bookkeeping writes
 *   a token refresh makes (`last_used_at`, broken) open with `requireStaff` alone. A Pimpinan writes
 *   nothing, so reaches none of them.
 *
 * This module stores and reads ciphertext only. Encrypting, decrypting and talking to Google are
 * `@sugt/internal`'s, which holds `DRIVE_TOKEN_KEY`; nothing here could decrypt a token if it tried.
 *
 * **One connect is two writes, on purpose** — `saveDriveConnection`, then `recordDriveFolders` —
 * because Drive calls run between them, and no transaction is held open across an HTTP call to
 * Google (ADR-0040). The first write alone leaves a row whose folder ids are not yet settled, which
 * every reader treats as not usable until the second lands.
 */

/** The Drive ids of the fixed tree. Each is null until a connect has created or found it. */
export type DriveFolderIds = {
  rootFolderId: string | null;
  stagingFolderId: string | null;
  buktiTransaksiFolderId: string | null;
  pelaksanaanOfflineFolderId: string | null;
  readmeFileId: string | null;
};

/** Exactly the five ids off a wider row — so a row's other columns never ride along into a write. */
export function driveFolderIds(source: DriveFolderIds): DriveFolderIds {
  return {
    rootFolderId: source.rootFolderId,
    stagingFolderId: source.stagingFolderId,
    buktiTransaksiFolderId: source.buktiTransaksiFolderId,
    pelaksanaanOfflineFolderId: source.pelaksanaanOfflineFolderId,
    readmeFileId: source.readmeFileId,
  };
}

/** The refresh token as stored: AES-256-GCM ciphertext, IV and tag, each base64. */
export type EncryptedRefreshToken = { ciphertext: string; iv: string; tag: string };

/** What the Pengaturan card renders. `null` is "Belum terhubung". */
export type DriveConnectionCard = DriveFolderIds & {
  accountEmail: string;
  status: DriveConnectionStatus;
  folderProblem: DriveFolderProblem | null;
  brokenAt: Date | null;
  lastUsedAt: Date | null;
  connectedAt: Date;
  connectedByName: string;
};

/** The Pengaturan card. Administrator only. */
export async function driveConnectionCard(caller: Person): Promise<DriveConnectionCard | null> {
  requireGrant(caller, "Administrator");

  const [row] = await db
    .select({
      accountEmail: driveConnection.accountEmail,
      status: driveConnection.status,
      folderProblem: driveConnection.folderProblem,
      brokenAt: driveConnection.brokenAt,
      lastUsedAt: driveConnection.lastUsedAt,
      connectedAt: driveConnection.connectedAt,
      connectedByName: person.fullName,
      rootFolderId: driveConnection.rootFolderId,
      stagingFolderId: driveConnection.stagingFolderId,
      buktiTransaksiFolderId: driveConnection.buktiTransaksiFolderId,
      pelaksanaanOfflineFolderId: driveConnection.pelaksanaanOfflineFolderId,
      readmeFileId: driveConnection.readmeFileId,
    })
    .from(driveConnection)
    .innerJoin(person, eq(person.id, driveConnection.connectedByPersonId));
  return row ?? null;
}

/** Whether uploads can go to Drive right now — what the receipt controls are disabled on. */
export type DriveUploadState = DriveFolderIds & {
  status: DriveConnectionStatus;
  brokenAt: Date | null;
  folderProblem: DriveFolderProblem | null;
};

/**
 * The connection's state, for any signed-in Person: the acquittal is an open money read (ADR-0026),
 * and its receipt controls render disabled with the reason when uploads cannot go through. It
 * carries no token and nothing an Administrator alone may see. `null` is "Belum terhubung".
 */
export async function driveUploadState(_caller: Person): Promise<DriveUploadState | null> {
  const [row] = await db
    .select({
      status: driveConnection.status,
      brokenAt: driveConnection.brokenAt,
      folderProblem: driveConnection.folderProblem,
      rootFolderId: driveConnection.rootFolderId,
      stagingFolderId: driveConnection.stagingFolderId,
      buktiTransaksiFolderId: driveConnection.buktiTransaksiFolderId,
      pelaksanaanOfflineFolderId: driveConnection.pelaksanaanOfflineFolderId,
      readmeFileId: driveConnection.readmeFileId,
    })
    .from(driveConnection);
  return row ?? null;
}

/** What a token refresh needs: the stored ciphertext, whether it is still trusted, and the tree. */
export type DriveCredentials = DriveFolderIds & {
  status: DriveConnectionStatus;
  folderProblem: DriveFolderProblem | null;
  refreshToken: EncryptedRefreshToken;
};

/** The stored credential, for any Staff upload. `null` when Drive was never connected. */
export async function driveCredentials(caller: Person): Promise<DriveCredentials | null> {
  requireStaff(caller);

  const [row] = await db.select().from(driveConnection);
  if (!row) return null;
  return {
    status: row.status,
    folderProblem: row.folderProblem,
    refreshToken: {
      ciphertext: row.refreshTokenCiphertext,
      iv: row.refreshTokenIv,
      tag: row.refreshTokenTag,
    },
    ...driveFolderIds(row),
  };
}

/**
 * Store a fresh connection: the first one, or a reconnect **overwriting** the old token. The old
 * token is never revoked at Google — the #370 spike found reconnecting leaves it valid, and revoking
 * can end the whole grant, the new token included. The folder ids are kept; `recordDriveFolders`
 * settles them next. A reconnect clears `broken_at`. `last_used_at` is left alone: it records the
 * last successful refresh, and connecting is not a use.
 */
export async function saveDriveConnection(
  caller: Person,
  input: { accountEmail: string; refreshToken: EncryptedRefreshToken },
): Promise<void> {
  requireGrant(caller, "Administrator");

  const values = {
    accountEmail: input.accountEmail,
    refreshTokenCiphertext: input.refreshToken.ciphertext,
    refreshTokenIv: input.refreshToken.iv,
    refreshTokenTag: input.refreshToken.tag,
    status: "connected" as const,
    brokenAt: null,
    connectedByPersonId: caller.id,
    connectedAt: sql`now()`,
  };
  await db
    .insert(driveConnection)
    .values(values)
    .onConflictDoUpdate({ target: driveConnection.singleton, set: values });
}

/** Record which fixed folders a connect created or found, and whether the root and `_staging` resolved. */
export async function recordDriveFolders(
  caller: Person,
  folders: DriveFolderIds & { folderProblem: DriveFolderProblem | null },
): Promise<void> {
  requireGrant(caller, "Administrator");

  await db
    .update(driveConnection)
    .set({ ...driveFolderIds(folders), folderProblem: folders.folderProblem });
}

/**
 * The stored token stopped working — Google answered `invalid_grant`, or it will not decrypt under
 * the current key. Only a `connected` row moves, so the first failure's time is the one kept.
 */
export async function markDriveConnectionBroken(caller: Person): Promise<void> {
  requireStaff(caller);

  await db
    .update(driveConnection)
    .set({ status: "broken", brokenAt: sql`now()` })
    .where(eq(driveConnection.status, "connected"));
}

/** A refresh succeeded. Bumps `last_used_at` on a still-connected row. */
export async function touchDriveConnection(caller: Person): Promise<void> {
  requireStaff(caller);

  await db
    .update(driveConnection)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(driveConnection.status, "connected"));
}
