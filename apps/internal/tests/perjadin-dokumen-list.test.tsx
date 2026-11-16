import {
  documentRowText,
  PerjadinDokumenList,
  sppdSummary,
} from "-/components/perjadin-dokumen-list";
import { documentFileName } from "-/lib/drive/document-files";
import type { DocumentSchool, PerjadinDocumentRow } from "@sugt/db/queries";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * **The Dokumen list** (#398, #441), read-only since #559: each SPPD under its own heading by
 * School and with no date, the **SPPD: x/y sekolah** summary counting the trip's Schools so a
 * missing one shows, how a sheet reads, and no write control on any row.
 */

const bontang: DocumentSchool = {
  id: "s-1",
  name: "SMAN 1 Bontang",
  timeZone: "WITA",
  hasSppd: true,
};
const samarinda: DocumentSchool = {
  id: "s-2",
  name: "SMAN 2 Samarinda",
  timeZone: "WITA",
  hasSppd: false,
};

const sppdRow: PerjadinDocumentRow = {
  id: "1a2b3c4d-0000-0000-0000-000000000000",
  kind: "SPPD",
  documentDate: null,
  schoolName: "SMAN 1 Bontang",
  participantType: null,
  startsAt: null,
  endsAt: null,
  timeZone: null,
  driveFileId: "file-1",
  unsynced: false,
};

describe("the SPPD section", () => {
  it("lists each SPPD by its School and counts the trip's Schools that have one", () => {
    const html = renderToStaticMarkup(
      <PerjadinDokumenList
        documents={[sppdRow]}
        schools={[bontang, samarinda]}
      />,
    );

    expect(html).toContain(">SPPD<");
    expect(html).toContain("SPPD: 1/2 sekolah");
    expect(html).toContain(">SMAN 1 Bontang<");
  });

  it("says Belum ada, and 0/y, while no School has one", () => {
    const html = renderToStaticMarkup(
      <PerjadinDokumenList
        documents={[]}
        schools={[{ ...bontang, hasSppd: false }]}
      />,
    );

    expect(html).toContain("SPPD: 0/1 sekolah");
    // One per kind: the three attendance kinds and SPPD.
    expect(html.match(/Belum ada/g)).toHaveLength(4);
  });
});

describe("read-only (#559)", () => {
  it("links each document to its PDF in Drive, flags an unsynced one, and offers no Hapus", () => {
    const html = renderToStaticMarkup(
      <PerjadinDokumenList
        documents={[
          sppdRow,
          { ...sppdRow, id: "2b3c4d5e-0000-0000-0000-000000000000", unsynced: true },
        ]}
        schools={[bontang]}
      />,
    );

    expect(html.match(/>Buka</g)).toHaveLength(2);
    expect(html).toContain("https://drive.google.com/file/d/file-1/view");
    expect(html).toContain("belum tersinkron");
    // The unsynced marker's tooltip trigger is the only button left on the list.
    expect(html).not.toContain("Hapus");
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe("a sheet, as it reads", () => {
  const row: PerjadinDocumentRow = {
    id: "1a2b3c4d-0000-0000-0000-000000000000",
    kind: "Daftar Hadir Peserta",
    documentDate: "2026-10-14",
    schoolName: "SMA Y",
    participantType: "Siswa",
    startsAt: "08:00:00",
    endsAt: "11:30:00",
    timeZone: "WITA",
    driveFileId: "f",
    unsynced: false,
  };

  it("lists a Peserta sheet with its School, cohort and span, and the others by date", () => {
    expect(documentRowText(row)).toBe("2026-10-14 · SMA Y · Siswa · 08.00–11.30 WITA");
    expect(
      documentRowText({
        ...row,
        kind: "Daftar Hadir Pendamping",
        schoolName: null,
        participantType: null,
        startsAt: null,
        endsAt: null,
        timeZone: null,
      }),
    ).toBe("2026-10-14");
  });

  it("lists an SPPD by its School alone", () => {
    expect(
      documentRowText({
        ...row,
        kind: "SPPD",
        documentDate: null,
        participantType: null,
        startsAt: null,
        endsAt: null,
      }),
    ).toBe("SMA Y");
  });

  it("counts the trip's Schools that have their SPPD", () => {
    expect(sppdSummary([{ hasSppd: true }, { hasSppd: false }])).toBe("SPPD: 1/2 sekolah");
    expect(sppdSummary([])).toBe("SPPD: 0/0 sekolah");
  });

  it("names its file in Drive with the D- marker", () => {
    expect(documentFileName({ ...row, documentId: row.id })).toBe(
      "2026-10-14 · SMA Y · Siswa · Daftar Hadir Peserta · D-1a2b3c4d.pdf",
    );
    expect(
      documentFileName({
        documentId: row.id,
        kind: "Daftar Hadir Narasumber",
        documentDate: "2026-10-13",
        schoolName: null,
        participantType: null,
      }),
    ).toBe("2026-10-13 · Daftar Hadir Narasumber · D-1a2b3c4d.pdf");
    expect(
      documentFileName({
        documentId: row.id,
        kind: "SPPD",
        documentDate: null,
        schoolName: "SMAN 1/Bontang",
        participantType: null,
      }),
    ).toBe("SMAN 1-Bontang · SPPD · D-1a2b3c4d.pdf");
  });
});
