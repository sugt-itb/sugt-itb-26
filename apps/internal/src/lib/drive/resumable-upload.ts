/**
 * **Sending one large file to a Drive resumable session in pieces** (#424, ADR-0046) — for Session
 * Footage only; receipts and Dokumen still go in one `PUT` (`putToDriveSession`). A 1 GB video sent in
 * one request over a phone's connection fails often and restarts from zero; in pieces, a drop costs
 * one piece at most.
 *
 * Drive's protocol, from the browser, straight to Google — the bytes never pass through Next:
 *
 * - **A piece** is a `PUT` of `FOOTAGE_PIECE_BYTES` (16 MiB, a multiple of the 256 KiB Drive requires
 *   of every piece but the last) with `Content-Range: bytes {from}-{to}/{total}`. Drive answers `308`
 *   while it wants more — its `Range: bytes=0-{n}` saying what it holds — and `200`/`201` with the
 *   file once it has every byte.
 * - **After anything else** — a network error, a `5xx`, a `429`, or a piece Drive would not take — it
 *   asks Drive what it holds (`PUT` with `Content-Range: bytes * /{total}`, no body) and resumes from
 *   there, waiting a little longer each time, up to `maxRetries` in a row. A status query Drive
 *   refuses outright (an expired session: `404`) ends it at once; past `maxRetries` it gives up.
 *
 * **Why a refused piece is not the end.** Checked in Chromium against a stand-in for the protocol: a
 * piece whose connection dropped after it arrived was **re-sent by the browser itself** — a `PUT` is
 * idempotent, and Chromium retries one on a reused connection that reset — so the uploader's next
 * answer was the server refusing bytes it already held. Asking what Drive holds puts it back in step.
 *
 * **When `Range` cannot be read.** Cross-origin, a response header is readable only if Drive exposes
 * it. When a `308` carries no readable `Range`, the upload resumes from the last piece it knows Drive
 * accepted — a `308` for a piece arrives only once the piece is received — which is never ahead of
 * what Drive holds. One case that is not enough, found in the browser: a piece the browser re-sent on
 * its own is held, so re-sending it is refused for ever; a piece refused (`400`) at the known offset
 * is therefore taken as held — once, and taken back if the next piece is refused too. A `308` that
 * keeps none of a piece counts toward giving up, so no answer can make it loop. ADR-0046 records what
 * was verified, against what, and what was not.
 *
 * Everything it touches is passed in (`fetch`, `sleep`), so the protocol is tested without a network.
 */

/** One piece: 16 MiB, a multiple of 256 KiB. */
export const FOOTAGE_PIECE_BYTES = 16 * 1024 * 1024;

export type ResumableUploadResult =
  | { outcome: "uploaded"; fileId: string }
  /**
   * `gave-up`: Drive could not be reached `maxRetries` times in a row. `refused`: Drive refused the
   * upload outright — the session expired, or the bytes did not match what it was opened for.
   */
  | { outcome: "failed"; reason: "gave-up" | "refused" };

