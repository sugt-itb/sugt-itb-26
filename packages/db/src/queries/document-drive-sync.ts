import type { PerjadinDocumentKind, PerjadinDocumentParticipantType } from "@sugt/domain";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";

import { db } from "../client";
import { driveConnection } from "../schema/drive";
import { school, subCluster } from "../schema/reference";
import { perjadin, perjadinDocument, perjadinDocumentFolder } from "../schema/travel";
import type { Person } from "./caller";
import { perjadinFolderNaming, type PerjadinFolderNaming } from "./perjadin-naming";
import { requireStaff } from "./staff-only";

/**
 * **What the document reconcile reads and writes** (ADR-0042, #397) — one Perjadin Document's place
 * in the company Drive, the same way `./drive-sync.ts` is one transaction's. Staff-only throughout:
 * the reconcile runs when an Administrator — Staff — sweeps or reconnects. Nothing uploads a
 * document any more (ADR-0061); it finishes the ones recorded before that.
 *
 * **No row lock is held across a call to Google.** Every folder id is claimed by compare-and-set:
 * the write lands only where the id is still what the caller last read, and a caller that lost
 * reads back the winner's and trashes the folder it made.
 */

/** `Dokumen/` and `Dokumen/Pelaksanaan Offline/`, as the connection holds them. */
export type DokumenFolderIds = {
  dokumenFolderId: string | null;
  dokumenPelaksanaanOfflineFolderId: string | null;
};

/** The two Dokumen folder ids, or `null` when Drive was never connected. */
export async function dokumenFolderIds(caller: Person): Promise<DokumenFolderIds | null> {
  requireStaff(caller);

  const [row] = await db
    .select({
      dokumenFolderId: driveConnection.dokumenFolderId,
      dokumenPelaksanaanOfflineFolderId: driveConnection.dokumenPelaksanaanOfflineFolderId,
    })
    .from(driveConnection);
  return row ?? null;
}

/**
 * **Claim one Dokumen folder** — `Dokumen/` or the `Pelaksanaan Offline/` under it — replacing
 * `expected`, the id the caller found missing, trashed or unset. Answers whether the claim landed.
 * A caller that lost trashes its own folder and reads the ids again.
 *
 * A new `Dokumen/` cannot still hold the old `Pelaksanaan Offline/`, so claiming it clears that.
 * A `Pelaksanaan Offline/` lands only while `parentId`, the `Dokumen/` it was made in, is still the
 * stored one — so it can never be recorded inside a `Dokumen/` another caller has just replaced.
 */
export async function claimDokumenFolder(
  caller: Person,
  claim:
    | { folder: "dokumenFolderId"; expected: string | null; next: string }
    | {
        folder: "dokumenPelaksanaanOfflineFolderId";
        expected: string | null;
        next: string;
        parentId: string;
      },
): Promise<boolean> {
  requireStaff(caller);

  const claimed =
    claim.folder === "dokumenFolderId"
      ? await db
          .update(driveConnection)
          .set({ dokumenFolderId: claim.next, dokumenPelaksanaanOfflineFolderId: null })
          .where(sql`${driveConnection.dokumenFolderId} is not distinct from ${claim.expected}`)
          .returning({ id: driveConnection.dokumenFolderId })
      : await db
          .update(driveConnection)
          .set({ dokumenPelaksanaanOfflineFolderId: claim.next })
          .where(
            and(
              eq(driveConnection.dokumenFolderId, claim.parentId),
              sql`${driveConnection.dokumenPelaksanaanOfflineFolderId} is not distinct from ${claim.expected}`,
            ),
          )
          .returning({ id: driveConnection.dokumenPelaksanaanOfflineFolderId });
  return claimed.length > 0;
}

/** Everything the reconcile needs to put one document in place. */
export type DocumentReconcileTarget = {
  documentId: string;
  kind: PerjadinDocumentKind;
  /** `null` on an SPPD, which has a School and no date (#441). */
  documentDate: string | null;
  schoolName: string | null;
  participantType: PerjadinDocumentParticipantType | null;
  driveFileId: string;
  /** What the Perjadin's folder is named from (ADR-0044). */
  perjadin: PerjadinFolderNaming;
  /** The Perjadin's folder under `Dokumen/Pelaksanaan Offline`, once claimed. */
  dokumenFolderId: string | null;
  /** This kind's folder in it, once claimed. */
  kindFolderId: string | null;
};

