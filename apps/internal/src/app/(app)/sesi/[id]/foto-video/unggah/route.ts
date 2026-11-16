import { openFootageFolderResponse } from "-/lib/foto-video-route";

/**
 * **Foto & Video — open the Session's upload folder** (#561, ADR-0063), where the trip's writers put
 * photos and videos straight from Google Drive. Writers only (ADR-0048); anyone else gets a 404. It
 * makes the archive's folders too, so the daily copy (#562) always has somewhere to copy to.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/sesi/[id]/foto-video/unggah">,
) {
  return openFootageFolderResponse(request, (await params).id, "upload");
}
