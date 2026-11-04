import { openReceiptSessionsAction } from "-/app/(app)/perjadin/[id]/laporan/actions";
import type { FakeDrive } from "-/lib/drive/fake-drive";
import { ensureFixedFolders, readyFolders, type ReadyFolders } from "-/lib/drive/fixed-folders";
import { reconcileTransaction } from "-/lib/drive/reconcile";
import { encryptRefreshToken } from "-/lib/drive/token-crypto";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import type { TransactionCategory, TransactionParticipantType } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { vi } from "vitest";

import { addActivityLogEntry, addTransaction } from "./fixtures";

/**
 * **What a receipt test needs of Google Drive** (ADR-0040): the token endpoint, a connected Drive
 * with its fixed tree, receipt bytes, the browser's upload, and a line already recorded. Shared by
 * the Unggah bukti, Hapus and Periksa koneksi tests, which each mock `openDrive` to hand back their own `FakeDrive` — a `vi.mock`
 * has to sit in the test file, so it is not here.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Google's token endpoint, answering every refresh with an access token. Anything else throws. */
export function stubTokenEndpoint() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== TOKEN_ENDPOINT) throw new Error(`Unexpected outbound request: ${url}`);
    return Response.json({ access_token: "access" });
  });
}

/** Bytes that sniff as a JPEG, `size` long. */
export function jpeg(size = 4096) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

/** Bytes that sniff as a PDF, `size` long. */
export function pdf(size = 2048) {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.7"));
  return bytes;
}

/**
 * The company Drive connection, with its fixed tree built in `drive` and a token that decrypts —
 * `connected` by default, or `broken`. Answers the tree's ids. `Dokumen/` and its `Pelaksanaan
 * Offline/` (ADR-0042) are built too, as a connect now builds them, unless `dokumen` is false — a
 * connection made before them — and likewise `Foto & Video/` (ADR-0046) unless `footage` is false.
 */
export async function connectDrive(
  drive: FakeDrive,
  connectedByPersonId: string,
  status: "connected" | "broken" = "connected",
  { dokumen = true, footage = true }: { dokumen?: boolean; footage?: boolean } = {},
): Promise<ReadyFolders> {
  const ensured = await ensureFixedFolders(drive, {
    rootFolderId: null,
    stagingFolderId: null,
    buktiTransaksiFolderId: null,
    pelaksanaanOfflineFolderId: null,
    readmeFileId: null,
  });
  const folders = readyFolders(ensured)!;
  const dokumenFolderId = dokumen
    ? (await drive.createFolder({ name: "Dokumen", parentId: folders.rootFolderId })).id
    : null;
  const dokumenPelaksanaanOfflineFolderId = dokumenFolderId
    ? (await drive.createFolder({ name: "Pelaksanaan Offline", parentId: dokumenFolderId })).id
    : null;
  const footageFolderId = footage
    ? (await drive.createFolder({ name: "Foto & Video", parentId: folders.rootFolderId })).id
    : null;
  const footagePelaksanaanOfflineFolderId = footageFolderId
    ? (await drive.createFolder({ name: "Pelaksanaan Offline", parentId: footageFolderId })).id
    : null;
  const token = encryptRefreshToken("refresh");
  await db.insert(schema.driveConnection).values({
    accountEmail: "bukti@perusahaan.test",
    refreshTokenCiphertext: token.ciphertext,
    refreshTokenIv: token.iv,
    refreshTokenTag: token.tag,
    ...folders,
    dokumenFolderId,
    dokumenPelaksanaanOfflineFolderId,
    footageFolderId,
    footagePelaksanaanOfflineFolderId,
    status,
    brokenAt: status === "broken" ? new Date() : null,
    connectedByPersonId,
  });
  return folders;
}

/**
 * A row's upload, as the browser does it: open a session per file for the line, then `PUT` each
 * file's bytes (`FakeDrive.land`). Answers the ids.
 */
export async function upload(
  drive: FakeDrive,
  perjadinId: string,
  files: Uint8Array[],
  options: { contentType?: string; transactionId: string },
): Promise<string[]> {
  const opened = await openReceiptSessionsAction(
    perjadinId,
    files.map((bytes) => ({
      size: bytes.length,
      contentType: options.contentType ?? "image/jpeg",
    })),
    options.transactionId,
  );
  if (opened.outcome !== "ready") throw new Error(`Sessions refused: ${opened.outcome}`);
  return opened.sessionUris.map((uri, index) => drive.land(uri, files[index]!).id);
}

