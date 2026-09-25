"use client";

import { updateOnlineSessionAction } from "-/app/(app)/sesi-daring/[id]/actions";
import { SchoolCombobox } from "-/components/single-select-combobox";
import type { OnlineSessionDetail } from "@sugt/db/queries";
import { formatSessionStartTimeWithWib } from "@sugt/domain";
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
import { TimeField } from "@sugt/ui/components/time-field";
import { useId, useState, useTransition } from "react";

/**
 * An online Session's fields — School, the two cohort-named Pengajar, Tanggal, Jam Mulai, Jam Selesai
 * — shown, and for Staff editable through one "Ubah Sesi" dialog (#152, #318). The online counterpart
 * of the offline detail's per-Session edit (`perjadin-sessions.tsx`): the same fields the record form
 * set, corrected after the fact. **No PIC, no Aliran/Stream and no Peserta (#284, #318):** a
 * third-party LMS runs online delivery, and both cohorts are always taught.
 *
 * One dialog for all of them, not one each, because they are one row and one write —
 * `updateOnlineSession` sets them together and re-checks the unique index on School/date. An online
 * Session is born `delivered` now (#318), so the edit is offered on a `delivered` Session too — it is
 * the correction path that replaced the old teacher-list editor; only a `cancelled` legacy Session is
 * settled and offers none. Read for everyone (no money); the "Ubah" trigger appears only for Staff,
 * whom the write re-checks. The two time labels read **(WIB)** unconditionally (#283).
 */
function OnlineSessionFields({
  session,
  canEdit,
}: {
  session: OnlineSessionDetail;
  canEdit: boolean;
}) {
  const editable = canEdit && session.status !== "cancelled";

  return (
    <div className="border-b border-border px-7 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-medium">Sesi</h2>
        {editable && <EditDialog session={session} />}
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
        <Row label="Sekolah">{session.schoolName}</Row>
        <Row label="Tanggal">
          <span className="tabular-nums">{session.heldOn}</span>
        </Row>
        <Row label="Jam Mulai">
          <span className="tabular-nums">
            {formatSessionStartTimeWithWib(session.startsAt, session.timeZone)}
          </span>
        </Row>
        <Row label="Jam Selesai">
          <span className="tabular-nums">
            {session.endsAt === null
              ? "—"
              : formatSessionStartTimeWithWib(session.endsAt, session.timeZone)}
          </span>
        </Row>
        <Row label="Pengajar Siswa">{session.pengajarSiswaName}</Row>
        <Row label="Pengajar GTK-MS">{session.pengajarGtkMsName}</Row>
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/**
 * The edit dialog, seeded from the Session's current values. On save it hands the fields to
 * `updateOnlineSession`, which refuses a collision with another still-standing online Session at the
 * same School on the same date — surfaced here beside the fields — a future date, and a Session that
 * was cancelled.
 */
function EditDialog({ session }: { session: OnlineSessionDetail }) {
  const [open, setOpen] = useState(false);
  const [schoolId, setSchoolId] = useState(session.schoolId);
  const [heldOn, setHeldOn] = useState(session.heldOn);
  const [startsAt, setStartsAt] = useState(session.startsAt.slice(0, 5));
  // A legacy Session may hold no end time (#283) — seed the field empty so the Staff editing it must
  // supply one, the same required-ness the record form has.
  const [endsAt, setEndsAt] = useState(session.endsAt?.slice(0, 5) ?? "");
  const [pengajarSiswaName, setPengajarSiswaName] = useState(session.pengajarSiswaName);
  const [pengajarGtkMsName, setPengajarGtkMsName] = useState(session.pengajarGtkMsName);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const idPrefix = useId();

  // Today in WIB (`YYYY-MM-DD`) — caps the date input and mirrors the query's future-date guard.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

  // Jam Selesai must be strictly after Jam Mulai; both `HH:MM`, so the string compare is chronological.
  const endBeforeStart = startsAt !== "" && endsAt !== "" && endsAt <= startsAt;

  const incomplete =
    schoolId === "" ||
    heldOn === "" ||
    heldOn > today ||
    startsAt === "" ||
    endsAt === "" ||
    endBeforeStart ||
    pengajarSiswaName.trim() === "" ||
    pengajarGtkMsName.trim() === "";

  function submit() {
    if (incomplete) return;
    startSaving(async () => {
      const result = await updateOnlineSessionAction(session.id, {
        schoolId,
        heldOn,
        startsAt,
        endsAt,
        pengajarSiswaName,
        pengajarGtkMsName,
      });
      if (result.outcome === "updated") {
        setOpen(false);
        return;
      }
      setRefusal(
        result.outcome === "collided"
          ? "Sekolah ini sudah punya Sesi daring pada tanggal tersebut. Ubah tanggalnya."
          : result.outcome === "future-date"
            ? "Tanggal tidak boleh di masa depan."
            : result.outcome === "end-before-start"
              ? "Jam selesai harus setelah jam mulai."
              : result.outcome === "cancelled"
                ? "Sesi ini sudah dibatalkan dan tidak bisa diubah. Muat ulang halaman."
                : "Sesi belum tersimpan. Periksa isian, lalu simpan lagi.",
      );
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
          >
            Ubah Sesi
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Sesi daring</DialogTitle>
          <DialogDescription>
            Sekolah, tanggal, jam mulai dan jam selesai, dan kedua Pengajar.
          </DialogDescription>
        </DialogHeader>

        {refusal !== null && (
          <Alert variant="destructive">
            <AlertTitle>Sesi belum tersimpan.</AlertTitle>
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-school`}>Sekolah</Label>
            <SchoolCombobox
              id={`${idPrefix}-school`}
              schools={session.schools}
              value={schoolId === "" ? null : schoolId}
              onValueChange={(next) => {
                setSchoolId(next ?? "");
                setRefusal(null);
              }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-date`}>Tanggal</Label>
              <Input
                id={`${idPrefix}-date`}
                type="date"
                value={heldOn}
                max={today}
                onChange={(event) => {
                  setHeldOn(event.target.value);
                  setRefusal(null);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-time`}>Jam Mulai (WIB)</Label>
              {/* Online Sessions are always WIB (#283), so the zone is fixed, not School-derived. */}
              <TimeField
                id={`${idPrefix}-time`}
                value={startsAt}
                onValueChange={(value) => {
                  setStartsAt(value);
                  setRefusal(null);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-end-time`}>Jam Selesai (WIB)</Label>
              <TimeField
                id={`${idPrefix}-end-time`}
                value={endsAt}
                onValueChange={(value) => {
                  setEndsAt(value);
                  setRefusal(null);
                }}
              />
              {endBeforeStart && (
                <p className="text-xs text-destructive">Jam selesai harus setelah jam mulai.</p>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-pengajar-siswa`}>Pengajar Siswa</Label>
              <Input
                id={`${idPrefix}-pengajar-siswa`}
                placeholder="Nama pengajar Siswa"
                value={pengajarSiswaName}
                onChange={(event) => {
                  setPengajarSiswaName(event.target.value);
                  setRefusal(null);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-pengajar-gtk-ms`}>Pengajar GTK-MS</Label>
              <Input
                id={`${idPrefix}-pengajar-gtk-ms`}
                placeholder="Nama pengajar GTK-MS"
                value={pengajarGtkMsName}
                onChange={(event) => {
                  setPengajarGtkMsName(event.target.value);
                  setRefusal(null);
                }}
              />
            </div>
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
            disabled={incomplete || saving}
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Simpan Sesi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { OnlineSessionFields };
