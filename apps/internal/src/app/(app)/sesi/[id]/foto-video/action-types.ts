import type { DriveRefusal } from "-/lib/drive/upload-messages";
import type { FootageSessionRefusal } from "@sugt/db/queries";
import type { SessionFootageKind } from "@sugt/domain";

/**
 * What the Foto & Video Server Actions (`./actions.ts`) take and answer (#424, ADR-0046). Kept apart
 * because a `"use server"` module may export only async functions.
 */

/** The file the browser is about to send: its size and its declared type. */
export type FootageToOpen = { size: number; contentType: string };

export type OpenFootageUploadResult =
  /**
   * Drive's resumable session, for the browser to send the file to in pieces
   * (`uploadInPieces`), and the kind the declared type makes it.
   */
  | { outcome: "ready"; sessionUri: string; kind: SessionFootageKind }
  | FootageSessionRefusal
  /** Not a type footage may be, by the browser's word. The server sniffs it again once it lands. */
  | { outcome: "unsupported-type" }
  /** Larger than its kind's cap, or empty. */
  | { outcome: "too-large"; kind: SessionFootageKind; limit: number }
  | DriveRefusal;

export type FootageToRecord = {
  sessionId: string;
  driveFileId: string;
  /** As the browser named the file; shown in the list. */
  originalFilename: string;
  /** The type declared when the upload opened. */
  contentType: string;
};

export type RecordFootageActionResult =
  | { outcome: "recorded"; footageId: string; synced: boolean }
  | FootageSessionRefusal
  /** Not the file this upload opened for: missing, trashed, elsewhere, another trip's, or empty. */
  | { outcome: "file-unverified" }
  /** Its first bytes are none of the six types. */
  | { outcome: "unsupported-type" }
  /** Its bytes are the other kind than the type it was declared as — a "photo" that is a video. */
  | { outcome: "type-mismatch" }
  /** Larger than its sniffed kind's cap. */
  | { outcome: "too-large"; kind: SessionFootageKind; limit: number }
  | DriveRefusal;

export type DeleteFootageActionResult =
  | { outcome: "deleted" }
  /** Already deleted — a second Hapus, or a stale screen. */
  | { outcome: "no-such-footage" }
  | DriveRefusal;
