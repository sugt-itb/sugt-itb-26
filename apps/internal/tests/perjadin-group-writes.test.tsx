import { randomUUID } from "node:crypto";

import { markSessionDeliveredFromPendampingAction } from "-/app/(app)/actions";
import {
  addPerjadinSessionAction,
  addPerjadinTeacherAction,
  cancelPerjadinSessionAction,
  changePerjadinPicAction,
  editPerjadinSessionAction,
  removePerjadinTeacherAction,
  renamePerjadinTeacherAction,
  setPerjadinStaffAction,
  togglePreparationItemAction,
  updatePerjadinDatesAction,
} from "-/app/(app)/perjadin/[id]/actions";
import {
  deleteDocumentAction,
  openDocumentSessionAction,
  recordDocumentAction,
} from "-/app/(app)/perjadin/[id]/dokumen/actions";
import {
  deleteReceiptAction,
  deleteTransactionAction,
  finalizeReceiptsAction,
  openReceiptSessionsAction,
  recordTransactionAction,
} from "-/app/(app)/perjadin/[id]/laporan/actions";
import LaporanPage from "-/app/(app)/perjadin/[id]/laporan/page";
import PerjadinDetailPage from "-/app/(app)/perjadin/[id]/page";
import PerjadinPage from "-/app/(app)/perjadin/page";
import {
  cancelSessionAction,
  fileSessionRecordAction,
  markSessionDeliveredAction,
  moveSessionDateAction,
} from "-/app/(app)/sesi/[id]/actions";
import {
  deleteFootageAction,
  openFootageUploadAction,
  recordFootageAction,
} from "-/app/(app)/sesi/[id]/foto-video/actions";
import SesiPage from "-/app/(app)/sesi/[id]/page";
import { driveAccessToken } from "-/lib/drive/access-token";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import {
  addPerjadinSession,
  addPerjadinTeacher,
  attachTransactionEvidence,
  cancelSession,
  changePerjadinPic,
  checkDocumentFields,
  deletePerjadinDocument,
  deleteSessionFootage,
  deleteTransaction,
  editPerjadinSession,
  fileSessionRecord,
  footageSession,
  isNotOnPerjadinError,
  isNotStaffError,
  issuePerjadinFeedbackToken,
  markSessionDelivered,
  moveSessionDate,
  perjadinDetail,
  receiptsOnLine,
  recordPerjadinDocument,
  recordSessionFootage,
  recordTransaction,
  removePerjadinTeacher,
  renamePerjadinTeacher,
  setPerjadinStaff,
  togglePreparationItem,
  transactionDeleteTarget,
  updatePerjadinDates,
  type Person,
} from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addGrant,
  addGroupMember,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  addTransaction,
  addTransactionEvidence,
  resetDatabase,
} from "./support/fixtures";

/**
 * **A Perjadin is written by its Group; Perjadin Editor and Administrator write every Perjadin** (#439,
 * ADR-0048). The ticket's T3 table, on its own people and its own Perjadin A:
 * - every write on a trip and its offline Sessions, called by each of the seven — the PIC, a member,
 *   a Staff member off the trip with no Grant, one with Dashboard Viewer, a Perjadin Editor and an
 *   Administrator off the trip, and a Pimpinan — lands for the first two and the last-but-one two,
 *   and is refused with `NotOnPerjadinError` for the two non-members (`NotStaffError` for the
 *   Pimpinan, first, as before);
 * - each refusal is a 403 from its action, and the upload openers refuse before Drive is asked;
 * - the Evaluation link stays open, a member who leaves is refused next time, and the write controls
 *   are hidden from whoever may not write.
 *
 * Against the real database; only the signed-in Person, the router and the Drive token are stubbed.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("-/lib/drive/access-token", () => ({ driveAccessToken: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(driveAccessToken).mockReset();
  // What `experimental.authInterrupts` sets in a build, so `forbidden()` throws its 403 here too.
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function signedInAs(person: Person) {
  vi.mocked(requirePerson).mockResolvedValue(person as never);
}

/** The digest a call rejects with — `forbidden()`'s 403 — or `undefined` when it resolves. */
async function digestOf(call: Promise<unknown>) {
  const thrown = await call.then(
    () => null,
    (error: unknown) => error,
  );
  return (thrown as { digest?: string } | null)?.digest;
}

/** What a call throws, or `null` when it returns. */
async function refusalOf(call: () => Promise<unknown>) {
  return call().then(
    () => null,
    (error: unknown) => error,
  );
}

