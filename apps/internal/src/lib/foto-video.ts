/**
 * **The Foto & Video button's link and its way back** (#552, ADR-0061), shared by the button
 * (`components/foto-video-link.tsx`), the route it opens (`/sesi/[id]/foto-video/buka`) and the
 * pages that show its notice. Pure: no React, no request.
 */

/** The route that opens a Session's folder, remembering the page the click came from. */
export function fotoVideoHref(sessionId: string, from: string): string {
  return `/sesi/${encodeURIComponent(sessionId)}/foto-video/buka?dari=${encodeURIComponent(from)}`;
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
 * Where the route sends the tab back to: `dari` when it is a path on this app, else the Session's
 * own page. Only a single leading `/` passes, so `//evil.example` and `https://…` cannot turn the
 * redirect into one off the app.
 */
export function fotoVideoBackPath(from: string | null, sessionId: string): string {
  if (from && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/\\"))
    return from;
  return `/sesi/${encodeURIComponent(sessionId)}`;
}
