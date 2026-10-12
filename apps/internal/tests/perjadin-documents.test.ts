import { randomUUID } from "node:crypto";

import { db, schema } from "@sugt/db";
import {
  deletePerjadinDocument,
  isNotStaffError,
  perjadinDokumen,
  recordPerjadinDocument,
  type NewPerjadinDocument,
  type Person,
} from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addGroupMember,
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
 * shape, the rules the application holds — the date inside the trip, the School one of the trip's
 * Schools (#410), one SPPD per School per Perjadin (#441) — and the record and its Activity Log
 * entry, written together.
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

/** A Daftar Hadir Peserta for `schoolId`, valid unless the overrides spoil it. */
function peserta(
  perjadinId: string,
  schoolId: string,
  overrides: Partial<NewPerjadinDocument> = {},
): NewPerjadinDocument {
  return {
    perjadinId,
    documentId: randomUUID(),
    driveFileId: randomUUID(),
    byteSize: 2048,
    kind: "Daftar Hadir Peserta",
    documentDate: "2026-10-14",
    peserta: { schoolId, participantType: "Siswa", startsAt: "08:00", endsAt: "11:30" },
    ...overrides,
  };
}

/** A Daftar Hadir Pendamping for one day. */
function pendamping(perjadinId: string, documentDate = "2026-10-13"): NewPerjadinDocument {
  return {
    perjadinId,
    documentId: randomUUID(),
    driveFileId: randomUUID(),
    byteSize: 2048,
    kind: "Daftar Hadir Pendamping",
    documentDate,
  };
}

const documents = () => db.select().from(schema.perjadinDocument);
const logged = () => db.select().from(schema.activityLog);

beforeEach(resetDatabase);

describe("the CHECKs", () => {
  /** A row written straight to the table, bypassing the application's checks. */
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

describe("recordPerjadinDocument", () => {
  it("records a Peserta sheet and its Activity Log entry, with the School's name and zone", async () => {
    const { staff, trip, inside } = await scene();
    const input = peserta(trip.id, inside.id);

    await expect(recordPerjadinDocument(staff, input)).resolves.toEqual({ outcome: "recorded" });

    const [row] = await documents();
    expect(row).toMatchObject({
      id: input.documentId,
      kind: "Daftar Hadir Peserta",
      documentDate: "2026-10-14",
      schoolId: inside.id,
      participantType: "Siswa",
      startsAt: "08:00:00",
      endsAt: "11:30:00",
      contentType: "application/pdf",
      uploadedByPersonId: staff.id,
      driveSyncedAt: null,
    });
    const [entry] = await logged();
    expect(entry).toMatchObject({
      actorPersonId: staff.id,
      perjadinId: trip.id,
      action: "document_uploaded",
      details: {
        documentId: input.documentId,
        kind: "Daftar Hadir Peserta",
        documentDate: "2026-10-14",
        schoolName: "SMAN 1 Bontang",
        participantType: "Siswa",
        startsAt: "08:00",
        endsAt: "11:30",
        timeZone: "WITA",
      },
      searchText:
        "dokumen diunggah · daftar hadir peserta · 2026-10-14 · sman 1 bontang · siswa · 08.00–11.30 wita",
    });
  });

  it("records a Pendamping sheet with only its date", async () => {
    const { staff, trip } = await scene();
    const input = pendamping(trip.id);

    await expect(recordPerjadinDocument(staff, input)).resolves.toEqual({ outcome: "recorded" });

    const [entry] = await logged();
    expect(entry?.details).toEqual({
      documentId: input.documentId,
      kind: "Daftar Hadir Pendamping",
      documentDate: "2026-10-13",
    });
    expect(entry?.searchText).toBe("dokumen diunggah · daftar hadir pendamping · 2026-10-13");
  });

  it("allows two sheets of one kind and date — the D- marker tells them apart", async () => {
    const { staff, trip, inside } = await scene();

    await recordPerjadinDocument(staff, peserta(trip.id, inside.id));
    await recordPerjadinDocument(staff, peserta(trip.id, inside.id));

    await expect(documents()).resolves.toHaveLength(2);
    await expect(logged()).resolves.toHaveLength(2);
  });

  it.each([
    ["before the trip", "2026-10-11"],
    ["after the trip", "2026-10-16"],
    ["not a date", "kemarin"],
  ])("refuses a date %s, and writes and logs nothing", async (_case, documentDate) => {
    const { staff, trip } = await scene();

    await expect(recordPerjadinDocument(staff, pendamping(trip.id, documentDate))).resolves.toEqual(
      {
        outcome: "date-outside-perjadin",
        startsOn: "2026-10-12",
        endsOn: "2026-10-15",
      },
    );
    await expect(documents()).resolves.toHaveLength(0);
    await expect(logged()).resolves.toHaveLength(0);
  });

  it("refuses a School that is not one of the trip's Schools, and writes and logs nothing", async () => {
    const { staff, trip, outside, offTrip } = await scene();

    // In the trip's Sub-Cluster, but its only Session on the trip was cancelled (#410).
    await expect(recordPerjadinDocument(staff, peserta(trip.id, offTrip.id))).resolves.toEqual({
      outcome: "school-not-on-perjadin",
    });
    await expect(recordPerjadinDocument(staff, peserta(trip.id, outside.id))).resolves.toEqual({
      outcome: "school-not-on-perjadin",
    });
    await expect(recordPerjadinDocument(staff, peserta(trip.id, "not-a-uuid"))).resolves.toEqual({
      outcome: "school-not-on-perjadin",
    });
    await expect(documents()).resolves.toHaveLength(0);
    await expect(logged()).resolves.toHaveLength(0);
  });

  it("refuses times out of order, and Peserta fields on the wrong kind", async () => {
    const { staff, trip, inside } = await scene();
    const sheet = peserta(trip.id, inside.id);

    await expect(
      recordPerjadinDocument(staff, {
        ...sheet,
        peserta: { ...sheet.peserta!, startsAt: "11:30", endsAt: "08:00" },
      }),
    ).resolves.toEqual({ outcome: "times-out-of-order" });
    await expect(
      recordPerjadinDocument(staff, { ...sheet, kind: "Daftar Hadir Narasumber" }),
    ).resolves.toEqual({ outcome: "invalid-fields" });
    await expect(recordPerjadinDocument(staff, { ...sheet, peserta: undefined })).resolves.toEqual({
      outcome: "invalid-fields",
    });
    await expect(logged()).resolves.toHaveLength(0);
  });

  it("refuses a non-Staff caller before anything is written", async () => {
    const { trip } = await scene();
    const pimpinan = await addPerson({ fullName: "Pim", email: "pim@itb.ac.id", role: "Pimpinan" });

    await expect(recordPerjadinDocument(pimpinan as Person, pendamping(trip.id))).rejects.toSatisfy(
      isNotStaffError,
    );
    await expect(documents()).resolves.toHaveLength(0);
  });
});

/** An SPPD for `schoolId` on `perjadinId` (#441): a School, no date. */
function sppd(perjadinId: string, schoolId: string): NewPerjadinDocument {
  return {
    perjadinId,
    documentId: randomUUID(),
    driveFileId: randomUUID(),
    byteSize: 2048,
    kind: "SPPD",
    documentDate: null,
    sppd: { schoolId },
  };
}

describe("an SPPD (#441)", () => {
  /**
   * The ticket's T5 table: SMAN 1 Bontang has a Session on Perjadin A and on Perjadin B; Rina and
   * Andi are A's Group, Dimas is B's. A also visits SMAN 2 Samarinda.
   */
  async function t5() {
    const { staff: rina, trip: a, inside: bontang, outside: samarinda } = await scene();
    await addOfflineSession({ schoolId: samarinda.id, heldOn: "2026-10-14", perjadinId: a.id });
    const andi = (await addPerson({
      fullName: "Andi",
      email: "andi@itb.ac.id",
      role: "Staff",
    })) as Person;
    await addGroupMember(a.id, andi.id);
    const dimas = (await addPerson({
      fullName: "Dimas",
      email: "dimas@itb.ac.id",
      role: "Staff",
    })) as Person;
    const b = await addPerjadin({
      picPersonId: dimas.id,
      subClusterId: a.subClusterId,
      startsOn: "2026-11-09",
      endsOn: "2026-11-10",
    });
    await addOfflineSession({ schoolId: bontang.id, heldOn: "2026-11-09", perjadinId: b.id });
    return { rina, andi, dimas, a, b, bontang, samarinda };
  }

  it("holds every row of the T5 table", async () => {
    const { rina, andi, dimas, a, b, bontang, samarinda } = await t5();

    // 1. Rina uploads A's Bontang SPPD.
    const first = sppd(a.id, bontang.id);
    await expect(recordPerjadinDocument(rina, first)).resolves.toEqual({ outcome: "recorded" });
    // 2. Andi, also on A, cannot add a second for Bontang on A — and A's read marks it.
    await expect(recordPerjadinDocument(andi, sppd(a.id, bontang.id))).resolves.toEqual({
      outcome: "sppd-exists",
      schoolName: "SMAN 1 Bontang",
    });
    expect((await perjadinDokumen(andi, a.id))?.schools).toEqual([
      expect.objectContaining({ name: "SMAN 1 Bontang", hasSppd: true }),
      expect.objectContaining({ name: "SMAN 2 Samarinda", hasSppd: false }),
    ]);
    // 3. Andi uploads Samarinda's on A: another School.
    await expect(recordPerjadinDocument(andi, sppd(a.id, samarinda.id))).resolves.toEqual({
      outcome: "recorded",
    });
    // 4. Dimas uploads Bontang's on B: A's does not count.
    const onB = sppd(b.id, bontang.id);
    await expect(recordPerjadinDocument(dimas, onB)).resolves.toEqual({ outcome: "recorded" });
    expect((await perjadinDokumen(dimas, b.id))?.schools).toEqual([
      expect.objectContaining({ name: "SMAN 1 Bontang", hasSppd: true }),
    ]);
    // 5. Rina deletes A's Bontang SPPD and uploads a corrected one; B's is untouched.
    await expect(deletePerjadinDocument(rina, first.documentId)).resolves.toMatchObject({
      outcome: "deleted",
    });
    await expect(recordPerjadinDocument(rina, sppd(a.id, bontang.id))).resolves.toEqual({
      outcome: "recorded",
    });

    const rows = await documents();
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.perjadinId === b.id)?.id).toBe(onB.documentId);
  });

  it("leaves exactly one row when two records for one School race; the loser gets sppd-exists", async () => {
    const { rina, andi, a, bontang } = await t5();

    const results = await Promise.all([
      recordPerjadinDocument(rina, sppd(a.id, bontang.id)),
      recordPerjadinDocument(andi, sppd(a.id, bontang.id)),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        { outcome: "recorded" },
        { outcome: "sppd-exists", schoolName: "SMAN 1 Bontang" },
      ]),
    );
    await expect(documents()).resolves.toHaveLength(1);
    await expect(logged()).resolves.toHaveLength(1);
  });

  it("is logged as SPPD · {School}, uploaded and deleted", async () => {
    const { staff, trip, inside } = await scene();
    const input = sppd(trip.id, inside.id);

    await recordPerjadinDocument(staff, input);
    await deletePerjadinDocument(staff, input.documentId);

    const entries = await logged();
    expect(entries.map((entry) => entry.details)).toEqual([
      {
        documentId: input.documentId,
        kind: "SPPD",
        documentDate: null,
        schoolName: "SMAN 1 Bontang",
      },
      {
        documentId: input.documentId,
        kind: "SPPD",
        documentDate: null,
        schoolName: "SMAN 1 Bontang",
      },
    ]);
    expect(entries.map((entry) => entry.searchText).sort()).toEqual(
      [
        "dokumen diunggah · sppd · sman 1 bontang",
        "dokumen dihapus · sppd · sman 1 bontang",
      ].sort(),
    );
  });

  it("refuses a School that is not one of the trip's, a date, and the wrong fields", async () => {
    const { staff, trip, inside, outside, offTrip } = await scene();
    const input = sppd(trip.id, inside.id);

    for (const schoolId of [outside.id, offTrip.id, "not-a-uuid"]) {
      await expect(recordPerjadinDocument(staff, sppd(trip.id, schoolId))).resolves.toEqual({
        outcome: "school-not-on-perjadin",
      });
    }
    await expect(
      recordPerjadinDocument(staff, { ...input, documentDate: "2026-10-13" }),
    ).resolves.toEqual({ outcome: "invalid-fields" });
    await expect(recordPerjadinDocument(staff, { ...input, sppd: undefined })).resolves.toEqual({
      outcome: "invalid-fields",
    });
    await expect(
      recordPerjadinDocument(staff, { ...pendamping(trip.id), sppd: { schoolId: inside.id } }),
    ).resolves.toEqual({ outcome: "invalid-fields" });
    await expect(documents()).resolves.toHaveLength(0);
    await expect(logged()).resolves.toHaveLength(0);
  });

  it("stays, listed after the dated sheets, once its School leaves the trip", async () => {
    const { staff, trip, inside, live } = await scene();
    const input = sppd(trip.id, inside.id);
    await recordPerjadinDocument(staff, input);
    await recordPerjadinDocument(staff, pendamping(trip.id));
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Sekolah libur" })
      .where(eq(schema.session.id, live.id));

    const read = await perjadinDokumen(staff, trip.id);

    expect(read?.schools).toEqual([]);
    expect(read?.documents.map((row) => [row.kind, row.documentDate, row.schoolName])).toEqual([
      ["Daftar Hadir Pendamping", "2026-10-13", null],
      ["SPPD", null, "SMAN 1 Bontang"],
    ]);
  });
});

