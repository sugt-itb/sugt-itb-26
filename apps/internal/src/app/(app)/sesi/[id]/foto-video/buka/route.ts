import { openSessionFootageFolder } from "-/lib/drive/session-footage-folder";
import { requireEnv } from "-/lib/env";
import { fotoVideoBackUrl } from "-/lib/foto-video";
import { requirePerson } from "-/lib/person";

/**
 * **Foto & Video — open a Session's folder in the company Google Drive** (#552, ADR-0061). The button
 * on `/pendamping` and `/sesi/[id]` is a plain link here, opened in a new tab: this handler makes the
 * folder if it must, shares it, and answers with a **303** to Drive. A link rather than `window.open`
 * after an `await`, because Safari blocks a tab opened that way.
 *
 * Open to anyone signed in, a Pimpinan included: opening is a read, and making or sharing the folder
 * is the company account's housekeeping (`openSessionFootageFolder`). When the folder cannot be had,
 * it sends the tab back to the page the click came from (`dari`), which says why.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/sesi/[id]/foto-video/buka">,
) {
  const person = await requirePerson();
  const { id } = await params;

  const opened = await openSessionFootageFolder(person, id);
  if (opened.outcome === "no-such-folder") return new Response("Not found", { status: 404 });
  if (opened.outcome === "open") {
    return Response.redirect(
      `https://drive.google.com/drive/folders/${encodeURIComponent(opened.folderId)}`,
      303,
    );
  }

  const from = new URL(request.url).searchParams.get("dari");
  return Response.redirect(
    fotoVideoBackUrl(from, id, requireEnv("BETTER_AUTH_URL"), opened.outcome),
    303,
  );
}
