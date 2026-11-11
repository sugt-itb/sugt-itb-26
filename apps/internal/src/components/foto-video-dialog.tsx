"use client";

import {
  openFootageUploadAction,
  recordFootageAction,
  sessionFootageAction,
} from "-/app/(app)/sesi/[id]/foto-video/actions";
import {
  checkPickedFootage,
  FOOTAGE_ACCEPT,
  FOOTAGE_DESCRIPTION,
  footageUnsyncedNote,
  footageKindLabel,
  footageTitle,
  formatFileSize,
  MAX_FOOTAGE_FILES_PER_BATCH,
  type PickedFootage,
} from "-/components/foto-video-form";
import { FotoVideoList } from "-/components/foto-video-list";
import { uploadFootageBatch } from "-/components/foto-video-upload";
import {
  holdOpenWhile,
  UploadStatus,
  useLeaveWarning,
  type UploadProgress,
} from "-/components/upload-status";
import { uploadInPieces } from "-/lib/drive/resumable-upload";
import type { UploadGate } from "-/lib/drive/upload-gate";
import type { SessionFootageRow } from "@sugt/db/queries";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import { XIcon } from "lucide-react";
import { type ReactElement, useRef, useState, useTransition } from "react";

/**
 * **Foto & Video — one Session's photos and videos** (#425, ADR-0046), opened from a Session row on
 * `/pendamping` or the section on `/sesi/[id]`. The files so far (`FotoVideoList`), each with Buka
 * and, for Staff, Hapus; and, while uploading is allowed, the picker and **Unggah**.
 *
 * **Picked files are checked at once** — type, size against the kind's cap, at most 30 — and a
 * refused one is named with its reason and left out. **Unggah sends them one at a time**, each opened,
 * sent to Drive in pieces and recorded on its own (`uploadFootageBatch`), under #420's status line, the
 * popup locked and the page warning before it is left. Afterwards a summary names each failure with
 * its reason, and **Coba lagi** sends just those again.
 *
 * The list is fetched when the popup opens and after every upload or Hapus. **It still opens when
 * Drive is down**, so the files can be viewed; only uploading is closed then, with the reason said.
 */
