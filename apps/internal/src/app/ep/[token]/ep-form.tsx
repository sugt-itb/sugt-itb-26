"use client";

import { RATING_INSTRUCTION } from "-/lib/rating-copy";
import {
  CONCERN_AT_OR_BELOW,
  PERJADIN_EVALUATION_ROLES,
  RATING_MAX,
  RATING_MIN,
  type PerjadinAspect,
  type PerjadinEvaluationRole,
} from "@sugt/domain";
import { Button } from "@sugt/ui/components/button";
import { Checkbox } from "@sugt/ui/components/checkbox";
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import { RatingInput } from "@sugt/ui/components/rating-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { Textarea } from "@sugt/ui/components/textarea";
import { useId, useState, useTransition } from "react";

import { submitPerjadinEvaluationAction } from "./actions";
import {
  answersForRole,
  askedAspects,
  evaluationSubmission,
  proseGaps,
  ratingsComplete,
  type AspectAnswers,
} from "./evaluation-answers";
import { GoneNotice } from "./gone-notice";

/**
 * **The public Perjadin Evaluation form** — filled after opening the `/ep/{token}` link, with no
 * sign-in (ADR-0024). It carries the rating/prose UX of the retired authenticated
 * `perjadin-evaluation-form.tsx` — the logistics Aspects, the "Tidak menginap" day-trip path for
 * lodging, one optional Komentar per Aspect, and the per-Aspect prose check — and wraps it in the
 * token form's shell: a header naming the trip, a self-declared Role and Name, and a swap to a
 * thank-you on submit, the same shape as `f/[token]/feedback-form.tsx`.
 *
 * **The Role decides the last Aspect** (#481, ADR-0054): Pendamping Support appears once a
 * Narasumber or a Pimpinan is picked, and is then required; a Pendamping is not asked it, and
 * switching to Pendamping drops one already given. What is asked, kept and sent lives in
 * `./evaluation-answers.ts`, tested without mounting this.
 *
 * Client-side because it holds a rubric's worth of state and swaps itself for a thank-you or a
 * dead-link notice. The token is the only credential it carries; the submit re-resolves it.
 */

/**
 * The Aspect names in Indonesian — the form copy around the English domain terms, the same edge
 * translation `record-forms.tsx` makes and `CONTEXT.md` § *Language* asks for. Each heads its
 * Komentar too; Pendamping Support's short name is *Bantuan Pendamping*.
 */
const PERJADIN_ASPECT_LABELS: Record<PerjadinAspect, string> = {
  lodging: "Penginapan",
  transport: "Transportasi",
  meals: "Konsumsi",
  punctuality: "Ketepatan waktu",
  pendamping_support: "Bantuan Pendamping",
};

/**
 * What the Rating control says where it is not the Aspect's name. Pendamping Support is asked as a
 * statement to agree with, worded with the product owner (#481) and shown exactly as written.
 */
const RATING_LABELS: Partial<Record<PerjadinAspect, string>> = {
  pendamping_support: "Pendamping membantu selama keberjalanan kegiatan.",
};

const INSTRUCTION = `${RATING_INSTRUCTION} Nilai ${CONCERN_AT_OR_BELOW} ke bawah wajib disertai penjelasan pada Komentar aspek tersebut.`;

/** The message an Aspect's Komentar carries when its own low Rating owes prose. */
const PROSE_REQUIRED = `Nilai ${CONCERN_AT_OR_BELOW} ke bawah wajib disertai penjelasan pada Komentar aspek ini.`;

