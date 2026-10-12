import {
  SESSION_FOOTAGE_CONTENT_TYPES,
  type SessionFootageContentType,
  type SessionFootageKind,
} from "@sugt/domain";
import { desc, eq, sql } from "drizzle-orm";

import { db } from "../client";
import { session, sessionFootage } from "../schema/delivery";
import { person } from "../schema/people";
import { school } from "../schema/reference";
import { logActivity, type FootageLogDetails } from "./activity-log";
import type { Person } from "./caller";
import { requirePerjadinWriter, requireStaff } from "./staff-only";

/**
 * **Session Footage** (#424, ADR-0046) — the database half of "Foto & Video": which Session footage
 * may be added to, recording it with its Activity Log entry, deleting it with its entry, and listing
 * a Session's. The upload, the verification and the reconcile talk to Google and live in
 * `@sugt/internal`; the Drive bookkeeping is `./session-footage-drive-sync.ts`.
 *
 * **Footage belongs to one offline Session that is not cancelled** at the moment it is added,
 * delivered or not. Online Sessions have none. Footage of a Session cancelled later stays.
 *
 * Writing is the Session's trip's Group's, a Perjadin Editor's or an Administrator's (`requirePerjadinWriter`,
 * ADR-0048); reading is anyone signed in, a Pimpinan included.
 */

/** Why footage may not be added to a Session. */
export type FootageSessionRefusal =
  /** No such Session — a stale screen, which is reachable. */
  | { outcome: "no-such-session" }
  /** An online Session: footage documents offline Sessions only. */
  | { outcome: "session-online" }
  | { outcome: "session-cancelled" };

/** A Session footage may be added to: its trip, for the Drive's `sugtPerjadinId`. */
export type FootageSession = { outcome: "ok"; sessionId: string; perjadinId: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * **May footage be added to this Session?** Offline — so on a Perjadin — and not cancelled. Run
 * before Google is asked anything, and again inside the commit, where the row is locked so a
 * cancellation cannot slip between the check and the insert.
 */
export async function footageSession(
  caller: Person,
  sessionId: string,
  tx: Tx | typeof db = db,
): Promise<FootageSession | FootageSessionRefusal> {
  requireStaff(caller);

  const query = tx
    .select({ mode: session.mode, status: session.status, perjadinId: session.perjadinId })
    .from(session)
    // A text compare, so a malformed id is simply no Session rather than a cast error.
    .where(sql`${session.id}::text = ${sessionId}`);
  const [row] = tx === db ? await query : await query.for("share");
  if (!row) return { outcome: "no-such-session" };
  if (row.mode !== "offline" || !row.perjadinId) return { outcome: "session-online" };
  // Its trip's Group, a Perjadin Editor or an Administrator (ADR-0048) — before Google is asked anything.
  await requirePerjadinWriter(caller, row.perjadinId, tx);
  if (row.status === "cancelled") return { outcome: "session-cancelled" };
  return { outcome: "ok", sessionId, perjadinId: row.perjadinId };
}

export type NewSessionFootage = {
  /** Generated before the insert: the file's name carries it (`M-{footage8}`). */
  footageId: string;
  sessionId: string;
  /** The type the server sniffed from the file's first bytes — never the browser's word. */
  contentType: SessionFootageContentType;
  originalFilename: string;
  driveFileId: string;
  /** Read back from Drive. */
  byteSize: number;
};

export type RecordSessionFootageResult =
  /**
   * `footageId` is the new row's — or, when this Drive file was recorded already (a lost answer, a
   * retry), the existing row's, with nothing written twice.
   */
  { outcome: "recorded"; perjadinId: string; footageId: string } | FootageSessionRefusal;

/**
 * **Commit one file of footage and its Activity Log entry, in one transaction** (`footage_uploaded`).
 * The Session is checked again under a row lock, so footage never lands on a Session cancelled since
 * the upload opened. The file is not yet in place: `drive_synced_at` stays null until the reconcile.
 * Recording a Drive file a second time writes nothing and answers the first row, so a retry after a
 * lost answer is safe.
 */
export async function recordSessionFootage(
  caller: Person,
  input: NewSessionFootage,
): Promise<RecordSessionFootageResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const target = await footageSession(caller, input.sessionId, tx);
    if (target.outcome !== "ok") return target;

    const kind = SESSION_FOOTAGE_CONTENT_TYPES[input.contentType];
    const [inserted] = await tx
      .insert(sessionFootage)
      .values({
        id: input.footageId,
        sessionId: input.sessionId,
        kind,
        contentType: input.contentType,
        // Trimmed, and never empty: the CHECK refuses an empty name.
        originalFilename: input.originalFilename.trim() || "tanpa nama",
        driveFileId: input.driveFileId,
        byteSize: input.byteSize,
        uploadedByPersonId: caller.id,
      })
      .onConflictDoNothing({ target: sessionFootage.driveFileId })
      .returning({ id: sessionFootage.id });
    if (!inserted) {
      const [existing] = await tx
        .select({ id: sessionFootage.id })
        .from(sessionFootage)
        .where(eq(sessionFootage.driveFileId, input.driveFileId));
      return { outcome: "recorded", perjadinId: target.perjadinId, footageId: existing!.id };
    }

    const details = await footageLogDetails(tx, {
      footageId: input.footageId,
      sessionId: input.sessionId,
      kind,
      originalFilename: input.originalFilename.trim() || "tanpa nama",
    });
    await logActivity(tx, caller, target.perjadinId, { action: "footage_uploaded", details });
    return { outcome: "recorded", perjadinId: target.perjadinId, footageId: inserted.id };
  });
}