function FotoVideoDialog({
  sessionId,
  heldOn,
  schoolName,
  uploadGate,
  canUpload,
  canDelete,
  onChanged,
  trigger,
}: {
  sessionId: string;
  heldOn: string;
  schoolName: string;
  uploadGate: UploadGate;
  /** Staff, on a Session that is not cancelled. */
  canUpload: boolean;
  /** Staff. */
  canDelete: boolean;
  /** After an upload or a Hapus, for a page that lists the footage itself. */
  onChanged?: () => void;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [footage, setFootage] = useState<SessionFootageRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picked, setPicked] = useState<PickedFootage[]>([]);
  const [refusedPicks, setRefusedPicks] = useState<{ file: File; reason: string }[]>([]);
  const [overLimit, setOverLimit] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    uploaded: number;
    failures: { picked: PickedFootage; reason: string }[];
    /** How many were recorded but are not yet in place in Drive. */
    unsynced: number;
  } | null>(null);
  const [saving, startSaving] = useTransition();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useLeaveWarning(saving);

  async function load() {
    const loaded = await sessionFootageAction(sessionId).catch(() => null);
    setFootage(loaded);
    setLoadFailed(loaded === null);
  }

  function pick(files: File[]) {
    const checked = checkPickedFootage(files, picked);
    setPicked((current) => [...current, ...checked.accepted]);
    setRefusedPicks(checked.refused);
    setOverLimit(checked.overLimit);
    // The last batch's summary stays: its failures and Coba lagi are still to be dealt with.
  }

  function upload(batch: PickedFootage[]) {
    if (batch.length === 0) return;
    // Set before the transition: React holds an async transition's updates made before its first
    // `await` until the whole action ends (#420).
    setProgress({ phase: "uploading", done: 0, total: batch.length });
    setSummary(null);
    setRefusedPicks([]);
    setOverLimit(null);
    startSaving(async () => {
      const results = await uploadFootageBatch(sessionId, batch, {
        open: openFootageUploadAction,
        send: (sessionUri, file) => uploadInPieces(sessionUri, file),
        record: recordFootageAction,
        onStep: ({ phase, index, total }) => {
          setProgress(
            phase === "saving" ? { phase: "saving" } : { phase: "uploading", done: index, total },
          );
        },
      });

      const failures = results.flatMap((entry, index) =>
        entry.result.ok ? [] : [{ picked: batch[index]!, reason: entry.result.reason }],
      );
      setSummary({
        uploaded: results.length - failures.length,
        failures,
        unsynced: results.filter((entry) => entry.result.ok && !entry.result.synced).length,
      });
      setPicked([]);
      await load();
      onChanged?.();
    });
  }

  const uploadOpen = canUpload && uploadGate.open;

  return (
    <Dialog
      open={open}
      onOpenChange={holdOpenWhile(saving, (next) => {
        setOpen(next);
        if (next) {
          setSummary(null);
          setRefusedPicks([]);
          setOverLimit(null);
          void load();
        }
      })}
    >
      <DialogTrigger render={trigger} />
      <DialogContent
        size="panel"
        closeDisabled={saving}
      >
        <DialogHeader>
          <DialogTitle>{footageTitle(heldOn, schoolName)}</DialogTitle>
          <DialogDescription>{FOOTAGE_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {/* `min-w-0` on each grid item, and `truncate` or `break-all` on every file name, so a long
              name never widens the track — and the popup — past a phone's width. */}
          {canUpload && (
            <div className="grid min-w-0 gap-3">
              {!uploadGate.open && (
                <p className="text-sm text-muted-foreground">{uploadGate.reason}</p>
              )}

              {summary && (
                <Alert variant={summary.failures.length > 0 ? "destructive" : "default"}>
                  <AlertTitle>{summary.uploaded} berkas terunggah</AlertTitle>
                  <AlertDescription>
                    {summary.failures.length > 0 && (
                      <ul className="grid gap-1">
                        {summary.failures.map(({ picked: failed, reason }, index) => (
                          <li
                            key={`${failed.file.name}-${failed.file.size}-${failed.file.lastModified}-${index}`}
                            // `break-all`: a long name with no space must break, not widen the popup.
                            className="break-all"
                          >
                            {failed.file.name}: {reason}
                          </li>
                        ))}
                      </ul>
                    )}
                    {summary.unsynced > 0 && <p>{footageUnsyncedNote(summary.unsynced)}</p>}
                    {summary.failures.length > 0 && uploadOpen && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 w-fit"
                        disabled={saving}
                        onClick={() => {
                          upload(summary.failures.map((failure) => failure.picked));
                        }}
                      >
                        Coba lagi
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <input
                ref={picker}
                type="file"
                multiple
                accept={FOOTAGE_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  pick([...(event.target.files ?? [])]);
                  // Clear it, so picking the same file again after removing it still fires.
                  event.target.value = "";
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={!uploadOpen || saving}
                  onClick={() => picker.current?.click()}
                >
                  Pilih foto/video
                </Button>
                <span className="text-xs text-muted-foreground">
                  Foto JPG, PNG, HEIC atau WebP maks. 50 MB; video MP4 atau MOV maks. 1000 MB;
                  paling banyak {MAX_FOOTAGE_FILES_PER_BATCH} berkas sekali unggah.
                </span>
              </div>

              {overLimit && <p className="text-sm text-destructive">{overLimit}</p>}
              {refusedPicks.length > 0 && (
                <ul className="grid gap-1 text-sm text-destructive">
                  {refusedPicks.map(({ file, reason }, index) => (
                    <li
                      key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                      className="break-all"
                    >
                      {file.name}: {reason}
                    </li>
                  ))}
                </ul>
              )}

              {picked.length > 0 && (
                <ul className="grid gap-1.5 text-sm">
                  {picked.map((entry, index) => (
                    <li
                      key={`${entry.file.name}-${entry.file.size}-${entry.file.lastModified}-${index}`}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <span className="text-xs text-muted-foreground">
                        {footageKindLabel(entry.kind)}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={entry.file.name}
                      >
                        {entry.file.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatFileSize(entry.file.size)}
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Batalkan ${entry.file.name}`}
                        disabled={saving}
                        onClick={() => {
                          setPicked((current) => current.filter((_, at) => at !== index));
                        }}
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div
            className={
              canUpload ? "grid min-w-0 gap-2 border-t border-border pt-4" : "grid min-w-0 gap-2"
            }
          >
            <h3 className="text-sm font-medium">Sudah diunggah</h3>
            {loadFailed && (
              <p className="text-sm text-destructive">
                Foto & Video tidak dapat dimuat — tutup lalu buka lagi.
              </p>
            )}
            {footage && (
              <FotoVideoList
                footage={footage}
                hapus={
                  canDelete
                    ? {
                        // Closed too while files upload, so nothing else changes the list under it.
                        gate: saving
                          ? { open: false, reason: "Tunggu sampai unggahan selesai." }
                          : uploadGate,
                        onDeleted: () => {
                          void load();
                          onChanged?.();
                        },
                      }
                    : undefined
                }
              />
            )}
          </div>
        </DialogBody>

        {saving && progress && <UploadStatus progress={progress} />}

        {canUpload && (
          <DialogFooter>
            <Button
              disabled={!uploadOpen || saving || picked.length === 0}
              onClick={() => {
                upload(picked);
              }}
            >
              {saving
                ? "Mengunggah…"
                : picked.length > 0
                  ? `Unggah ${picked.length} berkas`
                  : "Unggah"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { FotoVideoDialog };
