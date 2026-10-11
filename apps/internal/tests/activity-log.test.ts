import { randomUUID } from "node:crypto";

import { db, schema } from "@sugt/db";
import {
  activityLogAksi,
  activityLogPage,
  activityLogRincian,
  attachTransactionEvidence,
  filePerjadinReport,
  isNotGrantedError,
  isNotStaffError,
  planPerjadin,
  recordTransaction,
  type ActivityLogEntry,
  type ActivityLogFilters,
  type NewEvidence,
  type Person,
} from "@sugt/db/queries";
import type { ActivityLogAction, Role } from "@sugt/domain";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { logActivity } from "../../../packages/db/src/queries/activity-log";
import {
  addActivityLogEntry,
  addCluster,
  addGrant,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSchoolOnTrip,
  addSubCluster,
  addTransaction,
  addTransactionEvidence,
  asEditor,
  resetDatabase,
} from "./support/fixtures";

/**
 * **The Activity Log** (#395). Each of the five money writes inserts one entry in its own database
 * transaction — the right actor, Perjadin, action and details — and a refused write inserts none.
 * `/log`'s read pages newest first, searches in SQL and filters by Aksi group and WIB date range.
 */

async function staff(email = "rina@ditsama.itb.ac.id", fullName = "Rina Setiawati") {
  // An Editor, since `planPerjadin` needs the Grant (ADR-0047); nothing logged here depends on it.
  return asEditor(await addPerson({ fullName, email, role: "Staff" }));
}

async function administrator() {
  const admin = await addPerson({ fullName: "Admin", email: "admin@itb.ac.id", role: "Staff" });
  await addGrant(admin.id, "Administrator");
  return { ...admin, grants: ["Administrator"] } as Person;
}

/** A caller who is not Staff. Refused by `requireStaff` before anything is written. */
function nonStaff(): Person {
  return {
    id: "00000000-0000-0000-0000-000000000009",
    fullName: "Budi Santoso",
    email: "budi@gmail.com",
    role: "Pimpinan" as Role,
    grants: [],
  };
}

function receipts(count: number): NewEvidence[] {
  return Array.from({ length: count }, () => ({
    driveFileId: randomUUID(),
    contentType: "image/jpeg",
    byteSize: 120_000,
  }));
}

async function entries() {
  return db.select().from(schema.activityLog).orderBy(asc(schema.activityLog.occurredAt));
}

/** What `search_text` holds for an entry written now. */
function searchTextOf(entry: ActivityLogEntry, backfilled = false) {
  return `${activityLogAksi(entry.action, backfilled)} · ${activityLogRincian(entry)}`.toLowerCase();
}

