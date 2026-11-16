import { requireEnv } from "-/lib/env";
import {
  driveCredentials,
  driveFolderIds,
  hasGrant,
  recordDriveFolders,
  saveDriveConnection,
  type Person,
} from "@sugt/db/queries";

import { sweepUnsynced } from "./check";
import { ensureDokumenFolders, ensureFootageFolders } from "./dokumen-folders";
import { ensureFixedFolders, readyFolders } from "./fixed-folders";
import { DRIVE_FILE_SCOPE, exchangeDriveCode, openDrive } from "./google";
import { encryptRefreshToken } from "./token-crypto";

/**
 * **Connecting the company Google Drive** (ADR-0040, #372): what `GET /api/drive/callback` does with
 * the code Google sends back. Kept out of the route handler so the seven checks are driven by tests
 * directly, against the real database and the fake Drive.
 */

/** The httpOnly cookie carrying the connect action's `state` to the callback, for ten minutes. */
export const DRIVE_STATE_COOKIE = "sugt-drive-oauth-state";

/**
 * Why a callback stopped — one per check, in the order they run — or that it connected, or which
 * folder problem it found. One list, so the type and the URL parser cannot drift apart.
 */
const DRIVE_CONNECT_OUTCOMES = [
  "access-denied",
  "state-mismatch",
  "not-administrator",
  "exchange-failed",
  "wrong-account",
  "scope-missing",
  "no-refresh-token",
  "connected",
  "root-trashed",
  "root-missing",
  "staging-trashed",
  "staging-missing",
  "folders-unfinished",
] as const;

export type DriveConnectOutcome = (typeof DRIVE_CONNECT_OUTCOMES)[number];

/**
 * Run the callback's checks **in order, stopping at the first failure**, and store nothing until
 * all seven pass:
 *
 * 1. Google reported no error. `access_denied` is the Administrator cancelling; any other error is
 *    Google refusing, and reads as check 4's failure.
 * 2. `state` matches the cookie the connect action set.
 * 3. The caller still holds Administrator — re-checked here, since minutes passed at Google.
 * 4. The code exchanges for tokens.
 * 5. The id_token's email is `GOOGLE_DRIVE_ACCOUNT_EMAIL`, case-insensitively.
 * 6. The Drive scope was granted — Google lets the account untick it on the consent screen.
 * 7. A refresh token came back.
 *
 * Then the token is encrypted and stored — **overwriting** any old one, never revoking it — and the
 * fixed folders are ensured with the exchange's own access token. A root or `_staging` found trashed
 * or missing keeps the token stored but is answered with the problem, not `connected`. With the tree
 * usable, one bounded sweep then reconciles what was recorded while the connection was down (#375).
 */
