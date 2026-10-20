import { participantScopeLabel, perjadinScopeLabel, withSchool } from "-/components/feedback-scope";
import { FeedbackView } from "-/components/feedback-view";
import { sesiLabel, sesiShortLabel } from "-/components/session-labels";
import type {
  FeedbackPerjadinOption,
  FeedbackSchoolOption,
  ParticipantFeedbackRow,
} from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **The Peserta tab's scope, rendered** (#466): the Sekolah picker and a Sesi select disabled until a
 * School is picked, the Tipe Peserta select (#487), the "Sesi n" line each response card carries —
 * the same line the Sesi picker offers — and the averages' titles, programme-wide on the first paint.
 */

vi.mock("-/app/(app)/feedback/actions", () => ({
  loadParticipantFeedback: vi.fn(),
  loadParticipantFeedbackAverages: vi.fn(),
  loadParticipantFeedbackCharts: vi.fn(),
  loadPerjadinFeedback: vi.fn(),
  loadPerjadinFeedbackAverages: vi.fn(),
}));

const row = (over: Partial<ParticipantFeedbackRow>): ParticipantFeedbackRow => ({
  id: "row",
  name: "Rani",
  classKind: "GTK",
  schoolId: "bontang",
  schoolName: "SMAN 1 Bontang",
  sessionId: "sesi-1",
  sessionMode: "offline",
  sesi: 1,
  heldOn: "2026-10-12",
  startsAt: "08:00:00",
  timeZone: "WITA",
  handsOnRbl: null,
  materials: 9,
  instructor: 9,
  relevance: 9,
  rowAverage: 9,
  handsOnRblComment: null,
  materialsComment: null,
  instructorComment: null,
  relevanceComment: null,
  knowledgeGain: null,
  suggestions: null,
  submittedOn: "2026-10-12",
  submittedAt: new Date("2026-10-12T04:00:00Z"),
  ...over,
});

const schools: FeedbackSchoolOption[] = [
  {
    id: "bontang",
    name: "SMAN 1 Bontang",
    kabupatenKota: "Kota Bontang",
    sessions: [
      {
        id: "sesi-1",
        mode: "offline",
        sesi: 1,
        heldOn: "2026-10-12",
        startsAt: "08:00:00",
        timeZone: "WITA",
      },
    ],
  },
];

function render(rows: ParticipantFeedbackRow[]) {
  return renderToStaticMarkup(
    <FeedbackView
      participantInitialRows={rows}
      participantInitialCursor={null}
      participantAverages={{ handsOnRbl: null, instructor: 8, materials: 8, relevance: 8 }}
      participantSchools={schools}
      perjadinInitialRows={[]}
      perjadinInitialCursor={null}
      perjadinAverages={{
        lodging: 0,
        transport: 0,
        meals: 0,
        punctuality: 0,
        pendampingSupport: null,
      }}
      perjadinTrips={[]}
    />,
  );
}

describe("the Sesi line", () => {
  it("reads Sesi n · mode · date · time zone, and Dibatalkan for a cancelled Session", () => {
    const sesi = { sesi: 3, mode: "offline", heldOn: "2026-10-16", startsAt: "09:00:00" } as const;

    expect(sesiLabel({ ...sesi, timeZone: "WITA" })).toBe(
      "Sesi 3 · Luring · 16 Okt 2026 · 09.00 WITA",
    );
    expect(sesiLabel({ ...sesi, sesi: null, timeZone: "WITA" })).toBe(
      "Dibatalkan · Luring · 16 Okt 2026 · 09.00 WITA",
    );
    expect(sesiShortLabel({ ...sesi, timeZone: "WITA" })).toBe("Sesi 3 Luring");
    expect(sesiShortLabel({ ...sesi, sesi: null, timeZone: "WITA" })).toBe(
      "Luring 16 Okt 2026 (dibatalkan)",
    );
  });
});

describe("the Peserta tab's scope", () => {
  it("offers Semua Sekolah, and a Semua Sesi select disabled until a School is picked", () => {
    const html = render([]);

    expect(html).toMatch(
      /aria-label="Sekolah"[^>]*placeholder="Semua Sekolah"|placeholder="Semua Sekolah"[^>]*aria-label="Sekolah"/,
    );
    const sesi = /<button[^>]*aria-label="Sesi"[^>]*>/.exec(html)?.[0] ?? "";
    expect(sesi).toMatch(/disabled/);
    expect(html).toContain("Semua Sesi");
  });

  it("offers a Tipe Peserta select, at Semua Tipe Peserta (#487)", () => {
    const html = render([]);

    const tipe =
      /<button[^>]*aria-label="Tipe Peserta"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(tipe).toContain("Semua Tipe Peserta");
    expect(tipe).not.toMatch(/disabled=""/);
  });

  it("labels each card with its Sesi, online in WIB, linking to the Session", () => {
    const html = render([
      row({}),
      row({
        id: "daring",
        name: "Budi",
        sessionId: "daring-1",
        sessionMode: "online",
        sesi: 1,
        heldOn: "2026-10-20",
        startsAt: "10:00:00",
        timeZone: "WIB",
      }),
    ]);

    expect(html).toContain('href="/sesi/sesi-1"');
    expect(html).toContain("Sesi 1 · Luring · 12 Okt 2026 · 08.00 WITA");
    expect(html).toContain('href="/sesi-daring/daring-1"');
    expect(html).toContain("Sesi 1 · Daring · 20 Okt 2026 · 10.00 WIB");
  });

  it("titles the averages programme-wide before any scope is picked", () => {
    const html = render([]);

    expect(html).toContain("Nilai rata-rata · Narasumber</div>");
    expect(html).not.toContain("Nilai rata-rata · Narasumber · ");
  });
});

describe("Ekspor CSV (#490)", () => {
  it("links the Peserta tab to its export, carrying the default choices as no query at all", () => {
    const html = render([row({})]);

    expect(html).toContain('href="/feedback/ekspor/peserta"');
    expect(html).toContain(">Ekspor CSV<");
  });
});

describe("Lihat Grafik (#510)", () => {
  it("sits before Ekspor CSV on the Peserta tab, enabled even with no responses", () => {
    const html = render([]);

    const button = /<button[^>]*>Lihat Grafik<\/button>/.exec(html)?.[0] ?? "";
    expect(button).not.toBe("");
    expect(button).not.toMatch(/ disabled=""/);
    expect(html.indexOf(">Lihat Grafik<")).toBeLessThan(html.indexOf(">Ekspor CSV<"));
  });

  it("draws no figure until the dialog opens", () => {
    expect(render([row({})])).not.toContain('role="img"');
  });
});

describe("the scope's rules", () => {
  it("resets the Session whenever the School changes or is cleared, and keeps the Tipe Peserta", () => {
    const scope = { schoolId: "bontang", sessionId: "sesi-1", participantType: "GTK-MS" } as const;

    expect(withSchool(scope, "samarinda")).toEqual({
      schoolId: "samarinda",
      sessionId: null,
      participantType: "GTK-MS",
    });
    expect(withSchool(scope, null)).toEqual({
      schoolId: null,
      sessionId: null,
      participantType: "GTK-MS",
    });
  });

  it("titles the Peserta averages by School, Session, then Tipe Peserta, and programme-wide with none", () => {
    const scope = { schoolId: null, sessionId: null, participantType: null };

    expect(participantScopeLabel(schools, scope)).toBeNull();
    expect(participantScopeLabel(schools, { ...scope, schoolId: "bontang" })).toBe(
      "SMAN 1 Bontang",
    );
    expect(
      participantScopeLabel(schools, { ...scope, schoolId: "bontang", sessionId: "sesi-1" }),
    ).toBe("SMAN 1 Bontang · Sesi 1 Luring");
    expect(
      participantScopeLabel(schools, {
        schoolId: "bontang",
        sessionId: "sesi-1",
        participantType: "GTK-MS",
      }),
    ).toBe("SMAN 1 Bontang · Sesi 1 Luring · GTK-MS");
    expect(participantScopeLabel(schools, { ...scope, participantType: "Siswa" })).toBe("Siswa");
  });

  it("titles the Perjadin averages by trip, then Peran, and programme-wide with neither", () => {
    const trips: FeedbackPerjadinOption[] = [
      {
        id: "k10",
        subClusterName: "Kelompok 10",
        startsOn: "2026-10-12",
        endsOn: "2026-10-13",
        schoolNames: ["SMAN 1 Bontang"],
      },
    ];

    expect(perjadinScopeLabel(trips, { perjadinId: null, role: null })).toBeNull();
    expect(perjadinScopeLabel(trips, { perjadinId: "k10", role: null })).toBe(
      "Kelompok 10 · 12–13 Okt 2026",
    );
    expect(perjadinScopeLabel(trips, { perjadinId: "k10", role: "Narasumber" })).toBe(
      "Kelompok 10 · 12–13 Okt 2026 · Narasumber",
    );
    expect(perjadinScopeLabel(trips, { perjadinId: null, role: "Pimpinan" })).toBe("Pimpinan");
  });
});