function EpForm({
  token,
  tripName,
  schoolsLine,
}: {
  token: string;
  /** The trip's name, `{Sub-Cluster} · {dates}` (ADR-0044). */
  tripName: string;
  /** The trip's Schools, one line; empty when it has no live Session. */
  schoolsLine: string;
}) {
  const [role, setRole] = useState<PerjadinEvaluationRole | undefined>(undefined);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [ratings, setRatings] = useState<AspectAnswers<number>>({});
  const [noLodging, setNoLodging] = useState(false);
  // One optional Komentar per Aspect, so a comment belongs to the Rating it explains (#163).
  const [comments, setComments] = useState<AspectAnswers<string>>({});
  // Which Aspects are lit as owing prose — a set, not one flag, because the requirement is
  // per-Aspect: a low `transport` highlights only Transportasi's Komentar.
  const [proseNeeded, setProseNeeded] = useState<AspectAnswers<boolean>>({});
  // The write found the Ratings were not the Role's — only a forced request gets here.
  const [incomplete, setIncomplete] = useState(false);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [saving, startSaving] = useTransition();
  const namePrefix = useId();
  const nameId = useId();
  const roleId = useId();
  const noLodgingId = useId();

  // Lodging has its own block, with the day-trip box; every other asked Aspect is a row below it.
  const rowAspects = askedAspects(role).filter((aspect) => aspect !== "lodging");
  const canSubmit =
    role !== undefined && name.trim() !== "" && ratingsComplete({ role, ratings, noLodging });

  /** Clear one Aspect's prose warning — its Komentar was typed, or its Rating was raised. */
  function clearProse(aspect: PerjadinAspect) {
    setProseNeeded((previous) => ({ ...previous, [aspect]: false }));
  }

  /** Pick a Role, dropping whatever was given for an Aspect it is not asked. */
  function pickRole(next: PerjadinEvaluationRole) {
    setRole(next);
    setRatings((previous) => answersForRole(next, previous));
    setComments((previous) => answersForRole(next, previous));
    setProseNeeded((previous) => answersForRole(next, previous));
    setIncomplete(false);
  }

  function submit() {
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    // A null lodging must be a choice — *Tidak menginap* — never an unrated control degrading into
    // one. The column is nullable by design, so the write cannot catch a mistake here.
    if (!canSubmit) return;

    const submission = evaluationSubmission({ role, name, ratings, noLodging, comments });

    // Checked here so each message lands on its own Aspect's Komentar, and again in the write
    // function so it is a rule rather than a convenience.
    const gaps = proseGaps(submission);
    if (Object.keys(gaps).length > 0) {
      setProseNeeded(gaps);
      return;
    }

    startSaving(async () => {
      const result = await submitPerjadinEvaluationAction(token, submission);
      if (result.outcome === "filed") setDone(true);
      else if (result.outcome === "name-required") setNameError(true);
      else if (result.outcome === "prose-required") setProseNeeded(proseGaps(submission));
      else if (result.outcome === "ratings-mismatch") setIncomplete(true);
      else setGone(true);
    });
  }

  // The link died while the form was open — removed by hand in the database (ADR-0049). The same
  // notice a fresh dead load shows, and no form: there is nothing a second try here would reach.
  if (gone) return <GoneNotice />;

  // A thank-you and no form. A second submission is not prevented, so the page must not invite one
  // — there is no button back to the form.
  if (done) {
    return (
      <div className="text-center">
        <h1 className="font-heading text-lg font-medium">Terima kasih!</h1>
        <p className="mt-2 text-sm text-muted-foreground">Evaluasimu sudah tercatat.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-heading text-lg font-medium">Evaluasi Perjalanan Dinas</h1>
      {/* Which trip this is, so a filer opening a bare link knows what they are rating (#167). */}
      <p className="mt-1 text-sm text-foreground">{tripName}</p>
      {schoolsLine && <p className="text-sm text-muted-foreground">{schoolsLine}</p>}
      <p className="mt-2 text-sm text-muted-foreground">{INSTRUCTION}</p>

      <div className="mt-5 grid gap-5">
        <div className="grid gap-1.5">
          <Label htmlFor={roleId}>Peran</Label>
          <Select
            items={Object.fromEntries(PERJADIN_EVALUATION_ROLES.map((r) => [r, r]))}
            value={role ?? null}
            onValueChange={(value) => {
              if (value !== null) pickRole(value as PerjadinEvaluationRole);
            }}
          >
            <SelectTrigger
              id={roleId}
              aria-label="Peran"
            >
              <SelectValue placeholder="Pilih peran" />
            </SelectTrigger>
            <SelectContent>
              {PERJADIN_EVALUATION_ROLES.map((r) => (
                <SelectItem
                  key={r}
                  value={r}
                >
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={nameId}>Nama</Label>
          <Input
            id={nameId}
            value={name}
            aria-invalid={nameError}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(false);
            }}
          />
          {nameError && <p className="text-sm text-destructive">Nama wajib diisi.</p>}
        </div>

        <div className="grid gap-2">
          <RatingField
            namePrefix={namePrefix}
            aspect="lodging"
            label={PERJADIN_ASPECT_LABELS.lodging}
            value={ratings.lodging}
            disabled={noLodging}
            onValueChange={(value) => {
              setRatings((previous) => ({ ...previous, lodging: value }));
              clearProse("lodging");
            }}
          />
          <Label className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            <Checkbox
              id={noLodgingId}
              checked={noLodging}
              onCheckedChange={(checked) => {
                setNoLodging(checked === true);
                if (checked === true) {
                  // A skipped hotel has no Rating and no Komentar, and owes none — clear both so a
                  // stale one cannot travel or light up. Skipping only lowers obligations.
                  setRatings(({ lodging: _skipped, ...rest }) => rest);
                  setComments((previous) => ({ ...previous, lodging: "" }));
                }
                clearProse("lodging");
              }}
            />
            Tidak menginap (perjalanan pulang-hari)
          </Label>
          {/* Lodging's Komentar is hidden on a day trip: there is no hotel to comment on. */}
          {!noLodging && (
            <ProseField
              label={`Komentar ${PERJADIN_ASPECT_LABELS.lodging}`}
              value={comments.lodging ?? ""}
              invalid={proseNeeded.lodging}
              message={proseNeeded.lodging ? PROSE_REQUIRED : undefined}
              onChange={(value) => {
                setComments((previous) => ({ ...previous, lodging: value }));
                clearProse("lodging");
              }}
            />
          )}
        </div>

        {rowAspects.map((aspect) => (
          <div
            key={aspect}
            className="grid gap-2"
          >
            <RatingField
              namePrefix={namePrefix}
              aspect={aspect}
              label={RATING_LABELS[aspect] ?? PERJADIN_ASPECT_LABELS[aspect]}
              value={ratings[aspect]}
              onValueChange={(value) => {
                setRatings((previous) => ({ ...previous, [aspect]: value }));
                clearProse(aspect);
              }}
            />
            <ProseField
              label={`Komentar ${PERJADIN_ASPECT_LABELS[aspect]}`}
              value={comments[aspect] ?? ""}
              invalid={proseNeeded[aspect]}
              message={proseNeeded[aspect] ? PROSE_REQUIRED : undefined}
              onChange={(value) => {
                setComments((previous) => ({ ...previous, [aspect]: value }));
                clearProse(aspect);
              }}
            />
          </div>
        ))}

        {incomplete && (
          <p className="text-sm text-destructive">Beri nilai untuk tiap aspek, lalu kirim lagi.</p>
        )}
        <Button
          disabled={saving || !canSubmit}
          onClick={submit}
        >
          {saving ? "Mengirim…" : "Kirim"}
        </Button>
      </div>
    </div>
  );
}

/**
 * One Aspect's label and its 1–10 control. A sibling of `record-forms.tsx`'s, carrying one extra
 * prop: `lodging` disables its control when the Group did not stay anywhere. The `name` is
 * namespaced so two controls on one page do not fuse into a single radio group.
 *
 * The control sits **below** its question on every viewport (#486), as on the Participant Feedback
 * form: on a row of its own it is as wide as that row, and its cells shrink to fit a 360px phone.
 */
function RatingField({
  namePrefix,
  aspect,
  label,
  value,
  disabled,
  onValueChange,
}: {
  namePrefix: string;
  aspect: string;
  label: string;
  value: number | undefined;
  disabled?: boolean;
  onValueChange: (value: number) => void;
}) {
  const labelId = useId();

  return (
    <div className="grid gap-2">
      <Label id={labelId}>{label}</Label>
      <RatingInput
        name={`${namePrefix}-${aspect}`}
        aria-labelledby={labelId}
        min={RATING_MIN}
        max={RATING_MAX}
        concernAtOrBelow={CONCERN_AT_OR_BELOW}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </div>
  );
}

/** One free-text field. An Aspect's Komentar carries the elaboration message when its own Rating is low. */
function ProseField({
  label,
  value,
  invalid,
  message,
  onChange,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  message?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor={id}
        className="text-xs text-muted-foreground"
      >
        {label} (opsional)
      </Label>
      <Textarea
        id={id}
        value={value}
        aria-invalid={invalid}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {message !== undefined && <p className="text-sm text-destructive">{message}</p>}
    </div>
  );
}

export { EpForm };