export async function completeDriveConnection(input: {
  params: URLSearchParams;
  stateCookie: string | undefined;
  person: Person | null;
}): Promise<DriveConnectOutcome> {
  const { params, stateCookie, person } = input;

  const error = params.get("error");
  if (error === "access_denied") return "access-denied";
  if (error !== null) return "exchange-failed";

  const state = params.get("state");
  if (!state || !stateCookie || state !== stateCookie) return "state-mismatch";

  if (!person || !hasGrant(person, "Administrator")) return "not-administrator";

  const code = params.get("code");
  const exchange = code ? await exchangeDriveCode(code) : ({ ok: false } as const);
  if (!exchange.ok) return "exchange-failed";

  const accountEmail = requireEnv("GOOGLE_DRIVE_ACCOUNT_EMAIL");
  if (exchange.email?.toLowerCase() !== accountEmail.toLowerCase()) return "wrong-account";

  if (!exchange.scope.split(" ").includes(DRIVE_FILE_SCOPE)) return "scope-missing";

  if (!exchange.refreshToken) return "no-refresh-token";

  await saveDriveConnection(person, {
    accountEmail: exchange.email,
    refreshToken: encryptRefreshToken(exchange.refreshToken),
  });

  // The row was just written, so it is there; its ids are whatever the last connect settled.
  const stored = (await driveCredentials(person))!;
  const drive = openDrive(exchange.accessToken);
  const ensured = await ensureFixedFolders(drive, driveFolderIds(stored));
  await recordDriveFolders(person, ensured);

  // Work recorded while the connection was down never reached Drive: finish what one bounded sweep
  // can before returning. The connect has already succeeded, so a sweep that throws is logged, not
  // allowed to turn it into a failure — what it left is still unsynced, for Periksa koneksi.
  const folders = readyFolders(ensured);
  if (folders) {
    // `Dokumen/` and its `Pelaksanaan Offline/` (ADR-0042), made on connect like the rest of the
    // tree, but outside its readiness: failing here is logged and left to the next reconcile.
    await ensureDokumenFolders(person, drive, folders.rootFolderId).catch((error: unknown) => {
      console.error("Ensuring the Dokumen folders after connecting Google Drive failed.", error);
    });
    // `Foto & Video/` and its `Pelaksanaan Offline/` (ADR-0046), the same way.
    await ensureFootageFolders(person, drive, folders.rootFolderId).catch((error: unknown) => {
      console.error(
        "Ensuring the Foto & Video folders after connecting Google Drive failed.",
        error,
      );
    });
    // `Foto & Video — Unggahan/` and its `Pelaksanaan Offline/` (#561, ADR-0063), the same way.
    await ensureFootageFolders(person, drive, folders.rootFolderId, "upload").catch(
      (error: unknown) => {
        console.error(
          "Ensuring the Foto & Video — Unggahan folders after connecting Google Drive failed.",
          error,
        );
      },
    );
    await sweepUnsynced(person, drive, folders).catch((error: unknown) => {
      console.error("The sweep after reconnecting Google Drive threw.", error);
    });
  }

  return ensured.folderProblem ?? "connected";
}

/**
 * The sentence `/pengaturan` shows for an outcome. The callback passes only the outcome in the URL,
 * never text, so nothing a link could carry is ever rendered as a message.
 */
export function driveConnectMessage(outcome: DriveConnectOutcome, accountEmail: string): string {
  switch (outcome) {
    case "connected":
      return "Google Drive terhubung.";
    case "access-denied":
      return "Akses ke Google Drive dibatalkan.";
    case "state-mismatch":
      return "Sesi penghubungan kedaluwarsa atau tidak cocok — ulangi dari Pengaturan.";
    case "not-administrator":
      return "Hanya Administrator yang dapat menghubungkan Google Drive.";
    case "exchange-failed":
      return "Google menolak kode otorisasi — coba lagi.";
    case "wrong-account":
      return `Akun yang dipilih bukan ${accountEmail}. Pilih akun perusahaan.`;
    case "scope-missing":
      return "Izin Google Drive tidak dicentang — ulangi dan centang izin Drive.";
    case "no-refresh-token":
      return "Google tidak mengirim token jangka panjang — ulangi penghubungan.";
    case "root-trashed":
      return "Folder utama ada di Sampah Google Drive — pulihkan lalu Hubungkan ulang.";
    case "root-missing":
      return "Folder utama tidak ditemukan di Google Drive.";
    case "staging-trashed":
      return "Folder _staging ada di Sampah Google Drive — pulihkan lalu Hubungkan ulang.";
    case "staging-missing":
      return "Folder _staging tidak ditemukan di Google Drive.";
    case "folders-unfinished":
      return "Google Drive gagal saat menyiapkan folder — coba Hubungkan ulang.";
  }
}

const OUTCOMES = new Set<string>(DRIVE_CONNECT_OUTCOMES);

/** Read an outcome back off `/pengaturan?drive=…`; anything else is ignored. */
export function parseDriveConnectOutcome(value: unknown): DriveConnectOutcome | null {
  return typeof value === "string" && OUTCOMES.has(value) ? (value as DriveConnectOutcome) : null;
}
