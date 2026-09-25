"use client";

import { arrangeOnlineSessionAction } from "-/app/(app)/sesi-daring/baru/actions";
import { SchoolCombobox } from "-/components/single-select-combobox";
import type { SchoolOption } from "@sugt/db/queries";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import { TimeField } from "@sugt/ui/components/time-field";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

/**
 * **Catat Sesi daring** — record **one** online Session that has already happened (#70, #318). Two
 * entry points share this component: the standalone screen leads with a **searchable School
 * combobox** (`schools`), and Detail Sekolah pins the School it is on (`school`). Exactly one of the
 * two is passed.
 *
 * A third-party LMS runs online delivery, so the internal app only **logs** a Session — the write
 * records it **already delivered** (#318, ADR-0036), collapsing the old arrange→deliver step. Its two
 * Pengajar are **cohort-named**: one Siswa professor and one GTK-MS professor, one free-text name each,
 * both required — not a chip list. **No Aliran, no PIC and no Peserta selector (#318, #284):** both
 * cohorts are always taught, and delivery tracks neither Stream nor a PIC. The fields are Sekolah,
 * Tanggal (WIB, no future dates), Jam Mulai and Jam Selesai (both WIB, strictly ordered), and the two
 * Pengajar.
 *
 * A client component because every field is editable and none of that state is worth a URL. The
 * Schools arrive from the server as props; nothing here fetches. The Server Action is called with a
 * typed value rather than through a `<form action>`, because `FormData` would mean flattening the
 * fields out and parsing them back with the type checker helping at neither end.
 *
 * On success it **leaves the form**: the standalone screen redirects to `/sesi-daring` where the new
 * row appears, and the Detail Sekolah embed refreshes in place so the Session joins the School's own
 * list — no stay-on-page "record another" state (#318).
 */
function ArrangeOnlineSessionForm(
  props:
    | /** Detail Sekolah pins the School. */ { school: SchoolOption; schools?: never }
    | /** The standalone screen offers a searchable picker. */ {
        school?: never;
        schools: SchoolOption[];
      },
) {
  const { school, schools } = props;
  const router = useRouter();
  const [schoolId, setSchoolId] = useState(school?.id ?? "");
  const [heldOn, setHeldOn] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  // The two cohort-named Pengajar (#318), one free-text name each, both required.
  const [pengajarSiswaName, setPengajarSiswaName] = useState("");
  const [pengajarGtkMsName, setPengajarGtkMsName] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const schoolFieldId = useId();
  const dateId = useId();
  const timeId = useId();
  const endTimeId = useId();
  const pengajarSiswaId = useId();
  const pengajarGtkMsId = useId();

  // Today in WIB (`YYYY-MM-DD`) — the zone an online Session's date is a day in. Caps the date input
  // and mirrors the query's future-date guard, which is measured in the same zone.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

  // Jam Selesai must be strictly after Jam Mulai — the app-layer half of the
  // `session_ends_after_starts_check` CHECK. Both `HH:MM`, so the string compare is chronological.
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
    startSaving(async () => {
      const result = await arrangeOnlineSessionAction({
        schoolId,
        heldOn,
        startsAt,
        endsAt,
        pengajarSiswaName,
        pengajarGtkMsName,
      });

      if (result.outcome === "recorded") {
        // The standalone screen has no list of its own; land on the one that lists every Session.
        // The embed stays on the School page — a refresh brings the new Session into its list (#318).
        if (school === undefined) router.push("/sesi-daring");
        else router.refresh();
        return;
      }
      setRefusal(
        result.outcome === "collided"
          ? "Sekolah ini sudah punya Sesi daring pada tanggal tersebut. Ubah tanggalnya, lalu simpan lagi."
          : result.outcome === "future-date"
            ? "Tanggal tidak boleh di masa depan — Sesi daring dicatat setelah terlaksana."
            : result.outcome === "end-before-start"
              ? "Jam selesai harus setelah jam mulai."
              : "Sesi belum tersimpan. Periksa isian, lalu simpan lagi.",
      );
    });
  }

  return (
    <div className="flex flex-col gap-4 px-7 py-5">
      {refusal !== null && (
        <Alert variant="destructive">
          <AlertTitle>Sesi belum tersimpan.</AlertTitle>
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {school === undefined ? (
          <Field
            id={schoolFieldId}
            label="Sekolah"
          >
            <SchoolCombobox
              id={schoolFieldId}
              schools={schools ?? []}
              value={schoolId === "" ? null : schoolId}
              onValueChange={(next) => {
                setSchoolId(next ?? "");
                setRefusal(null);
              }}
            />
          </Field>
        ) : (
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">Sekolah</span>
            <p className="text-sm font-medium">{school.name}</p>
          </div>
        )}

        <Field
          id={dateId}
          label="Tanggal"
        >
          <Input
            id={dateId}
            type="date"
            className="w-44"
            value={heldOn}
            max={today}
            onChange={(event) => {
              setHeldOn(event.target.value);
              setRefusal(null);
            }}
          />
        </Field>

        {/* Jam Mulai and Jam Selesai side by side (#318). Online Sessions are always WIB (#283), so
            the zone is fixed, not School-derived. */}
        <Field
          id={timeId}
          label="Jam Mulai (WIB)"
        >
          <TimeField
            id={timeId}
            className="w-32"
            value={startsAt}
            onValueChange={(value) => {
              setStartsAt(value);
            }}
          />
        </Field>

        <Field
          id={endTimeId}
          label="Jam Selesai (WIB)"
        >
          <TimeField
            id={endTimeId}
            className="w-32"
            value={endsAt}
            onValueChange={(value) => {
              setEndsAt(value);
            }}
          />
          {endBeforeStart && (
            <p className="text-xs text-destructive">Jam selesai harus setelah jam mulai.</p>
          )}
        </Field>

        {/* The two cohort-named Pengajar side by side (#318), one name each, both required. */}
        <Field
          id={pengajarSiswaId}
          label="Pengajar Siswa"
        >
          <Input
            id={pengajarSiswaId}
            placeholder="Nama pengajar Siswa"
            value={pengajarSiswaName}
            onChange={(event) => {
              setPengajarSiswaName(event.target.value);
            }}
          />
        </Field>

        <Field
          id={pengajarGtkMsId}
          label="Pengajar GTK-MS"
        >
          <Input
            id={pengajarGtkMsId}
            placeholder="Nama pengajar GTK-MS"
            value={pengajarGtkMsName}
            onChange={(event) => {
              setPengajarGtkMsName(event.target.value);
            }}
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button
          disabled={incomplete || saving}
          onClick={submit}
        >
          {saving ? "Menyimpan…" : "Tandai Terlaksana"}
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
