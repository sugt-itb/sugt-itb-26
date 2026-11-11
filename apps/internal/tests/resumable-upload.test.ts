import { FOOTAGE_PIECE_BYTES, uploadEach, uploadInPieces } from "-/lib/drive/resumable-upload";
import { describe, expect, it } from "vitest";

/**
 * **Sending footage to Drive in pieces** (#424, ADR-0046), against a simulated resumable session that
 * keeps Drive's protocol: `308` with `Range: bytes=0-{n}` while it wants more, `200` with the file
 * once it has every byte, the status query `bytes * /{total}`, and pieces that must start where the
 * held bytes end. Network drops are simulated before and after a piece arrives. No network.
 */

const SESSION = "https://www.googleapis.com/upload/drive/v3/files?upload_id=abc";

type Drop = "before" | "after";

/** A simulated Drive resumable session for `total` bytes. */
function simulatedDrive(
  total: number,
  options: {
    /** Request numbers (1-based) that fail with a network error, before or after Drive got them. */
    drops?: Map<number, Drop>;
    /** Whether a `308`'s `Range` header can be read from script — cross-origin, only if exposed. */
    rangeReadable?: boolean;
    /** Request numbers answered with this status instead. */
    statuses?: Map<number, number>;
    /** Pieces (request numbers) Drive answers `308` to while keeping none of the bytes. */
    keepsNothing?: (request: number) => boolean;
  } = {},
) {
  let held = 0;
  let requests = 0;
  const ranges: string[] = [];

  const answer = () => {
    if (held === total) return Response.json({ id: "drive-file-1" }, { status: 200 });
    const headers = new Headers();
    if (held > 0 && options.rangeReadable !== false) headers.set("range", `bytes=0-${held - 1}`);
    return new Response(null, { status: 308, headers });
  };

  const send = (async (_uri: RequestInfo | URL, init?: RequestInit) => {
    requests += 1;
    const range = new Headers(init?.headers).get("content-range") ?? "";
    ranges.push(range);
    const drop = options.drops?.get(requests);
    if (drop === "before") throw new TypeError("Failed to fetch");
    const status = options.statuses?.get(requests);
    if (status) return new Response(null, { status });

    const piece = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (piece && options.keepsNothing?.(requests)) return answer();
    if (piece) {
      const [from, to] = [Number(piece[1]), Number(piece[2])];
      const size = (init?.body as Blob).size;
      // Drive takes a piece only where its held bytes end, of the length its range says.
      if (from !== held || to - from + 1 !== size) return new Response(null, { status: 400 });
      held = to + 1;
    } else if (range !== `bytes */${total}`) {
      return new Response(null, { status: 400 });
    }
    if (drop === "after") throw new TypeError("Failed to fetch");
    return answer();
  }) as typeof fetch;

  return { fetch: send, ranges, held: () => held, requests: () => requests };
}

const blobOf = (size: number) => new Blob([new Uint8Array(size)]);
const noWait = async () => undefined;
const PIECE = 256 * 1024;

