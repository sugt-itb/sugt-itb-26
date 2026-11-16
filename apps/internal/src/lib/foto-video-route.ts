import {
  type FootageFolderKind,
  openSessionFootageFolder,
} from "-/lib/drive/session-footage-folder";
import { requireEnv } from "-/lib/env";
import { fotoVideoBackUrl } from "-/lib/foto-video";
import { requirePerson } from "-/lib/person";

/**
 * **What both Foto & Video routes answer** (#561, ADR-0063): `/sesi/[id]/foto-video/unggah` (the
 * upload folder, for the trip's writers) and `/sesi/[id]/foto-video/arsip` (the archive, for anyone
 * signed in). The buttons are plain links, opened in a new tab: this makes the folders if it must,
 * shares them, and answers with a **303** to Drive. A link rather than `window.open` after an `await`,
 * because Safari blocks a tab opened that way.
 *
 * A **404** for no such Session, an online one, a cancelled one with no folder, and — on the upload
 * route — a caller who does not write the trip. When the folder cannot be had, it sends the tab back
 * to the page the click came from (`dari`), which says why.
 */
export async function openFootageFolderResponse(
  request: Request,
  sessionId: string,
  kind: FootageFolderKind,
): Promise<Response> {
  const person = await requirePerson();

  const opened = await openSessionFootageFolder(person, sessionId, kind);
  if (opened.outcome === "no-such-folder") return new Response("Not found", { status: 404 });
  if (opened.outcome === "open") {
    return Response.redirect(
      `https://drive.google.com/drive/folders/${encodeURIComponent(opened.folderId)}`,
      303,
    );
  }

  const from = new URL(request.url).searchParams.get("dari");
  return Response.redirect(
    fotoVideoBackUrl(from, sessionId, requireEnv("BETTER_AUTH_URL"), opened.outcome),
    303,
  );
}
