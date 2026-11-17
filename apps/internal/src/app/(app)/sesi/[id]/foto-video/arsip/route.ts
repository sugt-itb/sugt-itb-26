import { openFootageFolderResponse } from "-/lib/foto-video-route";

/**
 * **Lihat arsip — open the Session's archive folder** (#561, ADR-0063): the company-owned Session
 * Footage, which anyone with the folder's link can view. Open to anyone signed in, a Pimpinan
 * included; making or sharing the folder is the company account's housekeeping.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/sesi/[id]/foto-video/arsip">,
) {
  return openFootageFolderResponse(request, (await params).id, "archive");
}
