"use client";

import {
  cancelSessionAction,
  markSessionDeliveredAction,
  moveSessionDateAction,
} from "-/app/(app)/sesi/[id]/actions";
import type { SessionDetail } from "@sugt/db/queries";
import { timeZoneSuffix } from "@sugt/domain";
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
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import { Textarea } from "@sugt/ui/components/textarea";
import { useId, useState, useTransition } from "react";

/**
 * Everything Staff can do to an **offline** Session, and nothing else can. (An online Session is
 * edited on `/sesi-daring/[id]`; `/sesi/[id]` redirects an online id there, so nothing here runs for
 * one — #152.)
 *
 * **What is offered turns on the status, and that is the enforcement's shape rather than
 * its substance.** Tandai terlaksana, Batalkan Sesi and the date edit are offered only
 * while `arranged`; a delivered Session offers nothing to change (its teachers are trip-scoped names
 * edited on the Perjadin, not here); a cancelled Session offers nothing.
 *
 * Every one of those rules is also held by the write function, which is why each dialog
 * below has a branch for a refusal it believes it cannot provoke. A screen that merely
 * declines to show a button protects nothing against a page opened before somebody else
 * acted on the same Session — and that page is what those branches are for.
 *
 * A client component because three dialogs hold form state, and none of that state is
 * worth a URL. Nothing here fetches.
 */
function SessionWrites({ session }: { session: SessionDetail }) {
  return (
    <div className="flex flex-wrap gap-2.5 px-7 py-5">
      {session.status === "arranged" && (
        <>
          <OfflineMarkDelivered session={session} />
          <MoveDate session={session} />
          <Cancel session={session} />
        </>
      )}

      {session.status === "cancelled" && (
        <p className="text-sm text-muted-foreground">
          Sesi yang dibatalkan tidak bisa diubah lagi.
        </p>
      )}
    </div>
  );
}

/**
 * **Offline Tandai terlaksana** — status only (#140, #152). No who-taught prompt: the teachers are
 * trip-scoped names on the Perjadin, not People, and no `session_teacher` row is written — the same
 * shape both modes now share. The confirmation exists only so a delivered Session is a deliberate
 * act; the sole refusal it can meet is a Session someone else already moved, shown the same way the
 * other dialogs show it.
 */
function OfflineMarkDelivered({ session }: { session: SessionDetail }) {
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function submit() {
    startSaving(async () => {
      const result = await markSessionDeliveredAction(session.id);
      if (result.outcome === "delivered") {
        setOpen(false);
        return;
      }
      // The only refusal here is a Session someone else already moved — mark-delivered is
      // status-only, so nothing about who taught can turn it back.
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
            Tandai Sesi luring ini sebagai terlaksana. Pengajarnya dicatat lewat &ldquo;Diajar
            oleh&rdquo; di halaman Perjadin, bukan di sini.
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
 *
 * `session_cancelled_iff_reason` refuses the pair apart, so asking for the reason
 * afterwards would be asking for something that cannot be stored afterwards.
 */
function Cancel({ session }: { session: SessionDetail }) {
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
      const result = await cancelSessionAction(session.id, reason);
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
            Sesi yang dibatalkan tetap terlihat di daftar Sekolah dan tidak dihitung sebagai
            terlaksana. Kalau tanggalnya hanya bergeser, ubah tanggalnya saja.
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
 * Moving the date. **A slipped date is not a cancellation**, so this asks for no reason
 * and leaves no dead row on the School's list.
 *
 * Two things can refuse it, and they are different sentences: another online Session for
 * this School already stands on that day, or an offline Session was moved outside the
 * trip it happens on.
 */
function MoveDate({ session }: { session: SessionDetail }) {
  const [open, setOpen] = useState(false);
  const [heldOn, setHeldOn] = useState(session.heldOn);
  // The time moves with the date, in the same act (#72). Seeded from the current value so
  // moving only the date leaves the hour where the School expects it.
  const [startsAt, setStartsAt] = useState(session.startsAt);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const dateId = useId();
  const timeId = useId();

  function submit() {
    startSaving(async () => {
      const result = await moveSessionDateAction(session.id, heldOn, startsAt);
      if (result.outcome === "moved") {
        setOpen(false);
        return;
      }
      if (result.outcome === "collided") {
        setRefusal("Sekolah ini sudah punya Sesi daring pada tanggal tersebut.");
      } else if (result.outcome === "outside-perjadin") {
        setRefusal(
          `Sesi luring harus berada dalam rentang Perjadin, ${result.startsOn} – ${result.endsOn}.`,
        );
      } else {
        setRefusal(STALE_MESSAGES[result.status]);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger render={<Button variant="outline">Ubah jadwal</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah tanggal &amp; jam Sesi</DialogTitle>
          <DialogDescription>
            {session.perjadin === null
              ? "Tanggal baru tidak boleh bentrok dengan Sesi daring lain di Sekolah ini."
              : `Tanggal baru harus berada dalam rentang Perjadin, ${session.perjadin.startsOn} – ${session.perjadin.endsOn}.`}
          </DialogDescription>
        </DialogHeader>

        {refusal !== null && <StaleAlert message={refusal} />}

        <div className="flex flex-wrap gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={dateId}>Tanggal</Label>
            <Input
              id={dateId}
              type="date"
              value={heldOn}
              onChange={(event) => {
                setHeldOn(event.target.value);
                setRefusal(null);
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={timeId}>Jam Mulai{timeZoneSuffix(session.timeZone)}</Label>
            {/* Wall-clock time local to the School, in the School's Time Zone. */}
            <Input
              id={timeId}
              type="time"
              className="w-32"
              value={startsAt}
              onChange={(event) => {
                setStartsAt(event.target.value);
                setRefusal(null);
              }}
            />
          </div>
        </div>

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
            disabled={saving || heldOn === "" || startsAt === ""}
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What a refusal that the screen could not have predicted says.
 *
 * Every one of these means somebody else changed this Session while the page was open.
 * That is a user state and not a bug, so it reads as a sentence rather than as an error
 * page — but it is worth saying plainly, because the button that produced it was one this
 * screen had offered.
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

export { SessionWrites };