describe("perjadinDokumen — the dialog's read", () => {
  it("lists the trip's window, the trip's Schools and its sheets, unsynced flagged", async () => {
    const { staff, trip, inside } = await scene();
    const first = peserta(trip.id, inside.id);
    const second = pendamping(trip.id, "2026-10-12");
    await recordPerjadinDocument(staff, first);
    await recordPerjadinDocument(staff, second);
    await db
      .update(schema.perjadinDocument)
      .set({ driveSyncedAt: new Date() })
      .where(eq(schema.perjadinDocument.id, second.documentId));

    const read = await perjadinDokumen(staff, trip.id);

    expect(read).toMatchObject({
      perjadinId: trip.id,
      startsOn: "2026-10-12",
      endsOn: "2026-10-15",
      schools: [{ id: inside.id, name: "SMAN 1 Bontang", timeZone: "WITA", hasSppd: false }],
    });
    expect(read?.documents).toEqual([
      expect.objectContaining({
        id: second.documentId,
        kind: "Daftar Hadir Pendamping",
        schoolName: null,
        unsynced: false,
      }),
      expect.objectContaining({
        id: first.documentId,
        schoolName: "SMAN 1 Bontang",
        participantType: "Siswa",
        timeZone: "WITA",
        unsynced: true,
      }),
    ]);
    await expect(perjadinDokumen(staff, randomUUID())).resolves.toBeNull();
  });

  it("keeps a sheet for a School that has since left the trip — listed and deletable — but offers it no more", async () => {
    const { staff, trip, inside, live } = await scene();
    const sheet = peserta(trip.id, inside.id);
    await expect(recordPerjadinDocument(staff, sheet)).resolves.toEqual({ outcome: "recorded" });
    // The School's last live Session on the trip is cancelled: it is no longer one of the trip's.
    await db
      .update(schema.session)
      .set({ status: "cancelled", cancelledReason: "Sekolah libur" })
      .where(eq(schema.session.id, live.id));

    const read = await perjadinDokumen(staff, trip.id);

    expect(read?.schools).toEqual([]);
    expect(read?.documents).toEqual([
      expect.objectContaining({ id: sheet.documentId, schoolName: "SMAN 1 Bontang" }),
    ]);
    // Hapus does not re-check the School: the rule is for new uploads only.
    await expect(deletePerjadinDocument(staff, sheet.documentId)).resolves.toMatchObject({
      outcome: "deleted",
    });
    await expect(documents()).resolves.toHaveLength(0);
  });
});
