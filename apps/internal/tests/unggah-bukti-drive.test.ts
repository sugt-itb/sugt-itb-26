import {
  finalizeReceiptsAction,
  openReceiptSessionsAction,
} from "-/app/(app)/perjadin/[id]/laporan/actions";
import { FakeDrive } from "-/lib/drive/fake-drive";
import type { ReadyFolders } from "-/lib/drive/fixed-folders";
import { DriveRequestError, FOLDER_MIME_TYPE, openDrive } from "-/lib/drive/google";
import { reconcileTransaction } from "-/lib/drive/reconcile";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import { MAX_RECEIPTS_PER_TRANSACTION, MAX_UPLOAD_BYTES } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectDrive,
  digestOf,
  FORBIDDEN,
  jpeg,
  pdf,
  stubTokenEndpoint,
  upload as uploadTo,
} from "./support/drive";
import {
  addPerjadin,
  addPerson,
  addSchoolOnTrip,
  addTransaction,
  addTransactionEvidence,
  resetDatabase,
} from "./support/fixtures";

/**
 * **A row's own Unggah bukti uploads to Google Drive** (#374, ADR-0040), against the real database
 * and the in-memory `FakeDrive`.
 *
 * Faked, each because no test can reach it: Google's token endpoint (stubbed at the network
 * boundary), Drive itself (`FakeDrive` swapped in for `openDrive`), the browser's `PUT` (the fake's
 * `land`, which keeps Drive's size enforcement), the signed-in Person, the request's `Origin`, and
 * `next/cache`. The checks, the names, the write order and the reconcile are the real code.
 *
 * What this path holds is its order: every check before Drive, then **commit first** — the count
 * under the line's lock — and only then the files move into a folder that is usually already public.
 * And partial success: a file that does not check out is reported, the rest attach.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "https://preview-42.sugt.test" })),
}));

let drive: FakeDrive;
let folders: ReadyFolders;

/** A Staff PIC, a Pimpinan, a trip, and a line on it holding `held` receipts and no folder yet. */
async function scene(
  options: {
    connection?: "connected" | "broken" | "none";
    held?: number;
  } = {},
) {
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  const pimpinan = await addPerson({
    fullName: "Fatimah",
    email: "fa@itb.ac.id",
    role: "Pimpinan",
  });
  const trip = await addPerjadin({
    picPersonId: staff.id,
    subClusterName: "Kelompok 3",
    startsOn: "2026-10-12",
    endsOn: "2026-10-14",
  });
  const line = await addTransaction({
    perjadinId: trip.id,
    amountIdr: 75_000,
    category: "Konsumsi",
    spentOn: "2026-10-12",
    createdByPersonId: staff.id,
  });
  for (let held = 0; held < (options.held ?? 0); held += 1) {
    await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: staff.id });
  }

  const connection = options.connection ?? "connected";
  if (connection !== "none") folders = await connectDrive(drive, staff.id, connection);
  drive.calls = 0;
  vi.mocked(requirePerson).mockResolvedValue(staff);
  return { staff, pimpinan, trip, line };
}

/** The row's upload: sessions for the line, then the browser's `PUT` to each. */
const upload = (perjadinId: string, files: Uint8Array[], transactionId: string) =>
  uploadTo(drive, perjadinId, files, { transactionId });

const asReceipts = (ids: string[]) => ids.map((driveFileId) => ({ driveFileId }));
const evidenceOf = (transactionId: string) =>
  db
    .select()
    .from(schema.transactionEvidence)
    .where(eq(schema.transactionEvidence.transactionId, transactionId));
