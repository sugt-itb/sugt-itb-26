"use client";

import { arrangeOnlineSessionAction } from "-/app/(app)/jadwalkan-sesi-daring/actions";
import { PersonSelect } from "-/components/person-select";
import type { ArrangePerson, SchoolOption } from "@sugt/db/queries";
import {
  MAX_TEACHING_TEAM_PER_ONLINE_SESSION,
  STREAMS,
  type Stream,
  timeZoneSuffix,
} from "@sugt/domain";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

/**
 * Arrange **one** online Session (#70, ADR-0022). Two entry points share this component: the
 * standalone screen leads with a School picker (`schools`), and Detail Sekolah pins the School it
 * is on (`school`). Exactly one of the two is passed.
 *
 * An online Session is single-Stream now, so the form leads with a required **Aliran** and names
 * its Pengajar as **session-scoped free-text names** — typed in one at a time and shown as
 * removable chips, the same pattern the plan form uses for a Perjadin's trip-scoped Teaching Team
 * (ADR-0020). It no longer picks Teaching-Team People per Stream, so `teachingTeam` is gone from
 * this component; the `session_teacher` write it fed was retired in T3 (#153) along with the table.
 *
 * A client component because every field is editable and none of that state is worth a URL. The
 * pickers and Schools arrive from the server as props; nothing here fetches. The Server Action
 * is called with a typed value rather than through a `<form action>`, because the payload is
 * nested — a list of teacher names — and `FormData` would mean flattening it out and parsing it
 * back with the type checker helping at neither end.
 */