async function staffWith(grants: Grant[], fullName: string): Promise<Person> {
  const email = `${fullName.split(" ")[0]!.toLowerCase()}@itb.ac.id`;
  const person = await addPerson({ fullName, email, role: "Staff" });
  for (const grant of grants) await addGrant(person.id, grant);
  return { ...person, grants } as Person;
}

/** The ticket's people. Fajar is its Staff member with no Grant on no Perjadin. */
async function people() {
  return {
    rina: await staffWith([], "Rina Nurhayati"),
    andi: await staffWith([], "Andi Wijaya"),
    fajar: await staffWith([], "Fajar Pratama"),
    dewi: await staffWith(["Dashboard Viewer"], "Dewi Lestari"),
    budi: await staffWith(["Perjadin Editor"], "Budi Santoso"),
    sari: await staffWith(["Administrator"], "Sari Utami"),
    hadi: (await addPerson({
      fullName: "Pak Hadi",
      email: "hadi@itb.ac.id",
      role: "Pimpinan",
    })) as Person,
  };
}

type People = Awaited<ReturnType<typeof people>>;

/** Kelompok 10 and its two Schools, the ones Perjadin A visits. */
async function place() {
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "k10",
    name: "Kelompok 10",
    clusterId: cluster.id,
  });
  const school = (slug: string, name: string) =>
    addSchool({
      slug,
      name,
      clusterId: cluster.id,
      subClusterId: subCluster.id,
      provinceCode: "KT",
    });
  return {
    subCluster,
    bontang: await school("sman-1-bontang", "SMAN 1 Bontang"),
    samarinda: await school("sman-2-samarinda", "SMAN 2 Samarinda"),
  };
}

type Place = Awaited<ReturnType<typeof place>>;

/**
 * A distinct start time per trip, so the Sessions of every trip a test builds stay clear of each
 * other's School slots (ADR-0038).
 */
let slot = 0;
function nextTime() {
  slot += 1;
  return `${String(6 + Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}`;
}

/**
 * **Perjadin A**, "Kelompok 10 · 12–13 Okt 2026": Rina (PIC) and Andi in its Group, an arranged
 * Session at SMAN 1 Bontang and a delivered one at SMAN 2 Samarinda, a Narasumber, a line item with
 * its receipt, an attendance sheet and a photo — one of everything a write can touch.
 */
async function perjadinA(who: People, where: Place) {
  const trip = await addPerjadin({
    subClusterId: where.subCluster.id,
    picPersonId: who.rina.id,
    startsOn: "2026-10-12",
    endsOn: "2026-10-13",
  });
  await addGroupMember(trip.id, who.andi.id);
  const arranged = await addOfflineSession({
    perjadinId: trip.id,
    schoolId: where.bontang.id,
    heldOn: "2026-10-12",
    startsAt: nextTime(),
  });
  const delivered = await addOfflineSession({
    perjadinId: trip.id,
    schoolId: where.samarinda.id,
    heldOn: "2026-10-13",
    startsAt: nextTime(),
    status: "delivered",
  });
  const [teacher] = await db
    .insert(schema.perjadinTeacher)
    .values({ perjadinId: trip.id, name: "Dr. Bagus" })
    .returning();
  const line = await addTransaction({
    perjadinId: trip.id,
    amountIdr: 50_000,
    spentOn: "2026-10-12",
    createdByPersonId: who.rina.id,
  });
  const receipt = await addTransactionEvidence({
    transactionId: line.id,
    uploadedByPersonId: who.rina.id,
  });
  const documentId = randomUUID();
  await recordPerjadinDocument(who.rina, sheet(trip.id, documentId));
  const footageId = randomUUID();
  await recordSessionFootage(who.rina, footage(arranged.id, footageId));
  return {
    id: trip.id,
    arrangedId: arranged.id,
    deliveredId: delivered.id,
    teacherId: teacher!.id,
    transactionId: line.id,
    evidenceId: receipt.id,
    documentId,
    footageId,
  };
}

type PerjadinA = Awaited<ReturnType<typeof perjadinA>>;

function sheet(perjadinId: string, documentId = randomUUID()) {
  return {
    perjadinId,
    documentId,
    driveFileId: randomUUID(),
    byteSize: 2048,
    kind: "Daftar Hadir Pendamping" as const,
    documentDate: "2026-10-12",
  };
}

