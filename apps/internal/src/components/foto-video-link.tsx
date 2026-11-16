import { type FotoVideoFolder, fotoVideoHref } from "-/lib/foto-video";
import { LinkButton } from "@sugt/ui/components/link-button";
import { ExternalLink } from "lucide-react";

const LABELS: Record<FotoVideoFolder, string> = { upload: "Foto & Video", archive: "Lihat arsip" };

/**
 * **A Session's Foto & Video buttons** (#561, ADR-0063): plain links, in a new tab, to the routes that
 * open its folders in the company Google Drive. **Foto & Video** opens the upload folder, where Staff
 * add photos and videos through Drive itself, and is shown only to the trip's writers (ADR-0048). **Lihat arsip** opens the company-owned archive, for everyone. `from` is the page the
 * click came from, where a route sends the tab back with a notice when the folder cannot be opened.
 */
export function FotoVideoLinks({
  sessionId,
  from,
  folders,
  label,
}: {
  sessionId: string;
  /** The page these buttons are on, e.g. `/pendamping`. */
  from: string;
  /**
   * Which buttons, in order. `"upload"` (Foto & Video) only for the trip's writers; the routes check
   * that again.
   */
  folders: readonly FotoVideoFolder[];
  /** Said after each button's name, when the visible text alone is ambiguous — one of many on a timeline. */
  label?: string;
}) {
  return (
    <>
      {folders.map((folder) => (
        <LinkButton
          key={folder}
          href={fotoVideoHref(sessionId, folder, from)}
          target="_blank"
          rel="noopener noreferrer"
          variant="secondary"
          size="sm"
          className="rounded-full"
          aria-label={label ? `${LABELS[folder]} ${label}` : undefined}
        >
          {LABELS[folder]}
          <ExternalLink aria-hidden />
        </LinkButton>
      ))}
    </>
  );
}
