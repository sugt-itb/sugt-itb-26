"use client";

import { updateOnlineSessionAction } from "-/app/(app)/sesi-daring/[id]/actions";
import { PersonSelect } from "-/components/person-select";
import type { OnlineSessionDetail } from "@sugt/db/queries";
import {
  formatSessionStartTimeWithWib,
  PRETEST_PARTICIPANT_TYPES,
  type PretestParticipantType,
  STREAMS,
  type Stream,
} from "@sugt/domain";
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
import { useId, useState, useTransition } from "react";

/**
 * An online Session's scalar fields — School, PIC, Aliran, Peserta, Tanggal, Jam Mulai, Jam Selesai
 * (#283) — shown, and for Staff editable through one "Ubah Sesi" dialog. The online counterpart of
 * the offline detail's per-Session edit (`perjadin-sessions.tsx`): the same fields the arrange form
 * set, corrected after the fact.
 *
 * One dialog for all of them, not one each, because they are one row and one write —
 * `updateOnlineSession` sets them together and re-checks the widened unique index on
 * School/date/Stream. Offered only while the Session is `arranged`; once delivered its fields record
 * something that happened. Read for everyone (no money); the "Ubah" trigger appears only for Staff,
 * whom the write re-checks. The two time labels read **(WIB)** unconditionally — online Sessions are
 * always WIB (#283).
 */
function OnlineSessionFields({
  session,
  canEdit,
}: {
  session: OnlineSessionDetail;
  canEdit: boolean;
}) {
  const editable = canEdit && session.status === "arranged";

  return (
    <div className="border-b border-border px-7 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-medium">Sesi</h2>
        {editable && <EditDialog session={session} />}
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
        <Row label="Sekolah">{session.schoolName}</Row>
        <Row label="PIC">{session.picFullName}</Row>
        <Row label="Aliran">{session.stream}</Row>
        <Row label="Peserta">{session.participantType ?? "—"}</Row>
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
 * The edit dialog, seeded from the Session's current values. On save it hands all five fields to
 * `updateOnlineSession`, which refuses a collision with another still-standing online Session of the
 * same School, date and Stream — surfaced here beside the fields — and a Session someone else already
 * delivered or cancelled.
 */
function EditDialog({ session }: { session: OnlineSessionDetail }) {
  const [open, setOpen] = useState(false);
  const [schoolId, setSchoolId] = useState(session.schoolId);
  const [picPersonId, setPicPersonId] = useState(session.picPersonId);
  const [stream, setStream] = useState<Stream | "">(session.stream);
  const [participantType, setParticipantType] = useState<PretestParticipantType | "">(
    session.participantType ?? "",
  );
  const [heldOn, setHeldOn] = useState(session.heldOn);
  const [startsAt, setStartsAt] = useState(session.startsAt.slice(0, 5));
  // A legacy Session may hold no end time (#283) — seed the field empty so the Staff editing it must
  // supply one, the same required-ness the arrange form has.
  const [endsAt, setEndsAt] = useState(session.endsAt?.slice(0, 5) ?? "");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const idPrefix = useId();

  // Jam Selesai must be strictly after Jam Mulai; both `HH:MM`, so the string compare is chronological.
  const endBeforeStart = startsAt !== "" && endsAt !== "" && endsAt <= startsAt;

  const incomplete =
    schoolId === "" ||
    picPersonId === "" ||
    stream === "" ||
    participantType === "" ||
    heldOn === "" ||
    startsAt === "" ||
    endsAt === "" ||
    endBeforeStart;

  function submit() {
    if (incomplete) return;
    startSaving(async () => {
      const result = await updateOnlineSessionAction(session.id, {
        schoolId,
        picPersonId,
        stream: stream as Stream,
        participantType,
        heldOn,
        startsAt,
        endsAt,
      });
      if (result.outcome === "updated") {
        setOpen(false);
        return;
      }
      setRefusal(
        result.outcome === "collided"
          ? "Sekolah ini sudah punya Sesi daring Aliran ini pada tanggal tersebut. Ubah tanggal atau Aliran-nya."
          : result.outcome === "end-before-start"
            ? "Jam selesai harus setelah jam mulai."
            : "Sesi ini sudah tidak berstatus terjadwal. Muat ulang halaman untuk melihat keadaannya.",
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
            Sekolah, PIC, Aliran, Peserta, tanggal, jam mulai dan jam selesai.
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
              items={Object.fromEntries(session.schools.map((school) => [school.id, school.name]))}
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
                {session.schools.map((school) => (
                  <SelectItem
                    key={school.id}
                    value={school.id}
                  >
                    {school.name} — {school.kabupatenKota}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-pic`}>PIC</Label>
            <PersonSelect
              id={`${idPrefix}-pic`}
              people={session.staff}
              value={picPersonId}
              placeholder="Pilih PIC"
              onSelect={(personId) => {
                setPicPersonId(personId);
                setRefusal(null);
              }}
            />
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
            <Label htmlFor={`${idPrefix}-participant`}>Peserta</Label>
            <Select
              items={Object.fromEntries(PRETEST_PARTICIPANT_TYPES.map((entry) => [entry, entry]))}
              value={participantType === "" ? null : participantType}
              onValueChange={(value) => {
                setParticipantType((value as PretestParticipantType | null) ?? "");
                setRefusal(null);
              }}
            >
              <SelectTrigger
                id={`${idPrefix}-participant`}
                aria-label="Peserta"
              >
                <SelectValue placeholder="Pilih Peserta" />
              </SelectTrigger>
              <SelectContent>
                {PRETEST_PARTICIPANT_TYPES.map((entry) => (
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-date`}>Tanggal</Label>
              <Input
                id={`${idPrefix}-date`}
                type="date"
                value={heldOn}
                onChange={(event) => {
                  setHeldOn(event.target.value);
                  setRefusal(null);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-time`}>Jam Mulai (WIB)</Label>
              {/* Online Sessions are always WIB (#283), so the zone is fixed, not School-derived. */}
              <Input
                id={`${idPrefix}-time`}
                type="time"
                value={startsAt}
                onChange={(event) => {
                  setStartsAt(event.target.value);
                  setRefusal(null);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${idPrefix}-end-time`}>Jam Selesai (WIB)</Label>
              <Input
                id={`${idPrefix}-end-time`}
                type="time"
                value={endsAt}
                onChange={(event) => {
                  setEndsAt(event.target.value);
                  setRefusal(null);
                }}
              />
              {endBeforeStart && (
                <p className="text-xs text-destructive">Jam selesai harus setelah jam mulai.</p>
              )}
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