function footage(sessionId: string, footageId = randomUUID()) {
  return {
    footageId,
    sessionId,
    contentType: "image/jpeg" as const,
    originalFilename: "kelas.jpg",
    driveFileId: randomUUID(),
    byteSize: 4096,
  };
}

const receipt = () => [
  { driveFileId: randomUUID(), contentType: "image/jpeg" as const, byteSize: 120_000 },
];

/**
 * **Every write in the ticket's §2**, called as `caller` on a fresh Perjadin A, with the outcome it
 * lands with when the caller may write.
 */
/** Ubah tanggal on trip `perjadinId` — any write a member may make will do. */
const moveDates = (caller: Person, perjadinId: string) =>
  updatePerjadinDates(caller, perjadinId, { startsOn: "2026-10-12", endsOn: "2026-10-14" });

const WRITES: [
  string,
  (caller: Person, a: PerjadinA, who: People, where: Place) => Promise<unknown>,
  unknown,
][] = [
  [
    "Ubah tanggal",
    (c, a) => updatePerjadinDates(c, a.id, { startsOn: "2026-10-12", endsOn: "2026-10-14" }),
    "updated",
  ],
  ["Group Staff", (c, a, who) => setPerjadinStaff(c, a.id, [who.andi.id]), "set"],
  ["Change PIC", (c, a, who) => changePerjadinPic(c, a.id, who.andi.id), "changed"],
  [
    "Session Pimpinan",
    (c, a, who, where) =>
      editPerjadinSession(c, a.arrangedId, {
        schoolId: where.bontang.id,
        heldOn: "2026-10-12",
        startsAt: nextTime(),
        taughtByTeacherIds: [],
        pimpinanPersonIds: [who.hadi.id],
      }),
    "edited",
  ],
  ["Narasumber add", (c, a) => addPerjadinTeacher(c, a.id, "Dr. Sari"), "added"],
  ["Narasumber rename", (c, a) => renamePerjadinTeacher(c, a.teacherId, "Dr. Bagus P."), "renamed"],
  ["Narasumber remove", (c, a) => removePerjadinTeacher(c, a.teacherId), "removed"],
  [
    "offline Session add",
    (c, a, _who, where) =>
      addPerjadinSession(c, a.id, {
        schoolId: where.bontang.id,
        heldOn: "2026-10-13",
        startsAt: nextTime(),
        taughtByTeacherIds: [],
        pimpinanPersonIds: [],
      }),
    "added",
  ],
  [
    "offline Session edit",
    (c, a, _who, where) =>
      editPerjadinSession(c, a.arrangedId, {
        schoolId: where.bontang.id,
        heldOn: "2026-10-12",
        startsAt: nextTime(),
        taughtByTeacherIds: [a.teacherId],
        pimpinanPersonIds: [],
      }),
    "edited",
  ],
  [
    "offline Session cancel",
    (c, a) => cancelSession(c, a.arrangedId, "Sekolah libur"),
    "cancelled",
  ],
  ["Tandai", (c, a) => markSessionDelivered(c, a.arrangedId), "delivered"],
  ["move date", (c, a) => moveSessionDate(c, a.arrangedId, "2026-10-13", nextTime()), "moved"],
  [
    "Session Record",
    (c, a) =>
      fileSessionRecord(c, {
        sessionId: a.deliveredId,
        ratings: { facilities: 9, turnout: 9, school_support: 9, timing: 9, coordination: 9 },
        problems: null,
        suggestions: null,
      }),
    "filed",
  ],
  [
    "Persiapan tick",
    async (c, a, who) => {
      const [item] = (await perjadinDetail(who.rina, a.id))!.preparation;
      return togglePreparationItem(c, { perjadinId: a.id, itemId: item!.itemId, checked: true });
    },
    "toggled",
  ],
  [
    "Catat transaksi",
    (c, a) =>
      recordTransaction(c, {
        perjadinId: a.id,
        spentOn: "2026-10-12",
        description: "Taksi",
        amountIdr: 75_000,
        category: "Transport Lokal Dalam Provinsi",
        participantType: "Siswa",
        evidence: receipt(),
      }),
    "recorded",
  ],
  [
    "Unggah bukti",
    (c, a) => attachTransactionEvidence(c, a.id, a.transactionId, receipt()),
    "attached",
  ],
  ["Unggah bukti's early count", (c, a) => receiptsOnLine(c, a.id, a.transactionId), undefined],
  [
    "Hapus transaksi's early read",
    (c, a) => transactionDeleteTarget(c, a.transactionId),
    undefined,
  ],
  ["Hapus transaksi", (c, a) => deleteTransaction(c, a.transactionId), "deleted"],
  [
    "Dokumen check",
    (c, a) =>
      checkDocumentFields(c, a.id, { kind: "Daftar Hadir Pendamping", documentDate: "2026-10-12" }),
    "ok",
  ],
  ["Dokumen record", (c, a) => recordPerjadinDocument(c, sheet(a.id)), "recorded"],
  ["Dokumen Hapus", (c, a) => deletePerjadinDocument(c, a.documentId), "deleted"],
  ["Foto & Video open", (c, a) => footageSession(c, a.arrangedId), "ok"],
  ["Foto & Video record", (c, a) => recordSessionFootage(c, footage(a.arrangedId)), "recorded"],
  ["Foto & Video Hapus", (c, a) => deleteSessionFootage(c, a.footageId), "deleted"],
];