const lineRow = async (transactionId: string) =>
  (await db.select().from(schema.transaction).where(eq(schema.transaction.id, transactionId)))[0]!;

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("no Drive call before the guard", () => {
  const oneFile = [{ size: 10, contentType: "image/jpeg" }];

  it("refuses a non-Staff caller with zero Drive calls", async () => {
    const { pimpinan, trip, line } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(pimpinan as Person);

    await expect(digestOf(openReceiptSessionsAction(trip.id, oneFile, line.id))).resolves.toBe(
      FORBIDDEN,
    );
    await expect(
      digestOf(finalizeReceiptsAction(trip.id, line.id, asReceipts(["x"]))),
    ).resolves.toBe(FORBIDDEN);
    expect(drive.calls).toBe(0);
  });

  it("refuses a line on another Perjadin with zero Drive calls", async () => {
    const { staff, line } = await scene();
    const other = await addPerjadin({ picPersonId: staff.id });

    await expect(openReceiptSessionsAction(other.id, oneFile, line.id)).resolves.toEqual({
      outcome: "no-such-transaction",
    });
    await expect(finalizeReceiptsAction(other.id, line.id, asReceipts(["x"]))).resolves.toEqual({
      outcome: "no-such-transaction",
    });
    expect(drive.calls).toBe(0);
  });

  it.each([
    ["none", /^Google Drive belum terhubung/],
    ["broken", /^Koneksi Google Drive terputus sejak \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/],
  ] as const)(
    "answers drive-disconnected, with the gate's reason, and zero Drive calls when the connection is %s",
    async (connection, reason) => {
      const { trip, line } = await scene({ connection });
      const refusal = { outcome: "drive-disconnected", reason: expect.stringMatching(reason) };

      await expect(openReceiptSessionsAction(trip.id, oneFile, line.id)).resolves.toEqual(refusal);
      await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts(["x"]))).resolves.toEqual(
        refusal,
      );
      expect(drive.calls).toBe(0);
      await expect(evidenceOf(line.id)).resolves.toHaveLength(0);
    },
  );
});

describe("what a session may open for", () => {
  it("refuses no files, an unknown type and an over-cap size, before Drive", async () => {
    const { trip, line } = await scene();

    await expect(openReceiptSessionsAction(trip.id, [], line.id)).resolves.toEqual({
      outcome: "evidence-missing",
    });
    await expect(
      openReceiptSessionsAction(trip.id, [{ size: 10, contentType: "image/heic" }], line.id),
    ).resolves.toEqual({ outcome: "unsupported-type" });
    await expect(
      openReceiptSessionsAction(
        trip.id,
        [{ size: MAX_UPLOAD_BYTES + 1, contentType: "image/jpeg" }],
        line.id,
      ),
    ).resolves.toEqual({ outcome: "too-large", limit: MAX_UPLOAD_BYTES });
    expect(drive.calls).toBe(0);
  });

  it("opens one in _staging per file, named {uuid}.{ext}, with the declared size and the page's Origin", async () => {
    const { trip, line } = await scene();

    const opened = await openReceiptSessionsAction(
      trip.id,
      [
        { size: 4096, contentType: "image/jpeg" },
        { size: 2048, contentType: "application/pdf" },
      ],
      line.id,
    );

    expect(opened.outcome).toBe("ready");
    const sessions = [...drive.sessions.values()];
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      parentId: folders.stagingFolderId,
      size: 4096,
      origin: "https://preview-42.sugt.test",
      appProperties: { sugtPerjadinId: trip.id },
    });
    expect(sessions[0]!.name).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(sessions[1]!.name).toMatch(/\.pdf$/);
  });

  it("accepts a declared size of exactly 50 MB and refuses one byte more (#394)", async () => {
    const { trip, line } = await scene();
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);

    await expect(
      openReceiptSessionsAction(
        trip.id,
        [{ size: MAX_UPLOAD_BYTES, contentType: "application/pdf" }],
        line.id,
      ),
    ).resolves.toMatchObject({ outcome: "ready" });
    expect([...drive.sessions.values()][0]).toMatchObject({ size: MAX_UPLOAD_BYTES });

    await expect(
      openReceiptSessionsAction(
        trip.id,
        [{ size: MAX_UPLOAD_BYTES + 1, contentType: "application/pdf" }],
        line.id,
      ),
    ).resolves.toEqual({ outcome: "too-large", limit: MAX_UPLOAD_BYTES });
  });
});

