"use client";

import {
  addPerjadinSessionAction,
  cancelPerjadinSessionAction,
  editPerjadinSessionAction,
} from "-/app/(app)/perjadin/[id]/actions";
import { MultiSelectCombobox } from "-/components/multi-select-combobox";
import { SessionStatusBadge } from "-/components/session-labels";
import type {
  AddPerjadinSessionResult,
  EditPerjadinSessionResult,
  EligibleSchool,
  PerjadinSession,
} from "@sugt/db/queries";
import { formatSessionStartTimeWithWib, STREAMS, type Stream, timeZoneSuffix } from "@sugt/domain";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import Link from "next/link";
import { useId, useState, useTransition } from "react";

type TripTeacher = { id: string; name: string };

/**
 * A Perjadin's offline Sessions, and — for Staff — the per-Session controls: add one, edit an
 * arranged one's School, date, time, Stream and "Diajar oleh", and cancel one (which is how a Session
 * is removed, kept visible as an attempt). Every rule the plan form checks — inside the trip's window,
 * at a School of its Sub-Cluster, no two *different* Schools sharing a moment, the ten-per-School
 * ceiling — is re-checked by the write against the trip's other Sessions.
 *
 * The list is shown to everyone (a Session carries no money); the controls appear only for Staff.
 */
