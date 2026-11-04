import { AcquittalTransactions } from "-/components/laporan-perjadin/acquittal-transactions";
import {
  driveFileUrl,
  driveFolderUrl,
  evidenceFileName,
  sniffReceiptType,
  transactionFolderName,
} from "-/lib/drive/receipt-files";
import { prepareReceipt, UPLOAD_TOO_LARGE } from "-/lib/drive/receipt-upload";
import { MAX_UPLOAD_BYTES } from "@sugt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **Receipt names, types and links** (#373, ADR-0040) — the pure part, no database and no Drive. The
 * names are the ADR's to the character: ISO dates, ` · ` everywhere, `/` → `-` in a category, 8-hex
 * ids, and the extension from the sniffed type. The Perjadin folder's name is `perjadin-name.test.ts`'s.
 */

// The acquittal's client component imports its Server Actions; nothing here calls them.
vi.mock("-/app/(app)/perjadin/[id]/laporan/actions", () => ({}));

const TXN = "1a2b3c4d-0000-4000-8000-000000000001";
const EV = "5e6f7a8b-0000-4000-8000-000000000002";

describe("names", () => {
  it.each([
    ["Tiket Pesawat/Kereta PP", "2026-10-13 · Tiket Pesawat-Kereta PP · T-1a2b3c4d"],
    ["Transport Bandara/Stasiun", "2026-10-13 · Transport Bandara-Stasiun · T-1a2b3c4d"],
    ["Konsumsi", "2026-10-13 · Konsumsi · T-1a2b3c4d"],
  ] as const)("names a transaction folder in %s", (category, name) => {
    expect(transactionFolderName("2026-10-13", category, TXN)).toBe(name);
  });

  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["application/pdf", "pdf"],
  ] as const)("names a %s receipt with .%s", (contentType, ext) => {
    expect(evidenceFileName("2026-10-13", "Konsumsi", TXN, EV, contentType)).toBe(
      `2026-10-13 · Konsumsi · T-1a2b3c4d · 5e6f7a8b.${ext}`,
    );
  });
});

describe("sniffReceiptType", () => {
  const bytes = (...values: (number | string)[]) =>
    new Uint8Array(
      values.flatMap((value) =>
        typeof value === "string" ? [...value].map((c) => c.charCodeAt(0)) : [value],
      ),
    );

  it.each([
    ["application/pdf", bytes("%PDF-1.7")],
    ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe1)],
    ["image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["image/webp", bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")],
  ])("knows a %s by its first bytes", (type, head) => {
    expect(sniffReceiptType(head)).toBe(type);
  });

  it.each([
    ["HEIC", bytes(0, 0, 0, 0x18, "ftypheic")],
    ["a RIFF that is not WebP", bytes("RIFF", 0, 0, 0, 0, "WAVEfmt ")],
    ["an executable", bytes("MZ")],
    ["nothing", bytes()],
  ])("refuses %s", (_, head) => {
    expect(sniffReceiptType(head)).toBeNull();
  });
});

describe("the acquittal's receipt links and gate", () => {
  const line = {
    id: "t1",
    spentOn: "2026-10-13",
    description: "Taksi bandara",
    amountIdr: 150_000,
    category: "Transport Bandara/Stasiun" as const,
    participantType: "Siswa" as const,
    evidence: [{ id: "e1", contentType: "image/jpeg", byteSize: 10, url: driveFileUrl("file-1") }],
    folderUrl: driveFolderUrl("folder-1"),
    unsynced: false,
  };

  it("links each receipt and the folder to Drive, in a new tab", () => {
    const html = renderToStaticMarkup(
      <AcquittalTransactions
        perjadinId="p1"
        transactions={[line]}
        uploadGate={{ open: true }}
        canWrite
      />,
    );

    expect(html).toContain(
      '<a href="https://drive.google.com/file/d/file-1/view" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toMatch(
      /href="https:\/\/drive\.google\.com\/drive\/folders\/folder-1"[^>]*>Buka folder</,
    );
  });

  it("disables Unggah bukti with the reason while Drive is closed, and offers no Catat", () => {
    const reason =
      "Google Drive belum terhubung — minta Administrator menghubungkannya di Pengaturan.";
    const html = renderToStaticMarkup(
      <AcquittalTransactions
        perjadinId="p1"
        transactions={[line]}
        uploadGate={{ open: false, reason }}
        canWrite
      />,
    );

    expect(html).toContain(reason);
    const buttons = [...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*?(Unggah bukti)/g)];
    expect(buttons.map(([tag, label]) => [label, /\sdisabled(=""|\s|>)/.test(tag)])).toEqual([
      ["Unggah bukti", true],
    ]);
    expect(html).not.toContain("Catat transaksi");
  });
});

describe("prepareReceipt, for what needs no canvas", () => {
  // Re-encoding an image needs `createImageBitmap` and a canvas, which Node has not; those run only
  // in a browser. A PDF and the two refusals do not reach them.
  it("sends a PDF as it is", async () => {
    const file = new File([new Uint8Array(10)], "nota.pdf", { type: "application/pdf" });

    await expect(prepareReceipt(file)).resolves.toEqual({
      blob: file,
      contentType: "application/pdf",
    });
  });

  it("refuses a type outside the four before any work", async () => {
    const file = new File([new Uint8Array(10)], "IMG_0001.heic", { type: "image/heic" });

    await expect(prepareReceipt(file)).resolves.toBe("unsupported-type");
  });

  it("refuses a PDF over the cap", async () => {
    const file = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "besar.pdf", {
      type: "application/pdf",
    });

    await expect(prepareReceipt(file)).resolves.toBe("too-large");
  });

  it("sends a PDF of exactly 50 MB, and says 50 MB when refusing (#394)", async () => {
    const file = new File([new Uint8Array(MAX_UPLOAD_BYTES)], "pas.pdf", {
      type: "application/pdf",
    });

    await expect(prepareReceipt(file)).resolves.toMatchObject({ contentType: "application/pdf" });
    expect(UPLOAD_TOO_LARGE).toBe("Berkas lebih dari 50 MB — perkecil lalu coba lagi.");
  });
});