describe("five receipts per line, in total", () => {
  it("takes a line from 3 to 5", async () => {
    const { trip, line } = await scene({ held: 3 });
    const ids = await upload(trip.id, [jpeg(), jpeg()], line.id);

    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts(ids))).resolves.toEqual({
      outcome: "attached",
      attached: 2,
      failed: 0,
      synced: true,
    });
    await expect(evidenceOf(line.id)).resolves.toHaveLength(5);
  });

  it("refuses 3 to 6, and anything from 5, before Drive", async () => {
    const { trip, line } = await scene({ held: 3 });
    const three = Array(3).fill({ size: 10, contentType: "image/jpeg" });

    await expect(openReceiptSessionsAction(trip.id, three, line.id)).resolves.toMatchObject({
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
    });
    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts(["a", "b", "c"])),
    ).resolves.toEqual({ outcome: "too-many-receipts", limit: MAX_RECEIPTS_PER_TRANSACTION });

    await addTransactionEvidence({
      transactionId: line.id,
      uploadedByPersonId: line.createdByPersonId,
    });
    await addTransactionEvidence({
      transactionId: line.id,
      uploadedByPersonId: line.createdByPersonId,
    });
    await expect(
      openReceiptSessionsAction(trip.id, [{ size: 10, contentType: "image/jpeg" }], line.id),
    ).resolves.toMatchObject({ outcome: "too-many-receipts" });
    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts(["a"]))).resolves.toEqual({
      outcome: "too-many-receipts",
      limit: MAX_RECEIPTS_PER_TRANSACTION,
    });
    expect(drive.calls).toBe(0);
  });

  it("lets only one of two concurrent uploads pass the count", async () => {
    const { trip, line } = await scene({ held: 3 });
    // Both batches were opened while the line still had two slots — two tabs, say.
    const first = await upload(trip.id, [jpeg(), jpeg()], line.id);
    const second = await upload(trip.id, [jpeg(), jpeg()], line.id);

    const results = await Promise.all([
      finalizeReceiptsAction(trip.id, line.id, asReceipts(first)),
      finalizeReceiptsAction(trip.id, line.id, asReceipts(second)),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "attached",
      "too-many-receipts",
    ]);
    await expect(evidenceOf(line.id)).resolves.toHaveLength(5);
  });
});

describe("a line with no folder yet", () => {
  it("gets its Perjadin folder and its own, shared, the first time a receipt is added", async () => {
    const { trip, line } = await scene({ held: 0 });
    const [id] = await upload(trip.id, [jpeg()], line.id);

    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([id!])),
    ).resolves.toMatchObject({ outcome: "attached", attached: 1, synced: true });

    const [stored] = await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, trip.id));
    const perjadinFolder = (await drive.getFile(stored!.driveFolderId!))!;
    expect(perjadinFolder.name).toBe(`Kelompok 3 · 12–14 Okt 2026 · P-${trip.id.slice(0, 8)}`);
    expect(perjadinFolder.parents).toEqual([folders.pelaksanaanOfflineFolderId]);

    const after = await lineRow(line.id);
    expect(after.driveSyncedAt).toBeInstanceOf(Date);
    const folder = (await drive.getFile(after.driveFolderId!))!;
    expect(folder.parents).toEqual([perjadinFolder.id]);
    expect(folder.name).toBe(`2026-10-12 · Konsumsi · T-${line.id.slice(0, 8)}`);
    await expect(drive.listPermissions(folder.id)).resolves.toEqual([
      expect.objectContaining({ type: "anyone", role: "reader", inherited: false }),
    ]);
    // Only the transaction folder is shared; the Perjadin folder stays private.
    await expect(drive.listPermissions(perjadinFolder.id)).resolves.toEqual([]);

    const [row] = await evidenceOf(line.id);
    const file = (await drive.getFile(id!))!;
    expect(file.parents).toEqual([folder.id]);
    expect(file.name).toBe(`${folder.name} · ${row!.id.slice(0, 8)}.jpg`);
  });
});

