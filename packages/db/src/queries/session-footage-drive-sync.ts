import type { SessionFootageContentType, SessionFootageKind } from "@sugt/domain";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "../client";
import { session, sessionFootage } from "../schema/delivery";
import { driveConnection } from "../schema/drive";
import { school, subCluster } from "../schema/reference";
import { perjadin } from "../schema/travel";
import type { DriveCaller, Person } from "./caller";
import { perjadinFolderNaming, type PerjadinFolderNaming } from "./perjadin-naming";
import { requireStaff } from "./staff-only";

/**
 * **Session Footage's place in the company Drive** (#424, ADR-0046, ADR-0063) — the database half of
 * its folders, as `./document-drive-sync.ts` is the Dokumen's. Two trees, side by side under the root,
 * with the same folder names:
 *
 * ```
 * Foto & Video/Pelaksanaan Offline/            ← drive_connection.footage_*_folder_id   (the archive)
 * └── {the Perjadin's folder name}/            ← perjadin.drive_footage_folder_id
 *     └── {held_on} · {HH.MM} · {School} · S-{session8}/   ← session.drive_footage_folder_id
 *         └── {held_on} · {School} · {Foto|Video} · M-{footage8}.{ext}
 *
 * Foto & Video — Unggahan/Pelaksanaan Offline/ ← drive_connection.footage_upload_*_folder_id
 * └── {the Perjadin's folder name}/            ← perjadin.drive_footage_upload_folder_id
 *     └── {held_on} · {HH.MM} · {School} · S-{session8}/   ← session.drive_footage_upload_folder_id
 *         └── (Staff-owned uploads, never named or moved by the app)
 * ```
 *
 * **No row lock is held across a call to Google**: each folder id is claimed by compare-and-set, and a
 * caller that lost reads back the winner's id and trashes its own.
 *
 * **Who may call what.** The sweep's bookkeeping on footage rows stays Staff-only. Finding and
 * claiming the **folders** is open to any signed-in Person, a Pimpinan included (#561, ADR-0063):
 * Lihat arsip makes a Session's archive folder on whoever's click, as the company account's own
 * housekeeping. The daily copy does the same with no Person at all (`DriveCaller`, #562). It writes folder ids the app owns, never a Person's record, so the "a Pimpinan writes
 * nothing" rule (ADR-0025) is about something else.
 */

/** Which of the two footage trees: the company-owned archive, or the Staff upload tree (#561). */
export type FootageTree = "archive" | "upload";

export type FootageFolderIds = {
  footageFolderId: string | null;
  footagePelaksanaanOfflineFolderId: string | null;
};

/** Each tree's two fixed-folder columns on the connection. */
const FIXED_FOOTAGE_COLUMNS = {
  archive: {
    tree: driveConnection.footageFolderId,
    pelaksanaan: driveConnection.footagePelaksanaanOfflineFolderId,
    treeKey: "footageFolderId",
    pelaksanaanKey: "footagePelaksanaanOfflineFolderId",
  },
  upload: {
    tree: driveConnection.footageUploadFolderId,
    pelaksanaan: driveConnection.footageUploadPelaksanaanOfflineFolderId,
    treeKey: "footageUploadFolderId",
    pelaksanaanKey: "footageUploadPelaksanaanOfflineFolderId",
  },
} as const;

/**
 * One tree's two fixed footage folders, as the connection stores them; `null` with no connection.
 * The archive's (`Foto & Video/`) unless `tree` says the upload tree's (`Foto & Video — Unggahan/`).
 */
export async function footageFolderIds(
  _caller: DriveCaller,
  tree: FootageTree = "archive",
): Promise<FootageFolderIds | null> {
  const columns = FIXED_FOOTAGE_COLUMNS[tree];
  const [row] = await db
    .select({
      footageFolderId: columns.tree,
      footagePelaksanaanOfflineFolderId: columns.pelaksanaan,
    })
    .from(driveConnection);
  return row ?? null;
}

