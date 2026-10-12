import { PerjadinSessions } from "-/components/perjadin-sessions";
import type { PerjadinSession } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **The Session list on /perjadin/[id] names its Narasumber one per line** (#491): under the
 * Session's date, time and School, never comma-joined — and a Session with none has no list. The
 * badge and the Ubah/Batalkan controls stay on the Session's own row. The A–Z order is the query's
 * (`perjadinDetail`); the fixture is deliberately not A–Z, to show the list keeps what it gets.
 */

vi.mock("-/app/(app)/perjadin/[id]/actions", () => ({
  addPerjadinSessionAction: vi.fn(),
  cancelPerjadinSessionAction: vi.fn(),
  editPerjadinSessionAction: vi.fn(),
}));

const session: PerjadinSession = {
  sessionId: "5e5510a0-0000-0000-0000-000000000000",
  schoolId: "s-1",
  schoolName: "SMAN 1 Bontang",
  schoolSlug: "sman-1-bontang",
  heldOn: "2026-11-03",
  startsAt: "08:00:00",
  timeZone: "WITA",
  status: "arranged",
  taughtBy: [
    { id: "t-2", name: "Dr. Sari Wulandari" },
    { id: "t-1", name: "Prof. Adi Nugroho" },
  ],
  pimpinan: [],
};

function renderSessions(sessions: PerjadinSession[], canEdit = true): string {
  return renderToStaticMarkup(
    <PerjadinSessions
      perjadinId="9e8d7c6b-0000-0000-0000-000000000000"
      sessions={sessions}
      eligibleSchools={[]}
      teachers={[]}
      pimpinanRoster={[]}
      startsOn="2026-11-02"
      endsOn="2026-11-05"
      canEdit={canEdit}
    />,
  );
}

describe("the Session list's Narasumber (#491)", () => {
  it("lists each Narasumber as its own item, in order, with no comma-joined string", () => {
    const html = renderSessions([session]);

    expect(html).toContain('aria-label="Narasumber Sesi 2026-11-03 SMAN 1 Bontang"');
    const names = html.match(/<ul[^>]*aria-label="Narasumber Sesi[^"]*"[^>]*>(.*?)<\/ul>/)?.[1];
    expect(names).toBe("<li>Dr. Sari Wulandari</li><li>Prof. Adi Nugroho</li>");
    expect(html).not.toContain("Dr. Sari Wulandari, Prof. Adi Nugroho");
    expect(html).not.toContain("· Dr. Sari Wulandari");
  });

  it("puts the names below the Session's row, with the badge and the controls on the row", () => {
    const html = renderSessions([session]);

    const row = html.indexOf(">SMAN 1 Bontang</a>");
    const badge = html.indexOf(">Terjadwal<");
    const ubah = html.indexOf(">Ubah<");
    const batalkan = html.indexOf(">Batalkan<");
    const names = html.indexOf('aria-label="Narasumber Sesi');

    expect(row).toBeGreaterThan(-1);
    expect(badge).toBeGreaterThan(row);
    expect(ubah).toBeGreaterThan(badge);
    expect(batalkan).toBeGreaterThan(ubah);
    // The list opens after the row's last control, so nothing of the row sits among the names.
    expect(names).toBeGreaterThan(batalkan);
  });

  it("renders no list for a Session with no Narasumber", () => {
    const html = renderSessions([
      session,
      {
        ...session,
        sessionId: "5e5510a1-0000-0000-0000-000000000000",
        schoolName: "SMAN 2 Samarinda",
        schoolSlug: "sman-2-samarinda",
        taughtBy: [],
      },
    ]);

    // The list renders in order, so each Session's markup runs from its School to the next one's.
    const samarinda = html.indexOf(">SMAN 2 Samarinda</a>");
    expect(html.slice(html.indexOf(">SMAN 1 Bontang</a>"), samarinda)).toContain(
      'aria-label="Narasumber Sesi',
    );
    expect(html.slice(samarinda)).not.toContain("Narasumber");
    expect(html.match(/aria-label="Narasumber Sesi/g)).toHaveLength(1);
  });

  it("lists the names for readers without the controls too, the badge still on the row", () => {
    const html = renderSessions([session], false);

    expect(html).not.toContain(">Ubah<");
    expect(html).toContain("<li>Dr. Sari Wulandari</li><li>Prof. Adi Nugroho</li>");
    expect(html.indexOf(">Terjadwal<")).toBeGreaterThan(html.indexOf(">SMAN 1 Bontang</a>"));
    expect(html.indexOf('aria-label="Narasumber Sesi')).toBeGreaterThan(
      html.indexOf(">Terjadwal<"),
    );
  });
});
