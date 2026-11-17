import type { PerjadinDocumentKind, PerjadinDocumentParticipantType, TimeZone } from "@sugt/domain";
import { type AnyColumn, and, asc, eq, exists, type SQL, sql } from "drizzle-orm";

import { db } from "../client";
import { province, school } from "../schema/reference";
import { perjadin, perjadinDocument } from "../schema/travel";
import type { Person } from "./caller";
import { isTripSchool } from "./perjadin-naming";

/**
 * **Perjadin Documents** (#397, ADR-0042) — a trip's paperwork, the attendance sheets and each
 * School's SPPD (#441), one PDF each in the company Google Drive. **Nothing records or deletes one
 * any more** (ADR-0061, #559): the paperwork is no longer filed in the tool, and this module is
 * only the read of the ones already recorded, which `/perjadin/[id]` lists. Their Drive sync —
 * finishing one left unsynced — is `./document-drive-sync.ts`, and the reconcile that talks to
 * Google lives in `@sugt/internal`.
 */

/**
 * One recorded document, as `/perjadin/[id]` lists it. Peserta fields are null on the others; an
 * SPPD has a School and no date.
 */
export type PerjadinDocumentRow = {
  id: string;
  kind: PerjadinDocumentKind;
  documentDate: string | null;
  schoolName: string | null;
  participantType: PerjadinDocumentParticipantType | null;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: TimeZone | null;
  driveFileId: string;
  /** Recorded, but the reconcile has not yet put the file in place — "belum tersinkron". */
  unsynced: boolean;
};

/**
 * One of the trip's Schools (#410), with its zone, and whether it has its SPPD on this trip (#441) —
 * what the list's `SPPD: x/y sekolah` counts.
 */
export type DocumentSchool = { id: string; name: string; timeZone: TimeZone; hasSppd: boolean };

/** Everything `/perjadin/[id]`'s Dokumen section renders for one trip. */
export type PerjadinDokumen = {
  perjadinId: string;
  startsOn: string;
  endsOn: string;
  schools: DocumentSchool[];
  documents: PerjadinDocumentRow[];
};

/**
 * **The trip's documents, read** — the trip's window, its Schools, each marked when it has its
 * SPPD, and the documents recorded before uploads stopped (ADR-0061), by date, then time, then
 * upload (an SPPD, dateless, after the dated ones). `null` when there is no such trip. Open to any
 * signed-in Person: the paperwork carries no money, and a Pimpinan reads it.
 */
export async function perjadinDokumen(
  _caller: Person,
  perjadinId: string,
): Promise<PerjadinDokumen | null> {
  const [trip] = await db
    .select({
      perjadinId: perjadin.id,
      startsOn: perjadin.startsOn,
      endsOn: perjadin.endsOn,
    })
    .from(perjadin)
    .where(eq(perjadin.id, perjadinId));
  if (!trip) return null;

  const [schools, documents] = await Promise.all([
    db
      .select({
        id: school.id,
        name: school.name,
        timeZone: province.timeZone,
        hasSppd: sql<boolean>`${exists(
          db
            .select({ id: perjadinDocument.id })
            .from(perjadinDocument)
            .where(sppdOf(perjadinId, school.id)),
        )}`,
      })
      .from(school)
      .innerJoin(province, eq(province.code, school.provinceCode))
      .where(isTripSchool(sql`${perjadinId}::uuid`))
      .orderBy(asc(school.name), asc(school.id)),
    db
      .select({
        id: perjadinDocument.id,
        kind: perjadinDocument.kind,
        documentDate: perjadinDocument.documentDate,
        schoolName: school.name,
        participantType: perjadinDocument.participantType,
        startsAt: perjadinDocument.startsAt,
        endsAt: perjadinDocument.endsAt,
        timeZone: province.timeZone,
        driveFileId: perjadinDocument.driveFileId,
        unsynced: sql<boolean>`${perjadinDocument.driveSyncedAt} is null`,
      })
      .from(perjadinDocument)
      .leftJoin(school, eq(school.id, perjadinDocument.schoolId))
      .leftJoin(province, eq(province.code, school.provinceCode))
      .where(eq(perjadinDocument.perjadinId, perjadinId))
      .orderBy(
        asc(perjadinDocument.documentDate),
        asc(perjadinDocument.startsAt),
        asc(perjadinDocument.uploadedAt),
        asc(perjadinDocument.id),
      ),
  ]);

  return { ...trip, schools, documents };
}

/**
 * **The SPPD of one School on one Perjadin** (#441), as a condition on `perjadin_document` — what
 * the read counts a School's SPPD by.
 */
function sppdOf(perjadinId: string, schoolId: string | AnyColumn): SQL {
  return and(
    eq(perjadinDocument.perjadinId, perjadinId),
    eq(perjadinDocument.kind, "SPPD"),
    eq(perjadinDocument.schoolId, schoolId),
  )!;
}
