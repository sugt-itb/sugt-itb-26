import type { Grant } from "@sugt/domain";

/**
 * **The Foto & Video and Lihat arsip buttons' links and their way back** (#552, #561, ADR-0063),
 * shared by the buttons (`components/foto-video-link.tsx`), the routes they open
 * (`/sesi/[id]/foto-video/unggah` and `/arsip`) and the pages that show their notice. Pure: no React,
 * no request.
 */

/** Which folder: the upload folder (Foto & Video) or the archive (Lihat arsip). */
export type FotoVideoFolder = "upload" | "archive";

const ROUTE_SEGMENTS: Record<FotoVideoFolder, string> = { upload: "unggah", archive: "arsip" };

/** The route that opens one of a Session's folders, remembering the page the click came from. */
export function fotoVideoHref(sessionId: string, folder: FotoVideoFolder, from: string): string {
  return `/sesi/${encodeURIComponent(sessionId)}/foto-video/${ROUTE_SEGMENTS[folder]}?dari=${encodeURIComponent(from)}`;
}

/** The fixed note under Foto & Video (#561): where to upload, and when the original may go. */
export const FOTO_VIDEO_UPLOAD_NOTE =
  "Unggah langsung di Google Drive. Berkas disalin ke arsip perusahaan sekali sehari; setelah itu berkas asli boleh Anda hapus.";

/**
 * The page a button is on, as `dari`: its path and query, less any notice an earlier click left, so
 * a second failure does not stack them.
 */
export function fotoVideoFrom(pathname: string, search: { toString(): string } | null): string {
  const query = new URLSearchParams(search?.toString() ?? "");
  query.delete(FOTO_VIDEO_NOTICE_PARAM);
  const rest = query.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** The search parameter the route sets on the page it sends the tab back to. */
export const FOTO_VIDEO_NOTICE_PARAM = "foto-video";

/** Why the folder did not open — what either route sets `foto-video` to. */
export type FotoVideoNoticeCode = "drive-unavailable" | "folder-gone";

export const FOTO_VIDEO_NOTICES: Record<FotoVideoNoticeCode, string> = {
  "drive-unavailable": "Google Drive belum tersedia — coba lagi nanti.",
  "folder-gone":
    "Folder Foto & Video sesi ini ada di tempat sampah Google Drive atau sudah tidak ada. Minta Administrator memulihkannya dari tempat sampah Google Drive.",
};

/**
 * **Where the route sends the tab back to**, as an absolute URL on `base` (this app's own address),
 * carrying `code` as the notice: `from` when it resolves to a page **on this app**, else the Session's
 * own page. The check is on the resolved URL's origin, not on how `from` is spelt, because the URL
 * parser forgives a great deal — `/\evil.example`, or a tab inside `//`, both become another host —
 * and only the origin it lands on says whether the redirect stays here.
 */
export function fotoVideoBackUrl(
  from: string | null,
  sessionId: string,
  base: string,
  code: FotoVideoNoticeCode,
): string {
  const own = new URL(base).origin;
  let back = new URL(`/sesi/${encodeURIComponent(sessionId)}`, base);
  if (from?.startsWith("/")) {
    const resolved = new URL(from, base);
    if (resolved.origin === own) back = resolved;
  }
  back.searchParams.set(FOTO_VIDEO_NOTICE_PARAM, code);
  return back.href;
}

/**
 * The Grants that change who may edit **every** trip's Foto & Video upload folder (ADR-0048):
 * Perjadin Editor, and Administrator, which implies it. A change to either is not applied to Drive
 * inline — it would reach every trip — so the Grant screen says when it will be (#563).
 */
const FOOTAGE_ACCESS_GRANTS: readonly Grant[] = ["Perjadin Editor", "Administrator"];

/** The sentence the Grant screen says once a change touches `FOOTAGE_ACCESS_GRANTS`. */
export const FOOTAGE_ACCESS_NOTE =
  "Akses edit folder unggah Foto & Video diperbarui lewat Periksa koneksi, atau saat Foto & Video dibuka berikutnya.";

/** Whether assigning or revoking these Grants changes who edits the Foto & Video upload folders. */
export function touchesFootageAccess(changed: readonly Grant[]): boolean {
  return changed.some((grant) => FOOTAGE_ACCESS_GRANTS.includes(grant));
}

/**
 * **Whether the Grant screen's note is due** after one round of chip changes: some change to a
 * Grant in `FOOTAGE_ACCESS_GRANTS` **went through** (`assigned` or `revoked`). A refused one — the
 * Administrator's own Administrator chip, say — reached nothing, so says nothing.
 */
export function footageAccessChanged(
  results: readonly { grant: Grant; result: { outcome: string } }[],
): boolean {
  return touchesFootageAccess(
    results.flatMap(({ grant, result }) =>
      result.outcome === "assigned" || result.outcome === "revoked" ? [grant] : [],
    ),
  );
}
