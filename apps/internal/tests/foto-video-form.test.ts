import {
  checkPickedFootage,
  declaredFootageType,
  FOOTAGE_ACCEPT,
  footageFailureText,
  footageTitle,
  formatFileSize,
  MAX_FOOTAGE_FILES_PER_BATCH,
} from "-/components/foto-video-form";
import { uploadFootageBatch } from "-/components/foto-video-upload";
import { TripTimeline } from "-/components/my-perjadin-section";
import { tripTimeline } from "-/components/trip-timeline";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

/**
 * **The Foto & Video popup's rules and copy** (#425): what a picked file is declared as, which picks
 * are refused and why, the 30-file batch, sizes and the title — and the order an Unggah runs in. Pure:
 * no DOM, no server, no Drive.
 */

const MB = 1024 * 1024;

/** A file of `size` bytes without allocating them: only `name`, `type` and `size` are read. */
function file(name: string, type: string, size = 1024): File {
  const made = new File([], name, { type });
  Object.defineProperty(made, "size", { value: size });
  return made;
}

describe("declaredFootageType", () => {
  it("takes the browser's type when it is one footage may be", () => {
    expect(declaredFootageType(file("a.jpg", "image/jpeg"))).toBe("image/jpeg");
    expect(declaredFootageType(file("a.mov", "video/quicktime"))).toBe("video/quicktime");
  });

  it("reads the extension when the phone gave no type, as some do for HEIC", () => {
    expect(declaredFootageType(file("IMG_0001.HEIC", ""))).toBe("image/heic");
    expect(declaredFootageType(file("clip.MOV", "application/octet-stream"))).toBe(
      "video/quicktime",
    );
  });

  it("is null for anything else", () => {
    expect(declaredFootageType(file("scan.pdf", "application/pdf"))).toBeNull();
    expect(declaredFootageType(file("anim.gif", "image/gif"))).toBeNull();
  });

  it("offers the extensions in the picker too", () => {
    expect(FOOTAGE_ACCEPT).toContain(".heic");
    expect(FOOTAGE_ACCEPT).toContain("image/heif");
  });
});

describe("checkPickedFootage", () => {
  it("refuses a wrong type, an empty file and one over its kind's cap, each with its reason", () => {
    const checked = checkPickedFootage([
      file("ok.jpg", "image/jpeg", 2 * MB),
      file("doc.pdf", "application/pdf"),
      file("empty.png", "image/png", 0),
      file("big.jpg", "image/jpeg", 50 * MB + 1),
      file("huge.mp4", "video/mp4", 1000 * MB + 1),
      file("long.mp4", "video/mp4", 900 * MB),
    ]);

    expect(checked.accepted.map((entry) => [entry.file.name, entry.kind])).toEqual([
      ["ok.jpg", "foto"],
      ["long.mp4", "video"],
    ]);
    expect(checked.refused.map((entry) => [entry.file.name, entry.reason])).toEqual([
      ["doc.pdf", "Jenis berkas tidak didukung"],
      ["empty.png", "Berkas kosong"],
      ["big.jpg", "Foto lebih dari 50 MB"],
      ["huge.mp4", "Video lebih dari 1000 MB"],
    ]);
    expect(checked.overLimit).toBeNull();
  });

  it("takes at most 30 in all, counting those already picked, and says so", () => {
    const files = Array.from({ length: 12 }, (_, i) => file(`f${i}.jpg`, "image/jpeg"));

    const staged = Array.from({ length: 25 }, (_, i) => ({
      file: file(`staged${i}.jpg`, "image/jpeg"),
      contentType: "image/jpeg",
      kind: "foto" as const,
    }));
    const checked = checkPickedFootage(files, staged);

    expect(MAX_FOOTAGE_FILES_PER_BATCH).toBe(30);
    expect(checked.accepted).toHaveLength(5);
    expect(checked.overLimit).toBe(
      "Paling banyak 30 berkas sekali unggah — sisanya tidak dipilih.",
    );
  });
});

describe("picking the same file twice", () => {
  it("leaves out a repeat, in one pick or across picks, so it is never uploaded twice", () => {
    const photo = file("IMG_0001.JPG", "image/jpeg");
    const first = checkPickedFootage([photo, photo]);
    expect(first.accepted).toHaveLength(1);
    expect(first.refused).toEqual([{ file: photo, reason: "Sudah dipilih" }]);

    const again = checkPickedFootage([photo], first.accepted);
    expect(again.accepted).toEqual([]);
    expect(again.refused.map((entry) => entry.reason)).toEqual(["Sudah dipilih"]);
  });
});