describe("uploadInPieces", () => {
  it("sends 16 MiB pieces by default, a multiple of 256 KiB", () => {
    expect(FOOTAGE_PIECE_BYTES).toBe(16 * 1024 * 1024);
    expect(FOOTAGE_PIECE_BYTES % (256 * 1024)).toBe(0);
  });

  it("sends the file in pieces with their Content-Range, and answers Drive's file id", async () => {
    const total = PIECE * 2 + 1000;
    const drive = simulatedDrive(total);
    const progress: number[] = [];

    const result = await uploadInPieces(SESSION, blobOf(total), {
      pieceBytes: PIECE,
      fetch: drive.fetch,
      sleep: noWait,
      onProgress: (sent) => progress.push(sent),
    });

    expect(result).toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(drive.ranges).toEqual([
      `bytes 0-${PIECE - 1}/${total}`,
      `bytes ${PIECE}-${PIECE * 2 - 1}/${total}`,
      `bytes ${PIECE * 2}-${total - 1}/${total}`,
    ]);
    expect(progress).toEqual([PIECE, PIECE * 2]);
  });

  it("resumes from what Drive holds after a drop before a piece arrived", async () => {
    const total = PIECE * 3;
    const drive = simulatedDrive(total, { drops: new Map([[2, "before"]]) });

    const result = await uploadInPieces(SESSION, blobOf(total), {
      pieceBytes: PIECE,
      fetch: drive.fetch,
      sleep: noWait,
    });

    expect(result).toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(drive.ranges[2]).toBe(`bytes */${total}`);
    expect(drive.ranges[3]).toBe(`bytes ${PIECE}-${PIECE * 2 - 1}/${total}`);
  });

  it("skips a piece Drive already got when the drop came after it arrived", async () => {
    const total = PIECE * 3;
    const drive = simulatedDrive(total, { drops: new Map([[2, "after"]]) });

    const result = await uploadInPieces(SESSION, blobOf(total), {
      pieceBytes: PIECE,
      fetch: drive.fetch,
      sleep: noWait,
    });

    expect(result).toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    // The status query's Range says the second piece is in: the third goes next, not the second again.
    expect(drive.ranges.slice(2)).toEqual([
      `bytes */${total}`,
      `bytes ${PIECE * 2}-${total - 1}/${total}`,
    ]);
  });

  it("falls back to the last piece it saw accepted when Range cannot be read", async () => {
    const total = PIECE * 3;
    const drive = simulatedDrive(total, {
      rangeReadable: false,
      drops: new Map([[3, "before"]]),
    });

    const result = await uploadInPieces(SESSION, blobOf(total), {
      pieceBytes: PIECE,
      fetch: drive.fetch,
      sleep: noWait,
    });

    expect(result).toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(drive.ranges).toEqual([
      `bytes 0-${PIECE - 1}/${total}`,
      `bytes ${PIECE}-${PIECE * 2 - 1}/${total}`,
      `bytes ${PIECE * 2}-${total - 1}/${total}`,
      `bytes */${total}`,
      `bytes ${PIECE * 2}-${total - 1}/${total}`,
    ]);
  });

  it("finishes from the status query when the last piece's answer was lost", async () => {
    const total = PIECE * 2;
    const drive = simulatedDrive(total, { drops: new Map([[2, "after"]]) });

    await expect(
      uploadInPieces(SESSION, blobOf(total), {
        pieceBytes: PIECE,
        fetch: drive.fetch,
        sleep: noWait,
      }),
    ).resolves.toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(drive.requests()).toBe(3);
  });

  it("retries a 503 and a 429, waiting longer each time", async () => {
    const total = PIECE * 2;
    const drive = simulatedDrive(total, {
      statuses: new Map([
        [1, 503],
        [3, 429],
      ]),
    });
    const waits: number[] = [];

    const result = await uploadInPieces(SESSION, blobOf(total), {
      pieceBytes: PIECE,
      fetch: drive.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(result).toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("gives up after too many drops in a row", async () => {
    const total = PIECE * 2;
    const drops = new Map<number, Drop>(Array.from({ length: 20 }, (_, i) => [i + 1, "before"]));
    const drive = simulatedDrive(total, { drops });

    await expect(
      uploadInPieces(SESSION, blobOf(total), {
        pieceBytes: PIECE,
        fetch: drive.fetch,
        sleep: noWait,
        maxRetries: 3,
      }),
    ).resolves.toEqual({ outcome: "failed", reason: "gave-up" });
    // Each try is the piece, then a status query after a wait: three retries, then the fourth drop
    // stops it — seven requests, never an endless loop.
    expect(drive.requests()).toBe(7);
  });

  it("stops once Drive refuses the session outright — the status query too", async () => {
    const total = PIECE * 2;
    const drive = simulatedDrive(total, {
      statuses: new Map([
        [1, 404],
        [2, 404],
      ]),
    });

    await expect(
      uploadInPieces(SESSION, blobOf(total), {
        pieceBytes: PIECE,
        fetch: drive.fetch,
        sleep: noWait,
      }),
    ).resolves.toEqual({ outcome: "failed", reason: "refused" });
    expect(drive.requests()).toBe(2);
  });

  it("gets back in step when a piece is refused because Drive already holds it", async () => {
    // The second piece's answer is lost after Drive took it, and the browser sends it once more, as
    // Chromium does with an idempotent PUT on a reset connection: Drive refuses the copy, and the
    // status query puts the uploader back in step.
    const total = PIECE * 3;
    let sent = 0;
    const drive = simulatedDrive(total);
    const replaying = (async (uri: RequestInfo | URL, init?: RequestInit) => {
      sent += 1;
      const answer = await drive.fetch(uri, init);
      return sent === 2 ? drive.fetch(uri, init) : answer;
    }) as typeof fetch;

    await expect(
      uploadInPieces(SESSION, blobOf(total), {
        pieceBytes: PIECE,
        fetch: replaying,
        sleep: noWait,
      }),
    ).resolves.toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(drive.ranges.slice(1)).toEqual([
      `bytes ${PIECE}-${PIECE * 2 - 1}/${total}`,
      `bytes ${PIECE}-${PIECE * 2 - 1}/${total}`,
      `bytes */${total}`,
      `bytes ${PIECE * 2}-${total - 1}/${total}`,
    ]);
  });
});

describe("uploadInPieces, when Drive's Range cannot be read cross-origin", () => {
  it("goes past a piece the browser re-sent on its own, which Drive then refuses", async () => {
    const total = PIECE * 3;
    let sent = 0;
    const drive = simulatedDrive(total, { rangeReadable: false });
    const replaying = (async (uri: RequestInfo | URL, init?: RequestInit) => {
      sent += 1;
      const answer = await drive.fetch(uri, init);
      return sent === 2 ? drive.fetch(uri, init) : answer;
    }) as typeof fetch;

    await expect(
      uploadInPieces(SESSION, blobOf(total), {
        pieceBytes: PIECE,
        fetch: replaying,
        sleep: noWait,
      }),
    ).resolves.toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(drive.held()).toBe(total);
  });
});

describe("uploadInPieces, on answers that must not wreck an upload", () => {
  it("resends a piece refused once (a 403 rate limit) when Drive says it holds nothing", async () => {
    // A `308` with no `Range` from the status query is Drive saying "nothing yet", not a hidden header.
    const total = PIECE * 2;
    const drive = simulatedDrive(total, { statuses: new Map([[1, 403]]) });

    await expect(
      uploadInPieces(SESSION, blobOf(total), {
        pieceBytes: PIECE,
        fetch: drive.fetch,
        sleep: noWait,
      }),
    ).resolves.toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(drive.held()).toBe(total);
  });

  it("takes back a wrong guess when Range is hidden and a refused piece was not held", async () => {
    const total = PIECE * 3;
    const drive = simulatedDrive(total, {
      rangeReadable: false,
      statuses: new Map([[2, 400]]),
    });

    await expect(
      uploadInPieces(SESSION, blobOf(total), {
        pieceBytes: PIECE,
        fetch: drive.fetch,
        sleep: noWait,
      }),
    ).resolves.toEqual({ outcome: "uploaded", fileId: "drive-file-1" });
    expect(drive.held()).toBe(total);
  });

  it("gives up, rather than looping, when Drive keeps none of a piece it answers 308 to", async () => {
    const total = PIECE * 2;
    const drive = simulatedDrive(total, { keepsNothing: (request) => request >= 2 });

    await expect(
      uploadInPieces(SESSION, blobOf(total), {
        pieceBytes: PIECE,
        fetch: drive.fetch,
        sleep: noWait,
        maxRetries: 3,
      }),
    ).resolves.toEqual({ outcome: "failed", reason: "gave-up" });
    expect(drive.requests()).toBe(5);
  });
});

describe("uploadEach", () => {
  it("sends one file at a time, and one failing does not sink the rest", async () => {
    const files = ["a", "b", "c"].map((name) => new File(["x"], name));
    const order: string[] = [];
    let running = 0;

    const results = await uploadEach(
      files,
      async (file) => {
        running += 1;
        expect(running).toBe(1);
        order.push(file.name);
        await Promise.resolve();
        running -= 1;
        if (file.name === "b") throw new Error("boom");
        return "ok";
      },
      () => "failed",
    );

    expect(order).toEqual(["a", "b", "c"]);
    expect(results.map((entry) => [entry.file.name, entry.result])).toEqual([
      ["a", "ok"],
      ["b", "failed"],
      ["c", "ok"],
    ]);
  });
});