describe("where a line's receipts end up", () => {
  it.each([1, 5])(
    "puts %i receipts in place: rows written, folder in the Perjadin's, shared, synced",
    async (count) => {
      const { staff, trip } = await scene();
      await addSchoolOnTrip({ perjadin: trip, name: "SMAN 1 Bontang" });
      const line = await addTransaction({
        perjadinId: trip.id,
        amountIdr: 150_000,
        category: "Transport Bandara/Stasiun",
        spentOn: "2026-10-13",
        createdByPersonId: staff.id,
      });
      const files = Array.from({ length: count }, (_, i) => (i % 2 ? pdf() : jpeg()));
      const ids = await upload(trip.id, files, line.id);

      await expect(
        finalizeReceiptsAction(trip.id, line.id, asReceipts(ids)),
      ).resolves.toMatchObject({ outcome: "attached", attached: count, failed: 0, synced: true });

      const after = await lineRow(line.id);
      expect(after.driveSyncedAt).toBeInstanceOf(Date);
      const evidence = await evidenceOf(line.id);
      expect(evidence).toHaveLength(count);
      for (const row of evidence) {
        expect(ids).toContain(row.driveFileId);
        // From the sniff and from Drive, never from the browser.
        const sent = files[ids.indexOf(row.driveFileId)]!;
        expect(row.contentType).toBe(sent[0] === 0xff ? "image/jpeg" : "application/pdf");
        expect(row.byteSize).toBe(sent.length);
      }

      // The tree: Pelaksanaan Offline / Perjadin folder / transaction folder / receipts.
      const [stored] = await db
        .select()
        .from(schema.perjadin)
        .where(eq(schema.perjadin.id, trip.id));
      const perjadinFolder = (await drive.getFile(stored!.driveFolderId!))!;
      expect(perjadinFolder.name).toBe(
        `Kelompok 3 · 12–14 Okt 2026 · SMAN 1 Bontang · P-${trip.id.slice(0, 8)}`,
      );
      expect(perjadinFolder.parents).toEqual([folders.pelaksanaanOfflineFolderId]);

      const folder = (await drive.getFile(after.driveFolderId!))!;
      expect(folder.mimeType).toBe(FOLDER_MIME_TYPE);
      expect(folder.parents).toEqual([perjadinFolder.id]);
      expect(folder.name).toBe(`2026-10-13 · Transport Bandara-Stasiun · T-${line.id.slice(0, 8)}`);
      expect(folder.appProperties).toEqual({
        sugtPerjadinId: trip.id,
        sugtTransactionId: line.id,
      });

      for (const row of evidence) {
        const file = (await drive.getFile(row.driveFileId))!;
        expect(file.parents).toEqual([folder.id]);
        const ext = row.contentType === "image/jpeg" ? "jpg" : "pdf";
        expect(file.name).toBe(`${folder.name} · ${row.id.slice(0, 8)}.${ext}`);
        expect(file.appProperties.sugtTransactionId).toBe(line.id);
      }

      // Only the transaction folder is shared; the Perjadin folder and _staging stay private.
      await expect(drive.listPermissions(folder.id)).resolves.toEqual([
        expect.objectContaining({ type: "anyone", role: "reader", inherited: false }),
      ]);
      await expect(drive.listPermissions(perjadinFolder.id)).resolves.toEqual([]);
      await expect(drive.listPermissions(folders.stagingFolderId)).resolves.toEqual([]);
    },
  );

  it("puts a second line in the same Perjadin folder", async () => {
    const { staff, trip, line } = await scene();
    const second = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 1_000,
      createdByPersonId: staff.id,
    });

    for (const id of [line.id, second.id]) {
      const receipts = asReceipts(await upload(trip.id, [jpeg()], id));
      await finalizeReceiptsAction(trip.id, id, receipts);
    }

    const [a, b] = await Promise.all([
      lineRow(line.id).then((row) => drive.getFile(row.driveFolderId!)),
      lineRow(second.id).then((row) => drive.getFile(row.driveFolderId!)),
    ]);
    expect(a!.parents).toEqual(b!.parents);
    expect(drive.named(`Kelompok 3 · 12–14 Okt 2026 · P-${trip.id.slice(0, 8)}`)).toHaveLength(1);
  });
});

