import { footageFileName, sessionFootageFolderName } from "-/lib/drive/footage-files";
import { describe, expect, it } from "vitest";

/**
 * **What Session Footage is called in Drive** (#424, ADR-0046): the Session folder the Foto & Video
 * button opens, and the names of files the old upload recorded. Pure: no database, no Drive.
 */

describe("names in Drive", () => {
  const sessionId = "3e4f5a6b-0000-4000-8000-000000000001";
  const footageId = "7c8d9e0f-0000-4000-8000-000000000002";

  it("names a Session's folder by date, start time with a dot, School and S- id", () => {
    expect(
      sessionFootageFolderName({
        sessionId,
        heldOn: "2026-10-12",
        startsAt: "08:00:00",
        schoolName: "SMA Pradita Dirgantara",
      }),
    ).toBe("2026-10-12 · 08.00 · SMA Pradita Dirgantara · S-3e4f5a6b");
  });

  it("names a file by date, School, kind and M- id, with its sniffed type's extension", () => {
    const name = (
      kind: "foto" | "video",
      contentType: Parameters<typeof footageFileName>[0]["contentType"],
    ) =>
      footageFileName({
        footageId,
        heldOn: "2026-10-12",
        schoolName: "SMAN 1/Bontang",
        kind,
        contentType,
      });

    expect(name("foto", "image/jpeg")).toBe("2026-10-12 · SMAN 1-Bontang · Foto · M-7c8d9e0f.jpg");
    expect(name("foto", "image/heic")).toMatch(/ · Foto · M-7c8d9e0f\.heic$/);
    expect(name("video", "video/mp4")).toMatch(/ · Video · M-7c8d9e0f\.mp4$/);
    expect(name("video", "video/quicktime")).toMatch(/\.mov$/);
  });
});
