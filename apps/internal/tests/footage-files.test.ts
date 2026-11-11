import {
  footageFileName,
  sessionFootageFolderName,
  sniffFootageType,
} from "-/lib/drive/footage-files";
import { describe, expect, it } from "vitest";

/**
 * **What Session Footage is, from its bytes, and what it is called in Drive** (#424, ADR-0046). Pure:
 * no database, no Drive.
 */

const text = (value: string) => [...value].map((character) => character.charCodeAt(0));

/** The first 32 bytes of a file: `prefix`, then zeros. */
function head(...prefix: number[]) {
  const bytes = new Uint8Array(32);
  bytes.set(prefix);
  return bytes;
}

/** An ISO-BMFF head: a box size, `ftyp`, then the major brand. */
const isoBmff = (brand: string) => head(0, 0, 0, 0x18, ...text("ftyp"), ...text(brand));

describe("sniffFootageType", () => {
  it.each([
    ["JPEG", head(0xff, 0xd8, 0xff, 0xe1), "image/jpeg"],
    ["PNG", head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"],
    ["WebP", head(...text("RIFF"), 0, 0, 0, 0, ...text("WEBP")), "image/webp"],
    ["HEIC", isoBmff("heic"), "image/heic"],
    ["HEIF (mif1)", isoBmff("mif1"), "image/heic"],
    ["MP4 (isom)", isoBmff("isom"), "video/mp4"],
    ["MP4 (mp42)", isoBmff("mp42"), "video/mp4"],
    ["MOV", isoBmff("qt  "), "video/quicktime"],
    ["Sony XAVC MP4", isoBmff("XAVC"), "video/mp4"],
    [
      "a HEIF whose compatible brands are HEIF's",
      head(0, 0, 0, 0x18, ...text("ftypmif1"), 0, 0, 0, 0, ...text("mif1heic")),
      "image/heic",
    ],
  ])("accepts %s", (_name, bytes, expected) => {
    expect(sniffFootageType(bytes)).toBe(expected);
  });

  it.each([
    ["a PDF", head(...text("%PDF-1.7"))],
    ["a GIF", head(...text("GIF89a"))],
    ["an AVIF", isoBmff("avif")],
    [
      "an AVIF that leads with the generic HEIF brand",
      head(0, 0, 0, 0x18, ...text("ftypmif1"), 0, 0, 0, 0, ...text("mif1avif")),
    ],
    ["a RIFF that is not WebP", head(...text("RIFF"), 0, 0, 0, 0, ...text("WAVE"))],
    ["an MP3", head(...text("ID3"))],
    ["nothing", new Uint8Array(0)],
  ])("refuses %s", (_name, bytes) => {
    expect(sniffFootageType(bytes)).toBeNull();
  });
});

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
