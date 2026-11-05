"use client";

import {
  openDocumentSessionAction,
  perjadinDokumenAction,
  recordDocumentAction,
} from "-/app/(app)/perjadin/[id]/dokumen/actions";
import {
  documentFields,
  DOCUMENT_ACCEPT,
  DOCUMENT_HINT,
  DOCUMENT_UNSYNCED_NOTE,
  EMPTY_DOCUMENT_FORM,
  pickDocument,
  recordRefusalText,
  sessionRefusalText,
  SPPD_EXISTS_MARK,
  type DocumentForm,
} from "-/components/perjadin-dokumen-form";
import { PerjadinDokumenList } from "-/components/perjadin-dokumen-list";
import { RequiredLegend, RequiredMark } from "-/components/required-mark";
import {
  holdOpenWhile,
  UploadStatus,
  useLeaveWarning,
  type UploadProgress,
} from "-/components/upload-status";
import { putToDriveSession } from "-/lib/drive/receipt-upload";
import type { UploadGate } from "-/lib/drive/upload-gate";
import type { PerjadinDokumen } from "@sugt/db/queries";
import {
  PERJADIN_DOCUMENT_KINDS,
  PERJADIN_DOCUMENT_PARTICIPANT_TYPES,
  timeZoneSuffix,
  type PerjadinDocumentKind,
  type PerjadinDocumentParticipantType,
} from "@sugt/domain";
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
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { TimeField } from "@sugt/ui/components/time-field";
import { type ReactElement, useId, useRef, useState, useTransition } from "react";

/**
 * **Dokumen — one trip's paperwork** (ADR-0042, #397): its attendance sheets and each School's
 * SPPD (#441), opened from a `/pendamping` trip card. The documents uploaded so far
 * (`PerjadinDokumenList`), each with a Buka link to its file in Drive and **Hapus** (#398); and the
 * **Unggah dokumen** form: the kind, its fields, one PDF. An SPPD asks only for its School, and a
 * School that already has one on this trip is offered marked "sudah ada" and not selectable.
 *
 * The trip's documents and Schools are fetched when the dialog opens (`perjadinDokumenAction`), and
 * again after each upload or Hapus, rather than riding on every card's payload. The upload is a
 * session, the browser's `PUT` straight to Drive, then the record. **Any failure
 * keeps every value and the picked file**, so Unggah again retries against a fresh session.
 */
