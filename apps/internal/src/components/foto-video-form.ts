import type {
  DeleteFootageActionResult,
  OpenFootageUploadResult,
  RecordFootageActionResult,
} from "-/app/(app)/sesi/[id]/foto-video/action-types";
import { DECLARABLE_FOOTAGE_TYPES } from "-/lib/drive/footage-files";
import type { ResumableUploadResult } from "-/lib/drive/resumable-upload";
import { driveRefusalText, STALE_PAGE } from "-/lib/drive/upload-messages";
import { formatTripDates } from "-/lib/perjadin-name";
import { MAX_FOOTAGE_BYTES, type SessionFootageKind } from "@sugt/domain";

/**
 * **What the Foto & Video popup says and checks** (#425, ADR-0046) — plain functions, kept apart from
 * the components so the rules and the copy are tested without a DOM, as `perjadin-dokumen-form.ts`
 * is for Dokumen.
 */

/** At most this many files in one Unggah: a batch is sent one file at a time, and this bounds it. */
export const MAX_FOOTAGE_FILES_PER_BATCH = 30;

/**
 * What the picker offers: the types, and their extensions too — some phones report a HEIC photo with
 * no MIME type at all, and only the extension says what it is.
 */
export const FOOTAGE_ACCEPT = [
  ...Object.keys(DECLARABLE_FOOTAGE_TYPES),
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".webp",
  ".mp4",
  ".mov",
].join(",");

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/**
 * The type to declare for a picked file: the browser's when it is one footage may be, otherwise the
 * one its extension names (a HEIC with an empty `type`), otherwise `null`. The server sniffs the
 * bytes again once they land, so this only decides the kind's cap and the session's declared type.
 */
export function declaredFootageType(file: { name: string; type: string }): string | null {
  if (Object.hasOwn(DECLARABLE_FOOTAGE_TYPES, file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? null;
}

/** One file ready to go: its declared type and the kind that makes it. */
export type PickedFootage = { file: File; contentType: string; kind: SessionFootageKind };

export type PickedFootageCheck = {
  accepted: PickedFootage[];
  /** Each file refused on pick, with the reason the popup shows beside it. */
  refused: { file: File; reason: string }[];
  /** The files beyond `MAX_FOOTAGE_FILES_PER_BATCH`, left out, and the sentence saying so. */
  overLimit: string | null;
};

const MEGABYTE = 1024 * 1024;

/** One picked file, told apart from another the way a gallery picker repeats one: name, size, time. */
function sameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

/**
 * **Check what was picked**, before anything is uploaded: a type footage may be, within its kind's
 * cap, not empty, not picked already — and no more than `MAX_FOOTAGE_FILES_PER_BATCH` in all,
 * counting those already staged (`alreadyPicked`). A file picked twice would be uploaded twice, as two
 * Drive files and two rows, so the repeat is left out. The server checks every one of these again.
 */
export function checkPickedFootage(
  files: readonly File[],
  alreadyPicked: readonly PickedFootage[] = [],
): PickedFootageCheck {
  const accepted: PickedFootage[] = [];
  const refused: { file: File; reason: string }[] = [];
  let overLimit: string | null = null;

  for (const file of files) {
    if ([...alreadyPicked, ...accepted].some((entry) => sameFile(entry.file, file))) {
      refused.push({ file, reason: "Sudah dipilih" });
      continue;
    }
    const contentType = declaredFootageType(file);
    const kind = contentType ? DECLARABLE_FOOTAGE_TYPES[contentType]! : null;
    if (!contentType || !kind) {
      refused.push({ file, reason: "Jenis berkas tidak didukung" });
    } else if (file.size === 0) {
      refused.push({ file, reason: "Berkas kosong" });
    } else if (file.size > MAX_FOOTAGE_BYTES[kind]) {
      refused.push({ file, reason: tooLargeText(kind) });
    } else if (alreadyPicked.length + accepted.length >= MAX_FOOTAGE_FILES_PER_BATCH) {
      overLimit = `Paling banyak ${MAX_FOOTAGE_FILES_PER_BATCH} berkas sekali unggah — sisanya tidak dipilih.`;
    } else {
      accepted.push({ file, contentType, kind });
    }
  }
  return { accepted, refused, overLimit };
}

/** "Foto lebih dari 50 MB", "Video lebih dari 1000 MB". */
function tooLargeText(kind: SessionFootageKind): string {
  const limit = MAX_FOOTAGE_BYTES[kind] / MEGABYTE;
  return `${kind === "foto" ? "Foto" : "Video"} lebih dari ${limit} MB`;
}

const SIZE = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/** A file's size as a person reads it: `820 KB`, `3,4 MB`, `1,2 GB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < MEGABYTE) return `${SIZE.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
  if (bytes < 1024 * MEGABYTE) return `${SIZE.format(bytes / MEGABYTE)} MB`;
  return `${SIZE.format(bytes / (1024 * MEGABYTE))} GB`;
}

/** "Foto" or "Video". */
export function footageKindLabel(kind: SessionFootageKind): string {
  return kind === "foto" ? "Foto" : "Video";
}

/** The popup's title: `Foto & Video — 12 Okt 2026 · SMA Pradita Dirgantara`. */
export function footageTitle(heldOn: string, schoolName: string): string {
  return `Foto & Video — ${formatTripDates(heldOn, heldOn)} · ${schoolName}`;
}

/** The popup's description, word for word as the ticket set it. */
export const FOOTAGE_DESCRIPTION = "Upload dokumentasi kegiatan luring untuk sesi ini";

/** After an upload whose reconcile did not finish for `count` files, said once under the summary. */
export function footageUnsyncedNote(count: number): string {
  return `${count} berkas belum tersinkron ke Google Drive. Sinkronisasi akan diselesaikan kemudian; tidak ada yang perlu diulang.`;
}

/** What the "belum tersinkron" marker on a file says, in full. */
export const FOOTAGE_UNSYNCED_TOOLTIP =
  "Berkas belum tersinkron ke Google Drive — Administrator dapat menyelesaikannya lewat Periksa koneksi.";

/** Why a file did not go up or was not recorded: the reason listed beside its name. */
export function footageFailureText(
  failure:
    | Exclude<OpenFootageUploadResult, { outcome: "ready" }>
    | Exclude<RecordFootageActionResult, { outcome: "recorded" }>
    | Extract<ResumableUploadResult, { outcome: "failed" }>
    | { outcome: "error" },
): string {
  switch (failure.outcome) {
    case "no-such-session":
      return STALE_PAGE;
    case "session-online":
      return "Sesi daring tidak punya Foto & Video.";
    case "session-cancelled":
      return "Sesi ini sudah dibatalkan.";
    case "unsupported-type":
      return "Jenis berkas tidak didukung";
    case "type-mismatch":
      return "Isi berkas tidak sesuai jenisnya";
    case "too-large":
      return tooLargeText(failure.kind);
    case "file-unverified":
      return "Berkas tidak dapat diperiksa di Google Drive — coba lagi.";
    case "failed":
      return failure.reason === "gave-up"
        ? "Koneksi terputus terlalu lama — coba lagi."
        : "Google Drive menolak unggahan — coba lagi.";
    case "error":
      return "Gagal diunggah — coba lagi.";
    default:
      return driveRefusalText(failure);
  }
}

/** Why Hapus did not go through. The file is still listed, and still where it was. */
export function footageDeleteRefusalText(
  result: Exclude<DeleteFootageActionResult, { outcome: "deleted" | "no-such-footage" }>,
): string {
  return driveRefusalText(result);
}
