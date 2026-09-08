"use client";

import { issuePerjadinFeedbackTokenAction } from "-/app/(app)/perjadin/[id]/actions";
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
 * **The Perjadin Evaluation QR** (ADR-0024) — the sibling of `feedback-token.tsx`, one trip over.
 * Anyone signed in issues a link from the trip's page and shares it (QR or copy) with the Pengajar,
 * Pendamping and Pimpinan; they open `/ep/{token}` and rate the journey without signing in.
 *
 * **Offered to everyone, not only Staff** — a Perjadin Evaluation carries no money (ADR-0004), so
 * `issuePerjadinFeedbackToken` takes a plain `Person`. Unlike the Session QR there is **no cancelled
 * bar**: a Perjadin is a real trip once it exists, so the button is always live.
 *
 * **Issuing confirms first, and reissuing asks again, more pointedly.** The table is keyed on
 * `perjadin_id`, so a new token invalidates every link already shared. Once a link is shown it
 * **stays shown** across closing and reopening the dialog — re-viewing it must not silently replace
 * it while it is still being shared. Replacing it is *Terbitkan tautan baru*, which opens its own
 * confirmation naming what dies, so a reissue is a second, deliberate act rather than a repeat of
 * the neutral first-issue notice.
 */
function PerjadinFeedbackTokenDialog({
  perjadinId,
  trigger,
}: {
  perjadinId: string;
  // An optional custom trigger so a card elsewhere (e.g. the Staff dashboard) can open this exact
  // dialog from its own labelled control. Omitted, the default button below renders and behaviour is
  // identical to today — every current mount site keeps working unchanged.
  trigger?: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<{ url: string; qr: string } | null>(null);
  const [confirmingReissue, setConfirmingReissue] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, startSaving] = useTransition();

  function issue() {
    startSaving(async () => {
      const result = await issuePerjadinFeedbackTokenAction(perjadinId);
      setIssued({ url: result.url, qr: result.qr });
      setConfirmingReissue(false);
      setCopied(false);
    });
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.url);
    setCopied(true);
  }

  // Three states: no link yet (confirm and mint), a link shown, and a link shown with a reissue
  // being confirmed. The shown link persists across close; only reissuing — a second, pointed
  // confirmation — replaces it, because that is the act that kills a link still being shared.
  const showingQr = issued !== null && !confirmingReissue;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCopied(false);
          setConfirmingReissue(false);
        }
      }}
    >
      <DialogTrigger render={trigger ?? <Button variant="outline">QR Evaluasi Perjadin</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR Evaluasi Perjadin</DialogTitle>
          <DialogDescription>
            {issued === null
              ? "Bagikan QR atau tautan ini agar Pengajar, Pendamping dan Pimpinan dapat mengisi evaluasi perjalanan tanpa perlu masuk."
              : confirmingReissue
                ? "Tautan yang sedang dibagikan akan langsung mati begitu tautan baru dibuat. Lanjutkan?"
                : "Tunjukkan atau bagikan tautan ini untuk diisi."}
          </DialogDescription>
        </DialogHeader>

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
                alt="QR Evaluasi Perjadin"
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
                {saving ? "Menyiapkan…" : "Terbitkan tautan baru"}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmingReissue(true);
              }}
            >
              Terbitkan tautan baru
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { PerjadinFeedbackTokenDialog };