function ArrangeOnlineSessionForm({
  school,
  schools,
  staff,
}: {
  staff: ArrangePerson[];
} & (
  | /** Detail Sekolah pins the School. */ { school: SchoolOption; schools?: never }
  | /** The standalone screen offers a picker. */ { school?: never; schools: SchoolOption[] }
)) {
  const router = useRouter();
  const [schoolId, setSchoolId] = useState(school?.id ?? "");
  const [heldOn, setHeldOn] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [picPersonId, setPicPersonId] = useState("");
  // The Session's Stream — STEM or Research (ADR-0022). Required now, `""` until chosen; the submit
  // guard proves it is set before the cast.
  const [stream, setStream] = useState<Stream | "">("");
  // The Pengajar as session-scoped names (ADR-0022): a list of plain strings, added one at a time
  // from `teacherDraft` and shown as removable chips. Optional, capped at ten.
  const [teacherNames, setTeacherNames] = useState<string[]>([]);
  const [teacherDraft, setTeacherDraft] = useState("");
  const [collidedOn, setCollidedOn] = useState<string | null>(null);
  const [arranged, setArranged] = useState(false);
  const [saving, startSaving] = useTransition();

  const schoolFieldId = useId();
  const dateId = useId();
  const timeId = useId();
  const picId = useId();
  const streamId = useId();
  const teacherDraftId = useId();

  // `held_on` and `starts_at` are NOT NULL, every online Session must name a PIC and now carries a
  // Stream, all by CHECK — so the screen refuses a submit that could only be rejected. Pengajar are
  // optional at arrangement (mandatory at Tandai terlaksana), so they are not required here.
  const incomplete =
    schoolId === "" || heldOn === "" || startsAt === "" || picPersonId === "" || stream === "";

  // The picked School's Time Zone, for the Jam Mulai label (#165). The pinned entry point carries
  // one School; the picker looks its zone up by the current selection, so the suffix appears and
  // flips as the School changes, and is absent before one is chosen (standalone screen).
  const timeZone = school?.timeZone ?? schools?.find((option) => option.id === schoolId)?.timeZone;

  function reset() {
    setHeldOn("");
    setStartsAt("");
    setPicPersonId("");
    setStream("");
    setTeacherNames([]);
    setTeacherDraft("");
    setArranged(false);
    setCollidedOn(null);
  }

  function addTeacher() {
    const name = teacherDraft.trim();
    if (name === "" || teacherNames.length >= MAX_TEACHING_TEAM_PER_ONLINE_SESSION) return;
    setTeacherNames((previous) => [...previous, name]);
    setTeacherDraft("");
  }

  function removeTeacher(index: number) {
    setTeacherNames((previous) => previous.filter((_, i) => i !== index));
  }

  function submit() {
    startSaving(async () => {
      const result = await arrangeOnlineSessionAction({
        schoolId,
        heldOn,
        startsAt,
        picPersonId,
        // The guard above proves a Stream is chosen, so the cast holds.
        stream: stream as Stream,
        teacherNames: teacherNames.map((name) => name.trim()).filter((name) => name !== ""),
      });

      if (result.outcome === "arranged") {
        setArranged(true);
        setCollidedOn(null);
        // Detail Sekolah reads its Sessions on the server; refresh so the new one appears.
        router.refresh();
        return;
      }
      // `too-many-teachers` is unreachable from here — the chip input caps at the same number the
      // query does — so a collision is the only refusal the form can surface, beside the date.
      if (result.outcome === "collided") setCollidedOn(result.heldOn);
    });
  }

  if (arranged) {
    return (
      <div className="flex flex-col items-start gap-3.5 px-7 py-5">
        <Alert>
          <AlertTitle>Sesi daring dijadwalkan.</AlertTitle>
          <AlertDescription>Sesi baru muncul di daftar Sesi Sekolah ini.</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={reset}
        >
          Jadwalkan lagi
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-7 py-5">
      {collidedOn !== null && (
        <Alert variant="destructive">
          <AlertTitle>Sesi belum dijadwalkan.</AlertTitle>
          <AlertDescription>
            Sekolah ini sudah punya Sesi daring Aliran ini pada {collidedOn}. Ubah tanggal atau
            Aliran-nya, lalu simpan lagi.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {school === undefined ? (
          <Field
            id={schoolFieldId}
            label="Sekolah"
          >
            <Select
              items={Object.fromEntries((schools ?? []).map((entry) => [entry.id, entry.name]))}
              value={schoolId === "" ? null : schoolId}
              onValueChange={(value) => {
                setSchoolId((value as string | null) ?? "");
                setCollidedOn(null);
              }}
            >
              <SelectTrigger
                id={schoolFieldId}
                aria-label="Sekolah"
              >
                <SelectValue placeholder="Pilih Sekolah" />
              </SelectTrigger>
              <SelectContent>
                {(schools ?? []).map((entry) => (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}
                  >
                    {entry.name} — {entry.kabupatenKota}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">Sekolah</span>
            <p className="text-sm font-medium">{school.name}</p>
          </div>
        )}

        <Field
          id={picId}
          label="PIC"
        >
          <PersonSelect
            id={picId}
            people={staff}
            value={picPersonId}
            placeholder="Pilih PIC"
            onSelect={(personId) => {
              setPicPersonId(personId);
              setCollidedOn(null);
            }}
          />
        </Field>

        <Field
          id={streamId}
          label="Aliran"
        >
          <Select
            items={Object.fromEntries(STREAMS.map((entry) => [entry, entry]))}
            value={stream === "" ? null : stream}
            onValueChange={(value) => {
              setStream((value as Stream | null) ?? "");
              setCollidedOn(null);
            }}
          >
            <SelectTrigger
              id={streamId}
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
        </Field>

        <Field
          id={dateId}
          label="Tanggal"
        >
          <Input
            id={dateId}
            type="date"
            className="w-44"
            value={heldOn}
            onChange={(event) => {
              setHeldOn(event.target.value);
              setCollidedOn(null);
            }}
          />
        </Field>

        <Field
          id={timeId}
          label={`Jam Mulai${timeZoneSuffix(timeZone)}`}
        >
          {/* Local wall-clock time, in the School's Time Zone. */}
          <Input
            id={timeId}
            type="time"
            className="w-32"
            value={startsAt}
            onChange={(event) => {
              setStartsAt(event.target.value);
            }}
          />
        </Field>
      </div>

      <div>
        <Label htmlFor={teacherDraftId}>Pengajar (opsional)</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Nama Pengajar untuk Sesi ini. Tambahkan satu per satu; hingga{" "}
          {MAX_TEACHING_TEAM_PER_ONLINE_SESSION} nama.
        </p>

        <div className="mt-3 flex max-w-md gap-2">
          <Input
            id={teacherDraftId}
            aria-label="Nama pengajar"
            placeholder="Nama pengajar"
            value={teacherDraft}
            disabled={teacherNames.length >= MAX_TEACHING_TEAM_PER_ONLINE_SESSION}
            onChange={(event) => {
              setTeacherDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTeacher();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={
              teacherDraft.trim() === "" ||
              teacherNames.length >= MAX_TEACHING_TEAM_PER_ONLINE_SESSION
            }
            onClick={addTeacher}
          >
            Tambah pengajar
          </Button>
        </div>

        {teacherNames.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {teacherNames.map((name, index) => (
              <li
                // The list is reordered only by removal, so the index is a stable enough key for a
                // chip that carries no editable state of its own.
                key={`teacher-${index}`}
                className="flex items-center gap-1 rounded-2xl bg-input px-2.5 py-1 text-xs font-medium dark:bg-input/60"
              >
                {name}
                <button
                  type="button"
                  aria-label={`Hapus ${name}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    removeTeacher(index);
                  }}
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          disabled={incomplete || saving}
          onClick={submit}
        >
          {saving ? "Menyimpan…" : "Jadwalkan"}
        </Button>
      </div>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export { ArrangeOnlineSessionForm };
