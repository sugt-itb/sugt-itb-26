import { PerjadinPimpinan } from "-/components/perjadin-pimpinan";
import { PerjadinSessions, sessionPimpinanOptions } from "-/components/perjadin-sessions";
import type { PerjadinSession } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **A Pimpinan is shown where they were recorded** (#492, ADR-0056): each Session row on
 * `/perjadin/[id]` lists its Pimpinan one per line, below its Narasumber; the page's Pimpinan
 * section is read-only — the trip's derived list, each name followed by the Schools they were
 * recorded at, or "Tidak ada." when there is none. Which Pimpinan are on the trip is the query's
 * (`tripPimpinan`); this renders what it is given.
 */

vi.mock("-/app/(app)/perjadin/[id]/actions", () => ({
  addPerjadinSessionAction: vi.fn(),
  cancelPerjadinSessionAction: vi.fn(),
  editPerjadinSessionAction: vi.fn(),
  setSessionPimpinanAction: vi.fn(),
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
  taughtBy: [{ id: "t-1", name: "Prof. Adi Nugroho" }],
  pimpinan: [
    { personId: "p-1", name: "Anton Timur Jaelani" },
    { personId: "p-2", name: "Fatimah Arofiati Noor" },
  ],
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

describe("a Session row's Pimpinan", () => {
  it("lists each Pimpinan on its own line, below the Narasumber", () => {
    for (const canEdit of [true, false]) {
      const html = renderSessions([session], canEdit);

      const list = html.match(
        /<ul[^>]*aria-label="Pimpinan Sesi 2026-11-03 SMAN 1 Bontang"[^>]*>(.*?)<\/ul>/,
      )?.[1];
      expect(list).toBe(
        "<li>Pimpinan: Anton Timur Jaelani</li><li>Pimpinan: Fatimah Arofiati Noor</li>",
      );
      expect(html.indexOf('aria-label="Pimpinan Sesi')).toBeGreaterThan(
        html.indexOf('aria-label="Narasumber Sesi'),
      );
    }
  });

  it("offers Ubah Pimpinan on a delivered Session to whoever writes the trip, and only there", () => {
    const delivered = { ...session, status: "delivered" as const };

    expect(renderSessions([delivered])).toContain(">Ubah Pimpinan<");
    // An arranged Session's Pimpinan are in its Ubah dialog with the rest of it.
    expect(renderSessions([session])).not.toContain(">Ubah Pimpinan<");
    expect(renderSessions([{ ...session, status: "cancelled" as const }])).not.toContain(
      ">Ubah Pimpinan<",
    );
    expect(renderSessions([delivered], false)).not.toContain(">Ubah Pimpinan<");
  });

  it("renders no list for a Session with no Pimpinan", () => {
    const html = renderSessions([{ ...session, pimpinan: [] }]);

    expect(html).not.toContain('aria-label="Pimpinan Sesi');
    expect(html).not.toContain("Pimpinan:");
  });
});

describe("a Session's Pimpinan picker", () => {
  it("offers the roster, plus a recorded Pimpinan who has since left it", () => {
    const roster = [{ id: "p-2", fullName: "Fatimah Arofiati Noor" }];

    // Adding a Session: the roster alone.
    expect(sessionPimpinanOptions(roster)).toEqual([
      { value: "p-2", label: "Fatimah Arofiati Noor" },
    ]);
    // Editing one whose Anton was revoked since: still offered, so the chip shows and can go.
    expect(sessionPimpinanOptions(roster, session)).toEqual([
      { value: "p-2", label: "Fatimah Arofiati Noor" },
      { value: "p-1", label: "Anton Timur Jaelani" },
    ]);
  });
});

describe("the read-only Pimpinan section", () => {
  it("names each trip Pimpinan with the Schools they were recorded at", () => {
    const html = renderToStaticMarkup(
      <PerjadinPimpinan
        pimpinan={[
          { personId: "p-1", name: "Anton Timur Jaelani", schools: ["SMAN 1 Bontang"] },
          {
            personId: "p-2",
            name: "Fatimah Arofiati Noor",
            schools: ["SMAN 1 Bontang", "SMAN 3 Samarinda"],
          },
        ]}
      />,
    );

    const items = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((match) =>
      match[1]!.replace(/<[^>]+>/g, ""),
    );
    expect(items).toEqual([
      "Anton Timur Jaelani — SMAN 1 Bontang",
      "Fatimah Arofiati Noor — SMAN 1 Bontang, SMAN 3 Samarinda",
    ]);
    // Nothing to edit: no checkbox, no button.
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain("<button");
  });

  it("reads Tidak ada. when the trip has none", () => {
    const html = renderToStaticMarkup(<PerjadinPimpinan pimpinan={[]} />);

    expect(html).toContain("Tidak ada.");
    expect(html).not.toContain("<li");
  });
});
