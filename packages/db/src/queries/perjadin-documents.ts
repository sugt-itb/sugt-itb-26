import {
  PERJADIN_DOCUMENT_KINDS,
  PERJADIN_DOCUMENT_PARTICIPANT_TYPES,
  type PerjadinDocumentKind,
  type PerjadinDocumentParticipantType,
  type TimeZone,
} from "@sugt/domain";
import { type AnyColumn, and, asc, eq, exists, type SQL, sql } from "drizzle-orm";

import { db } from "../client";
import { province, school } from "../schema/reference";
import { perjadin, perjadinDocument } from "../schema/travel";
import { logActivity, type DocumentLogDetails } from "./activity-log";
import type { Person } from "./caller";
import { isTripSchool } from "./perjadin-naming";
import { requirePerjadinWriter, requireStaff } from "./staff-only";

/**
 * **Perjadin Documents** (#397, ADR-0042) — a trip's paperwork, the attendance sheets and each
 * School's SPPD (#441), one PDF each in the company Google Drive. This module is the database half:
 * recording one, and the Dokumen dialog's read. The upload, the checks on the file and the
 * reconcile talk to Google and live in `@sugt/internal`; their bookkeeping is
 * `./document-drive-sync.ts`.
 *
 * **The trip's Group, a Perjadin Editor or an Administrator records one** (`requirePerjadinWriter`,
 * ADR-0048), as they record a transaction; everyone else, a Pimpinan included, reads only.
 */

/** A Daftar Hadir Peserta's four extra fields: one School, one cohort, one session's local span. */
export type PesertaFields = {
  schoolId: string;
  participantType: PerjadinDocumentParticipantType;
  /** `HH:MM`, local to the School. */
  startsAt: string;
  /** `HH:MM`, local to the School; after `startsAt`. */
  endsAt: string;
};

/** An SPPD's one field (#441): the School it is for. */
export type SppdFields = { schoolId: string };

/**
 * What the Unggah dokumen form says about a document. Only a Peserta sheet carries `peserta`, and
 * only an SPPD carries `sppd` — and has no date.
 */
export type DocumentFields = {
  kind: PerjadinDocumentKind;
  /** Tanggal Sesi or Tanggal Dokumen, `YYYY-MM-DD`, inside the trip; `null` on an SPPD. */
  documentDate: string | null;
  peserta?: PesertaFields;
  sppd?: SppdFields;
};

/** A document whose file is already in Drive, checked by the app (ADR-0042). */
export type NewPerjadinDocument = DocumentFields & {
  perjadinId: string;
  /** Generated before the insert: the file's name carries it (`D-{doc8}`). */
  documentId: string;
  driveFileId: string;
  /** Read back from Drive, never the browser's word. */
  byteSize: number;
};

/** Why the form's fields cannot be recorded. Each points at a field, so each is a value. */
export type DocumentFieldsRefusal =
  /** The id names no Perjadin — a stale card, which is reachable. */
  | { outcome: "no-such-perjadin" }
  /**
   * Not one of the four kinds, or a Peserta's or an SPPD's fields on another kind, or missing from
   * one, or a date on an SPPD.
   */
  | { outcome: "invalid-fields" }
  /** The date is outside the trip — Tanggal Sesi and Tanggal Dokumen both lie inside it. */
  | { outcome: "date-outside-perjadin"; startsOn: string; endsOn: string }
  /**
   * A School that is not one of **the trip's Schools** — none of its Sessions on this Perjadin is
   * still live (#410, `isTripSchool`). A Kelompok split across several trips (ADR-0043) holds
   * Schools this trip never visits, and an attendance sheet for one of them is a mistake.
   */
  | { outcome: "school-not-on-perjadin" }
  /** Waktu Selesai is not after Waktu Mulai, or either is not a time. */
  | { outcome: "times-out-of-order" }
  /**
   * This School already has an SPPD on this Perjadin (#441). Hapus frees it; another Perjadin's
   * SPPD for the same School never counts.
   */
  | { outcome: "sppd-exists"; schoolName: string };