describe("each money write logs one entry with the change", () => {
  beforeEach(resetDatabase);

  /** A one-School plan on a real Sub-Cluster. */
  async function plan(pic: Person) {
    await addProvince("JB", "Jawa Barat");
    const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const subCluster = await addSubCluster({
      slug: "alpha-bandung",
      name: "Kelompok 3",
      clusterId: cluster.id,
    });
    const school = await addSchool({
      slug: "sman-1",
      name: "SMAN 1 Bandung",
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "JB",
      kabupatenKota: "Kota Bandung",
    });

    return planPerjadin(pic, {
      subClusterId: subCluster.id,
      picPersonId: pic.id,
      teacherNames: [],
      pimpinan: [],
      sessions: [
        {
          schoolId: school.id,
          heldOn: "2026-10-12",
          startsAt: "09:00",
          taughtByTeacherIndexes: [],
        },
      ],
      startsOn: "2026-10-12",
      endsOn: "2026-10-15",
    });
  }

  it("planPerjadin logs nothing, and leaves the Advance column unwritten (ADR-0051)", async () => {
    const pic = await staff();
    const result = await plan(pic);
    if (result.outcome !== "planned") throw new Error(result.outcome);

    const [row] = await db
      .select({ advanceIdr: schema.perjadin.advanceIdr })
      .from(schema.perjadin)
      .where(eq(schema.perjadin.id, result.perjadinId));
    expect(row).toEqual({ advanceIdr: null });
    await expect(entries()).resolves.toEqual([]);
  });

  it("planPerjadin's refusal logs nothing", async () => {
    const pic = await staff();
    const result = await planPerjadin(pic, {
      subClusterId: randomUUID(),
      picPersonId: pic.id,
      teacherNames: [],
      pimpinan: [],
      sessions: [],
      startsOn: "2026-10-12",
      endsOn: "2026-10-15",
    });
    expect(result.outcome).toBe("no-schools");
    await expect(entries()).resolves.toEqual([]);
  });

  it("cannot be handed advance_set or advance_changed — they are history only (ADR-0051)", () => {
    // Never called: the assertion is the typecheck gate. Each `@ts-expect-error` fails the build the
    // day `logActivity` accepts the action again.
    const set = { action: "advance_set", details: { amountIdr: 1 } } as const;
    const changed = { action: "advance_changed", details: { fromIdr: 1, toIdr: 2 } } as const;
    const neverRun = (tx: Parameters<typeof logActivity>[0], actor: Person) => [
      // @ts-expect-error -- advance_set is no longer written
      logActivity(tx, actor, randomUUID(), set),
      // @ts-expect-error -- advance_changed is no longer written
      logActivity(tx, actor, randomUUID(), changed),
    ];
    expect(neverRun).toBeTypeOf("function");
  });

  it("recordTransaction logs transaction_recorded with the line and its receipt count", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id });

    const result = await recordTransaction(pic, {
      perjadinId: trip.id,
      spentOn: "2026-10-12",
      description: "Makan siang",
      amountIdr: 1_250_000,
      category: "Konsumsi",
      participantType: "Siswa",
      evidence: receipts(2),
    });
    if (result.outcome !== "recorded") throw new Error(result.outcome);

    const logged = await entries();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      actorPersonId: pic.id,
      perjadinId: trip.id,
      action: "transaction_recorded",
      details: {
        transactionId: result.transactionId,
        category: "Konsumsi",
        amountIdr: 1_250_000,
        participantType: "Siswa",
        spentOn: "2026-10-12",
        receiptCount: 2,
      },
      searchText: "catat transaksi · konsumsi · rp1.250.000 · siswa · tgl 2026-10-12 · 2 bukti",
    });
  });

  it("recordTransaction logs nothing for a sixth receipt or a non-Staff caller", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id });
    const line = {
      perjadinId: trip.id,
      spentOn: "2026-10-12",
      description: "Makan siang",
      amountIdr: 1_250_000,
      category: "Konsumsi" as const,
      participantType: "Siswa" as const,
    };

    const refused = await recordTransaction(pic, { ...line, evidence: receipts(6) });
    expect(refused.outcome).toBe("too-many-receipts");
    await expect(
      recordTransaction(nonStaff(), { ...line, evidence: receipts(1) }),
    ).rejects.toSatisfy(isNotStaffError);
    await expect(entries()).resolves.toEqual([]);
  });

  it("attachTransactionEvidence logs evidence_uploaded with the batch and the line's new total", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id });
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 1_250_000,
      category: "Konsumsi",
      spentOn: "2026-10-12",
      createdByPersonId: pic.id,
    });
    await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: pic.id });
    await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: pic.id });

    await expect(attachTransactionEvidence(pic, trip.id, line.id, receipts(1))).resolves.toEqual({
      outcome: "attached",
      count: 1,
    });

    const logged = await entries();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      actorPersonId: pic.id,
      perjadinId: trip.id,
      action: "evidence_uploaded",
      details: {
        transactionId: line.id,
        category: "Konsumsi",
        amountIdr: 1_250_000,
        spentOn: "2026-10-12",
        added: 1,
        total: 3,
      },
      searchText: "unggah bukti · konsumsi · rp1.250.000 · tgl 2026-10-12 · +1 bukti (kini 3/5)",
    });
  });

  it("attachTransactionEvidence logs nothing for a batch past five", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id });
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 1_250_000,
      createdByPersonId: pic.id,
    });
    await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: pic.id });

    const refused = await attachTransactionEvidence(pic, trip.id, line.id, receipts(5));
    expect(refused.outcome).toBe("too-many-receipts");
    await expect(entries()).resolves.toEqual([]);
  });

  it("filePerjadinReport logs report_filed with every category's lines and total", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id });
    // Akomodasi does not draw down the float (ADR-0029); the entry counts it anyway.
    for (const [category, amountIdr] of [
      ["Konsumsi", 1_250_000],
      ["Akomodasi", 3_400_000],
    ] as const) {
      const line = await addTransaction({
        perjadinId: trip.id,
        amountIdr,
        category,
        createdByPersonId: pic.id,
      });
      await addTransactionEvidence({ transactionId: line.id, uploadedByPersonId: pic.id });
    }

    const result = await filePerjadinReport(pic, trip.id);
    expect(result.outcome).toBe("filed");

    const logged = await entries();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      actorPersonId: pic.id,
      perjadinId: trip.id,
      action: "report_filed",
      details: { transactionCount: 2, totalIdr: 4_650_000 },
      searchText: "laporan dikirim · 2 transaksi · total rp4.650.000",
    });
  });

  it("filePerjadinReport logs nothing when a line has no receipt, or when filed already", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id });
    await addTransaction({ perjadinId: trip.id, amountIdr: 1_250_000, createdByPersonId: pic.id });

    const refused = await filePerjadinReport(pic, trip.id);
    expect(refused.outcome).toBe("evidence-missing");
    await expect(entries()).resolves.toEqual([]);

    const empty = await addPerjadin({ picPersonId: pic.id });
    expect((await filePerjadinReport(pic, empty.id)).outcome).toBe("filed");
    expect((await filePerjadinReport(pic, empty.id)).outcome).toBe("already-filed");
    const logged = await entries();
    expect(logged.map((entry) => [entry.perjadinId, entry.details])).toEqual([
      [empty.id, { transactionCount: 0, totalIdr: 0 }],
    ]);
  });

  it("keeps the email the actor had at the time, after it changes", async () => {
    const pic = await staff();
    const trip = await addPerjadin({ picPersonId: pic.id });
    await filePerjadinReport(pic, trip.id);

    await db
      .update(schema.person)
      .set({ email: "rina.baru@ditsama.itb.ac.id" })
      .where(eq(schema.person.id, pic.id));

    const [entry] = await entries();
    expect(entry?.actorEmail).toBe("rina@ditsama.itb.ac.id");
  });
});

