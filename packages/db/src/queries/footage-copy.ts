import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "../client";
import { session } from "../schema/delivery";
import { driveConnection } from "../schema/drive";
import type { DriveCaller } from "./caller";

/**
 * **The database half of the daily Foto & Video copy** (#562, ADR-0063): the lease that keeps two
 * passes from copying at once, the Sessions to go through, and when each was last gone through. No
 * row per file: what is already copied is read from Drive itself (each copy carries the original's
 * id). Open to the cron (`CronCaller`) and to anyone signed in, as the company account's housekeeping.
 */

/**
 * **Claim the copy lease** until `until`: only when nobody holds it, or the holder's lease has run
 * out (a crashed pass frees itself that way). Answers the lease taken — what `releaseFootageCopyLease`
 * needs — or `null` when another pass holds it, and with no connection at all.
 */
export async function claimFootageCopyLease(
  _caller: DriveCaller,
  until: Date,
): Promise<Date | null> {
  const [claimed] = await db
    .update(driveConnection)
    .set({ footageCopyLeaseUntil: until })
    .where(
      or(
        isNull(driveConnection.footageCopyLeaseUntil),
        lt(driveConnection.footageCopyLeaseUntil, sql`now()`),
      ),
    )
    .returning({ until: driveConnection.footageCopyLeaseUntil });
  return claimed?.until ?? null;
}

/** Give the lease back — only the one this pass took, so a pass whose lease ran out frees nothing. */
export async function releaseFootageCopyLease(_caller: DriveCaller, lease: Date): Promise<void> {
  await db
    .update(driveConnection)
    .set({ footageCopyLeaseUntil: null })
    .where(eq(driveConnection.footageCopyLeaseUntil, lease));
}

/** One Session the copy goes through: its upload folder and, once made, its archive folder. */
export type FootageCopySession = {
  sessionId: string;
  uploadFolderId: string;
  /** Its archive Session folder, `null` until one is made. */
  archiveFolderId: string | null;
};

/**
 * **Every Session with an upload folder**, cancelled ones included — oldest-checked first, never
 * checked before all, then by id — so a pass cut short by its budget picks up with the ones it has
 * not reached.
 */
export async function footageCopySessions(_caller: DriveCaller): Promise<FootageCopySession[]> {
  const rows = await db
    .select({
      sessionId: session.id,
      uploadFolderId: session.driveFootageUploadFolderId,
      archiveFolderId: session.driveFootageFolderId,
    })
    .from(session)
    .where(isNotNull(session.driveFootageUploadFolderId))
    .orderBy(sql`${session.driveFootageUploadCheckedAt} asc nulls first`, asc(session.id));
  return rows.map((row) => ({ ...row, uploadFolderId: row.uploadFolderId! }));
}

/** A Session's upload folder has been gone through in full: it goes to the back of the queue. */
export async function markFootageUploadChecked(
  _caller: DriveCaller,
  sessionId: string,
): Promise<void> {
  await db
    .update(session)
    .set({ driveFootageUploadCheckedAt: sql`now()` })
    .where(and(eq(session.id, sessionId), isNotNull(session.driveFootageUploadFolderId)));
}