/**
 * **A line recorded before #541, with its receipts**: nothing in the app records one any more, so it
 * is inserted directly — the row, its evidence and its `transaction_recorded` Log entry — with real
 * files in `drive`, and the real reconcile puts them in place. Answers whether that finished, with
 * the line's id, its folder and its receipt files in upload order.
 */
export async function addRecordedLine(
  drive: FakeDrive,
  folders: ReadyFolders,
  person: Person,
  line: {
    perjadinId: string;
    receipts: number;
    spentOn?: string;
    description?: string;
    amountIdr?: number;
    category?: TransactionCategory;
    participantType?: TransactionParticipantType;
  },
) {
  const {
    perjadinId,
    receipts,
    spentOn = "2026-10-13",
    description = "Makan siang",
    amountIdr = 150_000,
    category = "Konsumsi",
    participantType = "Siswa",
  } = line;
  const row = await addTransaction({
    perjadinId,
    spentOn,
    description,
    amountIdr,
    category,
    participantType,
    createdByPersonId: person.id,
  });
  const files = Array.from({ length: receipts }, () => jpeg());
  const fileIds = await upload(drive, perjadinId, files, { transactionId: row.id });
  await db.insert(schema.transactionEvidence).values(
    fileIds.map((driveFileId, index) => ({
      transactionId: row.id,
      driveFileId,
      contentType: "image/jpeg",
      byteSize: files[index]!.length,
      uploadedByPersonId: person.id,
    })),
  );
  await addActivityLogEntry({
    perjadinId,
    actorPersonId: person.id,
    actorEmail: person.email,
    action: "transaction_recorded",
    details: {
      transactionId: row.id,
      category,
      amountIdr,
      participantType,
      spentOn,
      receiptCount: receipts,
    },
    searchText: `catat transaksi · ${category.toLowerCase()}`,
  });

  const reconciled = await reconcileTransaction(person, drive, folders, row.id);
  const [stored] = await db
    .select()
    .from(schema.transaction)
    .where(eq(schema.transaction.id, row.id));
  return {
    transactionId: row.id,
    synced: reconciled.outcome === "synced",
    folderId: stored!.driveFolderId!,
    fileIds,
  };
}

/**
 * **An older line its reconcile never finished** (#541): one receipt, in a folder still in `_staging`
 * where the record path used to build it, and unsynced. Nothing makes one any more, but one may be
 * waiting, and the sweep must still finish it.
 */
export async function addLineLeftInStaging(
  drive: FakeDrive,
  folders: ReadyFolders,
  person: Person,
  perjadinId: string,
) {
  const row = await addTransaction({
    perjadinId,
    spentOn: "2026-10-13",
    amountIdr: 150_000,
    category: "Konsumsi",
    createdByPersonId: person.id,
  });
  const staged = await drive.createFolder({
    name: `2026-10-13 · Konsumsi · T-${row.id.slice(0, 8)}`,
    parentId: folders.stagingFolderId,
    appProperties: { sugtPerjadinId: perjadinId, sugtTransactionId: row.id },
  });
  const [fileId] = await upload(drive, perjadinId, [jpeg()], { transactionId: row.id });
  await drive.updateFile(fileId!, {
    addParent: staged.id,
    removeParent: folders.stagingFolderId,
    appProperties: { sugtTransactionId: row.id },
  });
  await db
    .update(schema.transaction)
    .set({ driveFolderId: staged.id })
    .where(eq(schema.transaction.id, row.id));
  await db.insert(schema.transactionEvidence).values({
    transactionId: row.id,
    driveFileId: fileId!,
    contentType: "image/jpeg",
    byteSize: 4096,
    uploadedByPersonId: person.id,
  });
  return { transactionId: row.id, folderId: staged.id, fileId: fileId! };
}

/** The digest a refused Server Action threw — `NEXT_HTTP_ERROR_FALLBACK;403` for `forbidden()`. */
export async function digestOf(call: Promise<unknown>) {
  const thrown = await call.then(
    () => null,
    (error: unknown) => error,
  );
  return (thrown as { digest?: string } | null)?.digest;
}

export const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";
