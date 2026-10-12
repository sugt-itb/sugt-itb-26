import {
  participantFeedbackCsv,
  participantFeedbackCsvFileName,
  perjadinFeedbackCsv,
  perjadinFeedbackCsvFileName,
} from "-/app/(app)/feedback/ekspor/feedback-csv";
import {
  parseParticipantExportParams,
  parsePerjadinExportParams,
  participantExportHref,
  perjadinExportHref,
} from "-/app/(app)/feedback/feedback-params";
import type {
  FeedbackPerjadinOption,
  FeedbackSchoolOption,
  ParticipantFeedbackRow,
  PerjadinFeedbackRow,
} from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

import { parseCsv as parse } from "./support/csv";

/**
 * **`/feedback`'s two exports, with no database and no HTTP** (#490): the link round-trips each
 * tab's choices and falls back on anything malformed, each file is exactly its columns, a Rating
 * not given is an empty cell, and free text with commas, quotes and line breaks survives.
 */

const SCHOOL = "11111111-2222-4333-8444-555555555555";
const SESSION = "22222222-3333-4444-8555-666666666666";
const TRIP = "33333333-4444-4555-8666-777777777777";

function participantRow(overrides: Partial<ParticipantFeedbackRow> = {}): ParticipantFeedbackRow {
  return {
    id: "row-1",
    name: "Siti",
    classKind: "Student",
    schoolId: SCHOOL,
    schoolName: "SMAN 1 Bontang",
    sessionId: SESSION,
    sessionMode: "offline",
    sesi: 2,
    heldOn: "2026-10-12",
    startsAt: "09:00:00",
    timeZone: "WITA",
    handsOnRbl: 6,
    materials: 8,
    instructor: 9,
    relevance: 7,
    rowAverage: 7.5,
    handsOnRblComment: null,
    materialsComment: null,
    instructorComment: null,
    relevanceComment: null,
    knowledgeGain: null,
    suggestions: null,
    submittedOn: "2026-10-13",
    submittedAt: new Date("2026-10-13T02:00:00Z"),
    ...overrides,
  };
}

function perjadinRow(overrides: Partial<PerjadinFeedbackRow> = {}): PerjadinFeedbackRow {
  return {
    id: "eval-1",
    filedByName: "Dr. Sari",
    filedByRole: "Narasumber",
    subClusterName: "Kelompok 10",
    perjadinId: TRIP,
    startsOn: "2026-10-12",
    endsOn: "2026-10-13",
    createdOn: "2026-10-14",
    lodging: 8,
    transport: 7,
    meals: 9,
    punctuality: 6,
    pendampingSupport: 10,
    rowAverage: 8,
    lodgingComment: null,
    transportComment: null,
    mealsComment: null,
    punctualityComment: null,
    pendampingSupportComment: null,
    ...overrides,
  };
}