describe("after the commit", () => {
  it("keeps the receipt when sharing fails, and a second reconcile finishes it", async () => {
    const { staff, trip, line } = await scene();
    const ids = await upload(trip.id, [jpeg()], line.id);
    vi.spyOn(drive, "createPermission").mockRejectedValueOnce(
      new DriveRequestError("permissions.create", 500),
    );

    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts(ids))).resolves.toMatchObject({
      outcome: "attached",
      attached: 1,
      synced: false,
    });
    expect((await lineRow(line.id)).driveSyncedAt).toBeNull();
    await expect(evidenceOf(line.id)).resolves.toHaveLength(1);

    await expect(reconcileTransaction(staff, drive, folders, line.id)).resolves.toEqual({
      outcome: "synced",
    });
    const after = await lineRow(line.id);
    expect(after.driveSyncedAt).toBeInstanceOf(Date);
    await expect(drive.listPermissions(after.driveFolderId!)).resolves.toHaveLength(1);
  });

  it("never recreates a trashed transaction folder", async () => {
    const { staff, trip, line } = await scene();
    const receipts = asReceipts(await upload(trip.id, [jpeg()], line.id));
    await finalizeReceiptsAction(trip.id, line.id, receipts);
    drive.trash((await lineRow(line.id)).driveFolderId!);
    await db.update(schema.transaction).set({ driveSyncedAt: null });
    const before = drive.files.size;

    await expect(reconcileTransaction(staff, drive, folders, line.id)).resolves.toEqual({
      outcome: "unsynced",
      reason: "folder-trashed",
    });
    expect(drive.files.size).toBe(before);
    expect((await lineRow(line.id)).driveSyncedAt).toBeNull();
  });

  it("leaves one Perjadin folder when two lines' first receipts race, trashing the other", async () => {
    const { staff, trip, line } = await scene();
    const second = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 1_000,
      createdByPersonId: staff.id,
    });
    const [a, b] = await Promise.all([
      upload(trip.id, [jpeg()], line.id),
      upload(trip.id, [jpeg()], second.id),
    ]);
    // Hold each Perjadin-folder creation until both have started, so both reconciles have read "no
    // folder yet" before either claims one — the race itself, every run.
    const perjadinFolder = `Kelompok 3 · 12–14 Okt 2026 · P-${trip.id.slice(0, 8)}`;
    const createFolder = drive.createFolder.bind(drive);
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    vi.spyOn(drive, "createFolder").mockImplementation(async (input) => {
      if (input.name === perjadinFolder && ++started === 2) release();
      if (input.name === perjadinFolder) await bothStarted;
      return createFolder(input);
    });

    const results = await Promise.all([
      finalizeReceiptsAction(trip.id, line.id, asReceipts(a)),
      finalizeReceiptsAction(trip.id, second.id, asReceipts(b)),
    ]);

    expect(results.map((result) => result.outcome)).toEqual(["attached", "attached"]);
    const made = drive.named(perjadinFolder);
    expect(made).toHaveLength(2);
    const live = made.filter((folder) => !folder.trashed);
    expect(live).toHaveLength(1);
    const [stored] = await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, trip.id));
    expect(stored!.driveFolderId).toBe(live[0]!.id);
    for (const id of [line.id, second.id]) {
      await expect(drive.getFile((await lineRow(id)).driveFolderId!)).resolves.toMatchObject({
        parents: [live[0]!.id],
      });
    }
  });

  it("never puts a line into a Perjadin folder that is in the trash", async () => {
    const { staff, trip, line } = await scene();
    const receipts = asReceipts(await upload(trip.id, [jpeg()], line.id));
    await finalizeReceiptsAction(trip.id, line.id, receipts);
    const [stored] = await db.select().from(schema.perjadin).where(eq(schema.perjadin.id, trip.id));
    drive.trash(stored!.driveFolderId!);
    const second = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 1_000,
      createdByPersonId: staff.id,
    });
    const [id] = await upload(trip.id, [jpeg()], second.id);

    await expect(
      finalizeReceiptsAction(trip.id, second.id, asReceipts([id!])),
    ).resolves.toMatchObject({ outcome: "attached", attached: 1, synced: false });

    expect((await lineRow(second.id)).driveSyncedAt).toBeNull();
    expect((await drive.getFile(id!))!.parents).toEqual([folders.stagingFolderId]);
    expect(drive.named(`Kelompok 3 · 12–14 Okt 2026 · P-${trip.id.slice(0, 8)}`)).toHaveLength(1);
  });

  it("answers attached, not an error, when the reconcile throws after the commit", async () => {
    const { trip, line } = await scene();
    const ids = await upload(trip.id, [jpeg()], line.id);
    vi.spyOn(drive, "listPermissions").mockRejectedValueOnce(new Error("a bug, not Drive"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts(ids))).resolves.toMatchObject({
      outcome: "attached",
      attached: 1,
      synced: false,
    });
    await expect(evidenceOf(line.id)).resolves.toHaveLength(1);
  });

  it("keeps the receipt when the reconcile fails, with the file in _staging, and finishes it later", async () => {
    const { staff, trip, line } = await scene();
    const [id] = await upload(trip.id, [jpeg()], line.id);
    vi.spyOn(drive, "updateFile").mockRejectedValue(new DriveRequestError("files.update", 503));

    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts([id!]))).resolves.toEqual({
      outcome: "attached",
      attached: 1,
      failed: 0,
      synced: false,
    });
    await expect(evidenceOf(line.id)).resolves.toMatchObject([{ driveFileId: id }]);
    expect((await drive.getFile(id!))!.parents).toEqual([folders.stagingFolderId]);
    expect((await lineRow(line.id)).driveSyncedAt).toBeNull();

    vi.mocked(drive.updateFile).mockRestore();
    await expect(reconcileTransaction(staff, drive, folders, line.id)).resolves.toEqual({
      outcome: "synced",
    });
    const after = await lineRow(line.id);
    expect(after.driveSyncedAt).toBeInstanceOf(Date);
    expect((await drive.getFile(id!))!.parents).toEqual([after.driveFolderId]);
  });

  it("keeps the line owed when an older reconcile finishes after a newer receipt", async () => {
    const { staff, trip, line } = await scene();
    await finalizeReceiptsAction(
      trip.id,
      line.id,
      asReceipts(await upload(trip.id, [jpeg()], line.id)),
    );
    // Reconcile A — another tab, or the sweep — reads the line, then stops just before it shares.
    let reachedShare!: () => void;
    const atShare = new Promise<void>((resolve) => (reachedShare = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const listPermissions = drive.listPermissions.bind(drive);
    vi.spyOn(drive, "listPermissions").mockImplementationOnce(async (id) => {
      reachedShare();
      await held;
      return listPermissions(id);
    });
    const older = reconcileTransaction(staff, drive, folders, line.id);
    await atShare;

    // Meanwhile B adds a receipt; it commits, and its own reconcile fails before moving the file.
    const [newer] = await upload(trip.id, [jpeg()], line.id);
    vi.spyOn(drive, "updateFile").mockRejectedValue(new DriveRequestError("files.update", 503));
    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([newer!])),
    ).resolves.toMatchObject({ outcome: "attached", synced: false });
    release();

    await expect(older).resolves.toEqual({ outcome: "unsynced", reason: "newer-receipts" });
    expect((await lineRow(line.id)).driveSyncedAt).toBeNull();
    expect((await drive.getFile(newer!))!.parents).toEqual([folders.stagingFolderId]);
  });

  it("makes a synced line unsynced again until its new receipt is in place", async () => {
    const { trip, line } = await scene();
    await finalizeReceiptsAction(
      trip.id,
      line.id,
      asReceipts(await upload(trip.id, [jpeg()], line.id)),
    );
    expect((await lineRow(line.id)).driveSyncedAt).toBeInstanceOf(Date);
    const [id] = await upload(trip.id, [jpeg()], line.id);
    vi.spyOn(drive, "listPermissions").mockRejectedValueOnce(
      new DriveRequestError("permissions.list", 503),
    );

    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([id!])),
    ).resolves.toMatchObject({ outcome: "attached", synced: false });
    expect((await lineRow(line.id)).driveSyncedAt).toBeNull();
  });
});

