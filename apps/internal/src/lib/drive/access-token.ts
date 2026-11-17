import {
  driveCredentials,
  markDriveConnectionBroken,
  touchDriveConnection,
  type DriveCaller,
  type DriveCredentials,
} from "@sugt/db/queries";

import { readyFolders, type ReadyFolders } from "./fixed-folders";
import { refreshDriveAccessToken } from "./google";
import { decryptRefreshToken } from "./token-crypto";

/** A refreshed token, or why there is none. Says nothing about the folders. */
export type DriveToken =
  | {
      outcome: "ok";
      accessToken: string;
      credentials: DriveCredentials;
      /** The scopes the token carries (#562): without the full `drive` one, nothing is copied. */
      scope: string;
    }
  /** No connection, or a broken one — just now, if this refresh is what broke it. */
  | { outcome: "drive-disconnected" }
  /** Google could not be reached. The token may be fine; nothing is marked. */
  | { outcome: "drive-unreachable" };

/**
 * **Refresh the stored token** (ADR-0040): decrypt it and swap it for an access token, on every call
 * — no access-token cache, which the ticket allows and which a serverless function would rarely hit
 * anyway. The first `invalid_grant`, or a token that will not decrypt, **marks the connection
 * broken** and answers `drive-disconnected` — a returned outcome, never a thrown 500. A broken
 * connection stays broken until an Administrator reconnects; nothing here retries it.
 *
 * It does not look at the folders: Periksa koneksi refreshes even while they are unresolved, to say
 * whether the token itself works. Uploads go through `driveAccessToken`, which does.
 */
export async function refreshDriveToken(
  person: DriveCaller,
  /** The connection row, as the caller read it — every caller reads it first, to decide first. */
  credentials: DriveCredentials | null,
): Promise<DriveToken> {
  if (!credentials || credentials.status === "broken") return { outcome: "drive-disconnected" };

  const refreshToken = decryptRefreshToken(credentials.refreshToken);
  if (refreshToken === null) {
    await markDriveConnectionBroken(person);
    return { outcome: "drive-disconnected" };
  }

  const refreshed = await refreshDriveAccessToken(refreshToken);
  if (!refreshed.ok) {
    if (refreshed.reason === "unreachable") return { outcome: "drive-unreachable" };
    await markDriveConnectionBroken(person);
    return { outcome: "drive-disconnected" };
  }

  await touchDriveConnection(person, refreshed.scope);
  return {
    outcome: "ok",
    accessToken: refreshed.accessToken,
    credentials,
    scope: refreshed.scope,
  };
}

export type DriveAccess =
  | { outcome: "ok"; accessToken: string; folders: ReadyFolders; scope: string }
  | Exclude<DriveToken, { outcome: "ok" }>
  /**
   * The token is stored but the fixed tree is not usable — the root or `_staging` is trashed or
   * gone, or the last connect did not finish. An Administrator fixes it on `/pengaturan`.
   */
  | { outcome: "drive-folders-unresolved" };

/**
 * **An access token for the app's use of the company Drive** (ADR-0040) — a Staff member's upload, or
 * the Foto & Video and Lihat arsip buttons, Lihat arsip on anyone's click (#561): `refreshDriveToken`, but only once the fixed tree
 * is usable. A tree that is not answers before Google is asked anything, so no upload is ever pointed
 * at a trashed `_staging`.
 */
export async function driveAccessToken(person: DriveCaller): Promise<DriveAccess> {
  const credentials = await driveCredentials(person);
  // Checked here as well as in `refreshDriveToken`, because the folder check below must come before
  // any call to Google and must not mistake a broken connection for unresolved folders.
  if (!credentials || credentials.status === "broken") return { outcome: "drive-disconnected" };

  const folders = readyFolders(credentials);
  if (!folders) return { outcome: "drive-folders-unresolved" };

  const token = await refreshDriveToken(person, credentials);
  if (token.outcome !== "ok") return token;
  return { outcome: "ok", accessToken: token.accessToken, folders, scope: token.scope };
}