function PerjadinDokumenDialog({
  perjadinId,
  name,
  uploadGate,
  trigger,
}: {
  perjadinId: string;
  /** The trip's name (`perjadinName`, ADR-0044), for the title. */
  name: string;
  /** Closed while Drive cannot take an upload: the trigger is disabled, titled with the reason. */
  uploadGate: UploadGate;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [dokumen, setDokumen] = useState<PerjadinDokumen | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState<DocumentForm>(EMPTY_DOCUMENT_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [unsynced, setUnsynced] = useState(false);
  const [saving, startSaving] = useTransition();
  // What the upload is doing (#420), shown above the button only while `saving`. Until it ends the
  // popup will not close, its fields are disabled and leaving the page asks first.
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const ids = useId();
  useLeaveWarning(saving);

  const fields = documentFields(form);
  const isPeserta = form.kind === "Daftar Hadir Peserta";
  const isSppd = form.kind === "SPPD";
  const school = dokumen?.schools.find((option) => option.id === form.schoolId) ?? null;

  async function load() {
    const loaded = await perjadinDokumenAction(perjadinId).catch(() => null);
    setDokumen(loaded);
    setLoadFailed(loaded === null);
  }

  function update(patch: Partial<DocumentForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function submit() {
    if (!fields || !file) return;
    // Set before the transition, not inside it: React holds an async transition's updates made
    // before its first `await` until the whole action ends, so the status would never show and the
    // last attempt's alert would stay beside it.
    setProgress({ phase: "uploading", done: 0, total: 1 });
    setRefusal(null);
    setUnsynced(false);
    startSaving(async () => {
      const session = await openDocumentSessionAction(
        perjadinId,
        { size: file.size, contentType: file.type },
        fields,
      );
      if (session.outcome !== "ready") {
        // Someone else's SPPD for this School landed since the dialog opened: reload, so the
        // picker marks it "sudah ada" too.
        if (session.outcome === "sppd-exists") await load();
        return setRefusal(sessionRefusalText(session));
      }

      const driveFileId = await putToDriveSession(session.sessionUri, file);
      if (!driveFileId) return setRefusal("Berkas gagal diunggah — coba lagi.");

      setProgress({ phase: "saving" });
      const result = await recordDocumentAction({ ...fields, perjadinId, driveFileId });
      if (result.outcome !== "recorded") {
        if (result.outcome === "sppd-exists") await load();
        return setRefusal(recordRefusalText(result));
      }

      setForm(EMPTY_DOCUMENT_FORM);
      setFile(null);
      setUnsynced(!result.synced);
      await load();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={holdOpenWhile(saving, (next) => {
        setOpen(next);
        if (next) {
          setRefusal(null);
          setUnsynced(false);
          void load();
        }
      })}
    >
      <DialogTrigger
        disabled={!uploadGate.open}
        title={uploadGate.open ? undefined : uploadGate.reason}
        render={trigger}
      />
      <DialogContent
        size="panel"
        closeDisabled={saving}
      >
        <DialogHeader>
          <DialogTitle>Dokumen — {name}</DialogTitle>
          <DialogDescription>
            Daftar hadir dan SPPD perjalanan ini, satu file PDF masing-masing.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {loadFailed && (
            <p className="text-sm text-destructive">
              Dokumen tidak dapat dimuat — tutup lalu buka lagi.
            </p>
          )}

          {dokumen && (
            <PerjadinDokumenList
              documents={dokumen.documents}
              schools={dokumen.schools}
              hapus={{
                // Closed too while a document uploads, so nothing else changes the list under it.
                gate: saving ? { open: false, reason: UPLOAD_RUNNING } : uploadGate,
                onDeleted: () => void load(),
              }}
            />
          )}

          <div className="grid gap-3.5 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-medium">Unggah dokumen</h3>
              <RequiredLegend />
            </div>

            {refusal !== null && (
              <Alert variant="destructive">
                <AlertTitle>Dokumen belum tercatat.</AlertTitle>
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            )}
            {unsynced && (
              <Alert>
                <AlertTitle>Dokumen tercatat.</AlertTitle>
                <AlertDescription>{DOCUMENT_UNSYNCED_NOTE}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-1.5">
              <Label
                htmlFor={`${ids}-kind`}
                className="gap-1"
              >
                Jenis dokumen
                <RequiredMark />
              </Label>
              <Select
                value={form.kind}
                disabled={saving}
                onValueChange={(value) => {
                  // A School chosen for one kind is not carried to another: an SPPD's picker
                  // refuses Schools a Peserta sheet's offers.
                  update({ kind: value as PerjadinDocumentKind, schoolId: "" });
                }}
              >
                <SelectTrigger
                  id={`${ids}-kind`}
                  aria-required="true"
                >
                  <SelectValue placeholder="Pilih jenis dokumen" />
                </SelectTrigger>
                <SelectContent>
                  {PERJADIN_DOCUMENT_KINDS.map((kind) => (
                    <SelectItem
                      key={kind}
                      value={kind}
                    >
                      {kind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.kind !== "" && !isSppd && (
              <div className="grid gap-1.5">
                <Label
                  htmlFor={`${ids}-date`}
                  className="gap-1"
                >
                  {isPeserta ? "Tanggal Sesi" : "Tanggal Dokumen"}
                  <RequiredMark />
                </Label>
                <Input
                  id={`${ids}-date`}
                  aria-required="true"
                  type="date"
                  min={dokumen?.startsOn}
                  max={dokumen?.endsOn}
                  value={form.documentDate}
                  disabled={saving}
                  onChange={(event) => {
                    update({ documentDate: event.target.value });
                  }}
                />
              </div>
            )}

            {(isPeserta || isSppd) && (
              <div className="grid gap-1.5">
                <Label
                  htmlFor={`${ids}-school`}
                  className="gap-1"
                >
                  Sekolah
                  <RequiredMark />
                </Label>
                {/* A plain select: a trip has few Schools, so nothing to search. */}
                <Select
                  value={form.schoolId}
                  disabled={saving}
                  onValueChange={(value) => {
                    update({ schoolId: (value as string | null) ?? "" });
                  }}
                >
                  <SelectTrigger
                    id={`${ids}-school`}
                    aria-required="true"
                  >
                    <SelectValue placeholder="Pilih sekolah">{school?.name}</SelectValue>
                  </SelectTrigger>
                  {/* As wide as its longest School, so a "sudah ada" mark is never cut off. */}
                  <SelectContent className="w-auto min-w-(--anchor-width)">
                    {(dokumen?.schools ?? []).map((option) => {
                      // One SPPD per School on this trip (#441): Hapus frees it for a new one.
                      const taken = isSppd && option.hasSppd;
                      return (
                        <SelectItem
                          key={option.id}
                          value={option.id}
                          disabled={taken}
                        >
                          {option.name}
                          {taken && (
                            <span className="text-muted-foreground">· {SPPD_EXISTS_MARK}</span>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isPeserta && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label
                      htmlFor={`${ids}-starts`}
                      className="gap-1"
                    >
                      Waktu Mulai{timeZoneSuffix(school?.timeZone)}
                      <RequiredMark />
                    </Label>
                    <TimeField
                      id={`${ids}-starts`}
                      aria-required="true"
                      value={form.startsAt}
                      disabled={saving}
                      onValueChange={(value) => {
                        update({ startsAt: value });
                      }}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label
                      htmlFor={`${ids}-ends`}
                      className="gap-1"
                    >
                      Waktu Selesai{timeZoneSuffix(school?.timeZone)}
                      <RequiredMark />
                    </Label>
                    <TimeField
                      id={`${ids}-ends`}
                      aria-required="true"
                      value={form.endsAt}
                      disabled={saving}
                      onValueChange={(value) => {
                        update({ endsAt: value });
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label
                    htmlFor={`${ids}-participant-type`}
                    className="gap-1"
                  >
                    Tipe Peserta
                    <RequiredMark />
                  </Label>
                  <Select
                    value={form.participantType}
                    disabled={saving}
                    onValueChange={(value) => {
                      update({ participantType: value as PerjadinDocumentParticipantType });
                    }}
                  >
                    <SelectTrigger
                      id={`${ids}-participant-type`}
                      aria-required="true"
                    >
                      <SelectValue placeholder="Pilih tipe peserta" />
                    </SelectTrigger>
                    <SelectContent>
                      {PERJADIN_DOCUMENT_PARTICIPANT_TYPES.map((option) => (
                        <SelectItem
                          key={option}
                          value={option}
                        >
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="grid gap-1.5">
              <Label className="gap-1">
                File
                <RequiredMark />
              </Label>
              <p className="-mt-0.5 text-xs text-muted-foreground">{DOCUMENT_HINT}</p>
              <input
                ref={picker}
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0];
                  event.target.value = "";
                  if (!picked) return;
                  const checked = pickDocument(picked);
                  if (typeof checked === "string") {
                    setFileNote(checked);
                    return;
                  }
                  setFile(checked);
                  setFileNote(null);
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => picker.current?.click()}
                >
                  Pilih file
                </Button>
                {file && (
                  <span className="truncate text-sm text-muted-foreground">{file.name}</span>
                )}
              </div>
              {fileNote !== null && <p className="text-sm text-destructive">{fileNote}</p>}
            </div>
          </div>
        </DialogBody>

        {saving && progress !== null && <UploadStatus progress={progress} />}

        <DialogFooter>
          <Button
            disabled={saving || !fields || !file || !dokumen}
            onClick={submit}
          >
            Unggah
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Why Hapus waits while a document uploads. */
const UPLOAD_RUNNING = "Tunggu sampai unggahan selesai.";

export { PerjadinDokumenDialog };
