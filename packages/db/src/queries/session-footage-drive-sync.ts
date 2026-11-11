import type { SessionFootageContentType, SessionFootageKind } from "@sugt/domain";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "../client";
import { session, sessionFootage } from "../schema/delivery";
import { driveConnection } from "../schema/drive";
import { school, subCluster } from "../schema/reference";
import { perjadin } from "../schema/travel";
import type { Person } from "./caller";
import { perjadinFolderNaming, type PerjadinFolderNaming } from "./perjadin-naming";
import { requireStaff } from "./staff-only";

/**
 * **Session Footage's place in the company Drive** (#424, ADR-0046) — the database half of its
 * reconcile, as `./document-drive-sync.ts` is the Dokumen's. The tree:
 *
 * ```
 * Foto & Video/Pelaksanaan Offline/            ← drive_connection.footage_*_folder_id
 * └── {the Perjadin's folder name}/            ← perjadin.drive_footage_folder_id
 *     └── {held_on} · {HH.MM} · {School} · S-{session8}/   ← session.drive_footage_folder_id
 *         └── {held_on} · {School} · {Foto|Video} · M-{footage8}.{ext}
 * ```
 *
 * Every function is Staff-only. **No row lock is held across a call to Google**: each folder id is
 * claimed by compare-and-set, and a caller that lost reads back the winner's id and trashes its own.
 */

export type FootageFolderIds = {
  footageFolderId: string | null;
  footagePelaksanaanOfflineFolderId: string | null;
};

/** The two fixed footage folders, as the connection stores them; `null` with no connection. */
export async function footageFolderIds(caller: Person): Promise<FootageFolderIds | null> {
  requireStaff(caller);

  const [row] = await db
    .select({
      footageFolderId: driveConnection.footageFolderId,
      footagePelaksanaanOfflineFolderId: driveConnection.footagePelaksanaanOfflineFolderId,
    })
    .from(driveConnection);
  return row ?? null;
}

/**
 * Claim one of the two fixed footage folders by compare-and-set, as `claimDokumenFolder` does: a new
 * `Foto & Video/` clears its `Pelaksanaan Offline/`, and a `Pelaksanaan Offline/` is claimed only
 * under the `Foto & Video/` it was made in. `false` when another caller changed it first.
 */
export async function claimFootageFolder(
  caller: Person,
  claim:
    | { folder: "footageFolderId"; expected: string | null; next: string }
    | {
        folder: "footagePelaksanaanOfflineFolderId";
        expected: string | null;
        next: string;
        parentId: string;
      },
): Promise<boolean> {
  requireStaff(caller);

  const claimed =
    claim.folder === "footageFolderId"
      ? await db
          .update(driveConnection)
          .set({ footageFolderId: claim.next, footagePelaksanaanOfflineFolderId: null })
          .where(sql`${driveConnection.footageFolderId} is not distinct from ${claim.expected}`)
          .returning({ id: driveConnection.footageFolderId })
      : await db
          .update(driveConnection)
          .set({ footagePelaksanaanOfflineFolderId: claim.next })
          .where(
            and(
              eq(driveConnection.footageFolderId, claim.parentId),
              sql`${driveConnection.footagePelaksanaanOfflineFolderId} is not distinct from ${claim.expected}`,
            ),
          )
          .returning({ id: driveConnection.footagePelaksanaanOfflineFolderId });
  return claimed.length > 0;
}

/** What a Session's footage folder is named from: its date, its start time and its School. */
export type SessionFolderNaming = {
  sessionId: string;
  heldOn: string;
  /** `HH:MM:SS`, as Postgres returns a `time`. */
  startsAt: string;
  schoolName: string;
};

const sessionFolderNaming = {
  sessionId: session.id,
  heldOn: session.heldOn,
  startsAt: session.startsAt,
  schoolName: school.name,
};

/** Everything the reconcile needs to put one file of footage in place. */
export type FootageReconcileTarget = {
  footageId: string;
  kind: SessionFootageKind;
  contentType: SessionFootageContentType;
  driveFileId: string;
  session: SessionFolderNaming;
  /** What the Perjadin's folder is named from (ADR-0044). */
  perjadin: PerjadinFolderNaming;
  /** The Perjadin's folder under `Foto & Video/Pelaksanaan Offline`, once claimed. */
  perjadinFolderId: string | null;
  /** The Session's folder in it, once claimed. */
  sessionFolderId: string | null;
};

/** The footage, its Session and its Perjadin. `null` when there is no such footage. */
export async function footageReconcileTarget(
  caller: Person,
  footageId: string,
): Promise<FootageReconcileTarget | null> {
  requireStaff(caller);

  const [row] = await db
    .select({
      footageId: sessionFootage.id,
      kind: sessionFootage.kind,
      contentType: sessionFootage.contentType,
      driveFileId: sessionFootage.driveFileId,
      session: sessionFolderNaming,
      perjadin: perjadinFolderNaming,
      perjadinFolderId: perjadin.driveFootageFolderId,
      sessionFolderId: session.driveFootageFolderId,
    })
    .from(sessionFootage)
    .innerJoin(session, eq(session.id, sessionFootage.sessionId))
    .innerJoin(school, eq(school.id, session.schoolId))
    .innerJoin(perjadin, eq(perjadin.id, session.perjadinId))
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(sql`${sessionFootage.id}::text = ${footageId}`);
  return row ?? null;
}

