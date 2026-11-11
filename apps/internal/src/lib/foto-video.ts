/**
 * **The Foto & Video button's link and its way back** (#552, ADR-0061), shared by the button
 * (`components/foto-video-link.tsx`), the route it opens (`/sesi/[id]/foto-video/buka`) and the
 * pages that show its notice. Pure: no React, no request.
 */

/** The route that opens a Session's folder, remembering the page the click came from. */
export function fotoVideoHref(sessionId: string, from: string): string {
  return `/sesi/${encodeURIComponent(sessionId)}/foto-video/buka?dari=${encodeURIComponent(from)}`;
}

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

/** Why the folder did not open — what the route sets `foto-video` to. */
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
