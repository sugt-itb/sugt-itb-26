"use client";

import { planPerjadinAction } from "-/app/(app)/rencanakan-perjadin/actions";
import { MultiSelectCombobox } from "-/components/multi-select-combobox";
import { PersonSelect } from "-/components/person-select";
import type {
  PlannablePerson,
  PlannableSchool,
  PlannableSubCluster,
  PlanPerjadinResult,
} from "@sugt/db/queries";
import {
  formatIdr,
  MAX_EXTRA_STAFF_PER_GROUP,
  MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN,
  MAX_TEACHING_TEAM_PER_PERJADIN,
  STREAMS,
  timeZoneSuffix,
  TRANSPORT_MODES,
  type Stream,
  type TransportMode,
} from "@sugt/domain";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import { Checkbox } from "@sugt/ui/components/checkbox";
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import { LinkButton } from "@sugt/ui/components/link-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

/** One offline Session on a School's list: its date, time, Stream and "Diajar oleh" teacher indexes. */
type SessionDraft = {
  date: string;
  time: string;
  /** `""` until a Stream is chosen; the submit guard proves it is set before the cast. */
  stream: Stream | "";
  /** Indexes into `teacherNames` — which of the trip's teachers staffed this Session. May be empty. */
  taughtBy: number[];
};

function emptySession(): SessionDraft {
  return { date: "", time: "", stream: "", taughtBy: [] };
}

/**
 * The trip, its Staff-only Group, its trip-scoped Teaching Team names, its Pimpinan and its
 * Sessions, on one form and one submit (#137, ADR-0019, ADR-0020).
 *
 * **Planning starts from a Sub-Cluster** (#69): pick one, and its Schools appear. Each School holds
 * a repeatable list of Sessions — a School is "kept" on the trip exactly when it has at least one —
 * and each Session carries its own date, start time, Stream and the subset of the trip's Teaching
 * Team who taught it. The Teaching Team are **free-text names**, not People (ADR-0020): typed in one
 * at a time and shown as removable chips. Pimpinan are chosen from the Pimpinan roster (#181).
 *
 * A client component because every row is editable and none of that state is worth a URL. The
 * Sub-Clusters and the Staff and Pimpinan rosters arrive as props; nothing here fetches. The action
 * is called with a typed value rather than through a `<form action>`, because the payload is nested —
 * Sessions with teacher references — and `FormData` would mean flattening it out and parsing it back.
 */