export type RecordPerjadinDocumentResult = { outcome: "recorded" } | DocumentFieldsRefusal;

/** A School's name and its Province's Time Zone: what a document's Log entry says of its School. */
type ZonedSchool = { name: string; timeZone: TimeZone };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * **Check a document's fields against its trip** — in the caller's transaction when it has one, so
 * the record checks and writes against one view of the trip. Answers the School's name and Time
 * Zone a Peserta sheet's or an SPPD's Log entry needs, or why the fields are refused.
 *
 * Exported for the upload's own early answers: `openDocumentSessionAction` asks it **before the
 * upload opens**, so an SPPD for a School that already has one is refused before anyone uploads a
 * large scan, and `recordDocumentAction` asks again before anything moves in Drive, so a sheet
 * dated outside the trip is refused while the file still sits unnamed in `_staging`.
 * `recordPerjadinDocument` asks once more inside its transaction; that is the rule, these are the
 * courtesy.
 */
export async function checkDocumentFields(
  caller: Person,
  perjadinId: string,
  fields: DocumentFields,
  tx: Tx | typeof db = db,
): Promise<{ outcome: "ok"; school: ZonedSchool | null } | DocumentFieldsRefusal> {
  requireStaff(caller);
  await requirePerjadinWriter(caller, perjadinId, tx);

  const [trip] = await tx
    .select({ startsOn: perjadin.startsOn, endsOn: perjadin.endsOn })
    .from(perjadin)
    .where(eq(perjadin.id, perjadinId));
  if (!trip) return { outcome: "no-such-perjadin" };

  if (!(PERJADIN_DOCUMENT_KINDS as readonly string[]).includes(fields.kind)) {
    return { outcome: "invalid-fields" };
  }
  const isPeserta = fields.kind === "Daftar Hadir Peserta";
  if (isPeserta !== Boolean(fields.peserta)) return { outcome: "invalid-fields" };
  const isSppd = fields.kind === "SPPD";
  if (isSppd !== Boolean(fields.sppd)) return { outcome: "invalid-fields" };

  if (fields.sppd) {
    // An SPPD is for a School, not a day: a date on one is a malformed request.
    if (fields.documentDate !== null) return { outcome: "invalid-fields" };
    const found = await tripSchool(tx, perjadinId, fields.sppd.schoolId);
    if (!found) return { outcome: "school-not-on-perjadin" };
    // At most one per (this Perjadin, this School); the unique index holds it against a race. The
    // School matched a trip School's id above, so it is a well-formed uuid by now.
    const [existing] = await tx
      .select({ id: perjadinDocument.id })
      .from(perjadinDocument)
      .where(sppdOf(perjadinId, fields.sppd.schoolId));
    if (existing) return { outcome: "sppd-exists", schoolName: found.name };
    return { outcome: "ok", school: found };
  }

  // ISO dates compare as strings; a malformed one is outside every trip.
  if (
    fields.documentDate === null ||
    !ISO_DATE.test(fields.documentDate) ||
    fields.documentDate < trip.startsOn ||
    fields.documentDate > trip.endsOn
  ) {
    return { outcome: "date-outside-perjadin", startsOn: trip.startsOn, endsOn: trip.endsOn };
  }

  const peserta = fields.peserta;
  if (!peserta) return { outcome: "ok", school: null };

  if (
    !(PERJADIN_DOCUMENT_PARTICIPANT_TYPES as readonly string[]).includes(peserta.participantType)
  ) {
    return { outcome: "invalid-fields" };
  }
  // `HH:MM` compares as a string too, and the CHECK holds the same order at the database.
  if (
    !WALL_CLOCK.test(peserta.startsAt) ||
    !WALL_CLOCK.test(peserta.endsAt) ||
    peserta.endsAt <= peserta.startsAt
  ) {
    return { outcome: "times-out-of-order" };
  }

  const found = await tripSchool(tx, perjadinId, peserta.schoolId);
  if (!found) return { outcome: "school-not-on-perjadin" };
  return { outcome: "ok", school: found };
}

