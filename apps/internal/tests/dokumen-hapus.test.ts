import {
  deleteDocumentAction,
  openDocumentSessionAction,
  recordDocumentAction,
} from "-/app/(app)/perjadin/[id]/dokumen/actions";
import PerjadinPage from "-/app/(app)/perjadin/[id]/page";
import { FakeDrive } from "-/lib/drive/fake-drive";
import { DriveRequestError, openDrive } from "-/lib/drive/google";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import { deletePerjadinDocument, isNotStaffError, type Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectDrive, digestOf, FORBIDDEN, pdf, stubTokenEndpoint } from "./support/drive";
import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Hapus a Perjadin Document, and the read-only Dokumen section** (#398, ADR-0042). The file goes
 * to the Drive trash first, then the row and its `document_deleted` Log entry go in one
 * transaction; a failure between the two leaves the row, and Hapus again finishes it. The same
 * fakes as `dokumen-drive.test.ts`, plus `deletePerjadinDocument` wrapped so one test can fail it.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("-/lib/drive/google")>()),
  openDrive: vi.fn(),
}));
vi.mock("@sugt/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sugt/db/queries")>();
  return { ...actual, deletePerjadinDocument: vi.fn(actual.deletePerjadinDocument) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "https://preview-42.sugt.test" })),
}));

let drive: FakeDrive;

/**
 * A Staff PIC, a Pimpinan, a trip with one School, Drive connected, and one sheet uploaded —
 * synced, unless `synced` is false: then moving it fails, and its file stays in `_staging`.
 */
async function scene({ synced = true }: { synced?: boolean } = {}) {
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  const pimpinan = await addPerson({ fullName: "Fa", email: "fa@itb.ac.id", role: "Pimpinan" });
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "kelompok-18",
    name: "Kelompok 18",
    clusterId: cluster.id,
  });
  const school = await addSchool({
    slug: "sman-1-bontang",
    name: "SMAN 1 Bontang",
    clusterId: cluster.id,
    subClusterId: subCluster.id,
    provinceCode: "KT",
  });
  const trip = await addPerjadin({
    picPersonId: staff.id,
    subClusterId: subCluster.id,
    startsOn: "2026-10-12",
    endsOn: "2026-10-16",
  });
  // The School is one of the trip's Schools (#410), so a Peserta sheet may name it.
  await addOfflineSession({ schoolId: school.id, heldOn: "2026-10-13", perjadinId: trip.id });
  await connectDrive(drive, staff.id);
  vi.mocked(requirePerson).mockResolvedValue(staff);

  const bytes = pdf();
  const fields = {
    kind: "Daftar Hadir Peserta",
    documentDate: "2026-10-14",
    peserta: { schoolId: school.id, participantType: "Siswa", startsAt: "08:00", endsAt: "11:30" },
  } as const;
  const opened = await openDocumentSessionAction(
    trip.id,
    { size: bytes.length, contentType: "application/pdf" },
    fields,
  );
  if (opened.outcome !== "ready") throw new Error(opened.outcome);
  const fileId = drive.land(opened.sessionUri, bytes).id;
  if (!synced) {
    vi.spyOn(drive, "updateFile").mockRejectedValueOnce(new DriveRequestError("files.update", 500));
  }
  const recorded = await recordDocumentAction({
    ...fields,
    perjadinId: trip.id,
    driveFileId: fileId,
  });
  if (recorded.outcome !== "recorded") throw new Error(recorded.outcome);
  drive.calls = 0;
  return { staff, pimpinan, trip, fileId, documentId: recorded.documentId };
}

/** The scene's Staff PIC, as the query layer takes them. */
scene.staff = async () => {
  const [row] = await db.select().from(schema.person).where(eq(schema.person.role, "Staff"));
  return { ...row!, grants: [] } as Person;
};

const documents = () => db.select().from(schema.perjadinDocument);
const deletions = async () =>
  (await db.select().from(schema.activityLog)).filter(
    (entry) => entry.action === "document_deleted",
  );
const trashed = (fileId: string) => drive.files.get(fileId)?.explicitlyTrashed;

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
  drive = new FakeDrive();
  vi.mocked(openDrive).mockReturnValue(drive);
  stubTokenEndpoint();
});

