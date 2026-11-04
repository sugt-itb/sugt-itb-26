import { MAX_UPLOAD_BYTES } from "@sugt/domain";

import { isReceiptContentType, type ReceiptContentType } from "./receipt-files";

/**
 * **The browser's half of a receipt upload to Drive** (ADR-0040): get each file into shape, then send
 * its bytes straight to the Drive session the server opened. Nothing here is trusted — the server
 * sniffs the type and reads the size back from Drive — so this is about sending the right thing, not
 * about checking it.
 */

/**
 * The file picker's `accept`. Listing JPEG among four exact types is also what makes iOS transcode a
 * HEIC photo to JPEG as it hands it over, so no HEIC library is needed; anything else is refused.
 */
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export const UNSUPPORTED_RECEIPT = "Format tidak didukung — gunakan JPG, PNG, WebP atau PDF.";

/** The cap in whole megabytes, as the person reads it. */
export const MAX_UPLOAD_MEGABYTES = MAX_UPLOAD_BYTES / (1024 * 1024);

export const UPLOAD_TOO_LARGE = `Berkas lebih dari ${MAX_UPLOAD_MEGABYTES} MB — perkecil lalu coba lagi.`;

/** The longest edge an image keeps, and its JPEG quality: legible as a receipt, small on the wire. */
const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.82;

export type PreparedReceipt = { blob: Blob; contentType: ReceiptContentType };

/**
 * Ready one picked file for upload. **Every image is re-encoded** to JPEG — long edge at most
 * 2400 px, quality about 0.82, its EXIF orientation applied — which shrinks a phone photo and
 * **strips its EXIF, GPS included**: drawing to a canvas keeps only the pixels, and these links are
 * public. A PDF is sent as it is. The 50 MB cap applies to what will actually be sent.
 */
export async function prepareReceipt(
  file: File,
): Promise<PreparedReceipt | "unsupported-type" | "too-large"> {
  if (!isReceiptContentType(file.type)) return "unsupported-type";

  let prepared: PreparedReceipt;
  if (file.type === "application/pdf") {
    prepared = { blob: file, contentType: "application/pdf" };
  } else {
    const blob = await reencodeImage(file).catch(() => null);
    if (!blob) return "unsupported-type";
    prepared = { blob, contentType: "image/jpeg" };
  }

  return prepared.blob.size > MAX_UPLOAD_BYTES ? "too-large" : prepared;
}

async function reencodeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas context.");
  // JPEG has no alpha: a transparent PNG would otherwise turn black where it was clear.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas produced no JPEG."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/**
 * `PUT` the bytes to their Drive session and answer the new file's id. **Any failure is `null`**,
 * whatever caused it: Drive's refusals carry no CORS headers, so the browser sees them only as a
 * network error and cannot read a status (#370).
 */
export async function putToDriveSession(sessionUri: string, blob: Blob): Promise<string | null> {
  try {
    const response = await fetch(sessionUri, { method: "PUT", body: blob });
    if (!response.ok) return null;
    const file = (await response.json()) as { id?: unknown };
    return typeof file.id === "string" ? file.id : null;
  } catch {
    return null;
  }
}
