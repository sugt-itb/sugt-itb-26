"use client";

import { updateOnlineSessionAction } from "-/app/(app)/sesi-daring/[id]/actions";
import { PersonSelect } from "-/components/person-select";
import type { OnlineSessionDetail } from "@sugt/db/queries";
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
import { useId, useState, useTransition } from "react";

/**
 * An online Session's five scalar fields — School, PIC, Aliran, Tanggal, Jam Mulai — shown, and for
 * Staff editable through one "Ubah Sesi" dialog. The online counterpart of the offline detail's
 * per-Session edit (`perjadin-sessions.tsx`): the same fields the arrange form set, corrected after
 * the fact.
 *
 * One dialog for all five, not five, because they are one row and one write — `updateOnlineSession`
 * sets them together and re-checks the widened unique index on School/date/Stream. Offered only while
 * the Session is `arranged`; once delivered its fields record something that happened. Read for
 * everyone (no money); the "Ubah" trigger appears only for Staff, whom the write re-checks.
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
        <Row label="Tanggal">
          <span className="tabular-nums">{session.heldOn}</span>
        </Row>
        <Row label="Jam Mulai">
          <span className="tabular-nums">
            {formatSessionStartTimeWithWib(session.startsAt, session.timeZone)}
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
  const [heldOn, setHeldOn] = useState(session.heldOn);
  const [startsAt, setStartsAt] = useState(session.startsAt.slice(0, 5));
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const idPrefix = useId();

  const incomplete =
    schoolId === "" || picPersonId === "" || stream === "" || heldOn === "" || startsAt === "";

  function submit() {
    if (incomplete) return;
    startSaving(async () => {
      const result = await updateOnlineSessionAction(session.id, {
        schoolId,
        picPersonId,
        stream: stream as Stream,
        heldOn,
        startsAt,
      });
      if (result.outcome === "updated") {
        setOpen(false);
        return;
      }
      setRefusal(
        result.outcome === "collided"
          ? "Sekolah ini sudah punya Sesi daring Aliran ini pada tanggal tersebut. Ubah tanggal atau Aliran-nya."
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
          <DialogDescription>Sekolah, PIC, Aliran, tanggal dan jam mulai.</DialogDescription>
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
              <Label htmlFor={`${idPrefix}-time`}>
                Jam Mulai{timeZoneSuffix(session.timeZone)}
              </Label>
              {/* Local wall-clock time, in the School's Time Zone. */}
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
