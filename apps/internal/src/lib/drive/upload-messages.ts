/**
 * **The sentences an upload control says when Drive cannot take an upload** (ADR-0040, ADR-0042) —
 * a receipt control's or the Dokumen dialog's — in one place, because the page's gate
 * (`upload-gate.ts`, on the server) and the dialogs' refusals (in the browser) say them both. Plain
 * strings and types, nothing server-only, so the client can import it.
 */

/**
 * Why a file cannot go to Drive right now, as an upload action answers it. The first two carry the
 * same sentence the page's gate shows — the date a connection broke included — so a stale page's
 * dialog says what the fresh one would have.
 */
export type DriveRefusal =
  | { outcome: "drive-disconnected" | "drive-folders-unresolved"; reason: string }
  | { outcome: "drive-unreachable" };

export const DRIVE_NOT_CONNECTED =
  "Google Drive belum terhubung — minta Administrator menghubungkannya di Pengaturan.";

/** `since` is already formatted, `2026-10-05 09:30 WIB`. */
export function driveBrokenSince(since: string): string {
  return `Koneksi Google Drive terputus sejak ${since} — minta Administrator menghubungkan ulang.`;
}

export const DRIVE_FOLDERS_UNRESOLVED =
  "Folder Google Drive bermasalah — minta Administrator memeriksanya di Pengaturan.";

export const DRIVE_UNREACHABLE = "Google Drive tidak dapat dihubungi — coba lagi.";

/** Why Drive cannot take an upload right now: the gate's own sentence, or "try again". */
export function driveRefusalText(result: DriveRefusal): string {
  return "reason" in result ? result.reason : DRIVE_UNREACHABLE;
}

/**
 * What a page that has gone stale under the reader says — an upload against a trip, line or
 * document that is no longer stored. No field they could edit will fix it, so it says to reload.
 */
export const STALE_PAGE = "Halaman ini sudah tidak sesuai. Muat ulang untuk melihat keadaannya.";

/**
 * The tooltip on a transaction whose receipts the reconcile has not put in place yet — on the Laporan
 * and on `/keuangan` (#472) alike.
 */
export const RECEIPTS_UNSYNCED =
  "Bukti belum tersinkron ke Google Drive — Administrator dapat menyelesaikannya lewat Periksa koneksi.";
