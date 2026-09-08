"use client";

import { issueFeedbackTokenAction } from "-/app/(app)/sesi/[id]/actions";
import type { SessionDetail } from "@sugt/db/queries";
import type { SessionStatus } from "@sugt/domain";
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
import { type ReactElement, useState, useTransition } from "react";

/**
 * Two ways in, one behaviour. The Session detail page hands the whole `SessionDetail` it already
 * loaded; a card elsewhere (e.g. the Staff dashboard) has only an id and a status and passes those
 * bare, plus its own labelled `trigger`. The prop is a union so neither caller carries what it does
 * not have, and both are normalized to `sessionId`/`status` at the top so the body reads the same.
 * With no `trigger`, the default button renders and the existing `session={session}` mount behaves
 * exactly as before.
 */
type FeedbackTokenDialogProps = (
  | { session: SessionDetail }
  | { sessionId: string; status: SessionStatus }
) & {
  trigger?: ReactElement;
};

/**
 * **The Participant Feedback QR.** Anyone signed in presses this at the end of a Session and
 * holds up the code; students in the room scan it and rate three Aspects without signing in.
 *
 * **Offered to everyone, not only Staff** — so it lives here rather than in the Staff-only
 * `SessionWrites`. It is **barred on a cancelled Session**: nobody sat in a room that never
 * happened, and `issueFeedbackToken` refuses one anyway.
 *
 * **Issuing confirms first, and reissuing asks again, more pointedly.** The table is keyed on
 * `session_id`, so a new token invalidates every link already handed out. Once a QR is shown it
 * **stays shown** across closing and reopening the dialog — re-viewing it must not silently
 * replace it while half the room is still scanning. Replacing it is *Terbitkan QR baru*, which
 * opens its own confirmation naming what dies, so a reissue is a second, deliberate act rather
 * than a repeat of the neutral first-issue notice.
 */
function FeedbackTokenDialog(props: FeedbackTokenDialogProps) {
  const sessionId = "session" in props ? props.session.id : props.sessionId;
  const status = "session" in props ? props.session.status : props.status;
  const trigger = props.trigger;

  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<{ url: string; qr: string } | null>(null);
  const [confirmingReissue, setConfirmingReissue] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Barred on a cancelled Session, and absent rather than disabled — there is nothing to explain
  // in a dialog nobody should open.
  if (status === "cancelled") return null;

  function issue() {
    startSaving(async () => {
      const result = await issueFeedbackTokenAction(sessionId);
      if (result.outcome === "issued") {
        setIssued({ url: result.url, qr: result.qr });
        setConfirmingReissue(false);
        setCopied(false);
      } else {
        setError("Sesi ini sudah dibatalkan. Muat ulang halaman untuk melihat keadaannya.");
      }
    });
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.url);
    setCopied(true);
  }

  // Three states: no QR yet (confirm and mint), a QR shown, and a QR shown with a reissue being
  // confirmed. The shown QR persists across close; only reissuing — a second, pointed
  // confirmation — replaces it, because that is the act that kills a link the room is scanning.
  const showingQr = issued !== null && !confirmingReissue;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCopied(false);
          setError(null);
          setConfirmingReissue(false);
        }
      }}
    >
      <DialogTrigger render={trigger ?? <Button variant="outline">QR umpan balik</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR umpan balik</DialogTitle>
          <DialogDescription>
            {issued === null
              ? "Peserta memindai QR ini untuk menilai sesi tanpa perlu masuk."
              : confirmingReissue
                ? "Tautan yang sedang dibagikan akan langsung mati begitu QR baru dibuat. Lanjutkan?"
                : "Tunjukkan QR ini kepada peserta untuk mereka pindai."}
          </DialogDescription>
        </DialogHeader>

        {error !== null && <p className="text-sm text-destructive">{error}</p>}

        {showingQr && issued !== null && (
          <div className="grid gap-4">
            {/*
              Black on white regardless of the theme. The colours are baked into the image by the
              action, and this container is `bg-white` with no `dark:` variant, so its quiet zone
              stays white even inside a dialog that flips under `.dark`. The QR arrives as a data
              URL, so it is a plain `<img>` — there is no file for `next/image` to optimise.
            */}
            <div className="flex justify-center rounded-lg bg-white p-4">
              <img
                src={issued.qr}
                alt="QR umpan balik"
                width={256}
                height={256}
                className="size-64"
              />
            </div>

            <div className="grid gap-1.5">
              <p className="text-xs break-all text-muted-foreground">{issued.url}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={copy}
              >
                {copied ? "Tersalin" : "Salin tautan"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {issued === null ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Batal
              </Button>
              <Button
                disabled={saving}
                onClick={issue}
              >
                {saving ? "Menyiapkan…" : "Tampilkan QR"}
              </Button>
            </>
          ) : confirmingReissue ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmingReissue(false);
                }}
              >
                Batal
              </Button>
              <Button
                variant="destructive"
                disabled={saving}
                onClick={issue}
              >
                {saving ? "Menyiapkan…" : "Terbitkan QR baru"}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmingReissue(true);
              }}
            >
              Terbitkan QR baru
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { FeedbackTokenDialog };