function PerjadinPlanForm({
  subClusters,
  staff,
  pimpinan: pimpinanRoster,
}: {
  subClusters: PlannableSubCluster[];
  staff: PlannablePerson[];
  pimpinan: PlannablePerson[];
}) {
  const router = useRouter();
  const [subClusterId, setSubClusterId] = useState("");
  // The trip's range is no longer typed here (ADR-0021): it is the departure→return span, derived
  // at the write from the logistics leg dates. So Mulai/Selesai are gone and this holds only the
  // Advance and the PIC.
  const [trip, setTrip] = useState({
    advanceIdr: "",
    picPersonId: "",
  });
  // The Teaching Team as trip-scoped names (ADR-0020): a list of plain strings, added one at a time
  // from `teacherDraft` and shown as removable chips. Optional, capped at twenty.
  const [teacherNames, setTeacherNames] = useState<string[]>([]);
  const [teacherDraft, setTeacherDraft] = useState("");
  // Extra Staff on the Group beyond the PIC — a searchable multi-select of Person ids, capped at ten.
  const [extraStaff, setExtraStaff] = useState<string[]>([]);
  // The Pimpinan recorded on the trip — personIds chosen from the Pimpinan roster. Record-only
  // (ADR-0020, #181).
  const [pimpinan, setPimpinan] = useState<string[]>([]);
  // Departure/return logistics, all six required to submit. The zones are the server's — WIB out,
  // derived back.
  const [logistics, setLogistics] = useState({
    departureDate: "",
    departureTime: "",
    departureMode: "" as TransportMode | "",
    returnDate: "",
    returnTime: "",
    returnMode: "" as TransportMode | "",
  });
  // Sessions keyed by School id, seeded empty when a Sub-Cluster is picked. A School with no Sessions
  // is simply not kept, so there is no separate "include" toggle any more.
  const [sessions, setSessions] = useState<Record<string, SessionDraft[]>>({});
  const [refusal, setRefusal] = useState<PlanPerjadinResult | null>(null);
  const [saving, startSaving] = useTransition();

  const subClusterFieldId = useId();
  const advanceId = useId();
  const picId = useId();
  const teacherDraftId = useId();
  const extraStaffId = useId();
  // One prefix for the ids built per School and per Session in a `map`. `useId` cannot be called
  // inside one, and a bare key would collide if this form were ever rendered twice.
  const idPrefix = useId();

  const selected = subClusters.find((entry) => entry.id === subClusterId);
  const schools = selected?.schools ?? [];
  const keptSchools = schools.filter((school) => (sessions[school.id]?.length ?? 0) > 0);
  const totalSessions = Object.values(sessions).reduce((sum, list) => sum + list.length, 0);

  // "Diajar oleh" offers this trip's teacher names, referenced by their index. A blank name has no
  // chip and cannot be referenced, so options are the non-blank names paired with their real index.
  const teacherOptions = teacherNames
    .map((name, index) => ({ value: String(index), label: name.trim() }))
    .filter((option) => option.label !== "");

  // The Staff roster minus the PIC — a Group holds each person once, and the PIC is already on it.
  const extraStaffOptions = staff
    .filter((person) => person.id !== trip.picPersonId)
    .map((person) => ({ value: person.id, label: person.fullName }));

  function pickSubCluster(id: string) {
    setSubClusterId(id);
    const picked = subClusters.find((entry) => entry.id === id);
    setSessions(Object.fromEntries((picked?.schools ?? []).map((school) => [school.id, []])));
    setRefusal(null);
  }

  function addTeacher() {
    const name = teacherDraft.trim();
    if (name === "" || teacherNames.length >= MAX_TEACHING_TEAM_PER_PERJADIN) return;
    setTeacherNames((previous) => [...previous, name]);
    setTeacherDraft("");
  }

  /** Removing a teacher drops its chip and rewrites every Session's `taughtBy` so the indexes hold. */
  function removeTeacher(index: number) {
    setTeacherNames((previous) => previous.filter((_, i) => i !== index));
    setSessions((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([schoolId, list]) => [
          schoolId,
          list.map((draft) => ({
            ...draft,
            taughtBy: draft.taughtBy.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)),
          })),
        ]),
      ),
    );
  }

  function addSession(schoolId: string) {
    setSessions((previous) => {
      const list = previous[schoolId] ?? [];
      if (list.length >= MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN) return previous;
      return { ...previous, [schoolId]: [...list, emptySession()] };
    });
  }

  function removeSession(schoolId: string, index: number) {
    setSessions((previous) => ({
      ...previous,
      [schoolId]: (previous[schoolId] ?? []).filter((_, i) => i !== index),
    }));
  }

  function patchSession(schoolId: string, index: number, patch: Partial<SessionDraft>) {
    setSessions((previous) => ({
      ...previous,
      [schoolId]: (previous[schoolId] ?? []).map((draft, i) =>
        i === index ? { ...draft, ...patch } : draft,
      ),
    }));
  }

  /** Every field the database needs before a trip can be written. Teaching Team, Staff, Pimpinan are optional. */
  const incomplete =
    subClusterId === "" ||
    trip.advanceIdr === "" ||
    trip.picPersonId === "" ||
    logistics.departureDate === "" ||
    logistics.departureTime === "" ||
    logistics.departureMode === "" ||
    logistics.returnDate === "" ||
    logistics.returnTime === "" ||
    logistics.returnMode === "" ||
    totalSessions === 0 ||
    Object.values(sessions).some((list) =>
      list.some((draft) => draft.date === "" || draft.time === "" || draft.stream === ""),
    );

  function submit() {
    startSaving(async () => {
      const result = await planPerjadinAction({
        subClusterId,
        advanceIdr: Number(trip.advanceIdr),
        picPersonId: trip.picPersonId,
        extraStaffPersonIds: extraStaff,
        teacherNames: teacherNames.map((name) => name.trim()).filter((name) => name !== ""),
        pimpinan,
        // Flatten each kept School's Sessions. The guard above proves date, time and stream are set,
        // so the `stream` cast holds.
        sessions: keptSchools.flatMap((school) =>
          (sessions[school.id] ?? []).map((draft) => ({
            schoolId: school.id,
            heldOn: draft.date,
            startsAt: draft.time,
            stream: draft.stream as Stream,
            taughtByTeacherIndexes: draft.taughtBy,
          })),
        ),
        // The guard proves the six logistics fields are set, so the `mode` casts hold.
        departure: {
          date: logistics.departureDate,
          time: logistics.departureTime,
          mode: logistics.departureMode as TransportMode,
        },
        return: {
          date: logistics.returnDate,
          time: logistics.returnTime,
          mode: logistics.returnMode as TransportMode,
        },
      });

      if (result.outcome === "planned") {
        router.push(`/perjadin/${result.perjadinId}`);
        return;
      }
      setRefusal(result);
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      {refusal !== null && (
        <Refused
          result={refusal}
          schools={schools}
        />
      )}

      <div className="grid gap-4 border-b border-border px-7 py-5 sm:grid-cols-2">
        <Field
          id={subClusterFieldId}
          label="Kelompok Sekolah"
        >
          <Select
            items={Object.fromEntries(
              subClusters.map((entry) => [entry.id, `${entry.name} — ${entry.clusterName}`]),
            )}
            value={subClusterId === "" ? null : subClusterId}
            onValueChange={(value) => {
              pickSubCluster((value as string | null) ?? "");
            }}
          >
            <SelectTrigger
              id={subClusterFieldId}
              aria-label="Kelompok Sekolah"
            >
              <SelectValue placeholder="Pilih Kelompok Sekolah" />
            </SelectTrigger>
            <SelectContent>
              {subClusters.map((entry) => (
                <SelectItem
                  key={entry.id}
                  value={entry.id}
                >
                  {entry.name} — {entry.clusterName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id={picId}
          label="PIC"
        >
          <PersonSelect
            id={picId}
            people={staff}
            value={trip.picPersonId}
            placeholder="Pilih PIC"
            onSelect={(personId) => {
              setTrip((previous) => ({ ...previous, picPersonId: personId }));
            }}
          />
        </Field>

        <Field
          id={advanceId}
          label="Uang muka (Rp)"
        >
          {/*
            Fixed at planning and transferred before departure, so a Perjadin is never in an
            unfunded state — which is why this is on the planning form rather than the acquittal.

            A masked text input, not `type="number"`: it groups the thousands as they type so
            a seven-figure advance's magnitude is legible at the point of entry. `advanceIdr` stays
            a plain digit string in state — every non-digit is stripped back out on change — so
            submit's `Number(...)` and the empty-value guard are unchanged.
          */}
          <Input
            id={advanceId}
            type="text"
            inputMode="numeric"
            value={trip.advanceIdr === "" ? "" : `Rp ${formatIdr(Number(trip.advanceIdr))}`}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
              setTrip((previous) => ({ ...previous, advanceIdr: digits }));
            }}
          />
        </Field>
      </div>

      <div className="border-b border-border px-7 py-5">
        <h2 className="font-heading text-sm font-medium">Teaching Team</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nama pengajar untuk Perjadin ini (opsional). Tambahkan satu per satu; hingga{" "}
          {MAX_TEACHING_TEAM_PER_PERJADIN} nama.
        </p>

        <div className="mt-3 flex max-w-md gap-2">
          <Input
            id={teacherDraftId}
            aria-label="Nama pengajar"
            placeholder="Nama pengajar"
            value={teacherDraft}
            disabled={teacherNames.length >= MAX_TEACHING_TEAM_PER_PERJADIN}
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
              teacherDraft.trim() === "" || teacherNames.length >= MAX_TEACHING_TEAM_PER_PERJADIN
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
                // The list is reordered only by removal, which rewrites the references too, so the
                // index is a stable enough key for a chip that carries no editable state of its own.
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

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field
            id={extraStaffId}
            label="Pendamping tambahan (opsional)"
          >
            <p className="-mt-0.5 mb-1 text-xs text-muted-foreground">
              Koordinator, bendahara, atau dokumentator — selain PIC, hingga{" "}
              {MAX_EXTRA_STAFF_PER_GROUP} orang.
            </p>
            <MultiSelectCombobox
              id={extraStaffId}
              aria-label="Pendamping tambahan"
              placeholder="Cari Pendamping…"
              emptyLabel="Tidak ada Pendamping."
              options={extraStaffOptions}
              value={extraStaff}
              onValueChange={(next) => {
                // The cap is refused at the write too; this keeps the form from offering the mistake.
                if (next.length <= MAX_EXTRA_STAFF_PER_GROUP) setExtraStaff(next);
              }}
            />
          </Field>

          <div className="grid gap-1.5">
            <Label>Pimpinan (opsional)</Label>
            <p className="-mt-0.5 text-xs text-muted-foreground">
              Pimpinan DITSAMA yang ikut memantau — tercatat saja, bukan anggota Group.
            </p>
            {pimpinanRoster.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Belum ada Pimpinan di roster — tambahkan lewat /orang.
              </p>
            ) : (
              <ul className="mt-1 grid gap-2">
                {pimpinanRoster.map((person) => {
                  const checkboxId = `${idPrefix}-pimpinan-${person.id}`;
                  return (
                    <li
                      key={person.id}
                      className="flex items-center gap-2.5"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={pimpinan.includes(person.id)}
                        onCheckedChange={(checked) => {
                          setPimpinan((previous) =>
                            checked === true
                              ? [...previous, person.id]
                              : previous.filter((entry) => entry !== person.id),
                          );
                        }}
                      />
                      <Label
                        htmlFor={checkboxId}
                        className="text-sm font-normal"
                      >
                        {person.fullName}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-b border-border px-7 py-5 sm:grid-cols-2">
        <TravelLeg
          idPrefix={`${idPrefix}-departure`}
          heading="Keberangkatan"
          note="Dari Bandung (WIB)."
          date={logistics.departureDate}
          time={logistics.departureTime}
          mode={logistics.departureMode}
          onChange={(patch) => {
            setLogistics((previous) => ({
              ...previous,
              departureDate: patch.date ?? previous.departureDate,
              departureTime: patch.time ?? previous.departureTime,
              departureMode: patch.mode ?? previous.departureMode,
            }));
          }}
        />
        <TravelLeg
          idPrefix={`${idPrefix}-return`}
          heading="Kepulangan"
          note="Zona waktu mengikuti Sekolah terakhir yang dikunjungi."
          date={logistics.returnDate}
          time={logistics.returnTime}
          mode={logistics.returnMode}
          onChange={(patch) => {
            setLogistics((previous) => ({
              ...previous,
              returnDate: patch.date ?? previous.returnDate,
              returnTime: patch.time ?? previous.returnTime,
              returnMode: patch.mode ?? previous.returnMode,
            }));
          }}
        />
      </div>

      {selected === undefined ? (
        <p className="px-7 py-6 text-sm text-muted-foreground">
          Pilih Kelompok Sekolah untuk menampilkan Sekolah-sekolahnya.
        </p>
      ) : (
        <ul className="border-b border-border">
          {schools.map((school) => {
            const list = sessions[school.id] ?? [];
            return (
              <li
                key={school.id}
                className="border-b border-border px-7 py-4 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={list.length === 0 ? "text-muted-foreground" : undefined}>
                    <p className="text-sm font-medium">{school.name}</p>
                    <p className="text-xs text-muted-foreground">{school.kabupatenKota}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={list.length >= MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN}
                    onClick={() => {
                      addSession(school.id);
                    }}
                  >
                    Tambah Sesi
                  </Button>
                </div>

                {list.length > 0 && (
                  <ul className="mt-3 grid gap-3">
                    {list.map((draft, index) => (
                      <li
                        // A Session row carries editable state, but the list only grows at the end or
                        // shrinks by removal, so a positional key does not swap one row's state for
                        // another's between renders.
                        key={`${school.id}-session-${index}`}
                        className="flex flex-wrap items-end gap-x-5 gap-y-2 rounded-2xl bg-muted/40 px-4 py-3"
                      >
                        <Field
                          id={`${idPrefix}-date-${school.id}-${index}`}
                          label="Tanggal Sesi"
                        >
                          <Input
                            id={`${idPrefix}-date-${school.id}-${index}`}
                            type="date"
                            className="w-44"
                            // The range is the departure→return span now (ADR-0021), so a Session's
                            // date is bounded by the leg dates rather than by typed Mulai/Selesai.
                            min={logistics.departureDate || undefined}
                            max={logistics.returnDate || undefined}
                            value={draft.date}
                            onChange={(event) => {
                              patchSession(school.id, index, { date: event.target.value });
                            }}
                          />
                        </Field>

                        <Field
                          id={`${idPrefix}-time-${school.id}-${index}`}
                          label={`Jam Mulai${timeZoneSuffix(school.timeZone)}`}
                        >
                          <Input
                            id={`${idPrefix}-time-${school.id}-${index}`}
                            type="time"
                            className="w-32"
                            value={draft.time}
                            onChange={(event) => {
                              patchSession(school.id, index, { time: event.target.value });
                            }}
                          />
                        </Field>

                        <Field
                          id={`${idPrefix}-stream-${school.id}-${index}`}
                          label="Aliran"
                        >
                          <Select
                            items={Object.fromEntries(STREAMS.map((stream) => [stream, stream]))}
                            value={draft.stream === "" ? null : draft.stream}
                            onValueChange={(value) => {
                              patchSession(school.id, index, {
                                stream: (value as Stream | null) ?? "",
                              });
                            }}
                          >
                            <SelectTrigger
                              id={`${idPrefix}-stream-${school.id}-${index}`}
                              aria-label="Aliran"
                              className="w-36"
                            >
                              <SelectValue placeholder="Pilih Aliran" />
                            </SelectTrigger>
                            <SelectContent>
                              {STREAMS.map((stream) => (
                                <SelectItem
                                  key={stream}
                                  value={stream}
                                >
                                  {stream}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>

                        <Field
                          id={`${idPrefix}-taught-${school.id}-${index}`}
                          label="Diajar oleh"
                        >
                          <div className="w-64">
                            <MultiSelectCombobox
                              id={`${idPrefix}-taught-${school.id}-${index}`}
                              aria-label="Diajar oleh"
                              placeholder={
                                teacherOptions.length === 0
                                  ? "Belum ada pengajar"
                                  : "Pilih pengajar…"
                              }
                              emptyLabel="Tidak ada pengajar."
                              options={teacherOptions}
                              value={draft.taughtBy.map(String)}
                              onValueChange={(next) => {
                                patchSession(school.id, index, {
                                  taughtBy: next.map(Number),
                                });
                              }}
                            />
                          </div>
                        </Field>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Hapus Sesi"
                          onClick={() => {
                            removeSession(school.id, index);
                          }}
                        >
                          <XIcon className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-7 py-3.5 shadow-lg">
        <p className="text-sm">
          <b>{totalSessions}</b> Sesi luring di <b>{keptSchools.length}</b> Sekolah akan dijadwalkan
        </p>

        <div className="flex gap-2.5">
          <LinkButton
            variant="ghost"
            render={<Link href="/perjadin" />}
          >
            Batal
          </LinkButton>
          <Button
            disabled={incomplete || saving}
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Rencanakan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * What a refused plan says.
 *
 * **Nothing was written**, and each of these says which field to fix rather than that something
 * went wrong. The per-School cases name the Schools, because the fix is per row.
 */
function Refused({ result, schools }: { result: PlanPerjadinResult; schools: PlannableSchool[] }) {
  const nameOf = (schoolId: string) =>
    schools.find((school) => school.id === schoolId)?.name ?? schoolId;

  return (
    <div className="px-7 pt-5">
      <Alert variant="destructive">
        <AlertTitle>Perjadin belum dibuat.</AlertTitle>
        <AlertDescription>
          {result.outcome === "return-before-departure" && (
            <p>Tanggal Kepulangan tidak boleh lebih awal dari Keberangkatan.</p>
          )}
          {result.outcome === "no-schools" && <p>Belum ada Sesi pada Perjadin ini.</p>}
          {result.outcome === "duplicate-staff" && (
            <p>Setiap Pendamping tambahan harus berbeda, dan bukan PIC.</p>
          )}
          {result.outcome === "too-many-extra-staff" && (
            <p>
              Pendamping tambahan terlalu banyak: maksimal {result.limit}, bukan {result.count}.
            </p>
          )}
          {result.outcome === "too-many-teachers" && (
            <p>
              Nama pengajar terlalu banyak: maksimal {result.limit}, bukan {result.count}.
            </p>
          )}
          {result.outcome === "too-many-sessions-per-school" && (
            <>
              <p>Terlalu banyak Sesi pada satu Sekolah (maksimal per Sekolah terlampaui):</p>
              <ul className="mt-1.5 list-disc pl-4">
                {result.offending.map((entry) => (
                  <li key={entry.schoolId}>
                    {nameOf(entry.schoolId)} · {entry.count} Sesi
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.outcome === "unknown-pimpinan" && (
            <p>Nama Pimpinan tidak dikenal: {result.offending.join(", ")}.</p>
          )}
          {result.outcome === "session-outside-perjadin" && (
            <>
              <p>
                Tanggal Sesi harus berada di antara {result.startsOn} dan {result.endsOn}.
              </p>
              <ul className="mt-1.5 list-disc pl-4">
                {result.offending.map((offending) => (
                  <li key={`${offending.schoolId}-${offending.heldOn}-${offending.startsAt}`}>
                    {nameOf(offending.schoolId)} · {offending.heldOn}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.outcome === "school-outside-sub-cluster" && (
            <>
              <p>Sekolah berikut bukan bagian dari Kelompok Sekolah yang dipilih:</p>
              <ul className="mt-1.5 list-disc pl-4">
                {result.offending.map((schoolId) => (
                  <li key={schoolId}>{nameOf(schoolId)}</li>
                ))}
              </ul>
            </>
          )}
          {result.outcome === "session-time-clash" && (
            <>
              <p>Dua Sekolah yang berbeda tidak bisa berada di tanggal dan jam yang sama:</p>
              <ul className="mt-1.5 list-disc pl-4">
                {result.clashes.map((clash) => (
                  <li key={`${clash.heldOn} ${clash.startsAt}`}>
                    {clash.schoolIds.map(nameOf).join(", ")} · {clash.heldOn} {clash.startsAt}
                  </li>
                ))}
              </ul>
            </>
          )}
        </AlertDescription>
      </Alert>
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

/**
 * One travel leg on the plan form: a date, a wall-clock time and a transport mode. No zone
 * picker — the departure zone is WIB and the return zone is derived server-side from the last
 * School, so a control for it would offer a choice the form does not make.
 */
function TravelLeg({
  idPrefix,
  heading,
  note,
  date,
  time,
  mode,
  onChange,
}: {
  idPrefix: string;
  heading: string;
  note: string;
  date: string;
  time: string;
  mode: TransportMode | "";
  onChange: (patch: { date?: string; time?: string; mode?: TransportMode }) => void;
}) {
  return (
    <div className="grid gap-3">
      <div>
        <h2 className="font-heading text-sm font-medium">{heading}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{note}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id={`${idPrefix}-date`}
          label="Tanggal"
        >
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={date}
            onChange={(event) => {
              onChange({ date: event.target.value });
            }}
          />
        </Field>
        <Field
          id={`${idPrefix}-time`}
          label="Jam"
        >
          <Input
            id={`${idPrefix}-time`}
            type="time"
            value={time}
            onChange={(event) => {
              onChange({ time: event.target.value });
            }}
          />
        </Field>
        <Field
          id={`${idPrefix}-mode`}
          label="Moda"
        >
          <Select
            items={Object.fromEntries(TRANSPORT_MODES.map((entry) => [entry, entry]))}
            value={mode === "" ? null : mode}
            onValueChange={(value) => {
              onChange({ mode: (value as TransportMode | null) ?? undefined });
            }}
          >
            <SelectTrigger
              id={`${idPrefix}-mode`}
              aria-label={`Moda ${heading}`}
            >
              <SelectValue placeholder="Pilih moda" />
            </SelectTrigger>
            <SelectContent>
              {TRANSPORT_MODES.map((entry) => (
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
      </div>
    </div>
  );
}

export { PerjadinPlanForm };