/** Claim the Perjadin's footage folder; answers whichever id won. */
export async function claimPerjadinFootageFolder(
  caller: Person,
  perjadinId: string,
  folderId: string,
): Promise<string> {
  requireStaff(caller);

  const [claimed] = await db
    .update(perjadin)
    .set({ driveFootageFolderId: folderId })
    .where(and(eq(perjadin.id, perjadinId), isNull(perjadin.driveFootageFolderId)))
    .returning({ id: perjadin.driveFootageFolderId });
  if (claimed?.id) return claimed.id;

  const [winner] = await db
    .select({ id: perjadin.driveFootageFolderId })
    .from(perjadin)
    .where(eq(perjadin.id, perjadinId));
  return winner!.id!;
}

/** Claim the Session's footage folder; answers whichever id won. */
export async function claimSessionFootageFolder(
  caller: Person,
  sessionId: string,
  folderId: string,
): Promise<string> {
  requireStaff(caller);

  const [claimed] = await db
    .update(session)
    .set({ driveFootageFolderId: folderId })
    .where(and(eq(session.id, sessionId), isNull(session.driveFootageFolderId)))
    .returning({ id: session.driveFootageFolderId });
  if (claimed?.id) return claimed.id;

  const [winner] = await db
    .select({ id: session.driveFootageFolderId })
    .from(session)
    .where(eq(session.id, sessionId));
  return winner!.id!;
}

export async function markFootageSynced(caller: Person, footageId: string): Promise<void> {
  requireStaff(caller);

  await db
    .update(sessionFootage)
    .set({ driveSyncedAt: sql`now()`, driveSyncFailedAt: null })
    .where(eq(sessionFootage.id, footageId));
}

/** Remember a failed reconcile, so the sweep tries other footage first next time. */
export async function markFootageSyncFailed(caller: Person, footageId: string): Promise<void> {
  requireStaff(caller);

  await db
    .update(sessionFootage)
    .set({ driveSyncFailedAt: sql`now()` })
    .where(and(eq(sessionFootage.id, footageId), isNull(sessionFootage.driveSyncedAt)));
}

export type UnsyncedFootage = { id: string; kind: SessionFootageKind; originalFilename: string };

/**
 * Footage still owed its place in Drive — never-tried first, then oldest — up to `limit`, and how
 * many there are in all. Periksa koneksi's sweep reads it.
 */
export async function unsyncedFootage(
  caller: Person,
  limit: number,
): Promise<{ total: number; footage: UnsyncedFootage[] }> {
  requireStaff(caller);

  const unsynced = isNull(sessionFootage.driveSyncedAt);
  const [footage, [counted]] = await Promise.all([
    db
      .select({
        id: sessionFootage.id,
        kind: sessionFootage.kind,
        originalFilename: sessionFootage.originalFilename,
      })
      .from(sessionFootage)
      .where(unsynced)
      .orderBy(
        sql`${sessionFootage.driveSyncFailedAt} asc nulls first`,
        asc(sessionFootage.uploadedAt),
        asc(sessionFootage.id),
      )
      .limit(limit),
    db.select({ total: count() }).from(sessionFootage).where(unsynced),
  ]);
  return { total: counted?.total ?? 0, footage };
}

/** One placed file of a Session's footage, as a rename names it. */
export type PlacedFootage = {
  footageId: string;
  kind: SessionFootageKind;
  contentType: SessionFootageContentType;
  driveFileId: string;
};

/** A Session's footage folder and the files placed in it, with what they are named from. */
export type SessionFootageFolder = {
  perjadinId: string;
  naming: SessionFolderNaming;
  folderId: string;
  /** Only footage the reconcile has placed: an unsynced file is still in `_staging`, unnamed. */
  files: PlacedFootage[];
};

/**
 * **The Session footage folders to name** — one Session's (`sessionId`), after its date or time
 * changed, or every one, for Periksa koneksi's re-assert. Ordered by Session id, so a press that
 * stops early stops at the same place each time.
 */
export async function sessionFootageFolders(
  caller: Person,
  sessionId?: string,
): Promise<SessionFootageFolder[]> {
  requireStaff(caller);

  const rows = await db
    .select({
      perjadinId: session.perjadinId,
      naming: sessionFolderNaming,
      folderId: session.driveFootageFolderId,
      footageId: sessionFootage.id,
      kind: sessionFootage.kind,
      contentType: sessionFootage.contentType,
      driveFileId: sessionFootage.driveFileId,
    })
    .from(session)
    .innerJoin(school, eq(school.id, session.schoolId))
    .leftJoin(
      sessionFootage,
      and(eq(sessionFootage.sessionId, session.id), isNotNull(sessionFootage.driveSyncedAt)),
    )
    .where(
      and(
        isNotNull(session.driveFootageFolderId),
        sessionId === undefined ? undefined : sql`${session.id}::text = ${sessionId}`,
      ),
    )
    .orderBy(asc(session.id), asc(sessionFootage.id));

  const folders = new Map<string, SessionFootageFolder>();
  for (const row of rows) {
    const folder = folders.get(row.naming.sessionId) ?? {
      // Only an offline Session, on a Perjadin, ever has a footage folder.
      perjadinId: row.perjadinId!,
      naming: row.naming,
      folderId: row.folderId!,
      files: [],
    };
    if (row.footageId && row.kind && row.contentType && row.driveFileId) {
      folder.files.push({
        footageId: row.footageId,
        kind: row.kind,
        contentType: row.contentType,
        driveFileId: row.driveFileId,
      });
    }
    folders.set(row.naming.sessionId, folder);
  }
  return [...folders.values()];
}
