import type { Person } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { perjadinAcquittal, requirePerjadinWriter } from "@sugt/db/queries";
import { MAX_UPLOAD_BYTES } from "@sugt/domain";

import type { driveAccessToken } from "./access-token";
import type { DriveFile } from "./google";
import { uploadGate } from "./upload-gate";
import {
  DRIVE_FOLDERS_UNRESOLVED,
  DRIVE_NOT_CONNECTED,
  type DriveRefusal,
} from "./upload-messages";

/**
 * **The two guards every upload to Drive shares** (ADR-0040, ADR-0042) — receipts and Perjadin
 * Documents alike — kept here so the two sets of Server Actions cannot drift apart.
 */

/**
 * **The guard every upload write runs before it touches Drive**: `requirePerjadinWriter` — Staff,
 * then the trip's Group or the Perjadin Editor Grant (ADR-0048) — then a read of the Perjadin. Returns whether
 * the Perjadin exists.
 *
 * The order is load-bearing. An upload session is a write credential on the company Drive, and the
 * verify reads files with the company's own token; doing either first would give a caller who may
 * not write this trip an upload URL, or tell them whether a file exists and how big it is. The guard
 * is what closes this: `perjadinAcquittal` is an open money read since #180 (ADR-0026), so the read
 * alone refuses nobody.
 */
export async function staffOnTrip(person: Person, perjadinId: string): Promise<boolean> {
  const acquittal = await staffSurface(async () => {
    await requirePerjadinWriter(person, perjadinId);
    return perjadinAcquittal(person, perjadinId);
  });
  return acquittal !== null;
}

/**
 * Why `driveAccessToken` said no, as an action answers it: with the gate's own sentence for the two
 * states the page also closes on, so the dialog says exactly what a fresh page would have.
 */
export async function driveRefusal(
  person: Person,
  outcome: Exclude<Awaited<ReturnType<typeof driveAccessToken>>["outcome"], "ok">,
): Promise<DriveRefusal> {
  if (outcome === "drive-unreachable") return { outcome };
  const gate = await uploadGate(person);
  const fallback =
    outcome === "drive-disconnected" ? DRIVE_NOT_CONNECTED : DRIVE_FOLDERS_UNRESOLVED;
  return { outcome, reason: gate.open ? fallback : gate.reason };
}

/**
 * **Is this the file the browser said it uploaded, for this Perjadin?** The first half of verifying
 * any upload before it is recorded — the server never saw the bytes. It must sit in `_staging`,
 * untrashed, carry this Perjadin's `sugtPerjadinId`, and be no larger than the cap by Drive's own
 * count. What its first bytes must be is the caller's to sniff: a receipt's four types, or a PDF.
 * `maxBytes` is the cap: the receipts' and documents' by default; Session Footage passes the largest
 * of its kinds, and checks the sniffed kind's own cap after.
 */
export function isStagedUploadFor(
  file: DriveFile | null,
  stagingFolderId: string,
  perjadinId: string,
  maxBytes: number = MAX_UPLOAD_BYTES,
): file is DriveFile & { size: number } {
  return Boolean(
    file &&
    !file.trashed &&
    file.parents.includes(stagingFolderId) &&
    file.appProperties.sugtPerjadinId === perjadinId &&
    file.size !== null &&
    file.size > 0 &&
    file.size <= maxBytes,
  );
}
