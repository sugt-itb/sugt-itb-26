"use client";

import { planPerjadinAction } from "-/app/(app)/perjadin/baru/actions";
import { CoveredSessionsNote } from "-/components/covered-sessions-note";
import { MultiSelectCombobox } from "-/components/multi-select-combobox";
import { duplicateSessionRows } from "-/components/perjadin-plan-duplicates";
import { PersonSelect } from "-/components/person-select";
import { RequiredLegend, RequiredMark } from "-/components/required-mark";
import { SchoolBookedElsewhere } from "-/components/school-booked-elsewhere";
import type {
  PlannablePerson,
  PlannableSchool,
  PlannableSubCluster,
  PlanPerjadinResult,
} from "@sugt/db/queries";
import {
  MAX_EXTRA_STAFF_PER_GROUP,
  MAX_OFFLINE_SESSIONS_PER_SCHOOL_PER_PERJADIN,
  MAX_TEACHING_TEAM_PER_PERJADIN,
  timeZoneSuffix,
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
import { TimeField } from "@sugt/ui/components/time-field";
import { XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

/** One offline Session on a School's list: its date, time and "Diajar oleh" teacher indexes. */
type SessionDraft = {
  date: string;
  time: string;
  /** Indexes into `teacherNames` — which of the trip's teachers staffed this Session. May be empty. */
  taughtBy: number[];
};

function emptySession(): SessionDraft {
  return { date: "", time: "", taughtBy: [] };
}

/**
 * The trip, its Staff-only Group, its trip-scoped Teaching Team names, its Pimpinan and its
 * Sessions, on one form and one submit (#137, ADR-0019, ADR-0020).
 *
 * **Planning starts from a Sub-Cluster** (#69): pick one, and its Schools appear. Each School holds
 * a repeatable list of Sessions — a School is "kept" on the trip exactly when it has at least one —
 * and each Session carries its own date, start time and the subset of the trip's Teaching Team who
 * taught it — no Stream, since a Session teaches both (ADR-0038). One School holds at most one
 * Session per date and start time: parallel rooms are one Session, so a repeated slot is flagged on
 * its row and holds back submit. The Teaching Team are **free-text names**, not People (ADR-0020): typed in one
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
  // The trip's range is two typed dates (ADR-0041) — a Perjadin carries no travel legs to derive
  // it from — beside the PIC.
  const [trip, setTrip] = useState({
    startsOn: "",
    endsOn: "",
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
  // Sessions keyed by School id, seeded empty when a Sub-Cluster is picked. A School with no Sessions
  // is simply not kept, so there is no separate "include" toggle any more.
  const [sessions, setSessions] = useState<Record<string, SessionDraft[]>>({});
  const [refusal, setRefusal] = useState<PlanPerjadinResult | null>(null);
  const [saving, startSaving] = useTransition();

  const subClusterFieldId = useId();
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
  // Rows repeating an earlier row's School, date and time (ADR-0038) — flagged in place and caught
  // here before submit; `planPerjadin` refuses the same payload as `duplicate-session` regardless.
  const duplicateRows = duplicateSessionRows(sessions);

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

  /**
   * Every field the database needs before a trip can be written. Teaching Team, Staff and Pimpinan are
   * optional.
   */
  const incomplete =
    subClusterId === "" ||
    trip.picPersonId === "" ||
    trip.startsOn === "" ||
    trip.endsOn === "" ||
    totalSessions === 0 ||
    Object.values(sessions).some((list) =>
      list.some((draft) => draft.date === "" || draft.time === ""),
    ) ||
    duplicateRows.size > 0;

  function submit() {
    startSaving(async () => {
      const result = await planPerjadinAction({
        subClusterId,
        startsOn: trip.startsOn,
        endsOn: trip.endsOn,
        picPersonId: trip.picPersonId,
        extraStaffPersonIds: extraStaff,
        teacherNames: teacherNames.map((name) => name.trim()).filter((name) => name !== ""),
        pimpinan,
        // Flatten each kept School's Sessions. The guard above proves date and time are set.
        sessions: keptSchools.flatMap((school) =>
          (sessions[school.id] ?? []).map((draft) => ({
            schoolId: school.id,
            heldOn: draft.date,
            startsAt: draft.time,
            taughtByTeacherIndexes: draft.taughtBy,
          })),
        ),
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

      <div className="px-4 pt-5 sm:px-7">
        <RequiredLegend />
      </div>

      <div className="grid gap-4 border-b border-border px-4 py-5 sm:grid-cols-2 sm:px-7">
        <Field
          id={subClusterFieldId}
          label="Kelompok Sekolah"
          required
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
              aria-required="true"
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
          required
        >
          <PersonSelect
            id={picId}
            aria-required="true"
            people={staff}
            value={trip.picPersonId}
            placeholder="Pilih PIC"
            onSelect={(personId) => {
              setTrip((previous) => ({ ...previous, picPersonId: personId }));
            }}
          />
        </Field>
      </div>

      <div className="border-b border-border px-4 py-5 sm:px-7">
        <h2 className="font-heading text-sm font-medium">Narasumber</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nama narasumber untuk Perjadin ini. Tambahkan satu per satu; hingga{" "}
          {MAX_TEACHING_TEAM_PER_PERJADIN} nama.
        </p>

        <div className="mt-3 flex max-w-md gap-2">
          <Input
            id={teacherDraftId}
            aria-label="Nama narasumber"
            placeholder="Nama narasumber"
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
            Tambah narasumber
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
            label="Pendamping tambahan"
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
            <Label>Pimpinan</Label>
            <p className="-mt-0.5 text-xs text-muted-foreground">
              Pimpinan DITSAMA yang ikut memantau — tercatat saja, bukan anggota Group.
            </p>
            {pimpinanRoster.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Belum ada Pimpinan di roster — minta Administrator menambahkannya lewat /orang.
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

      <div className="grid gap-4 border-b border-border px-4 py-5 sm:grid-cols-2 sm:px-7">
        <Field
          id={`${idPrefix}-starts-on`}
          label="Tanggal mulai"
          required
        >
          <Input
            id={`${idPrefix}-starts-on`}
            aria-required="true"
            type="date"
            value={trip.startsOn}
            onChange={(event) => {
              setTrip((previous) => ({ ...previous, startsOn: event.target.value }));
            }}
          />
        </Field>
        <Field
          id={`${idPrefix}-ends-on`}
          label="Tanggal selesai"
          required
        >
          <Input
            id={`${idPrefix}-ends-on`}
            aria-required="true"
            type="date"
            min={trip.startsOn || undefined}
            value={trip.endsOn}
            onChange={(event) => {
              setTrip((previous) => ({ ...previous, endsOn: event.target.value }));
            }}
          />
        </Field>
      </div>

      {selected === undefined ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-7">
          Pilih Kelompok Sekolah untuk menampilkan Sekolah-sekolahnya.
        </p>
      ) : (
        <ul className="border-b border-border">
          {schools.map((school) => {
            const list = sessions[school.id] ?? [];
            return (
              <li
                key={school.id}
                className="border-b border-border px-4 py-4 last:border-b-0 sm:px-7"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={list.length === 0 ? "text-muted-foreground" : undefined}>
                    <p className="text-sm font-medium">{school.name}</p>
                    <p className="text-xs text-muted-foreground">{school.kabupatenKota}</p>
                    <div className="mt-1">
                      <CoveredSessionsNote
                        sessions={school.offlineSessionsElsewhere}
                        empty="Belum ada Sesi luring"
                      />
                    </div>
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
                    {list.map((draft, index) => {
                      const duplicate = duplicateRows.has(`${school.id}-${index}`);
                      return (
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
                            required
                          >
                            <Input
                              id={`${idPrefix}-date-${school.id}-${index}`}
                              aria-required="true"
                              type="date"
                              className="w-44"
                              // Bounded by the trip's typed range (ADR-0041).
                              min={trip.startsOn || undefined}
                              max={trip.endsOn || undefined}
                              aria-invalid={duplicate || undefined}
                              value={draft.date}
                              onChange={(event) => {
                                patchSession(school.id, index, { date: event.target.value });
                              }}
                            />
                          </Field>

                          <Field
                            id={`${idPrefix}-time-${school.id}-${index}`}
                            label={`Jam Mulai${timeZoneSuffix(school.timeZone)}`}
                            required
                          >
                            <TimeField
                              id={`${idPrefix}-time-${school.id}-${index}`}
                              aria-required="true"
                              className="w-32"
                              aria-invalid={duplicate || undefined}
                              value={draft.time}
                              onValueChange={(value) => {
                                patchSession(school.id, index, { time: value });
                              }}
                            />
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
                                    ? "Belum ada narasumber"
                                    : "Pilih narasumber…"
                                }
                                emptyLabel="Tidak ada narasumber."
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

                          {duplicate && (
                            <p
                              role="alert"
                              className="basis-full text-sm text-destructive"
                            >
                              Sekolah ini sudah punya Sesi pada tanggal dan jam yang sama. Sesi
                              paralel dicatat sebagai satu Sesi — hapus baris ini atau ubah jamnya.
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3.5 shadow-lg sm:px-7">
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
    <div className="px-4 pt-5 sm:px-7">
      <Alert variant="destructive">
        <AlertTitle>Perjadin belum dibuat.</AlertTitle>
        <AlertDescription>
          {result.outcome === "ends-before-starts" && (
            <p>Tanggal selesai tidak boleh lebih awal dari Tanggal mulai.</p>
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
              Nama narasumber terlalu banyak: maksimal {result.limit}, bukan {result.count}.
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
          {result.outcome === "duplicate-session" && (
            <>
              <p>Satu Sekolah tidak bisa punya dua Sesi pada tanggal dan jam yang sama:</p>
              <ul className="mt-1.5 list-disc pl-4">
                {result.duplicates.map((duplicate) => (
                  <li key={`${duplicate.schoolId} ${duplicate.heldOn} ${duplicate.startsAt}`}>
                    {nameOf(duplicate.schoolId)} · {duplicate.heldOn} {duplicate.startsAt}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.outcome === "school-booked-on-another-perjadin" && (
            <p>
              <SchoolBookedElsewhere refusal={result} />
            </p>
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

/**
 * A label over its control. `required` adds the asterisk only — the control beside it carries its own
 * `aria-required`, since this cannot reach into `children` to set it.
 */
function Field({
  id,
  label,
  required = false,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor={id}
        className="gap-1"
      >
        {label}
        {required && <RequiredMark />}
      </Label>
      {children}
    </div>
  );
}

export { PerjadinPlanForm };