describe("copy", () => {
  it("formats sizes the Indonesian way", () => {
    expect(formatFileSize(820 * 1024)).toBe("820 KB");
    expect(formatFileSize(3.4 * MB)).toBe("3,4 MB");
    expect(formatFileSize(1.25 * 1024 * MB)).toBe("1,3 GB");
  });

  it("titles the popup with the Session's date and School", () => {
    expect(footageTitle("2026-10-12", "SMA Pradita Dirgantara")).toBe(
      "Foto & Video — 12 Okt 2026 · SMA Pradita Dirgantara",
    );
  });

  it("names each failure in a sentence", () => {
    expect(footageFailureText({ outcome: "too-large", kind: "video", limit: 1 })).toBe(
      "Video lebih dari 1000 MB",
    );
    expect(footageFailureText({ outcome: "failed", reason: "gave-up" })).toBe(
      "Koneksi terputus terlalu lama — coba lagi.",
    );
    expect(footageFailureText({ outcome: "drive-unreachable" })).toBe(
      "Google Drive tidak dapat dihubungi — coba lagi.",
    );
  });
});

describe("uploadFootageBatch", () => {
  const picked = (name: string) => ({
    file: file(name, "image/jpeg"),
    contentType: "image/jpeg",
    kind: "foto" as const,
  });

  it("runs open → send → record for one file at a time, and one failure sinks nothing else", async () => {
    const calls: string[] = [];
    const steps: string[] = [];

    const results = await uploadFootageBatch(
      "session-1",
      [picked("a.jpg"), picked("b.jpg"), picked("c.jpg"), picked("d.jpg")],
      {
        open: async (_session, opened) => {
          calls.push(`open ${opened.size}`);
          return { outcome: "ready", sessionUri: `uri-${calls.length}`, kind: "foto" };
        },
        send: async (uri, sent) => {
          calls.push(`send ${sent.name}`);
          if (sent.name === "b.jpg") return { outcome: "failed", reason: "gave-up" };
          if (sent.name === "d.jpg") throw new Error("boom");
          return { outcome: "uploaded", fileId: `drive-${uri}` };
        },
        record: async (input) => {
          calls.push(`record ${input.originalFilename}`);
          return {
            outcome: "recorded",
            footageId: "x",
            synced: input.originalFilename !== "c.jpg",
          };
        },
        onStep: ({ phase, index, total }) => steps.push(`${phase} ${index + 1}/${total}`),
      },
    );

    expect(calls).toEqual([
      "open 1024",
      "send a.jpg",
      "record a.jpg",
      "open 1024",
      "send b.jpg",
      "open 1024",
      "send c.jpg",
      "record c.jpg",
      "open 1024",
      "send d.jpg",
    ]);
    expect(results.map((entry) => entry.result)).toEqual([
      { ok: true, synced: true },
      { ok: false, reason: "Koneksi terputus terlalu lama — coba lagi." },
      { ok: true, synced: false },
      { ok: false, reason: "Gagal diunggah — coba lagi." },
    ]);
    expect(steps).toEqual([
      "uploading 1/4",
      "saving 1/4",
      "uploading 2/4",
      "uploading 3/4",
      "saving 3/4",
      "uploading 4/4",
    ]);
  });
});

describe("the Foto & Video button on a /pendamping Session row", () => {
  it("sits after Tandai and Feedback on every live Session, and a cancelled one has no row", () => {
    const session = (sessionId: string, status: "arranged" | "delivered" | "cancelled") => ({
      sessionId,
      heldOn: "2026-10-12",
      startsAt: "08:00:00",
      status,
    });
    const nodes = tripTimeline({
      schools: [
        {
          schoolId: "s1",
          name: "SMA Pradita Dirgantara",
          kabupatenKota: "Kab. Bogor",
          timeZone: "WIB",
          sessions: [
            session("a", "arranged"),
            session("b", "delivered"),
            session("c", "cancelled"),
          ],
        },
      ],
    });

    const html = renderToStaticMarkup(
      createElement(TripTimeline, {
        nodes,
        uploadGate: { open: false, reason: "Terputus." },
        canWrite: true,
      }),
    );

    // Each row's buttons in order: the arranged one has Tandai first; the delivered one does not.
    const labels = [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]);
    expect(labels).toEqual([
      "Tandai",
      "Feedback",
      "Foto &amp; Video",
      "Feedback",
      "Foto &amp; Video",
    ]);
    // It opens while Drive is down, so the files can be viewed: never disabled.
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Foto &amp; Video</);
  });
});