export type ResumableUploadOptions = {
  pieceBytes?: number;
  /** Consecutive failures tolerated before giving up. */
  maxRetries?: number;
  /** The wait before the `n`th retry (1-based). */
  backoffMs?: (attempt: number) => number;
  /** Called after each accepted piece with the bytes Drive holds. */
  onProgress?: (sent: number, total: number) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultBackoff = (attempt: number) => Math.min(30_000, 1_000 * 2 ** (attempt - 1));
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The offset after the last byte a `308`'s `Range: bytes=0-{n}` names; `null` when unreadable. */
function heldThrough(response: Response): number | null {
  const range = response.headers.get("range");
  const match = range ? /bytes=0-(\d+)/.exec(range) : null;
  return match ? Number(match[1]) + 1 : null;
}

/** Drive's file id from a finished upload's body, or `null`. */
async function fileIdOf(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return typeof body?.id === "string" ? body.id : null;
}

/** A status a retry may cure: a timeout, Drive's own trouble or its rate limit. */
function transient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function uploadInPieces(
  sessionUri: string,
  blob: Blob,
  options: ResumableUploadOptions = {},
): Promise<ResumableUploadResult> {
  const pieceBytes = options.pieceBytes ?? FOOTAGE_PIECE_BYTES;
  const maxRetries = options.maxRetries ?? 5;
  const backoffMs = options.backoffMs ?? defaultBackoff;
  const send = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const total = blob.size;

  /** Where the next piece starts: what Drive is known to hold, or — once — a guess past it. */
  let accepted = 0;
  let failures = 0;
  /**
   * Whether `Range` is hidden from script. Learnt from a piece's `308`: Drive then holds bytes, so a
   * `308` with no readable `Range` means it is not exposed. A status query's `308` without one proves
   * nothing — that is also how Drive says it holds nothing yet.
   */
  let rangeHidden = false;
  /** What Drive held before a guess past a refused piece, so a wrong guess can be taken back. */
  let beforeGuess: number | null = null;

  /** Wait, then ask Drive what it holds. `"done"` with the id when it already has everything. */
  async function recover(): Promise<{ done: string } | "again" | "refused"> {
    failures += 1;
    if (failures > maxRetries) return "refused";
    await sleep(backoffMs(failures));
    try {
      const status = await send(sessionUri, {
        method: "PUT",
        headers: { "content-range": `bytes */${total}` },
      });
      if (status.ok) {
        const id = await fileIdOf(status);
        return id ? { done: id } : "refused";
      }
      if (status.status === 308) {
        accepted = Math.max(accepted, heldThrough(status) ?? accepted);
        return "again";
      }
      return transient(status.status) ? "again" : "refused";
    } catch {
      // Still unreachable: the next recover waits longer.
      return "again";
    }
  }

  while (true) {
    const from = accepted;
    const to = Math.min(from + pieceBytes, total);
    let response: Response | null = null;
    try {
      response = await send(sessionUri, {
        method: "PUT",
        headers: { "content-range": `bytes ${from}-${to - 1}/${total}` },
        body: blob.slice(from, to),
      });
    } catch {
      response = null;
    }

    if (response && response.ok) {
      const id = await fileIdOf(response);
      return id ? { outcome: "uploaded", fileId: id } : { outcome: "failed", reason: "refused" };
    }
    if (response && response.status === 308) {
      // Received. Drive's `Range` is the authority when readable; otherwise this piece's end.
      const held = heldThrough(response);
      if (held === null) rangeHidden = true;
      const next = held ?? to;
      if (next > from) {
        accepted = next;
        failures = 0;
        beforeGuess = null;
        options.onProgress?.(accepted, total);
        continue;
      }
      // Drive kept none of the piece. Not progress, so it counts toward giving up — never a loop.
      failures += 1;
      if (failures > maxRetries) return { outcome: "failed", reason: "gave-up" };
      await sleep(backoffMs(failures));
      continue;
    }
    // A drop, Drive's own trouble, or a piece it would not take: ask what it holds before deciding.
    const refusedAsHeld = response?.status === 400;
    const recovered = await recover();
    if (recovered === "again" && rangeHidden && refusedAsHeld && accepted === from) {
      if (beforeGuess === null) {
        // Drive refused a piece starting where it was last known to stand, and cannot say what it
        // holds: the browser most likely re-sent that piece on its own, so Drive has it. Go past it,
        // once. Drive refuses a piece that leaves a gap, so a wrong guess never corrupts the file.
        beforeGuess = accepted;
        accepted = to;
      } else {
        // The guess was wrong — the piece after it was refused too. Take it back, and guess no more
        // until a piece is accepted.
        accepted = beforeGuess;
      }
    }
    if (recovered === "refused") {
      return { outcome: "failed", reason: failures > maxRetries ? "gave-up" : "refused" };
    }
    if (recovered !== "again") return { outcome: "uploaded", fileId: recovered.done };
  }
}

/** One file of a batch: what came of it, alone. */
export type BatchFileResult<T> = { file: File; result: T };

/**
 * **A batch is sent one file at a time** (ADR-0046), so a phone never holds several gigabytes in
 * flight, and each file is its own open → upload → record: one failing does not sink the rest.
 */
export async function uploadEach<T>(
  files: readonly File[],
  uploadOne: (file: File) => Promise<T>,
  /** What a file that threw counts as — so a throw is one file's failure, not the batch's. */
  onError: (error: unknown) => T,
): Promise<BatchFileResult<T>[]> {
  const results: BatchFileResult<T>[] = [];
  for (const file of files) {
    results.push({ file, result: await uploadOne(file).catch(onError) });
  }
  return results;
}