/**
 * Claim one of a tree's two fixed footage folders by compare-and-set, as `claimDokumenFolder` does: a
 * new tree folder clears its `Pelaksanaan Offline/`, and a `Pelaksanaan Offline/` is claimed only
 * under the tree folder it was made in. `false` when another caller changed it first. The archive's
 * unless `claim.tree` says the upload tree's.
 */
export async function claimFootageFolder(
  _caller: DriveCaller,
  claim: { tree?: FootageTree } & (
    | { folder: "footageFolderId"; expected: string | null; next: string }
    | {
        folder: "footagePelaksanaanOfflineFolderId";
        expected: string | null;
        next: string;
        parentId: string;
      }
  ),
): Promise<boolean> {
  const columns = FIXED_FOOTAGE_COLUMNS[claim.tree ?? "archive"];
  const claimed =
    claim.folder === "footageFolderId"
      ? await db
          .update(driveConnection)
          .set({ [columns.treeKey]: claim.next, [columns.pelaksanaanKey]: null })
          .where(sql`${columns.tree} is not distinct from ${claim.expected}`)
          .returning({ id: columns.tree })
      : await db
          .update(driveConnection)
          .set({ [columns.pelaksanaanKey]: claim.next })
          .where(
            and(
              eq(columns.tree, claim.parentId),
              sql`${columns.pelaksanaan} is not distinct from ${claim.expected}`,
            ),
          )
          .returning({ id: columns.pelaksanaan });
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

/** An offline or online Session, with what the Foto & Video button needs to open its folder. */
export type SessionFootageFolderTarget = {
  sessionId: string;
  mode: "offline" | "online";
  status: "arranged" | "delivered" | "cancelled";
  session: SessionFolderNaming;
  /** The trip and what its folder is named from; `null` for an online Session, which has none. */
  perjadin: PerjadinFolderNaming | null;
  /** The Perjadin's folder under `Foto & Video/Pelaksanaan Offline`, once claimed. */
  perjadinFolderId: string | null;
  /** The Session's folder in it, once claimed. */
  sessionFolderId: string | null;
  /** The Perjadin's folder under `Foto & Video — Unggahan/Pelaksanaan Offline` (#561), once claimed. */
  uploadPerjadinFolderId: string | null;
  /** The Session's folder in that, once claimed: what Foto & Video opens. */
  uploadSessionFolderId: string | null;
};

/**
 * **One Session, for the Foto & Video and Lihat arsip buttons** (#552, #561): its mode and status,
 * what its folders are named from, and the folder ids of both trees claimed so far. `null` when there
 * is no such Session — a text compare, so a malformed id is simply none. Open to any signed-in Person,
 * and to the daily cron (#562): opening a folder is a read, and making one is housekeeping.
 */
export async function sessionFootageFolderTarget(
  _caller: DriveCaller,
  sessionId: string,
): Promise<SessionFootageFolderTarget | null> {
  const [row] = await db
    .select({
      sessionId: session.id,
      mode: session.mode,
      status: session.status,
      session: sessionFolderNaming,
      perjadin: perjadinFolderNaming,
      perjadinFolderId: perjadin.driveFootageFolderId,
      sessionFolderId: session.driveFootageFolderId,
      uploadPerjadinFolderId: perjadin.driveFootageUploadFolderId,
      uploadSessionFolderId: session.driveFootageUploadFolderId,
    })
    .from(session)
    .innerJoin(school, eq(school.id, session.schoolId))
    .leftJoin(perjadin, eq(perjadin.id, session.perjadinId))
    .leftJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .where(sql`${session.id}::text = ${sessionId}`);
  if (!row) return null;
  // Left-joined, so every part is null for an online Session, which has no trip.
  const trip = row.perjadin;
  return {
    sessionId: row.sessionId,
    mode: row.mode,
    status: row.status,
    session: row.session,
    perjadin:
      trip?.id && trip.subClusterName && trip.startsOn && trip.endsOn
        ? {
            id: trip.id,
            subClusterName: trip.subClusterName,
            startsOn: trip.startsOn,
            endsOn: trip.endsOn,
            schoolNames: trip.schoolNames,
          }
        : null,
    perjadinFolderId: row.perjadinFolderId,
    sessionFolderId: row.sessionFolderId,
    uploadPerjadinFolderId: row.uploadPerjadinFolderId,
    uploadSessionFolderId: row.uploadSessionFolderId,
  };
}

/**
 * Claim the Perjadin's footage folder in `tree` (the archive unless said); answers whichever id won.
 * Any signed-in Person, or the daily cron (#561, #562, ADR-0063).
 */
export async function claimPerjadinFootageFolder(
  _caller: DriveCaller,
  perjadinId: string,
  folderId: string,
  tree: FootageTree = "archive",
): Promise<string> {
  const column =
    tree === "archive" ? perjadin.driveFootageFolderId : perjadin.driveFootageUploadFolderId;
  const key = tree === "archive" ? "driveFootageFolderId" : "driveFootageUploadFolderId";
  const [claimed] = await db
    .update(perjadin)
    .set({ [key]: folderId })
    .where(and(eq(perjadin.id, perjadinId), isNull(column)))
    .returning({ id: column });
  if (claimed?.id) return claimed.id;

  const [winner] = await db
    .select({ id: column })
    .from(perjadin)
    .where(eq(perjadin.id, perjadinId));
  return winner!.id!;
}

/**
 * Claim the Session's footage folder in `tree` (the archive unless said); answers whichever id won.
 * Any signed-in Person, or the daily cron (#561, #562, ADR-0063).
 */
export async function claimSessionFootageFolder(
  _caller: DriveCaller,
  sessionId: string,
  folderId: string,
  tree: FootageTree = "archive",
): Promise<string> {
  const column =
    tree === "archive" ? session.driveFootageFolderId : session.driveFootageUploadFolderId;
  const key = tree === "archive" ? "driveFootageFolderId" : "driveFootageUploadFolderId";
  const [claimed] = await db
    .update(session)
    .set({ [key]: folderId })
    .where(and(eq(session.id, sessionId), isNull(column)))
    .returning({ id: column });
  if (claimed?.id) return claimed.id;

  const [winner] = await db.select({ id: column }).from(session).where(eq(session.id, sessionId));
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

/** A Session's upload folder (#561), with what it is named from. Its files are Staff-owned. */
export type SessionFootageUploadFolder = {
  perjadinId: string;
  naming: SessionFolderNaming;
  folderId: string;
};

/**
 * **The Session upload folders to name** (#561, ADR-0063) — one Session's (`sessionId`), after its
 * date, time or School changed, or every one, for Periksa koneksi's re-assert. Only the folders: the
 * files in them are Staff-owned and never renamed. Ordered by Session id, as `sessionFootageFolders`.
 */
export async function sessionFootageUploadFolders(
  caller: Person,
  sessionId?: string,
): Promise<SessionFootageUploadFolder[]> {
  requireStaff(caller);

  const rows = await db
    .select({
      perjadinId: session.perjadinId,
      naming: sessionFolderNaming,
      folderId: session.driveFootageUploadFolderId,
    })
    .from(session)
    .innerJoin(school, eq(school.id, session.schoolId))
    .where(
      and(
        isNotNull(session.driveFootageUploadFolderId),
        sessionId === undefined ? undefined : sql`${session.id}::text = ${sessionId}`,
      ),
    )
    .orderBy(asc(session.id));
  // Only an offline Session, on a Perjadin, ever has an upload folder.
  return rows.map((row) => ({ ...row, perjadinId: row.perjadinId!, folderId: row.folderId! }));
}
