import type { SessionFootageContentType, SessionFootageKind } from "@sugt/domain";

import { SEPARATOR, short } from "./receipt-files";

/**
 * **What Session Footage in the company Drive is, and is called** (#424, ADR-0046) — pure functions
 * beside `receipt-files.ts` and `document-files.ts`, sharing their separator and short ids. The tree:
 *
 * ```
 * Foto & Video/Pelaksanaan Offline/
 * └── {the Perjadin's folder name}/                                   ← link-viewable, Group-editable
 *     └── 2026-10-12 · 08.00 · SMA Pradita Dirgantara · S-3e4f5a6b/   ← one per Session
 *         └── 2026-10-12 · SMA Pradita Dirgantara · Foto · M-7c8d9e0f.jpg   ← an upload from before #552
 * ```
 *
 * Since #552 (ADR-0061) Staff put files into a Session's folder themselves, under their own names;
 * the file names below are only for the rows the old upload recorded.
 *
 * `S-` and `M-` are the first 8 hex characters of the Session's and the footage's ids. The start time
 * is written `08.00`, since Drive names avoid `:`, and a `/` in a School's name becomes `-`.
 */

/** The extension each stored type was named with. */
const EXTENSIONS: Record<SessionFootageContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** The extension a recorded footage file is named with, from the type the upload sniffed. */
export function footageExtension(contentType: SessionFootageContentType): string {
  return EXTENSIONS[contentType];
}

/** `08:00:00` or `08:00` as `08.00`. */
function dottedTime(startsAt: string): string {
  return startsAt.slice(0, 5).replace(":", ".");
}

/** `2026-10-12 · 08.00 · SMA Pradita Dirgantara · S-3e4f5a6b` — one Session's folder. */
export function sessionFootageFolderName(parts: {
  sessionId: string;
  heldOn: string;
  startsAt: string;
  schoolName: string;
}): string {
  return [
    parts.heldOn,
    dottedTime(parts.startsAt),
    parts.schoolName.replaceAll("/", "-"),
    `S-${short(parts.sessionId)}`,
  ].join(SEPARATOR);
}

/** `2026-10-12 · SMA Pradita Dirgantara · Foto · M-7c8d9e0f.jpg` — one file of footage. */
export function footageFileName(parts: {
  footageId: string;
  heldOn: string;
  schoolName: string;
  kind: SessionFootageKind;
  contentType: SessionFootageContentType;
}): string {
  const stem = [
    parts.heldOn,
    parts.schoolName.replaceAll("/", "-"),
    parts.kind === "foto" ? "Foto" : "Video",
    `M-${short(parts.footageId)}`,
  ].join(SEPARATOR);
  return `${stem}.${footageExtension(parts.contentType)}`;
}