describe("Hapus", () => {
  it("trashes the file, then deletes the row and logs a snapshot of it", async () => {
    const { staff, trip, fileId, documentId } = await scene();

    await expect(deleteDocumentAction(documentId)).resolves.toEqual({ outcome: "deleted" });

    expect(trashed(fileId)).toBe(true);
    await expect(documents()).resolves.toEqual([]);
    const [entry] = await deletions();
    expect(entry).toMatchObject({
      actorPersonId: staff.id,
      perjadinId: trip.id,
      details: {
        documentId,
        kind: "Daftar Hadir Peserta",
        documentDate: "2026-10-14",
        schoolName: "SMAN 1 Bontang",
        participantType: "Siswa",
        startsAt: "08:00",
        endsAt: "11:30",
        timeZone: "WITA",
      },
      searchText:
        "dokumen dihapus · daftar hadir peserta · 2026-10-14 · sman 1 bontang · siswa · 08.00–11.30 wita",
    });
  });

  it("is refused, with the reason, while Drive is broken — the row and the file untouched", async () => {
    const { fileId, documentId } = await scene();
    await db.update(schema.driveConnection).set({ status: "broken", brokenAt: new Date() });

    await expect(deleteDocumentAction(documentId)).resolves.toEqual({
      outcome: "drive-disconnected",
      reason: expect.stringMatching(/^Koneksi Google Drive terputus sejak/),
    });
    expect(trashed(fileId)).toBe(false);
    await expect(documents()).resolves.toHaveLength(1);
    await expect(deletions()).resolves.toHaveLength(0);
  });

  it("is refused, with the reason, when Drive was never connected", async () => {
    const { documentId } = await scene();
    await db.delete(schema.driveConnection);

    await expect(deleteDocumentAction(documentId)).resolves.toEqual({
      outcome: "drive-disconnected",
      reason: expect.stringMatching(/^Google Drive belum terhubung/),
    });
    await expect(documents()).resolves.toHaveLength(1);
  });

  it("deletes an unsynced sheet the same way, its file trashed from _staging", async () => {
    const { documentId, fileId } = await scene({ synced: false });
    const [unsynced] = await documents();
    expect(unsynced!.driveSyncedAt).toBeNull();

    await expect(deleteDocumentAction(documentId)).resolves.toEqual({ outcome: "deleted" });
    expect(trashed(fileId)).toBe(true);
    await expect(documents()).resolves.toEqual([]);
  });

  it("rolls the row back with the Log entry: one refused, neither written", async () => {
    const { documentId } = await scene();
    // A caller whose Person does not exist: the Log entry's foreign key refuses it, inside the
    // transaction, after the row delete — so the delete must be undone with it.
    const ghost = { ...(await scene.staff()), id: "00000000-0000-0000-0000-00000000dead" };

    await expect(deletePerjadinDocument(ghost, documentId)).rejects.toThrow();
    await expect(documents()).resolves.toHaveLength(1);
    await expect(deletions()).resolves.toHaveLength(0);
  });

  it.each([
    ["already in the Drive trash", (id: string) => drive.trash(id)],
    ["gone from Drive", (id: string) => drive.remove(id)],
  ])("completes when the file is %s", async (_case, spoil) => {
    const { fileId, documentId } = await scene();
    spoil(fileId);

    await expect(deleteDocumentAction(documentId)).resolves.toEqual({ outcome: "deleted" });
    await expect(documents()).resolves.toEqual([]);
    await expect(deletions()).resolves.toHaveLength(1);
  });

  it("keeps the row when the database fails after the trash, and Hapus again finishes it", async () => {
    const { fileId, documentId } = await scene();
    vi.mocked(deletePerjadinDocument).mockRejectedValueOnce(new Error("connection lost"));

    await expect(deleteDocumentAction(documentId)).rejects.toThrow("connection lost");
    expect(trashed(fileId)).toBe(true);
    await expect(documents()).resolves.toHaveLength(1);

    await expect(deleteDocumentAction(documentId)).resolves.toEqual({ outcome: "deleted" });
    await expect(documents()).resolves.toEqual([]);
    await expect(deletions()).resolves.toHaveLength(1);
  });

  it("answers no-such-document for a sheet already deleted", async () => {
    const { documentId } = await scene();
    await deleteDocumentAction(documentId);

    await expect(deleteDocumentAction(documentId)).resolves.toEqual({
      outcome: "no-such-document",
    });
    await expect(deletions()).resolves.toHaveLength(1);
  });

  it("refuses a non-Staff caller with zero Drive calls", async () => {
    const { pimpinan, fileId, documentId } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(pimpinan);

    await expect(digestOf(deleteDocumentAction(documentId))).resolves.toBe(FORBIDDEN);
    await expect(deletePerjadinDocument(pimpinan as Person, documentId)).rejects.toSatisfy(
      isNotStaffError,
    );
    expect(drive.calls).toBe(0);
    expect(trashed(fileId)).toBe(false);
  });
});

describe("the Dokumen section on /perjadin/[id]", () => {
  it("lists the sheets read-only for a Pimpinan: Buka, no Hapus, no upload", async () => {
    const { pimpinan, trip } = await scene();
    vi.mocked(requirePerson).mockResolvedValue(pimpinan);

    const html = renderToStaticMarkup(
      await PerjadinPage({ params: Promise.resolve({ id: trip.id }) } as never),
    );

    expect(html).toContain(">Dokumen</h2>");
    expect(html).toContain("2026-10-14 · SMAN 1 Bontang · Siswa · 08.00–11.30 WITA");
    expect(html).toContain(">Buka</a>");
    expect(html).not.toContain(">Hapus</button>");
    expect(html).not.toContain("Unggah dokumen");
  });
});