/** The document, its Perjadin and its folders. `null` when there is no such document. */
export async function documentReconcileTarget(
  caller: Person,
  documentId: string,
): Promise<DocumentReconcileTarget | null> {
  requireStaff(caller);

  const [row] = await db
    .select({
      documentId: perjadinDocument.id,
      kind: perjadinDocument.kind,
      documentDate: perjadinDocument.documentDate,
      schoolName: school.name,
      participantType: perjadinDocument.participantType,
      driveFileId: perjadinDocument.driveFileId,
      perjadin: perjadinFolderNaming,
      dokumenFolderId: perjadin.driveDokumenFolderId,
      kindFolderId: perjadinDocumentFolder.driveFolderId,
    })
    .from(perjadinDocument)
    .innerJoin(perjadin, eq(perjadin.id, perjadinDocument.perjadinId))
    .innerJoin(subCluster, eq(subCluster.id, perjadin.subClusterId))
    .leftJoin(school, eq(school.id, perjadinDocument.schoolId))
    .leftJoin(
      perjadinDocumentFolder,
      and(
        eq(perjadinDocumentFolder.perjadinId, perjadinDocument.perjadinId),
        eq(perjadinDocumentFolder.kind, perjadinDocument.kind),
      ),
    )
    .where(eq(perjadinDocument.id, documentId));
  return row ?? null;
}

/** Claim the Perjadin's Dokumen folder unless another caller did first. Answers the winner. */
export async function claimPerjadinDokumenFolder(
  caller: Person,
  perjadinId: string,
  folderId: string,
): Promise<string> {
  requireStaff(caller);

  const [claimed] = await db
    .update(perjadin)
    .set({ driveDokumenFolderId: folderId })
    .where(and(eq(perjadin.id, perjadinId), isNull(perjadin.driveDokumenFolderId)))
    .returning({ id: perjadin.driveDokumenFolderId });
  if (claimed?.id) return claimed.id;

  const [winner] = await db
    .select({ id: perjadin.driveDokumenFolderId })
    .from(perjadin)
    .where(eq(perjadin.id, perjadinId));
  return winner!.id!;
}

/** The same for one kind's folder: the primary key `(perjadin_id, kind)` is the compare-and-set. */
export async function claimDocumentKindFolder(
  caller: Person,
  perjadinId: string,
  kind: PerjadinDocumentKind,
  folderId: string,
): Promise<string> {
  requireStaff(caller);

  const [claimed] = await db
    .insert(perjadinDocumentFolder)
    .values({ perjadinId, kind, driveFolderId: folderId })
    .onConflictDoNothing()
    .returning({ id: perjadinDocumentFolder.driveFolderId });
  if (claimed) return claimed.id;

  const [winner] = await db
    .select({ id: perjadinDocumentFolder.driveFolderId })
    .from(perjadinDocumentFolder)
    .where(
      and(eq(perjadinDocumentFolder.perjadinId, perjadinId), eq(perjadinDocumentFolder.kind, kind)),
    );
  return winner!.id;
}

/** The reconcile finished this document: named, in its kind folder, shared. */
export async function markDocumentSynced(caller: Person, documentId: string): Promise<void> {
  requireStaff(caller);

  await db
    .update(perjadinDocument)
    .set({ driveSyncedAt: sql`now()`, driveSyncFailedAt: null })
    .where(eq(perjadinDocument.id, documentId));
}

/** A reconcile could not finish it, so the sweep tries other documents first next time. */
export async function markDocumentSyncFailed(caller: Person, documentId: string): Promise<void> {
  requireStaff(caller);

  await db
    .update(perjadinDocument)
    .set({ driveSyncFailedAt: sql`now()` })
    .where(and(eq(perjadinDocument.id, documentId), isNull(perjadinDocument.driveSyncedAt)));
}

/** One document the sweep will reconcile, with what Periksa koneksi says about it if it fails. */
export type UnsyncedDocument = {
  id: string;
  kind: PerjadinDocumentKind;
  /** `null` on an SPPD (#441), which Periksa koneksi names by its School instead. */
  documentDate: string | null;
  schoolName: string | null;
};

/**
 * **The documents the sweep owes**: every one not yet synced, at most `limit`, and how many in all
 * — in the order `unsyncedTransactions` uses: never-failed first, oldest first, then the
 * longest-failed, so a few that fail every time cannot hold the bounded sweep.
 */
export async function unsyncedDocuments(
  caller: Person,
  limit: number,
): Promise<{ total: number; documents: UnsyncedDocument[] }> {
  requireStaff(caller);

  const unsynced = isNull(perjadinDocument.driveSyncedAt);
  const [documents, [counted]] = await Promise.all([
    db
      .select({
        id: perjadinDocument.id,
        kind: perjadinDocument.kind,
        documentDate: perjadinDocument.documentDate,
        schoolName: school.name,
      })
      .from(perjadinDocument)
      .leftJoin(school, eq(school.id, perjadinDocument.schoolId))
      .where(unsynced)
      .orderBy(
        sql`${perjadinDocument.driveSyncFailedAt} asc nulls first`,
        asc(perjadinDocument.uploadedAt),
        asc(perjadinDocument.id),
      )
      .limit(limit),
    db.select({ total: count() }).from(perjadinDocument).where(unsynced),
  ]);
  return { total: counted?.total ?? 0, documents };
}