describe("every write on Perjadin A, by each of the ticket's people", () => {
  it.each(WRITES)("%s", async (_name, write, landed) => {
    const who = await people();
    const where = await place();
    const outcome = async (caller: Person) => {
      const a = await perjadinA(who, where);
      return write(caller, a, who, where).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
    };
    const lands = async (caller: Person) => {
      const answer = await outcome(caller);
      expect(answer).not.toHaveProperty("error");
      if (landed !== undefined) {
        expect((answer as { result: { outcome: string } }).result.outcome).toBe(landed);
      }
    };

    // The PIC and a member who is not PIC; a Perjadin Editor and an Administrator off the trip.
    await lands(who.rina);
    await lands(who.andi);
    await lands(who.budi);
    await lands(who.sari);
    // Off the trip without the Perjadin Editor Grant: no Grant, or Dashboard Viewer only.
    for (const outsider of [who.fajar, who.dewi]) {
      const answer = await outcome(outsider);
      expect(isNotOnPerjadinError((answer as { error?: unknown }).error)).toBe(true);
    }
    // A Pimpinan writes nothing, Group or not — refused as non-Staff first.
    expect(isNotStaffError(((await outcome(who.hadi)) as { error?: unknown }).error)).toBe(true);
  });
});

describe("what stays open, and what follows the Group", () => {
  it("issues the Evaluation link for everyone signed in, a Pimpinan included", async () => {
    const who = await people();
    const a = await perjadinA(who, await place());

    for (const caller of Object.values(who)) {
      await expect(issuePerjadinFeedbackToken(caller, a.id)).resolves.toHaveProperty("token");
    }
  });

  it("refuses a member on their next write once they leave the Group", async () => {
    const who = await people();
    const a = await perjadinA(who, await place());

    await expect(setPerjadinStaff(who.andi, a.id, [])).resolves.toEqual({ outcome: "set" });

    const refusal = await refusalOf(() => moveDates(who.andi, a.id));
    expect(isNotOnPerjadinError(refusal)).toBe(true);
  });

  it("lets Dewi write A, and only A, once a Perjadin Editor adds her to its Group", async () => {
    const who = await people();
    const where = await place();
    const a = await perjadinA(who, where);
    const b = await perjadinA(who, where);

    await setPerjadinStaff(who.budi, a.id, [who.andi.id, who.dewi.id]);

    await expect(moveDates(who.dewi, a.id)).resolves.toMatchObject({ outcome: "updated" });
    expect(isNotOnPerjadinError(await refusalOf(() => moveDates(who.dewi, b.id)))).toBe(true);
  });

  it("still answers a stale Perjadin id as a value, not a refusal", async () => {
    const who = await people();

    await expect(moveDates(who.fajar, "00000000-0000-4000-8000-000000000000")).resolves.toEqual({
      outcome: "no-such-perjadin",
    });
  });
});

