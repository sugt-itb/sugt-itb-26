"use client";

import {
  FOTO_VIDEO_NOTICE_PARAM,
  FOTO_VIDEO_NOTICES,
  type FotoVideoNoticeCode,
} from "-/lib/foto-video";
import { Alert, AlertDescription } from "@sugt/ui/components/alert";
import { useSearchParams } from "next/navigation";

/**
 * **The notice a page shows when the Foto & Video route sent the tab back** (#552): the folder could
 * not be opened, and the URL's `foto-video` says why. Read **in the browser**, so the page's server
 * render never reads the URL for it — `/pendamping` reads no search parameter at all for a viewer
 * without the Perjadin Editor Grant, and this keeps it so. Any other value renders nothing, so the
 * sentence is always the app's own, never text from the URL.
 */
export function FotoVideoNotice({ className }: { className?: string }) {
  const code = useSearchParams()?.get(FOTO_VIDEO_NOTICE_PARAM) ?? null;
  if (code === null || !Object.hasOwn(FOTO_VIDEO_NOTICES, code)) return null;
  return (
    <Alert
      variant="destructive"
      className={className}
    >
      <AlertDescription>{FOTO_VIDEO_NOTICES[code as FotoVideoNoticeCode]}</AlertDescription>
    </Alert>
  );
}