/**
 * **The SPPD of one School on one Perjadin** (#441), as a condition on `perjadin_document` — one
 * rule for the check that refuses a second and the read that marks a School "sudah ada".
 */
function sppdOf(perjadinId: string, schoolId: string | AnyColumn): SQL {
  return and(
    eq(perjadinDocument.perjadinId, perjadinId),
    eq(perjadinDocument.kind, "SPPD"),
    eq(perjadinDocument.schoolId, schoolId),
  )!;
}

/**
 * The School named, with its zone, **if it is one of the trip's Schools** (#410) — the same rule
 * the pickers offer. A new upload only: a document already recorded for a School that has since
 * left the trip stays listed and deletable.
 */
async function tripSchool(
  tx: Tx | typeof db,
  perjadinId: string,
  schoolId: string,
): Promise<ZonedSchool | null> {
  const [found] = await tx
    .select({ name: school.name, timeZone: province.timeZone })
    .from(school)
    .innerJoin(province, eq(province.code, school.provinceCode))
    .where(and(sql`${school.id}::text = ${schoolId}`, isTripSchool(sql`${perjadinId}::uuid`)));
  return found ?? null;
}

/**
 * **Record one Perjadin Document**, with its Activity Log entry, in one transaction (ADR-0042):
 * the row lands unsynced, and a refused write logs nothing. The fields are checked again here
 * (`checkDocumentFields`) — the upload's early checks are a courtesy, this is the rule. The three
 * attendance kinds have no duplicate rule: a second sheet of one kind and date is a second row.
 *
 * **An SPPD is at most one per (Perjadin, School)** (#441). Two racing past the check both reach
 * the insert, and the loser trips `perjadin_document_sppd_unique`; that comes back as
 * `sppd-exists`, never as an error, and its file stays unnamed in private `_staging` like any
 * refused record's.
 */
export async function recordPerjadinDocument(
  caller: Person,
  input: NewPerjadinDocument,
): Promise<RecordPerjadinDocumentResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const checked = await checkDocumentFields(caller, input.perjadinId, input, tx);
    if (checked.outcome !== "ok") return checked;

    // In a savepoint, so a lost race is answered here rather than aborting the whole transaction.
    const inserted = await tx
      .transaction((savepoint) => insertDocument(savepoint, caller, input, checked.school))
      .then(
        () => true,
        (error: unknown) => {
          if (constraintOf(error) === "perjadin_document_sppd_unique") return false;
          throw error;
        },
      );
    // Only an SPPD trips that index, and an SPPD's check always answers its School.
    if (!inserted) return { outcome: "sppd-exists", schoolName: checked.school!.name };
    return { outcome: "recorded" };
  });
}

/** The row and its `document_uploaded` entry, once the fields are checked. */
async function insertDocument(
  tx: Tx,
  caller: Person,
  input: NewPerjadinDocument,
  checkedSchool: ZonedSchool | null,
): Promise<void> {
  const peserta = input.peserta;
  await tx.insert(perjadinDocument).values({
    id: input.documentId,
    perjadinId: input.perjadinId,
    kind: input.kind,
    documentDate: input.documentDate,
    schoolId: peserta?.schoolId ?? input.sppd?.schoolId ?? null,
    participantType: peserta?.participantType ?? null,
    startsAt: peserta?.startsAt ?? null,
    endsAt: peserta?.endsAt ?? null,
    driveFileId: input.driveFileId,
    contentType: "application/pdf",
    byteSize: input.byteSize,
    uploadedByPersonId: caller.id,
  });

  const details = documentLogDetails(
    { documentId: input.documentId, kind: input.kind, documentDate: input.documentDate },
    peserta,
    checkedSchool,
  );
  await logActivity(tx, caller, input.perjadinId, { action: "document_uploaded", details });
}

/**
 * The name of the constraint that refused a write, read from both places a driver may put it — the
 * same reading `session-records.ts` does.
 */
