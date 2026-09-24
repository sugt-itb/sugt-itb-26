"use client";

import {
  cancelOnlineSessionAction,
  deleteOnlineSessionAction,
  markOnlineSessionDeliveredAction,
} from "-/app/(app)/sesi-daring/[id]/actions";
import type { OnlineSessionDetail } from "@sugt/db/queries";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
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
import { Label } from "@sugt/ui/components/label";
import { Textarea } from "@sugt/ui/components/textarea";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

/**
 * The writes an online Session offers Staff — a hard **Delete** always, plus the legacy status acts
 * Tandai terlaksana and Batalkan Sesi while `arranged`. An online Session is born `delivered` now
 * (#318), so a born-`delivered` Session shows **Edit** (in the fields section above) **+ Delete**; a
 * Session arranged before #318 also shows the two status acts. Delete replaced cancellation as the
 * correction for a mis-recorded delivered Session.
 *
 * Each rule is also held by the write function, which is why each dialog has a branch for a refusal
 * it believes it cannot provoke — a page opened before somebody else acted on the same Session is
 * what those branches are for. Rendered only for Staff, whom the writes re-check.
 */
function OnlineSessionWrites({ session }: { session: OnlineSessionDetail }) {
  return (
    <div className="flex flex-wrap gap-2.5 px-7 py-5">
      {session.status === "arranged" && (
        <>
          <MarkDelivered session={session} />
          <Cancel session={session} />
        </>
      )}

      <Delete session={session} />
    </div>
  );
}

/**
 * **Hapus Sesi** — a hard delete behind a confirm dialog (#318). The correction for a Session
 * recorded in error, which for a born-`delivered` Session replaced cancellation. On success the row is
 * gone, so the page redirects to `/sesi-daring`; a `no-such-session` refusal means somebody else
 * already deleted it, which the same redirect resolves.
 */
function Delete({ session }: { session: OnlineSessionDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, startSaving] = useTransition();

  function submit() {
    startSaving(async () => {
      await deleteOnlineSessionAction(session.id);
      // Whether it deleted or was already gone, the Session no longer belongs on this page.
      router.push("/sesi-daring");
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger render={<Button variant="destructive">Hapus Sesi</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hapus Sesi daring</DialogTitle>
          <DialogDescription>
            Sesi daring ini akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Batal
          </Button>
          <Button
            variant="destructive"
            disabled={saving}
            onClick={submit}
          >
            {saving ? "Menghapus…" : "Hapus Sesi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * **Tandai terlaksana** — status only (#152), and **legacy for online now** (#318): an online Session
 * is born `delivered`, so this reaches only a Session arranged before #318. No who-taught prompt — the
 * two Pengajar are columns on the Session, edited in the fields section above. The confirmation exists
 * only so a delivered Session is a deliberate act; the sole refusal it can meet is a Session someone
 * else already moved.
 */
function MarkDelivered({ session }: { session: OnlineSessionDetail }) {
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function submit() {
    startSaving(async () => {
      const result = await markOnlineSessionDeliveredAction(session.id);
      if (result.outcome === "delivered") {
        setOpen(false);
        return;
      }
      if (result.outcome === "not-arranged") setStale(STALE_MESSAGES[result.status]);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger render={<Button>Tandai terlaksana</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tandai Sesi terlaksana</DialogTitle>
          <DialogDescription>
            Tandai Sesi daring ini sebagai terlaksana. Pengajarnya dicatat di bagian Pengajar, bukan
            di sini.
          </DialogDescription>
        </DialogHeader>

        {stale !== null && <StaleAlert message={stale} />}

        <DialogFooter>
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
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Tandai terlaksana"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * **Batalkan Sesi** — the reason is in the same dialog because it is in the same write.
 * `session_cancelled_iff_reason` refuses the pair apart, so asking for the reason afterwards would be
 * asking for something that cannot be stored afterwards. A slipped date is not a cancellation — that
 * is an edit in the Sesi section above.
 */
function Cancel({ session }: { session: OnlineSessionDetail }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [blank, setBlank] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const reasonId = useId();

  function submit() {
    if (reason.trim() === "") {
      setBlank(true);
      return;
    }

    startSaving(async () => {
      const result = await cancelOnlineSessionAction(session.id, reason);
      if (result.outcome === "cancelled") {
        setOpen(false);
        return;
      }
      if (result.outcome === "reason-required") setBlank(true);
      else setStale(STALE_MESSAGES[result.status]);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger render={<Button variant="outline">Batalkan Sesi</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Batalkan Sesi</DialogTitle>
          <DialogDescription>
            Sesi yang dibatalkan tetap terlihat di daftar dan tidak dihitung sebagai terlaksana.
            Kalau tanggalnya hanya bergeser, ubah tanggalnya saja di bagian Sesi.
          </DialogDescription>
        </DialogHeader>

        {stale !== null && <StaleAlert message={stale} />}

        <div className="grid gap-1.5">
          <Label htmlFor={reasonId}>Alasan</Label>
          <Textarea
            id={reasonId}
            value={reason}
            aria-invalid={blank}
            onChange={(event) => {
              setReason(event.target.value);
              setBlank(false);
            }}
          />
          {blank && <p className="text-sm text-destructive">Alasan wajib diisi.</p>}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Kembali
          </Button>
          <Button
            variant="destructive"
            disabled={saving}
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Batalkan Sesi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What a refusal that the screen could not have predicted says — somebody else changed this Session
 * while the page was open, which is a user state and reads as a sentence, not an error page.
 */
function StaleAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Tidak jadi disimpan.</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

const STALE_MESSAGES = {
  delivered: "Sesi ini sudah ditandai terlaksana. Muat ulang halaman untuk melihat keadaannya.",
  cancelled: "Sesi ini sudah dibatalkan. Muat ulang halaman untuk melihat keadaannya.",
  arranged: "Sesi ini sudah berubah. Muat ulang halaman untuk melihat keadaannya.",
} as const;

export { OnlineSessionWrites };