function PerjadinSessions({
  perjadinId,
  sessions,
  eligibleSchools,
  teachers,
  startsOn,
  endsOn,
  canEdit,
}: {
  perjadinId: string;
  sessions: PerjadinSession[];
  eligibleSchools: EligibleSchool[];
  teachers: TripTeacher[];
  startsOn: string;
  endsOn: string;
  canEdit: boolean;
}) {
  return (
    <div className="px-7 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-medium">Sesi</h2>
        {canEdit && (
          <SessionDialog
            perjadinId={perjadinId}
            eligibleSchools={eligibleSchools}
            teachers={teachers}
            startsOn={startsOn}
            endsOn={endsOn}
            trigger={
              <Button
                variant="outline"
                size="sm"
              >
                Tambah Sesi
              </Button>
            }
          />
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="mt-2.5 text-sm text-muted-foreground">Belum ada Sesi.</p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {sessions.map((session) => (
            <li
              key={session.sessionId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            >
              <Link
                href={`/sesi/${session.sessionId}`}
                className="tabular-nums hover:underline"
              >
                {session.heldOn}
              </Link>
              <span className="text-muted-foreground tabular-nums">
                {formatSessionStartTimeWithWib(session.startsAt, session.timeZone)}
              </span>
              <Link
                href={`/sekolah/${session.schoolSlug}`}
                className="text-muted-foreground hover:underline"
              >
                {session.schoolName}
              </Link>
              {session.stream !== null && (
                <span className="text-muted-foreground">· {session.stream}</span>
              )}
              {session.taughtBy.length > 0 && (
                <span className="text-muted-foreground">
                  · {session.taughtBy.map((teacher) => teacher.name).join(", ")}
                </span>
              )}
              <SessionStatusBadge status={session.status} />
              {canEdit && session.status === "arranged" && (
                <span className="flex gap-1">
                  <SessionDialog
                    perjadinId={perjadinId}
                    session={session}
                    eligibleSchools={eligibleSchools}
                    teachers={teachers}
                    startsOn={startsOn}
                    endsOn={endsOn}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                      >
                        Ubah
                      </Button>
                    }
                  />
                  <CancelDialog
                    perjadinId={perjadinId}
                    sessionId={session.sessionId}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Add or edit one Session. With `session` it edits that one (its fields seed the form); without, it
 * adds a new one. The same five fields either way — School, date, time, Stream, "Diajar oleh" — and
 * the same write shape, so one dialog serves both.
 */
function SessionDialog({
  perjadinId,
  session,
  eligibleSchools,
  teachers,
  startsOn,
  endsOn,
  trigger,
}: {
  perjadinId: string;
  session?: PerjadinSession;
  eligibleSchools: EligibleSchool[];
  teachers: TripTeacher[];
  startsOn: string;
  endsOn: string;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [schoolId, setSchoolId] = useState(session?.schoolId ?? "");
  const [date, setDate] = useState(session?.heldOn ?? "");
  const [time, setTime] = useState(session ? session.startsAt.slice(0, 5) : "");
  const [stream, setStream] = useState<Stream | "">(session?.stream ?? "");
  const [taughtBy, setTaughtBy] = useState<string[]>(
    () => session?.taughtBy.map((teacher) => teacher.id) ?? [],
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const idPrefix = useId();

  const teacherOptions = teachers.map((teacher) => ({ value: teacher.id, label: teacher.name }));
  const incomplete = schoolId === "" || date === "" || time === "" || stream === "";

  // The picked School's Time Zone, for the Jam Mulai label. In add mode it appears and flips as the
  // School is chosen (#165); in edit mode the seeded School's zone matches `session.timeZone`, and
  // that seed is the fallback for the rare case the seeded School is not among the eligible ones.
  const timeZone =
    eligibleSchools.find((option) => option.id === schoolId)?.timeZone ?? session?.timeZone;

  function submit() {
    if (incomplete) return;
    startSaving(async () => {
      const input = {
        schoolId,
        heldOn: date,
        startsAt: time,
        stream: stream as Stream,
        taughtByTeacherIds: taughtBy,
      };
      const result = session
        ? await editPerjadinSessionAction(perjadinId, session.sessionId, input)
        : await addPerjadinSessionAction(perjadinId, input);

      if (result.outcome === "added" || result.outcome === "edited") {
        setOpen(false);
        return;
      }
      setRefusal(sessionRefusalMessage(result));
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{session ? "Ubah Sesi" : "Tambah Sesi"}</DialogTitle>
          <DialogDescription>
            Sekolah, tanggal, jam, Aliran dan siapa yang mengajar.
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
            <Select
              items={Object.fromEntries(eligibleSchools.map((school) => [school.id, school.name]))}
              value={schoolId === "" ? null : schoolId}
              onValueChange={(value) => {
                setSchoolId((value as string | null) ?? "");
                setRefusal(null);
              }}
            >
              <SelectTrigger
                id={`${idPrefix}-school`}
                aria-label="Sekolah"
              >
                <SelectValue placeholder="Pilih Sekolah" />
              </SelectTrigger>
              <SelectContent>
                {eligibleSchools.map((school) => (
                  <SelectItem
                    key={school.id}
                    value={school.id}
                  >
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-date`}>Tanggal</Label>
              <Input
                id={`${idPrefix}-date`}
                type="date"
                min={startsOn}
                max={endsOn}
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setRefusal(null);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              {/* Zone follows the picked School (#165): shown once one is chosen in add mode, seeded from the Session's School in edit mode, omitted when none is in scope. */}
              <Label htmlFor={`${idPrefix}-time`}>Jam Mulai{timeZoneSuffix(timeZone)}</Label>
              <Input
                id={`${idPrefix}-time`}
                type="time"
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  setRefusal(null);
                }}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-stream`}>Aliran</Label>
            <Select
              items={Object.fromEntries(STREAMS.map((entry) => [entry, entry]))}
              value={stream === "" ? null : stream}
              onValueChange={(value) => {
                setStream((value as Stream | null) ?? "");
                setRefusal(null);
              }}
            >
              <SelectTrigger
                id={`${idPrefix}-stream`}
                aria-label="Aliran"
              >
                <SelectValue placeholder="Pilih Aliran" />
              </SelectTrigger>
              <SelectContent>
                {STREAMS.map((entry) => (
                  <SelectItem
                    key={entry}
                    value={entry}
                  >
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-taught`}>Diajar oleh</Label>
            <MultiSelectCombobox
              id={`${idPrefix}-taught`}
              aria-label="Diajar oleh"
              placeholder={teacherOptions.length === 0 ? "Belum ada pengajar" : "Pilih pengajar…"}
              emptyLabel="Tidak ada pengajar."
              options={teacherOptions}
              value={taughtBy}
              onValueChange={(next) => {
                setTaughtBy(next);
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

/** Cancel a Session, which is how it is removed — a reason is required, and it stays visible. */
function CancelDialog({ perjadinId, sessionId }: { perjadinId: string; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const reasonId = useId();

  function submit() {
    startSaving(async () => {
      const result = await cancelPerjadinSessionAction(perjadinId, sessionId, reason);
      if (result.outcome === "cancelled") {
        setOpen(false);
        return;
      }
      setRefusal(
        result.outcome === "reason-required"
          ? "Alasan pembatalan wajib diisi."
          : "Sesi ini sudah tidak dalam status terjadwal. Muat ulang halaman.",
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
            variant="ghost"
            size="sm"
          >
            Batalkan
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Batalkan Sesi</DialogTitle>
          <DialogDescription>
            Sesi yang dibatalkan tetap terlihat sebagai percobaan yang gagal.
          </DialogDescription>
        </DialogHeader>

        {refusal !== null && (
          <Alert variant="destructive">
            <AlertTitle>Sesi belum dibatalkan.</AlertTitle>
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor={reasonId}>Alasan</Label>
          <Input
            id={reasonId}
            value={reason}
            placeholder="Alasan pembatalan"
            onChange={(event) => {
              setReason(event.target.value);
              setRefusal(null);
            }}
          />
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
            disabled={saving || reason.trim() === ""}
            onClick={submit}
          >
            {saving ? "Membatalkan…" : "Batalkan Sesi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What each add/edit refusal says. Field-level messages; nothing was written. */
function sessionRefusalMessage(
  result: AddPerjadinSessionResult | EditPerjadinSessionResult,
): string {
  switch (result.outcome) {
    case "not-arranged":
      return "Sesi ini tidak lagi berstatus terjadwal, jadi tidak bisa diubah.";
    case "no-such-perjadin":
      return "Perjadin ini sudah tidak ada. Muat ulang halaman.";
    case "duplicate-session":
      return "Sesi yang persis sama (Sekolah, tanggal, jam dan Aliran) sudah ada.";
    case "school-outside-sub-cluster":
      return "Sekolah itu bukan bagian dari Kelompok Sekolah Perjadin ini.";
    case "session-outside-perjadin":
      return `Tanggal Sesi harus di antara ${result.startsOn} dan ${result.endsOn}.`;
    case "too-many-sessions":
      return `Terlalu banyak Sesi di Sekolah ini: maksimal ${result.limit}.`;
    case "session-time-clash":
      return "Dua Sekolah yang berbeda tidak bisa berada di tanggal dan jam yang sama.";
    case "unknown-teacher":
      return "Ada pengajar yang sudah tidak ada. Muat ulang halaman.";
    default:
      return "Perubahan gagal. Muat ulang halaman.";
  }
}

export { PerjadinSessions };