describe("the actions answer a non-member with a 403", () => {
  it("on the trip's writes and its Sessions', /pendamping's Tandai included", async () => {
    const who = await people();
    const a = await perjadinA(who, await place());
    signedInAs(who.dewi);

    await expect(
      digestOf(updatePerjadinDatesAction(a.id, { startsOn: "2026-10-12", endsOn: "2026-10-14" })),
    ).resolves.toBe(FORBIDDEN);
    await expect(digestOf(togglePreparationItemAction(a.id, randomUUID(), true))).resolves.toBe(
      FORBIDDEN,
    );
    await expect(digestOf(markSessionDeliveredAction(a.arrangedId))).resolves.toBe(FORBIDDEN);
    await expect(digestOf(markSessionDeliveredFromPendampingAction(a.arrangedId))).resolves.toBe(
      FORBIDDEN,
    );
  });

  it("on every other write in the ticket's table, each action of its own", async () => {
    const who = await people();
    const where = await place();
    const a = await perjadinA(who, where);
    signedInAs(who.fajar);
    const session = {
      schoolId: where.bontang.id,
      heldOn: "2026-10-13",
      startsAt: nextTime(),
      taughtByTeacherIds: [],
      pimpinanPersonIds: [],
    };

    const calls: [string, () => Promise<unknown>][] = [
      ["Group Staff", () => setPerjadinStaffAction(a.id, [])],
      ["Change PIC", () => changePerjadinPicAction(a.id, who.andi.id)],
      [
        "Session Pimpinan",
        () =>
          editPerjadinSessionAction(a.id, a.arrangedId, {
            ...session,
            pimpinanPersonIds: [who.hadi.id],
          }),
      ],
      ["Narasumber add", () => addPerjadinTeacherAction(a.id, "Dr. Sari")],
      ["Narasumber rename", () => renamePerjadinTeacherAction(a.id, a.teacherId, "Dr. Baru")],
      ["Narasumber remove", () => removePerjadinTeacherAction(a.id, a.teacherId)],
      ["Session add", () => addPerjadinSessionAction(a.id, session)],
      ["Session edit", () => editPerjadinSessionAction(a.id, a.arrangedId, session)],
      ["Session cancel", () => cancelPerjadinSessionAction(a.id, a.arrangedId, "Libur")],
      ["/sesi cancel", () => cancelSessionAction(a.arrangedId, "Libur")],
      ["/sesi move", () => moveSessionDateAction(a.arrangedId, "2026-10-13", nextTime())],
      [
        "Session Record",
        () =>
          fileSessionRecordAction({
            sessionId: a.deliveredId,
            ratings: { facilities: 9, turnout: 9, school_support: 9, timing: 9, coordination: 9 },
            problems: null,
            suggestions: null,
          }),
      ],
      ["Catat transaksi", () => recordTransactionAction({ perjadinId: a.id } as never)],
      ["Unggah bukti", () => finalizeReceiptsAction(a.id, a.transactionId, [])],
      ["Dokumen record", () => recordDocumentAction({ perjadinId: a.id } as never)],
      ["Foto & Video record", () => recordFootageAction({ sessionId: a.arrangedId } as never)],
    ];

    for (const [name, call] of calls) {
      expect([name, await digestOf(call())]).toEqual([name, FORBIDDEN]);
    }
    expect(driveAccessToken).not.toHaveBeenCalled();
  });

  it("before Drive is asked anything, on every upload opener and every Hapus", async () => {
    const who = await people();
    const a = await perjadinA(who, await place());
    signedInAs(who.fajar);

    await expect(
      digestOf(
        openReceiptSessionsAction(a.id, [{ contentType: "image/jpeg", size: 1_000 }] as never),
      ),
    ).resolves.toBe(FORBIDDEN);
    await expect(
      digestOf(
        openDocumentSessionAction(
          a.id,
          { contentType: "application/pdf", size: 1_000 },
          { kind: "Daftar Hadir Pendamping", documentDate: "2026-10-12" },
        ),
      ),
    ).resolves.toBe(FORBIDDEN);
    await expect(
      digestOf(
        openFootageUploadAction(a.arrangedId, { contentType: "image/jpeg", size: 1_000 } as never),
      ),
    ).resolves.toBe(FORBIDDEN);
    await expect(digestOf(deleteDocumentAction(a.documentId))).resolves.toBe(FORBIDDEN);
    await expect(digestOf(deleteFootageAction(a.footageId))).resolves.toBe(FORBIDDEN);
    await expect(digestOf(deleteReceiptAction(a.evidenceId))).resolves.toBe(FORBIDDEN);
    await expect(digestOf(deleteTransactionAction(a.transactionId))).resolves.toBe(FORBIDDEN);

    expect(driveAccessToken).not.toHaveBeenCalled();
  });
});