describe("the export link", () => {
  it("round-trips the Peserta tab's scope, filters and sort, carrying only what is not the default", () => {
    const view = {
      scope: { schoolId: SCHOOL, sessionId: SESSION, participantType: "GTK-MS" as const },
      filters: {
        reviewType: "le7" as const,
        instructor: "all" as const,
        materials: "gt7" as const,
        relevance: "all" as const,
        handsOnRbl: "le7" as const,
      },
      sort: { score: "desc" as const, date: "asc" as const },
    };
    const href = participantExportHref(view);

    expect(href).toBe(
      `/feedback/ekspor/peserta?sekolah=${SCHOOL}&sesi=${SESSION}&tipe=GTK-MS&ulasan=le7&materi=gt7&rbl=le7&nilai=desc&tanggal=asc`,
    );
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseParticipantExportParams(params)).toEqual(view);
    expect(participantExportHref(parseParticipantExportParams({}))).toBe(
      "/feedback/ekspor/peserta",
    );
  });

  it("round-trips the Perjadin tab's", () => {
    const view = {
      scope: { perjadinId: TRIP, role: "Pimpinan" as const },
      filters: {
        reviewType: "all" as const,
        lodging: "le7" as const,
        transport: "all" as const,
        meals: "all" as const,
        punctuality: "gt7" as const,
        pendampingSupport: "le7" as const,
      },
      sort: { score: "asc" as const, date: "desc" as const },
    };
    const href = perjadinExportHref(view);

    expect(href).toBe(
      `/feedback/ekspor/perjadin?perjadin=${TRIP}&peran=Pimpinan&penginapan=le7&ketepatan=gt7&pendamping=le7`,
    );
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parsePerjadinExportParams(params)).toEqual(view);
    expect(perjadinExportHref(parsePerjadinExportParams({}))).toBe("/feedback/ekspor/perjadin");
  });

  it("falls back to the defaults on anything malformed", () => {
    expect(
      parseParticipantExportParams({
        sekolah: "not-a-uuid",
        sesi: SESSION,
        tipe: "Guru",
        ulasan: "lt3",
        rbl: ["gt7", "le7"],
        nilai: "sideways",
        tanggal: "",
      }),
    ).toEqual({
      scope: { schoolId: null, sessionId: null, participantType: null },
      filters: {
        reviewType: "all",
        instructor: "all",
        materials: "all",
        relevance: "all",
        handsOnRbl: "gt7",
      },
      sort: { score: "asc", date: "desc" },
    });
    expect(parsePerjadinExportParams({ perjadin: "x", peran: "Guru", konsumsi: "7" })).toEqual({
      scope: { perjadinId: null, role: null },
      filters: {
        reviewType: "all",
        lodging: "all",
        transport: "all",
        meals: "all",
        punctuality: "all",
        pendampingSupport: "all",
      },
      sort: { score: "asc", date: "desc" },
    });
  });
});

describe("the Peserta file", () => {
  it("carries the listed columns, a Rating not given as an empty cell, never 0", () => {
    const rows = parse(
      participantFeedbackCsv([
        participantRow(),
        participantRow({ id: "row-2", classKind: "GTK", handsOnRbl: null, rowAverage: 8 }),
      ]),
    );

    expect(rows[0]).toEqual([
      "Tanggal",
      "Sekolah",
      "Sesi",
      "Tipe Peserta",
      "Nama",
      "Materi",
      "Komentar Materi",
      "Narasumber",
      "Komentar Narasumber",
      "Relevansi",
      "Komentar Relevansi",
      "Hands-on RBL",
      "Komentar Hands-on RBL",
      "Peningkatan pengetahuan",
      "Saran dan masukan",
      "Rata-rata",
    ]);
    expect(rows[1]).toEqual([
      "2026-10-13",
      "SMAN 1 Bontang",
      "Sesi 2 · Luring · 12 Okt 2026 · 09.00 WITA",
      "Siswa",
      "Siti",
      "8",
      "",
      "9",
      "",
      "7",
      "",
      "6",
      "",
      "",
      "",
      "7.5",
    ]);
    expect(rows[2]![3]).toBe("GTK");
    expect(rows[2]![11]).toBe("");
    expect(rows).toHaveLength(3);
  });

  it("keeps commas, quotes and line breaks in free text, and rounds the average as the card does", () => {
    const comment = 'Bagus, tapi "terlalu cepat".\r\nUlangi lagi\nya';
    const rows = parse(
      participantFeedbackCsv([
        participantRow({
          name: "=Budi, S.Pd",
          materialsComment: comment,
          knowledgeGain: "Ya,\nsangat",
          suggestions: '"Tambah waktu"',
          rowAverage: 22 / 3,
        }),
      ]),
    );

    expect(rows[1]![4]).toBe("'=Budi, S.Pd");
    expect(rows[1]![6]).toBe(comment);
    expect(rows[1]![13]).toBe("Ya,\nsangat");
    expect(rows[1]![14]).toBe('"Tambah waktu"');
    expect(rows[1]![15]).toBe("7.3");
  });
});

