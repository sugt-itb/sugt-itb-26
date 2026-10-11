"use client";

import { FotoVideoDialog } from "-/components/foto-video-dialog";
import { FotoVideoList } from "-/components/foto-video-list";
import type { UploadGate } from "-/lib/drive/upload-gate";
import type { SessionFootageRow } from "@sugt/db/queries";
import { Button } from "@sugt/ui/components/button";

/**
 * **The Foto & Video section on `/sesi/[id]`** (#425), so a Pimpinan — who cannot open `/pendamping`
 * — sees a Session's photos and videos too. The list, with **Buka** for everyone; for whoever writes
 * the Session's trip (its Group, a Perjadin Editor or an Administrator — ADR-0048), **Hapus** and the upload
 * popup. A cancelled Session keeps its list but offers no upload. An upload or a Hapus
 * revalidates this page in its own Server Action, so the list here follows without a refresh.
 */
function FotoVideoSection({
  sessionId,
  heldOn,
  schoolName,
  footage,
  canWrite,
  cancelled,
  uploadGate,
}: {
  sessionId: string;
  heldOn: string;
  schoolName: string;
  footage: SessionFootageRow[];
  canWrite: boolean;
  cancelled: boolean;
  uploadGate: UploadGate;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-medium">Foto & Video</h2>
        {canWrite && !cancelled && (
          <FotoVideoDialog
            sessionId={sessionId}
            heldOn={heldOn}
            schoolName={schoolName}
            uploadGate={uploadGate}
            canUpload
            canDelete
            trigger={
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full"
              >
                Unggah Foto & Video
              </Button>
            }
          />
        )}
      </div>
      {/* Hapus is closed while Drive is down; said as text, since a disabled button's title never
          shows on touch. */}
      {canWrite && !uploadGate.open && (
        <p className="text-xs text-muted-foreground">{uploadGate.reason}</p>
      )}
      <FotoVideoList
        footage={footage}
        hapus={canWrite ? { gate: uploadGate, onDeleted: () => undefined } : undefined}
      />
    </section>
  );
}

export { FotoVideoSection };