/** The Log's snapshot of one file of footage: which Session — its date and School — and which file. */
async function footageLogDetails(
  tx: Tx,
  footage: Pick<FootageLogDetails, "footageId" | "sessionId" | "kind" | "originalFilename">,
): Promise<FootageLogDetails> {
  const [found] = await tx
    .select({ heldOn: session.heldOn, schoolName: school.name })
    .from(session)
    .innerJoin(school, eq(school.id, session.schoolId))
    .where(eq(session.id, footage.sessionId));
  return { ...footage, heldOn: found!.heldOn, schoolName: found!.schoolName };
}

export type DeleteSessionFootageResult =
  | { outcome: "deleted"; sessionId: string; perjadinId: string }
  /** Already deleted — a second Hapus, or a stale screen. Nothing to do. */
  | { outcome: "no-such-footage" };

/**
 * **Delete one file's row and log `footage_deleted`, in one transaction** — the second half of Hapus,
 * run only once the file is in the Drive trash (ADR-0042's order, ADR-0046). The entry is a snapshot
 * of the row as it is deleted, since the row is then gone.
 */
export async function deleteSessionFootage(
  caller: Person,
  footageId: string,
): Promise<DeleteSessionFootageResult> {
  requireStaff(caller);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(sessionFootage)
      .where(sql`${sessionFootage.id}::text = ${footageId}`)
      .returning();
    if (!row) return { outcome: "no-such-footage" };

    const [trip] = await tx
      .select({ perjadinId: session.perjadinId })
      .from(session)
      .where(eq(session.id, row.sessionId));
    // Footage is only ever added to an offline Session, which always has a Perjadin.
    const perjadinId = trip!.perjadinId!;
    // A refusal here rolls the delete back; the action ran the same check before trashing the file.
    await requirePerjadinWriter(caller, perjadinId, tx);

    const details = await footageLogDetails(tx, {
      footageId: row.id,
      sessionId: row.sessionId,
      kind: row.kind,
      originalFilename: row.originalFilename,
    });
    await logActivity(tx, caller, perjadinId, { action: "footage_deleted", details });
    return { outcome: "deleted", sessionId: row.sessionId, perjadinId };
  });
}

/** One file of a Session's footage, as "Foto & Video" lists it. */
export type SessionFootageRow = {
  id: string;
  kind: SessionFootageKind;
  contentType: SessionFootageContentType;
  originalFilename: string;
  byteSize: number;
  uploadedByName: string;
  uploadedAt: Date;
  /** The Drive file — a link once it is shared; `driveFileUrl` builds it. */
  driveFileId: string;
  /** Recorded, but the reconcile has not yet put the file in place — "belum tersinkron". */
  unsynced: boolean;
};

/** **A Session's footage**, newest first. Open to anyone signed in. */
export async function sessionFootageList(
  _caller: Person,
  sessionId: string,
): Promise<SessionFootageRow[]> {
  return db
    .select({
      id: sessionFootage.id,
      kind: sessionFootage.kind,
      contentType: sessionFootage.contentType,
      originalFilename: sessionFootage.originalFilename,
      byteSize: sessionFootage.byteSize,
      uploadedByName: person.fullName,
      uploadedAt: sessionFootage.uploadedAt,
      driveFileId: sessionFootage.driveFileId,
      unsynced: sql<boolean>`${sessionFootage.driveSyncedAt} is null`,
    })
    .from(sessionFootage)
    .innerJoin(person, eq(person.id, sessionFootage.uploadedByPersonId))
    .where(sql`${sessionFootage.sessionId}::text = ${sessionId}`)
    .orderBy(desc(sessionFootage.uploadedAt), desc(sessionFootage.id));
}
