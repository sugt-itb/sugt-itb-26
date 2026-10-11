import { FeedbackView } from "-/components/feedback-view";
import type { ParticipantFeedbackRow } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **The Peserta tab's Hands-on RBL and written answers** (#446), rendered: its own average card and
 * filter, "—" where a row or the dataset has none, and the two written answers under their headings
 * only when a Participant wrote one.
 */

vi.mock("-/app/(app)/feedback/actions", () => ({
  loadParticipantFeedback: vi.fn(),
  loadParticipantFeedbackAverages: vi.fn(),
  loadPerjadinFeedback: vi.fn(),
  loadPerjadinFeedbackAverages: vi.fn(),
}));

const base: ParticipantFeedbackRow = {
  id: "row",
  name: "Rani",
  classKind: "Student",
  schoolId: "school",
  schoolName: "SMAN 1 Bontang",
  sessionId: "session",
  sessionMode: "offline",
  sesi: 1,
  heldOn: "2026-10-12",
  startsAt: "08:00:00",
  timeZone: "WITA",
  handsOnRbl: 8,
  materials: 9,
  instructor: 7,
  relevance: 9,
  rowAverage: 8.25,
  handsOnRblComment: null,
  materialsComment: null,
  instructorComment: null,
  relevanceComment: null,
  knowledgeGain: "Ya, bertambah.",
  suggestions: "Tambah waktu praktik.",
  submittedOn: "2026-10-12",
  submittedAt: new Date("2026-10-12T04:00:00Z"),
};

function render(rows: ParticipantFeedbackRow[], handsOnRbl: number | null) {
  return renderToStaticMarkup(
    <FeedbackView
      participantInitialRows={rows}
      participantInitialCursor={null}
      participantAverages={{ handsOnRbl, instructor: 8, materials: 8, relevance: 8 }}
      participantSchools={[]}
      perjadinInitialRows={[]}
      perjadinInitialCursor={null}
      perjadinAverages={{ lodging: 0, transport: 0, meals: 0, punctuality: 0 }}
      perjadinTrips={[]}
    />,
  );
}

/** The text of one card, found by the Participant's name. */
function card(html: string, name: string): string {
  const start = html.indexOf(`>${name}<`);
  const end = html.indexOf('data-slot="card"', start);
  return html.slice(start, end === -1 ? undefined : end);
}

describe("the Peserta tab", () => {
  it("gives Hands-on RBL an average card and a filter, '—' while no row has one", () => {
    expect(render([], 6.5)).toContain("Nilai rata-rata · Hands-on RBL");
    expect(render([], 6.5)).toContain("6.5");
    expect(render([], null)).toMatch(/Hands-on RBL<\/div>[\s\S]*?>—</);
    expect(render([], null)).toContain('aria-label="Nilai Hands-on RBL"');
  });

  it("shows Rani's RBL score and both written answers under their headings", () => {
    const rani = card(render([base], 8), "Rani");

    expect(rani).toContain("Hands-on RBL");
    expect(rani).toContain("Peningkatan pengetahuan");
    expect(rani).toContain("Ya, bertambah.");
    expect(rani).toContain("Saran dan masukan");
    expect(rani).toContain("Tambah waktu praktik.");
  });

  it("shows '—' for an older Siswa row's RBL, and no RBL line or empty headings for Bu Wati (MS)", () => {
    const html = render(
      [
        {
          ...base,
          id: "old",
          name: "Lama",
          handsOnRbl: null,
          knowledgeGain: null,
          suggestions: null,
        },
        {
          ...base,
          id: "wati",
          name: "Bu Wati",
          classKind: "MS",
          handsOnRbl: null,
          knowledgeGain: null,
          suggestions: null,
        },
      ],
      null,
    );
    const lama = card(html, "Lama");
    const wati = card(html, "Bu Wati");

    expect(lama).toMatch(/Hands-on RBL<\/span><span[^>]*>—</);
    expect(wati).not.toContain("Hands-on RBL");
    expect(wati).not.toContain("Peningkatan pengetahuan");
    expect(wati).not.toContain("Saran dan masukan");
  });
});
