import { FotoVideoLinks } from "-/components/foto-video-link";
import { FOTO_VIDEO_UPLOAD_NOTE } from "-/lib/foto-video";

/**
 * **The Foto & Video section on `/sesi/[id]`** (#425, #561), so a Pimpinan — who cannot open
 * `/pendamping` — reaches a Session's photos and videos too. Since ADR-0063 it is two links, each
 * opening one of the Session's folders in the company Google Drive in a new tab:
 *
 * - **Foto & Video**, the upload folder, for the trip's writers (`canUpload`: its Group, a Perjadin
 *   Editor, an Administrator), with the note that files are copied to the archive once a day;
 * - **Lihat arsip**, the company-owned archive, for everyone signed in.
 *
 * A **cancelled** Session shows a link only when its folder already exists, since the routes never
 * make one for it; with neither, the section says so.
 */
function FotoVideoSection({
  sessionId,
  cancelled,
  canUpload,
  hasArchiveFolder,
  hasUploadFolder,
}: {
  sessionId: string;
  cancelled: boolean;
  /** Whether the viewer writes the trip (ADR-0048). */
  canUpload: boolean;
  /** Whether the Session's archive folder exists in Drive yet. */
  hasArchiveFolder: boolean;
  /** Whether the Session's upload folder exists in Drive yet. */
  hasUploadFolder: boolean;
}) {
  const offersArchive = !cancelled || hasArchiveFolder;
  const offersUpload = canUpload && (!cancelled || hasUploadFolder);
  const folders = [
    ...(offersUpload ? (["upload"] as const) : []),
    ...(offersArchive ? (["archive"] as const) : []),
  ];
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-medium">Foto & Video</h2>
        {folders.length > 0 && (
          <span className="flex flex-wrap gap-2">
            <FotoVideoLinks
              sessionId={sessionId}
              from={`/sesi/${sessionId}`}
              folders={folders}
            />
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {offersUpload
          ? FOTO_VIDEO_UPLOAD_NOTE
          : offersArchive
            ? "Foto dan video sesi ini disimpan di arsipnya di Google Drive."
            : "Sesi ini dibatalkan dan tidak punya folder Foto & Video."}
      </p>
    </section>
  );
}

export { FotoVideoSection };