describe("a file that does not check out", () => {
  it("counts a file named twice in one batch once, and the repeat as failed", async () => {
    const { trip, line } = await scene();
    const [id] = await upload(trip.id, [jpeg()], line.id);

    await expect(finalizeReceiptsAction(trip.id, line.id, asReceipts([id!, id!]))).resolves.toEqual(
      { outcome: "attached", attached: 1, failed: 1, synced: true },
    );
    await expect(evidenceOf(line.id)).resolves.toHaveLength(1);
  });

  it("fails a file over the cap as Drive holds it, one no longer in _staging, and a trashed one", async () => {
    const { trip, line } = await scene();
    const [overCap, moved, trashed] = await upload(trip.id, [jpeg(), jpeg(), jpeg()], line.id);
    drive.files.get(overCap!)!.size = MAX_UPLOAD_BYTES + 1;
    await drive.updateFile(moved!, {
      addParent: folders.rootFolderId,
      removeParent: folders.stagingFolderId,
    });
    drive.trash(trashed!);

    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([overCap!, moved!, trashed!])),
    ).resolves.toEqual({ outcome: "attached", attached: 0, failed: 3, synced: true });
    await expect(evidenceOf(line.id)).resolves.toHaveLength(0);
  });

  it("is reported as failed and not attached, while the rest attach", async () => {
    const { staff, trip, line } = await scene();
    const other = await addPerjadin({ picPersonId: staff.id });
    const [good] = await upload(trip.id, [jpeg()], line.id);
    const [wrongBytes] = await upload(
      trip.id,
      [new TextEncoder().encode("MZ executable!")],
      line.id,
    );
    const theirLine = await addTransaction({
      perjadinId: other.id,
      amountIdr: 1_000,
      createdByPersonId: staff.id,
    });
    const [theirs] = await upload(other.id, [jpeg()], theirLine.id);

    await expect(
      finalizeReceiptsAction(trip.id, line.id, asReceipts([good!, wrongBytes!, theirs!])),
    ).resolves.toEqual({ outcome: "attached", attached: 1, failed: 2, synced: true });

    await expect(evidenceOf(line.id)).resolves.toMatchObject([{ driveFileId: good }]);
    expect((await drive.getFile(wrongBytes!))!.parents).toEqual([folders.stagingFolderId]);
  });
});
