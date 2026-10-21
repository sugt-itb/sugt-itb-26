import { feedbackList, withNextPage } from "-/components/feedback-list";
import { FeedbackView, PerjadinTab, ResponseCount } from "-/components/feedback-view";
import type { ParticipantFeedbackRow, PerjadinFeedbackRow } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **Each `/feedback` tab's response count, on screen** (#519): `{n} tanggapan` at the left of the
 * row above the list — the total the tab's choices match, not the cards loaded, so "Tampilkan lebih
 * banyak" never moves it — as muted text, never a card, so nobody reads it as another average.
 */

vi.mock("-/app/(app)/feedback/actions", () => ({
  loadParticipantFeedback: vi.fn(),
  loadParticipantFeedbackAverages: vi.fn(),
  loadParticipantFeedbackCharts: vi.fn(),
  loadPerjadinFeedback: vi.fn(),
  loadPerjadinFeedbackAverages: vi.fn(),
}));

const row = (id: string): ParticipantFeedbackRow => ({
  id,
  name: `Peserta ${id}`,
  classKind: "Student",
  schoolId: "bontang",
  schoolName: "SMAN 1 Bontang",
  sessionId: "sesi-1",
  sessionMode: "offline",
  sesi: 1,
  heldOn: "2026-10-12",
  startsAt: "08:00:00",
  timeZone: "WITA",
  handsOnRbl: 9,
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
});

const ten = Array.from({ length: 10 }, (_, index) => row(`r${index}`));

function render(rows: ParticipantFeedbackRow[], total: number) {
  return renderToStaticMarkup(
    <FeedbackView
      participantFirstPage={{ rows, nextCursor: rows.length < total ? 10 : null, total }}
      participantAverages={{ handsOnRbl: 8, instructor: 8, materials: 8, relevance: 8 }}
      participantSchools={[]}
      perjadinFirstPage={{ rows: [], nextCursor: null, total: 0 }}
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

describe("the Peserta tab's response count", () => {
  it("shows every matching response, not the ten cards loaded", () => {
    const html = render(ten, 42);
    expect(html).toContain(">42 tanggapan</p>");
    expect(html).not.toContain(">10 tanggapan<");
    expect(html).toContain("Tampilkan lebih banyak");
  });

  it("sits on the left of the row that holds Lihat Grafik and Ekspor CSV", () => {
    const html = render(ten, 42);
    const count = html.indexOf(">42 tanggapan<");
    expect(count).toBeGreaterThan(-1);
    expect(count).toBeLessThan(html.indexOf("Lihat Grafik"));
    expect(count).toBeLessThan(html.indexOf("Ekspor CSV"));
    // The row spreads the two ends apart, and wraps on a narrow screen rather than overlapping.
    const rowStart = html.lastIndexOf("<div", html.lastIndexOf("<p", count));
    expect(html.slice(rowStart, count)).toMatch(/class="[^"]*flex-wrap[^"]*justify-between/);
  });

  it("is muted text, not a card, and never reads n = or Nilai rata-rata", () => {
    const html = render(ten, 42);
    const count = /<p[^>]*>42 tanggapan<\/p>/.exec(html)![0];
    expect(count).toContain("text-sm text-muted-foreground");
    expect(count).not.toContain("data-slot");
    expect(count).not.toContain("text-2xl");
    expect(html).not.toContain("n = ");
  });

  it("reads 0 tanggapan beside the empty list's text", () => {
    const html = render([], 0);
    expect(html).toContain(">0 tanggapan</p>");
    expect(html).toContain("Tidak ada masukan Peserta untuk saringan ini.");
  });
});

describe("the Perjadin tab's response count", () => {
  const evaluation = (id: string): PerjadinFeedbackRow => ({
    id,
    filedByName: `Pengisi ${id}`,
    filedByRole: "Pendamping",
    subClusterName: "Kelompok 3",
    perjadinId: "trip",
    startsOn: "2026-10-12",
    endsOn: "2026-10-13",
    createdOn: "2026-10-14",
    lodging: 9,
    transport: 9,
    meals: 9,
    punctuality: 9,
    pendampingSupport: null,
    rowAverage: 9,
    lodgingComment: null,
    transportComment: null,
    mealsComment: null,
    punctualityComment: null,
    pendampingSupportComment: null,
  });

  function renderPerjadin(rows: PerjadinFeedbackRow[], total: number) {
    return renderToStaticMarkup(
      <PerjadinTab
        firstPage={{ rows, nextCursor: rows.length < total ? 10 : null, total }}
        initialAverages={{
          lodging: 8,
          transport: 8,
          meals: 8,
          punctuality: 8,
          pendampingSupport: null,
        }}
        trips={[]}
      />,
    );
  }

  it("shows every matching evaluation left of Ekspor CSV, not the cards loaded", () => {
    const html = renderPerjadin(
      Array.from({ length: 10 }, (_, index) => evaluation(`e${index}`)),
      15,
    );
    expect(html).toContain(">15 tanggapan</p>");
    expect(html.indexOf(">15 tanggapan<")).toBeLessThan(html.indexOf("Ekspor CSV"));
    expect(html).toContain("Tampilkan lebih banyak");
  });

  it("reads 0 tanggapan beside the empty list's text", () => {
    const html = renderPerjadin([], 0);
    expect(html).toContain(">0 tanggapan</p>");
    expect(html).toContain("Tidak ada evaluasi Perjadin untuk saringan ini.");
  });
});

describe("ResponseCount", () => {
  it("is dimmed, and busy, while a change's first page is on its way", () => {
    const idle = renderToStaticMarkup(
      <ResponseCount
        total={15}
        recounting={false}
      />,
    );
    const busy = renderToStaticMarkup(
      <ResponseCount
        total={15}
        recounting
      />,
    );
    expect(idle).not.toContain("opacity-50");
    expect(idle).toContain('aria-busy="false"');
    expect(busy).toContain("opacity-50");
    expect(busy).toContain('aria-busy="true"');
    // The previous number stays until the new one lands.
    expect(busy).toContain(">15 tanggapan</p>");
  });
});

describe("the list's state", () => {
  it("keeps the count on Tampilkan lebih banyak, appending the next batch", () => {
    const first = feedbackList({ rows: ten, nextCursor: 10, total: 42 });
    expect(first).toEqual({ rows: ten, cursor: 10, total: 42 });

    // A later page's own total is never read: the count already stood for every match.
    const more = withNextPage(first, { rows: [row("r10")], nextCursor: 20, total: 0 });
    expect(more.rows).toHaveLength(11);
    expect(more.cursor).toBe(20);
    expect(more.total).toBe(42);
  });

  it("takes a new first page's count whole, as a scope, filter or sort change does", () => {
    const narrowed = feedbackList({ rows: [row("r0")], nextCursor: null, total: 1 });
    expect(narrowed).toEqual({ rows: [row("r0")], cursor: null, total: 1 });
  });
});