describe("the Perjadin file", () => {
  it("carries the listed columns, the trip's name, and empty cells for a missing Penginapan or Bantuan Pendamping", () => {
    const rows = parse(
      perjadinFeedbackCsv([
        perjadinRow({ transportComment: 'Mobil, "AC" mati' }),
        perjadinRow({
          id: "eval-2",
          filedByRole: "Pendamping",
          lodging: null,
          pendampingSupport: null,
          rowAverage: 22 / 3,
        }),
      ]),
    );

    expect(rows[0]).toEqual([
      "Tanggal",
      "Perjadin",
      "Peran",
      "Nama",
      "Penginapan",
      "Komentar Penginapan",
      "Transportasi",
      "Komentar Transportasi",
      "Konsumsi",
      "Komentar Konsumsi",
      "Ketepatan Waktu",
      "Komentar Ketepatan Waktu",
      "Bantuan Pendamping",
      "Komentar Bantuan Pendamping",
      "Rata-rata",
    ]);
    expect(rows[1]).toEqual([
      "2026-10-14",
      "Kelompok 10 · 12–13 Okt 2026",
      "Narasumber",
      "Dr. Sari",
      "8",
      "",
      "7",
      'Mobil, "AC" mati',
      "9",
      "",
      "6",
      "",
      "10",
      "",
      "8",
    ]);
    expect([rows[2]![4], rows[2]![12], rows[2]![14]]).toEqual(["", "", "7.3"]);
  });
});

describe("the file names", () => {
  const schools: FeedbackSchoolOption[] = [
    {
      id: SCHOOL,
      name: "SMAN 1 Bontang",
      kabupatenKota: "Kota Bontang",
      sessions: [
        {
          id: SESSION,
          mode: "offline",
          sesi: 2,
          heldOn: "2026-10-12",
          startsAt: "09:00:00",
          timeZone: "WITA",
        },
      ],
    },
  ];
  const trips: FeedbackPerjadinOption[] = [
    {
      id: TRIP,
      subClusterName: "Kelompok 10",
      startsOn: "2026-10-12",
      endsOn: "2026-10-13",
      schoolNames: [],
    },
  ];
  const peserta = (query: Record<string, string>) =>
    participantFeedbackCsvFileName(parseParticipantExportParams(query), schools, "2026-10-13");
  const perjadin = (query: Record<string, string>) =>
    perjadinFeedbackCsvFileName(parsePerjadinExportParams(query), trips, "2026-10-13");

  it("say what the scope covers, and tersaring when a score filter is on", () => {
    expect(peserta({})).toBe("feedback-peserta-semua-2026-10-13.csv");
    expect(peserta({ ulasan: "le7" })).toBe("feedback-peserta-tersaring-2026-10-13.csv");
    expect(peserta({ sekolah: SCHOOL, sesi: SESSION, tipe: "Siswa", materi: "gt7" })).toBe(
      "feedback-peserta-sman-1-bontang-sesi-2-luring-siswa-tersaring-2026-10-13.csv",
    );
    expect(perjadin({})).toBe("feedback-perjadin-semua-2026-10-13.csv");
    expect(perjadin({ perjadin: TRIP, peran: "Pendamping" })).toBe(
      "feedback-perjadin-kelompok-10-12-13-okt-2026-pendamping-2026-10-13.csv",
    );
  });

  it("say tanpa-masukan for a School or trip with no responses", () => {
    const other = "99999999-2222-4333-8444-555555555555";
    expect(peserta({ sekolah: other, tipe: "Siswa" })).toBe(
      "feedback-peserta-tanpa-masukan-2026-10-13.csv",
    );
    expect(peserta({ sekolah: SCHOOL, sesi: other })).toBe(
      "feedback-peserta-tanpa-masukan-2026-10-13.csv",
    );
    expect(perjadin({ perjadin: other, ketepatan: "le7" })).toBe(
      "feedback-perjadin-tanpa-masukan-tersaring-2026-10-13.csv",
    );
  });
});