describe("the write controls follow who writes the trip", () => {
  const WRITE_CONTROLS = ["Ubah tanggal", "Ubah Group", "Tambah Sesi"];

  it("hides Perjadin A's controls from a non-member and shows them to a member and a Perjadin Editor", async () => {
    const who = await people();
    const a = await perjadinA(who, await place());
    const render = async (viewer: Person) => {
      signedInAs(viewer);
      return renderToStaticMarkup(
        await PerjadinDetailPage({ params: Promise.resolve({ id: a.id }) } as never),
      );
    };

    const forDewi = await render(who.dewi);
    for (const control of WRITE_CONTROLS) expect(forDewi).not.toContain(control);
    // She still reads all of it, and may still share the Evaluation link.
    expect(forDewi).toContain("Kelompok 10");
    expect(forDewi).toContain("SMAN 1 Bontang");
    expect(forDewi).toContain("Evaluasi Perjadin");

    for (const writer of [who.andi, who.budi, who.sari]) {
      const html = await render(writer);
      for (const control of WRITE_CONTROLS) expect(html).toContain(control);
    }
  });

  it("hides Catat transaksi and Unggah bukti on the Laporan from a non-member", async () => {
    const who = await people();
    const a = await perjadinA(who, await place());
    const render = async (viewer: Person) => {
      signedInAs(viewer);
      return renderToStaticMarkup(
        await LaporanPage({ params: Promise.resolve({ id: a.id }) } as never),
      );
    };

    const forFajar = await render(who.fajar);
    for (const control of ["Catat transaksi", "Unggah bukti"]) {
      expect(forFajar).not.toContain(control);
    }
    // The receipts stay readable.
    expect(forFajar).toContain("Bukti 1");

    const forRina = await render(who.rina);
    for (const control of ["Catat transaksi", "Unggah bukti"]) {
      expect(forRina).toContain(control);
    }
  });

  it("shows nobody a deadline, Laporkan or Dilaporkan, on the Laporan or the trip (#489)", async () => {
    const who = await people();
    const a = await perjadinA(who, await place());
    const render = async (viewer: Person) => {
      signedInAs(viewer);
      const params = { params: Promise.resolve({ id: a.id }) } as never;
      return (
        renderToStaticMarkup(await LaporanPage(params)) +
        renderToStaticMarkup(await PerjadinDetailPage(params))
      );
    };

    for (const viewer of [who.rina, who.sari, who.fajar]) {
      const html = await render(viewer);
      expect(html).toContain("Uang Perjalanan Terpakai");
      for (const gone of ["Laporkan", "Dilaporkan", "atuh tempo", "terlambat"]) {
        expect(html, `${viewer.email}: ${gone}`).not.toContain(gone);
      }
      expect(html).not.toMatch(/sisa \d+ hari/);
    }
  });

  it("hides /sesi/[id]'s Tandai and Foto & Video upload from a non-member", async () => {
    const who = await people();
    const a = await perjadinA(who, await place());
    const render = async (viewer: Person) => {
      signedInAs(viewer);
      return renderToStaticMarkup(
        await SesiPage({ params: Promise.resolve({ id: a.arrangedId }) } as never),
      );
    };

    const forDewi = await render(who.dewi);
    expect(forDewi).not.toContain("Tandai terlaksana");
    expect(forDewi).not.toContain("Unggah Foto");
    expect(forDewi).toContain("kelas.jpg");

    for (const writer of [who.andi, who.budi]) {
      expect(await render(writer)).toContain("Tandai terlaksana");
    }
  });

  it("opens the Persiapan checklist from a /perjadin row only on a trip the viewer writes", async () => {
    const who = await people();
    const where = await place();
    await perjadinA(who, where);
    // Perjadin B: Fajar's alone.
    await addPerjadin({
      subClusterId: where.subCluster.id,
      picPersonId: who.fajar.id,
      startsOn: "2026-11-09",
      endsOn: "2026-11-10",
    });
    const render = async (viewer: Person) => {
      signedInAs(viewer);
      return renderToStaticMarkup(await PerjadinPage());
    };
    const toggles = (html: string) => [...html.matchAll(/aria-label="Persiapan /g)].length;

    expect(toggles(await render(who.andi))).toBe(1);
    expect(toggles(await render(who.fajar))).toBe(1);
    expect(toggles(await render(who.dewi))).toBe(0);
    expect(toggles(await render(who.budi))).toBe(2);
    expect(toggles(await render(who.hadi))).toBe(0);
  });
});
