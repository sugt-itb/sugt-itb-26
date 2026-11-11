"use client";

import { deleteFootageAction } from "-/app/(app)/sesi/[id]/foto-video/actions";
import {
  FOOTAGE_UNSYNCED_TOOLTIP,
  footageDeleteRefusalText,
  footageKindLabel,
  formatFileSize,
} from "-/components/foto-video-form";
import { UnsyncedMarker } from "-/components/unsynced-marker";
import { driveFileUrl } from "-/lib/drive/receipt-files";
import type { UploadGate } from "-/lib/drive/upload-gate";
import { formatWibIndonesian } from "-/lib/format-wib";
import type { SessionFootageRow } from "@sugt/db/queries";
import { Badge } from "@sugt/ui/components/badge";
import { Button } from "@sugt/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import { useState, useTransition } from "react";

/**
 * **A Session's Foto & Video, newest first** (#425, ADR-0046): each file's kind, its name as it was
 * picked, its size, who uploaded it and when, a **Buka** link to it in Drive, and "belum tersinkron"
 * while it is not yet in place. One list for both places that show it — the Foto & Video popup on a
 * `/pendamping` Session row, and the section on `/sesi/[id]`.
 *
 * With `hapus` (Staff), each row also carries **Hapus**, behind a confirmation.
 */
function FotoVideoList({
  footage,
  hapus,
}: {
  footage: SessionFootageRow[];
  /** Hapus on every row: closed with the gate's reason while Drive cannot take it. */
  hapus?: { gate: UploadGate; onDeleted: () => void };
}) {
  if (footage.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada foto atau video.</p>;
  }
  return (
    <ul className="grid min-w-0 gap-2 text-sm">
      {footage.map((row) => (
        <li
          key={row.id}
          className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="secondary">{footageKindLabel(row.kind)}</Badge>
              <span
                className="min-w-0 truncate"
                title={row.originalFilename}
              >
                {row.originalFilename}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(row.byteSize)} · {row.uploadedByName} ·{" "}
              {formatWibIndonesian(row.uploadedAt)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
            <a
              href={driveFileUrl(row.driveFileId)}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Buka
            </a>
            {row.unsynced && <UnsyncedMarker explanation={FOOTAGE_UNSYNCED_TOOLTIP} />}
            {hapus && (
              <Hapus
                row={row}
                gate={hapus.gate}
                onDeleted={hapus.onDeleted}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * **Hapus** behind a confirmation. The file goes to the Drive trash first, then the row; a refusal —
 * Drive disconnected, or unreachable — leaves the file listed and says why.
 */
function Hapus({
  row,
  gate,
  onDeleted,
}: {
  row: SessionFootageRow;
  gate: UploadGate;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();

  function submit() {
    setRefusal(null);
    startDeleting(async () => {
      const result = await deleteFootageAction(row.id);
      if (result.outcome === "deleted" || result.outcome === "no-such-footage") {
        setOpen(false);
        onDeleted();
        return;
      }
      setRefusal(footageDeleteRefusalText(result));
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        setOpen(next);
        if (next) setRefusal(null);
      }}
    >
      <DialogTrigger
        disabled={!gate.open}
        title={gate.open ? undefined : gate.reason}
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Hapus ${row.originalFilename}`}
          >
            Hapus
          </Button>
        }
      />
      <DialogContent closeDisabled={deleting}>
        <DialogHeader>
          <DialogTitle>Hapus berkas</DialogTitle>
          <DialogDescription>
            Hapus berkas ini? File akan dipindahkan ke Sampah Google Drive.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm break-all">
          {footageKindLabel(row.kind)} · {row.originalFilename}
        </p>
        {refusal !== null && <p className="text-sm text-destructive">{refusal}</p>}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={deleting}
            onClick={() => {
              setOpen(false);
            }}
          >
            Batal
          </Button>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={submit}
          >
            {deleting ? "Menghapus…" : "Hapus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { FotoVideoList };
