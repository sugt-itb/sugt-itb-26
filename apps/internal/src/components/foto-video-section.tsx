import { FotoVideoLink } from "-/components/foto-video-link";

/**
 * **The Foto & Video section on `/sesi/[id]`** (#425, #552), so a Pimpinan — who cannot open
 * `/pendamping` — reaches a Session's photos and videos too. Since ADR-0061 it is one link: it opens
 * the Session's own folder in the company Google Drive in a new tab, where whoever the trip's sharing
 * lets edit (its Group, a Perjadin Editor, an Administrator) adds files, and everyone else views them.
 *
 * A **cancelled** Session shows the link only when its folder already exists, since the route never
 * makes one for it; with none, the section says so.
 */
function FotoVideoSection({
  sessionId,
  cancelled,
  hasFolder,
}: {
  sessionId: string;
  cancelled: boolean;
  /** Whether the Session's folder exists in Drive yet. */
  hasFolder: boolean;
}) {
  const offered = !cancelled || hasFolder;
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-medium">Foto & Video</h2>
        {offered && (
          <FotoVideoLink
            sessionId={sessionId}
            from={`/sesi/${sessionId}`}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {offered
          ? "Foto dan video sesi ini disimpan di foldernya di Google Drive."
          : "Sesi ini dibatalkan dan tidak punya folder Foto & Video."}
      </p>
    </section>
  );
}

export { FotoVideoSection };
