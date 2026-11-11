import {
  SESSION_FOOTAGE_CONTENT_TYPES,
  type SessionFootageContentType,
  type SessionFootageKind,
} from "@sugt/domain";

import { SEPARATOR, short } from "./receipt-files";

/**
 * **What Session Footage in the company Drive is, and is called** (#424, ADR-0046) — pure functions
 * beside `receipt-files.ts` and `document-files.ts`, sharing their separator and short ids. The tree:
 *
 * ```
 * Foto & Video/Pelaksanaan Offline/
 * └── {the Perjadin's folder name}/                                   ← private
 *     └── 2026-10-12 · 08.00 · SMA Pradita Dirgantara · S-3e4f5a6b/   ← one per Session, private
 *         └── 2026-10-12 · SMA Pradita Dirgantara · Foto · M-7c8d9e0f.jpg   ← shared, this file only
 * ```
 *
 * `S-` and `M-` are the first 8 hex characters of the Session's and the footage's ids. The start time
 * is written `08.00`, since Drive names avoid `:`, and a `/` in a School's name becomes `-`.
 */

/**
 * Enough of a file's head to sniff every footage type: the ISO-BMFF major brand sits at bytes 8–11,
 * and the compatible brands that tell an AVIF from a HEIF start at byte 16.
 */
export const FOOTAGE_SNIFF_LENGTH = 32;

/** The ISO-BMFF major brands of a HEIC or HEIF still image. */
const HEIF_BRANDS = new Set(["heic", "heix", "mif1", "msf1", "heif", "hevc", "hevx"]);

/** The ISO-BMFF major brands of an MP4 video, as phones and cameras write them. */
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
  "MSNV",
  "dash",
  "3gp4",
  "3gp5",
  // Sony's camera MP4.
  "XAVC",
]);

/** Compatible brands that make a `mif1`/`msf1` file an AVIF — a different image format, refused. */
const AVIF_BRANDS = new Set(["avif", "avis"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * **What a file of footage really is, from its first bytes** — Drive inspects nothing, so this is the
 * only check that a "photo" is a photo. `null` for anything outside the six:
 * JPEG `FF D8 FF`; PNG's signature; `RIFF….WEBP`; and ISO-BMFF — `ftyp` at offset 4 — with a HEIC/HEIF,
 * an MP4 or the QuickTime `qt  ` major brand.
 */
export function sniffFootageType(bytes: Uint8Array): SessionFootageContentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (HEIF_BRANDS.has(brand)) {
      // `mif1` and `msf1` are generic, and some AVIF writers lead with them: an AVIF says so among the
      // compatible brands, four bytes each from byte 16 to the end of the box (or of what was read).
      const boxEnd = Math.min(
        new DataView(bytes.buffer, bytes.byteOffset).getUint32(0),
        bytes.length,
      );
      for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
        if (AVIF_BRANDS.has(ascii(bytes, offset, offset + 4))) return null;
      }
      return "image/heic";
    }
    if (brand === "qt  ") return "video/quicktime";
    if (MP4_BRANDS.has(brand)) return "video/mp4";
  }
  return null;
}

const EXTENSIONS: Record<SessionFootageContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** The extension a footage file is named with — from the sniffed type, never the browser's. */
export function footageExtension(contentType: SessionFootageContentType): string {
  return EXTENSIONS[contentType];
}

/**
 * The types a browser may declare when opening an upload: the six, plus `image/heif`, which is
 * stored as `image/heic` once sniffed. Anything else is refused before Drive is asked.
 */
export const DECLARABLE_FOOTAGE_TYPES: Record<string, SessionFootageKind> = {
  ...SESSION_FOOTAGE_CONTENT_TYPES,
  "image/heif": "foto",
};

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