function constraintOf(error: unknown): string | null {
  const wrapped = error as { constraint_name?: string; cause?: { constraint_name?: string } };
  return wrapped.cause?.constraint_name ?? wrapped.constraint_name ?? null;
}

/**
 * What a `document_uploaded` or `document_deleted` entry records of one document: its kind and
 * date, for a Peserta sheet its School's name and zone, cohort and span, and for an SPPD its
 * School's name alone — one shape for both, so the Log reads an upload and its deletion the same
 * way.
 */
function documentLogDetails(
  sheet: Pick<DocumentLogDetails, "documentId" | "kind" | "documentDate">,
  peserta: PesertaFields | undefined,
  school: ZonedSchool | null,
): DocumentLogDetails {
  if (!school) return { ...sheet };
  if (!peserta) return { ...sheet, schoolName: school.name };
  return {
    ...sheet,
    schoolName: school.name,
    participantType: peserta.participantType,
    startsAt: peserta.startsAt,
    endsAt: peserta.endsAt,
    timeZone: school.timeZone,
  };
}

export type DeletePerjadinDocumentResult =
  | { outcome: "deleted"; perjadinId: string }
  /** Already deleted — a second Hapus, or a stale dialog. Nothing to do. */
  | { outcome: "no-such-document" };

/**
 * **Delete one Perjadin Document's row, with its `document_deleted` Log entry**, in one transaction
 * (#398). The entry is a snapshot of the row as it goes — the same fields `document_uploaded`
 * recorded — since nothing is left to read afterwards.
 *
 * **The file must already be in the Drive trash** (ADR-0042): `deleteDocumentAction` trashes it
 * first and calls this second, so a row never vanishes while its public file stays live. If this
 * fails after the trash, the row stays, pointing at a trashed file, and Hapus again finishes it.
 */
export async function deletePerjadinDocument(
  caller: Person,
  documentId: string,
): Promise<DeletePerjadinDocumentResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(perjadinDocument)
      .where(sql`${perjadinDocument.id}::text = ${documentId}`)
      .returning();
    if (!row) return { outcome: "no-such-document" };
    // A refusal here rolls the delete back; the action ran the same check before trashing the file.
    await requirePerjadinWriter(caller, row.perjadinId, tx);

    const peserta =
      row.schoolId && row.participantType && row.startsAt && row.endsAt
        ? {
            schoolId: row.schoolId,
            participantType: row.participantType,
            // As the upload's entry wrote them: `HH:MM`.
            startsAt: row.startsAt.slice(0, 5),
            endsAt: row.endsAt.slice(0, 5),
          }
        : undefined;
    // A Peserta sheet's School, or an SPPD's.
    const [found] = row.schoolId
      ? await tx
          .select({ name: school.name, timeZone: province.timeZone })
          .from(school)
          .innerJoin(province, eq(province.code, school.provinceCode))
          .where(eq(school.id, row.schoolId))
      : [];
    const details = documentLogDetails(
      { documentId: row.id, kind: row.kind, documentDate: row.documentDate },
      peserta,
      found ?? null,
    );
    await logActivity(tx, caller, row.perjadinId, { action: "document_deleted", details });

    return { outcome: "deleted", perjadinId: row.perjadinId };
  });
}

/**
 * One uploaded document, as the Dokumen dialog lists it. Peserta fields are null on the others; an
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
 * A School the Peserta and SPPD forms offer — one of the trip's Schools (#410) — with its zone, and
 * whether it already has its SPPD on this trip (#441), which the SPPD picker marks "sudah ada".
 */
export type DocumentSchool = { id: string; name: string; timeZone: TimeZone; hasSppd: boolean };

/** Everything the Dokumen dialog renders for one trip. */
export type PerjadinDokumen = {
  perjadinId: string;
  startsOn: string;
  endsOn: string;
  schools: DocumentSchool[];
  documents: PerjadinDocumentRow[];
};

/**
 * **The Dokumen dialog's read**: the trip's window, the Schools a Peserta sheet or an SPPD may name
 * — each marked when it has its SPPD — and the documents uploaded so far, by date, then time, then
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