describe("activityLogPage — /log's read", () => {
  beforeEach(resetDatabase);

  const NO_FILTERS: ActivityLogFilters = { q: "", aksi: null, dari: null, sampai: null, page: 1 };

  /** Two trips with different PICs, Kelompok and Schools, and an entry-writer for either. */
  async function twoTrips() {
    const admin = await administrator();
    const rina = await staff();
    const budi = await staff("budi@ditsama.itb.ac.id", "Budi Hartono");
    const samarinda = await addPerjadin({
      picPersonId: rina.id,
      subClusterName: "Kelompok 18",
      startsOn: "2026-10-12",
      endsOn: "2026-10-15",
    });
    const bandung = await addPerjadin({
      picPersonId: budi.id,
      subClusterName: "Kelompok 3",
    });
    await addSchoolOnTrip({ perjadin: samarinda, name: "SMAN 1 Bontang" });
    await addSchoolOnTrip({ perjadin: bandung, name: "SMAN 3 Bandung" });
    const log = (
      trip: { id: string },
      actor: { id: string; email: string },
      entry: ActivityLogEntry,
      occurredAt: string,
      backfilled = false,
    ) =>
      addActivityLogEntry({
        perjadinId: trip.id,
        actorPersonId: actor.id,
        actorEmail: actor.email,
        action: entry.action,
        details: entry.details,
        searchText: searchTextOf(entry, backfilled),
        occurredAt: new Date(occurredAt),
        backfilled,
      });
    return { admin, rina, budi, samarinda, bandung, log };
  }

  const advanceSet = (amountIdr: number): ActivityLogEntry => ({
    action: "advance_set",
    details: { amountIdr },
  });

  it("is Administrator only", async () => {
    const plain = await staff();
    await expect(activityLogPage(plain, NO_FILTERS)).rejects.toSatisfy(isNotGrantedError);
    await expect(activityLogPage(nonStaff(), NO_FILTERS)).rejects.toSatisfy(isNotGrantedError);
  });

  it("reads newest first, with the trip, its current PIC and the line's Drive folder", async () => {
    const { admin, rina, budi, samarinda, log } = await twoTrips();
    const line = await addTransaction({
      perjadinId: samarinda.id,
      amountIdr: 1_250_000,
      createdByPersonId: rina.id,
    });
    await db
      .update(schema.transaction)
      .set({ driveFolderId: "folder-1" })
      .where(eq(schema.transaction.id, line.id));
    await log(samarinda, rina, advanceSet(15_000_000), "2026-10-01T02:14:00Z");
    const recorded: ActivityLogEntry = {
      action: "transaction_recorded",
      details: {
        transactionId: line.id,
        category: "Konsumsi",
        amountIdr: 1_250_000,
        participantType: "Siswa",
        spentOn: "2026-10-12",
        receiptCount: 2,
      },
    };
    await log(samarinda, rina, recorded, "2026-10-13T14:40:00Z", true);
    // The PIC is joined live: hand the trip to Budi and the column follows. He joins the Group
    // first, since the PIC must be a member of it.
    await db.insert(schema.groupMember).values({
      perjadinId: samarinda.id,
      personId: budi.id,
      role: "Staff",
      stream: null,
    });
    await db
      .update(schema.perjadin)
      .set({ picPersonId: budi.id })
      .where(eq(schema.perjadin.id, samarinda.id));

    const page = await activityLogPage(admin, NO_FILTERS);

    expect(page).toMatchObject({ total: 2, page: 1, pageCount: 1 });
    expect(page.rows.map((row) => row.action)).toEqual(["transaction_recorded", "advance_set"]);
    expect(page.rows[0]).toMatchObject({
      actorEmail: "rina@ditsama.itb.ac.id",
      backfilled: true,
      details: recorded.details,
      driveFolderId: "folder-1",
      perjadin: {
        id: samarinda.id,
        subClusterName: "Kelompok 18",
        schoolNames: ["SMAN 1 Bontang"],
        startsOn: "2026-10-12",
        endsOn: "2026-10-15",
        picName: "Budi Hartono",
      },
    });
    expect(page.rows[1]?.driveFolderId).toBeNull();
  });

  it("pages 50 at a time, with the total count", async () => {
    const { admin, rina, samarinda, log } = await twoTrips();
    // One more than a page of 50.
    for (let i = 0; i < 51; i += 1) {
      const minute = String(i).padStart(2, "0");
      await log(samarinda, rina, advanceSet(1_000 + i), `2026-10-01T03:${minute}:00Z`);
    }

    const first = await activityLogPage(admin, NO_FILTERS);
    const second = await activityLogPage(admin, { ...NO_FILTERS, page: 2 });

    expect(first).toMatchObject({ total: 51, page: 1, pageCount: 2 });
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0]?.details).toEqual({ amountIdr: 1_050 });
    expect(second.rows.map((row) => row.details)).toEqual([{ amountIdr: 1_000 }]);

    // A page past the last is the last, so the footer and the rows agree.
    const beyond = await activityLogPage(admin, { ...NO_FILTERS, page: 9 });
    expect(beyond).toMatchObject({ total: 51, page: 2, pageCount: 2 });
    expect(beyond.rows).toHaveLength(1);
  });

  it("breaks a tie on the same instant by id, newest id first", async () => {
    const { admin, rina, samarinda, log } = await twoTrips();
    const a = await log(samarinda, rina, advanceSet(1), "2026-10-01T03:00:00Z");
    const b = await log(samarinda, rina, advanceSet(2), "2026-10-01T03:00:00Z");

    const page = await activityLogPage(admin, NO_FILTERS);
    expect(page.rows.map((row) => row.id)).toEqual([a.id, b.id].sort().reverse());
  });

  it("searches, case-insensitively and in SQL, the email, Kelompok, Schools, PIC and details", async () => {
    const { admin, rina, budi, samarinda, bandung, log } = await twoTrips();
    await log(samarinda, rina, advanceSet(15_000_000), "2026-10-01T02:00:00Z");
    await log(bandung, budi, advanceSet(5_000_000), "2026-10-02T02:00:00Z");
    await log(
      bandung,
      budi,
      { action: "report_filed", details: { transactionCount: 14, totalIdr: 16_420_000 } },
      "2026-10-03T02:00:00Z",
    );

    const search = async (q: string) =>
      (await activityLogPage(admin, { ...NO_FILTERS, q })).rows.map((row) => [
        row.perjadin.id,
        row.action,
      ]);

    // The actor's email.
    expect(await search("RINA@")).toEqual([[samarinda.id, "advance_set"]]);
    // The trip's Kelompok — its Sub-Cluster's name, the first half of its name (ADR-0044).
    expect(await search("kelompok 18")).toEqual([[samarinda.id, "advance_set"]]);
    // The trip's Schools, the School line under its name.
    expect(await search("bontang")).toEqual([[samarinda.id, "advance_set"]]);
    expect(await search("SMAN 3")).toEqual([
      [bandung.id, "report_filed"],
      [bandung.id, "advance_set"],
    ]);
    // The current PIC's name.
    expect(await search("Hartono")).toEqual([
      [bandung.id, "report_filed"],
      [bandung.id, "advance_set"],
    ]);
    // The rendered Aksi and Rincian.
    expect(await search("16.420.000")).toEqual([[bandung.id, "report_filed"]]);
    expect(await search("Laporan Dikirim")).toEqual([[bandung.id, "report_filed"]]);
    // `%` and `_` are matched literally, not as wildcards.
    expect(await search("%")).toEqual([]);
    expect(await search("_")).toEqual([]);
  });

  it("filters by Aksi group", async () => {
    const { admin, rina, samarinda } = await twoTrips();
    const each: [ActivityLogAction, Record<string, unknown>][] = [
      ["advance_set", { amountIdr: 1 }],
      ["advance_changed", { fromIdr: 1, toIdr: 2 }],
      ["transaction_recorded", {}],
      ["evidence_uploaded", {}],
      ["report_filed", { transactionCount: 0, totalIdr: 0 }],
      ["document_uploaded", { kind: "Daftar Hadir Pendamping", documentDate: "2026-10-13" }],
      ["document_deleted", { kind: "Daftar Hadir Pendamping", documentDate: "2026-10-13" }],
      ["evidence_deleted", {}],
      ["transaction_deleted", {}],
    ];
    for (const [i, [action, details]] of each.entries()) {
      await addActivityLogEntry({
        perjadinId: samarinda.id,
        actorPersonId: rina.id,
        actorEmail: rina.email,
        action,
        details,
        occurredAt: new Date(Date.UTC(2026, 9, 1, i)),
      });
    }

    const actions = async (aksi: ActivityLogFilters["aksi"]) =>
      (await activityLogPage(admin, { ...NO_FILTERS, aksi })).rows.map((row) => row.action).sort();

    expect(await actions("uang-perjalanan")).toEqual(["advance_changed", "advance_set"]);
    expect(await actions("catat-transaksi")).toEqual([
      "transaction_deleted",
      "transaction_recorded",
    ]);
    expect(await actions("unggah-bukti")).toEqual(["evidence_deleted", "evidence_uploaded"]);
    expect(await actions("dokumen")).toEqual(["document_deleted", "document_uploaded"]);
    expect(await actions("laporan")).toEqual(["report_filed"]);
    expect(await actions(null)).toHaveLength(9);
  });

  it("filters by an inclusive range of WIB calendar dates", async () => {
    const { admin, rina, samarinda, log } = await twoTrips();
    // WIB is UTC+7: 14 Oct WIB runs from 13 Oct 17:00 UTC to 14 Oct 17:00 UTC.
    await log(samarinda, rina, advanceSet(1), "2026-10-13T16:59:59Z"); // 13 Oct 23.59 WIB
    await log(samarinda, rina, advanceSet(2), "2026-10-13T17:00:00Z"); // 14 Oct 00.00 WIB
    await log(samarinda, rina, advanceSet(3), "2026-10-14T16:59:59Z"); // 14 Oct 23.59 WIB
    await log(samarinda, rina, advanceSet(4), "2026-10-14T17:00:00Z"); // 15 Oct 00.00 WIB

    const amounts = async (range: Pick<ActivityLogFilters, "dari" | "sampai">) =>
      (await activityLogPage(admin, { ...NO_FILTERS, ...range })).rows.map(
        (row) => (row.details as { amountIdr: number }).amountIdr,
      );

    expect(await amounts({ dari: "2026-10-14", sampai: "2026-10-14" })).toEqual([3, 2]);
    expect(await amounts({ dari: "2026-10-14", sampai: null })).toEqual([4, 3, 2]);
    expect(await amounts({ dari: null, sampai: "2026-10-14" })).toEqual([3, 2, 1]);
  });

  it("combines search, Aksi and dates with AND", async () => {
    const { admin, rina, budi, samarinda, bandung, log } = await twoTrips();
    await log(samarinda, rina, advanceSet(1), "2026-10-14T02:00:00Z");
    await log(bandung, budi, advanceSet(2), "2026-10-14T02:00:00Z");
    await log(
      samarinda,
      rina,
      { action: "report_filed", details: { transactionCount: 0, totalIdr: 0 } },
      "2026-10-14T03:00:00Z",
    );
    await log(samarinda, rina, advanceSet(3), "2026-10-20T02:00:00Z");

    const page = await activityLogPage(admin, {
      q: "rina",
      aksi: "uang-perjalanan",
      dari: "2026-10-14",
      sampai: "2026-10-14",
      page: 1,
    });
    expect(page.total).toBe(1);
    expect(page.rows.map((row) => row.details)).toEqual([{ amountIdr: 1 }]);
  });
});

describe("transaction_deleted, which Hapus transaksi will write (#463)", () => {
  it("reads as Transaksi dihapus, with the line as it was", () => {
    const entry = {
      action: "transaction_deleted",
      details: {
        transactionId: "00000000-0000-0000-0000-000000000001",
        category: "Konsumsi",
        amountIdr: 150_000,
        participantType: "Siswa",
        spentOn: "2026-10-13",
        description: "Makan siang",
        receiptCount: 2,
      },
    } as const;

    expect(activityLogAksi(entry.action, false)).toBe("Transaksi dihapus");
    expect(activityLogRincian(entry)).toBe(
      "Konsumsi · Rp150.000 · Siswa · tgl 2026-10-13 · Makan siang · 2 bukti",
    );
  });
});
