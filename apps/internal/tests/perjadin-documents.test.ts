import { randomUUID } from "node:crypto";

import { db, schema } from "@sugt/db";
import { perjadinDokumen, type Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  refusedBy,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Perjadin Documents, the database half** (#397, ADR-0042): the CHECKs that hold each kind's exact
 * shape, and the read `/perjadin/[id]` lists them by. Nothing records or deletes one any more
 * (ADR-0061, #559), so every row here is written straight to the table, as one recorded before that.
 */

/**
 * A trip to a Sub-Cluster in WITA. SMAN 1 Bontang is on it, with a live Session; SMAN 3 Bontang is
 * in the same Sub-Cluster but off it, its one Session there cancelled; SMAN 2 Samarinda is in
 * another Sub-Cluster altogether.
 */
async function scene() {
  const staff = await addPerson({ fullName: "Rina", email: "rina@itb.ac.id", role: "Staff" });
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "kelompok-18",
    name: "Kelompok 18",
    clusterId: cluster.id,
  });
  const inside = await addSchool({
    slug: "sman-1-bontang",
    name: "SMAN 1 Bontang",
    clusterId: cluster.id,
    subClusterId: subCluster.id,
    provinceCode: "KT",
    kabupatenKota: "Kota Bontang",
  });
  const outside = await addSchool({
    slug: "sman-2-samarinda",
    name: "SMAN 2 Samarinda",
    clusterId: cluster.id,
    provinceCode: "KT",
    kabupatenKota: "Kota Samarinda",
  });
  const trip = await addPerjadin({
    picPersonId: staff.id,
    subClusterId: subCluster.id,
    startsOn: "2026-10-12",
    endsOn: "2026-10-15",
  });
  const offTrip = await addSchool({
    slug: "sman-3-bontang",
    name: "SMAN 3 Bontang",
    clusterId: cluster.id,
    subClusterId: subCluster.id,
    provinceCode: "KT",
    kabupatenKota: "Kota Bontang",
  });
  const live = await addOfflineSession({
    schoolId: inside.id,
    heldOn: "2026-10-13",
    perjadinId: trip.id,
  });
  await addOfflineSession({
    schoolId: offTrip.id,
    heldOn: "2026-10-14",
    perjadinId: trip.id,
    status: "cancelled",
  });
  return { staff: staff as Person, trip, inside, outside, offTrip, live };
}

/**
 * A row written straight to the table, bypassing the application — a document recorded before
 * #559, or one the CHECKs should refuse. A Narasumber sheet unless `row` says otherwise.
 */
async function insert(
  perjadinId: string,
  uploadedByPersonId: string,
  row: Partial<typeof schema.perjadinDocument.$inferInsert>,
) {
  return db.insert(schema.perjadinDocument).values({
    perjadinId,
    kind: "Daftar Hadir Narasumber",
    documentDate: "2026-10-13",
    driveFileId: randomUUID(),
    contentType: "application/pdf",
    byteSize: 1,
    uploadedByPersonId,
    ...row,
  });
}

/** A recorded Daftar Hadir Peserta for `schoolId`, its id. */
async function addPeserta(perjadinId: string, staff: Person, schoolId: string) {
  const id = randomUUID();
  await insert(perjadinId, staff.id, {
    id,
    kind: "Daftar Hadir Peserta",
    documentDate: "2026-10-14",
    schoolId,
    participantType: "Siswa",
    startsAt: "08:00",
    endsAt: "11:30",
  });
  return id;
}

/** A recorded SPPD for `schoolId` (#441), its id. */
async function addSppd(perjadinId: string, staff: Person, schoolId: string) {
  const id = randomUUID();
  await insert(perjadinId, staff.id, { id, kind: "SPPD", documentDate: null, schoolId });
  return id;
}

beforeEach(resetDatabase);

describe("the CHECKs", () => {
  it("requires a Peserta sheet's four fields, and refuses any of them on the other two kinds", async () => {
    const { staff, trip, inside } = await scene();
    const all = {
      schoolId: inside.id,
      participantType: "Siswa" as const,
      startsAt: "08:00",
      endsAt: "11:30",
    };

    await expect(
      refusedBy(
        insert(trip.id, staff.id, { kind: "Daftar Hadir Peserta", ...all, startsAt: null }),
      ),
    ).resolves.toBe("perjadin_document_peserta_fields_check");
    await expect(
      refusedBy(
        insert(trip.id, staff.id, { kind: "Daftar Hadir Peserta", ...all, documentDate: null }),
      ),
    ).resolves.toBe("perjadin_document_peserta_fields_check");
    await expect(
      refusedBy(insert(trip.id, staff.id, { kind: "Daftar Hadir Pendamping", ...all })),
    ).resolves.toBe("perjadin_document_day_sheet_fields_check");
    await expect(refusedBy(insert(trip.id, staff.id, { schoolId: inside.id }))).resolves.toBe(
      "perjadin_document_day_sheet_fields_check",
    );
    await expect(refusedBy(insert(trip.id, staff.id, { documentDate: null }))).resolves.toBe(
      "perjadin_document_day_sheet_fields_check",
    );
    await expect(
      refusedBy(insert(trip.id, staff.id, { kind: "Daftar Hadir Peserta", ...all })),
    ).resolves.toBeNull();
    await expect(refusedBy(insert(trip.id, staff.id, {}))).resolves.toBeNull();
  });

  it("holds an SPPD to a School and nothing else (#441)", async () => {
    const { staff, trip, inside } = await scene();
    const sppd = { kind: "SPPD" as const, schoolId: inside.id, documentDate: null };

    for (const spoil of [
      { documentDate: "2026-10-13" },
      { schoolId: null },
      { participantType: "Siswa" as const },
      { startsAt: "08:00", endsAt: "11:30" },
    ]) {
      await expect(refusedBy(insert(trip.id, staff.id, { ...sppd, ...spoil }))).resolves.toBe(
        "perjadin_document_sppd_fields_check",
      );
    }
    await expect(refusedBy(insert(trip.id, staff.id, sppd))).resolves.toBeNull();
  });

  it("holds one SPPD per School per Perjadin, and leaves the attendance kinds unbounded", async () => {
    const { staff, trip, inside } = await scene();
    const other = await addPerjadin({
      picPersonId: staff.id,
      subClusterId: trip.subClusterId,
      startsOn: "2026-11-09",
      endsOn: "2026-11-10",
    });
    const sppd = { kind: "SPPD" as const, schoolId: inside.id, documentDate: null };

    await expect(refusedBy(insert(trip.id, staff.id, sppd))).resolves.toBeNull();
    await expect(refusedBy(insert(trip.id, staff.id, sppd))).resolves.toBe(
      "perjadin_document_sppd_unique",
    );
    // The same School on another Perjadin gets its own.
    await expect(refusedBy(insert(other.id, staff.id, sppd))).resolves.toBeNull();
    // Peserta sheets for that School are no SPPD, and are not counted against it.
    const peserta = {
      kind: "Daftar Hadir Peserta" as const,
      schoolId: inside.id,
      participantType: "Siswa" as const,
      startsAt: "08:00",
      endsAt: "11:30",
    };
    await expect(refusedBy(insert(trip.id, staff.id, peserta))).resolves.toBeNull();
    await expect(refusedBy(insert(trip.id, staff.id, peserta))).resolves.toBeNull();
  });

  it("holds Waktu Selesai after Waktu Mulai, and the PDF-only type", async () => {
    const { staff, trip, inside } = await scene();
    const sheet = {
      kind: "Daftar Hadir Peserta" as const,
      schoolId: inside.id,
      participantType: "GTK-MS" as const,
    };

    await expect(
      refusedBy(insert(trip.id, staff.id, { ...sheet, startsAt: "11:30", endsAt: "11:30" })),
    ).resolves.toBe("perjadin_document_times_check");
    await expect(refusedBy(insert(trip.id, staff.id, { contentType: "image/jpeg" }))).resolves.toBe(
      "perjadin_document_content_type_check",
    );
  });
});

describe("perjadinDokumen — the trip page's read", () => {
  it("lists the trip's window, the trip's Schools and its sheets, unsynced flagged", async () => {
    const { staff, trip, inside } = await scene();
    const first = await addPeserta(trip.id, staff, inside.id);
    const second = randomUUID();
    await insert(trip.id, staff.id, {
      id: second,
      kind: "Daftar Hadir Pendamping",
      documentDate: "2026-10-12",
      driveSyncedAt: new Date(),
    });

    const read = await perjadinDokumen(staff, trip.id);

    expect(read).toMatchObject({
      perjadinId: trip.id,
      startsOn: "2026-10-12",
      endsOn: "2026-10-15",
      schools: [{ id: inside.id, name: "SMAN 1 Bontang", timeZone: "WITA", hasSppd: false }],
    });
    expect(read?.documents).toEqual([
      expect.objectContaining({
        id: second,
        kind: "Daftar Hadir Pendamping",
        schoolName: null,
        unsynced: false,
      }),
      expect.objectContaining({
        id: first,
        schoolName: "SMAN 1 Bontang",
        participantType: "Siswa",
        timeZone: "WITA",
        unsynced: true,
      }),
    ]);
    await expect(perjadinDokumen(staff, randomUUID())).resolves.toBeNull();
  });

  it("marks a School that has its SPPD on this trip, and never counts another trip's (#441)", async () => {
    const { staff, trip: a, inside: bontang, outside: samarinda } = await scene();
    await addOfflineSession({ schoolId: samarinda.id, heldOn: "2026-10-14", perjadinId: a.id });
    const b = await addPerjadin({
      picPersonId: staff.id,
      subClusterId: a.subClusterId,
      startsOn: "2026-11-09",
      endsOn: "2026-11-10",
    });
    await addOfflineSession({ schoolId: bontang.id, heldOn: "2026-11-09", perjadinId: b.id });
    await addSppd(a.id, staff, bontang.id);

    expect((await perjadinDokumen(staff, a.id))?.schools).toEqual([
      expect.objectContaining({ name: "SMAN 1 Bontang", hasSppd: true }),
      expect.objectContaining({ name: "SMAN 2 Samarinda", hasSppd: false }),
    ]);
    expect((await perjadinDokumen(staff, b.id))?.schools).toEqual([
      expect.objectContaining({ name: "SMAN 1 Bontang", hasSppd: false }),
    ]);
  });

  it("keeps a School's SPPD and sheets listed, the SPPD last, once the School leaves the trip", async () => {
    const { staff, trip, inside, live } = await scene();
    const sheet = await addPeserta(trip.id, staff, inside.id);
    await addSppd(trip.id, staff, inside.id);
    await insert(trip.id, staff.id, {
      kind: "Daftar Hadir Pendamping",
      documentDate: "2026-10-13",
    });
    // The School's last live Session on the trip is cancelled: it is no longer one of the trip's.
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Sekolah libur" })
      .where(eq(schema.session.id, live.id));

    const read = await perjadinDokumen(staff, trip.id);

    expect(read?.schools).toEqual([]);
    expect(read?.documents.map((row) => [row.kind, row.documentDate, row.schoolName])).toEqual([
      ["Daftar Hadir Pendamping", "2026-10-13", null],
      ["Daftar Hadir Peserta", "2026-10-14", "SMAN 1 Bontang"],
      ["SPPD", null, "SMAN 1 Bontang"],
    ]);
    expect(read?.documents[1]?.id).toBe(sheet);
  });
});
