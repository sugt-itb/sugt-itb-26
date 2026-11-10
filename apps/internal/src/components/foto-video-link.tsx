import { fotoVideoHref } from "-/lib/foto-video";
import { LinkButton } from "@sugt/ui/components/link-button";
import { ExternalLink } from "lucide-react";

/**
 * **The Foto & Video button** (#552, ADR-0061): a plain link, in a new tab, to the route that opens
 * the Session's folder in the company Google Drive (`/sesi/[id]/foto-video/buka`). Staff add photos
 * and videos there through Drive itself; the app uploads nothing. `dari` is the page the click came
 * from, where the route sends the tab back with a notice when the folder cannot be opened.
 */
export function FotoVideoLink({
  sessionId,
  from,
  label,
}: {
  sessionId: string;
  /** The page this button is on, e.g. `/pendamping`. */
  from: string;
  /** The accessible name, when the visible text alone is ambiguous — one of many on a timeline. */
  label?: string;
}) {
  return (
    <LinkButton
      href={fotoVideoHref(sessionId, from)}
      target="_blank"
      rel="noopener noreferrer"
      variant="secondary"
      size="sm"
      className="rounded-full"
      aria-label={label}
    >
      Foto & Video
      <ExternalLink aria-hidden />
    </LinkButton>
  );
}
