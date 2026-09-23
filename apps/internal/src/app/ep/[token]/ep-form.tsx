"use client";

import type { PerjadinEvaluationRatings } from "@sugt/db/queries";
import {
  CONCERN_AT_OR_BELOW,
  PERJADIN_ASPECTS,
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
import { GoneNotice } from "./gone-notice";

/**
 * **The public Perjadin Evaluation form** — filled after opening the `/ep/{token}` link, with no
 * sign-in (ADR-0024). It carries the rating/prose UX of the retired authenticated
 * `perjadin-evaluation-form.tsx` — the four Aspects, the "Tidak menginap" day-trip path for
 * lodging, one optional Komentar per Aspect, and the per-Aspect prose check — and wraps it in the
 * token form's shell: a header naming the trip, a self-declared Role and Name, and a swap to a
 * thank-you on submit, the same shape as `f/[token]/feedback-form.tsx`.
 *
 * Client-side because it holds a rubric's worth of state and swaps itself for a thank-you or a
 * dead-link notice. The token is the only credential it carries; the submit re-resolves it.
 */

/**
 * The Aspect names in Indonesian — the form copy around the English domain terms, the same edge
 * translation `record-forms.tsx` makes and `CONTEXT.md` § *Language* asks for.
 */
const PERJADIN_ASPECT_LABELS: Record<PerjadinAspect, string> = {
  lodging: "Penginapan",
  transport: "Transportasi",
  meals: "Konsumsi",
  punctuality: "Ketepatan waktu",
};

/**
 * The Aspects that are always rated — `PERJADIN_ASPECTS` without `lodging`, which is handled on
 * its own because it is nullable. Derived from the domain list rather than restated, so a new
 * Aspect there reaches the form without a second edit.
 */
type AlwaysRated = Exclude<PerjadinAspect, "lodging">;
const ALWAYS_RATED = PERJADIN_ASPECTS.filter(
  (aspect): aspect is AlwaysRated => aspect !== "lodging",
);

const INSTRUCTION = `Beri nilai ${RATING_MIN}–${RATING_MAX} untuk tiap aspek. Nilai ${CONCERN_AT_OR_BELOW} ke bawah wajib disertai penjelasan pada Komentar aspek tersebut.`;

/** The message an Aspect's Komentar carries when its own low Rating owes prose. */
const PROSE_REQUIRED = `Nilai ${CONCERN_AT_OR_BELOW} ke bawah wajib disertai penjelasan pada Komentar aspek ini.`;

function EpForm({
  token,
  destination,
  startsOn,
  endsOn,
}: {
  token: string;
  destination: string;
  startsOn: string;
  endsOn: string;
}) {
  const [role, setRole] = useState<PerjadinEvaluationRole | undefined>(undefined);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [lodging, setLodging] = useState<number | undefined>(undefined);
  const [noLodging, setNoLodging] = useState(false);
  const [others, setOthers] = useState<Partial<Record<AlwaysRated, number>>>({});
  // One optional Komentar per Aspect, so a comment belongs to the Rating it explains (#163).
  const [comments, setComments] = useState<Partial<Record<PerjadinAspect, string>>>({});
  // Which Aspects are lit as owing prose — a set, not one flag, because the requirement is
  // per-Aspect: a low `transport` highlights only Transportasi's Komentar.
  const [proseNeeded, setProseNeeded] = useState<Partial<Record<PerjadinAspect, boolean>>>({});
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [saving, startSaving] = useTransition();
  const namePrefix = useId();
  const nameId = useId();
  const roleId = useId();
  const noLodgingId = useId();

  const othersRated = ALWAYS_RATED.every((aspect) => others[aspect] !== undefined);
  const lodgingSettled = noLodging || lodging !== undefined;
  const canSubmit = role !== undefined && name.trim() !== "" && othersRated && lodgingSettled;

  /** Clear one Aspect's prose warning — its Komentar was typed, or its Rating was raised. */
  function clearProse(aspect: PerjadinAspect) {
    setProseNeeded((previous) => ({ ...previous, [aspect]: false }));
  }

  /**
   * Which low Aspects still owe their own Komentar. Per-Aspect: prose on a different Aspect does
   * not satisfy a low one (#163). A null `lodging` is not low — it drops out exactly as Postgres
   * `least()` leaves a NULL out of the minimum — so it never appears here.
   */
  function proseGaps(ratings: PerjadinEvaluationRatings): Partial<Record<PerjadinAspect, boolean>> {
    const byAspect: Record<PerjadinAspect, number | null> = {
      lodging: ratings.lodging,
      transport: ratings.transport,
      meals: ratings.meals,
      punctuality: ratings.punctuality,
    };
    const gaps: Partial<Record<PerjadinAspect, boolean>> = {};
    for (const aspect of PERJADIN_ASPECTS) {
      const rating = byAspect[aspect];
      if (
        rating !== null &&
        rating <= CONCERN_AT_OR_BELOW &&
        (comments[aspect]?.trim() ?? "") === ""
      ) {
        gaps[aspect] = true;
      }
    }
    return gaps;
  }

  function submit() {
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    if (!canSubmit) return;
    // A null lodging must be a choice — *Tidak menginap* — never an unrated control degrading into
    // one. The column is nullable by design, so the write cannot catch a mistake here.
    if (!noLodging && lodging === undefined) return;

    const ratings: PerjadinEvaluationRatings = {
      lodging: noLodging ? null : lodging!,
      transport: others.transport!,
      meals: others.meals!,
      punctuality: others.punctuality!,
    };

    // Checked here so each message lands on its own Aspect's Komentar, and again in the write
    // function so it is a rule rather than a convenience.
    const gaps = proseGaps(ratings);
    if (Object.keys(gaps).length > 0) {
      setProseNeeded(gaps);
      return;
    }

    startSaving(async () => {
      const result = await submitPerjadinEvaluationAction(token, {
        role: role!,
        name: name.trim(),
        ratings,
        comments: {
          lodging: blankToNull(comments.lodging ?? ""),
          transport: blankToNull(comments.transport ?? ""),
          meals: blankToNull(comments.meals ?? ""),
          punctuality: blankToNull(comments.punctuality ?? ""),
        },
      });
      if (result.outcome === "filed") setDone(true);
      else if (result.outcome === "name-required") setNameError(true);
      else if (result.outcome === "prose-required") setProseNeeded(proseGaps(ratings));
      else setGone(true);
    });
  }

  // The link died while the form was open — a reissue, or the 14 days ran out. The same notice a
  // fresh dead load shows, and no form: there is nothing a second try here would reach.
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
      <p className="mt-1 text-sm text-foreground">{destination}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {startsOn} – {endsOn}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{INSTRUCTION}</p>

      <div className="mt-5 grid gap-5">
        <div className="grid gap-1.5">
          <Label htmlFor={roleId}>Peran</Label>
          <Select
            items={Object.fromEntries(PERJADIN_EVALUATION_ROLES.map((r) => [r, r]))}
            value={role ?? null}
            onValueChange={(value) => {
              if (value !== null) setRole(value as PerjadinEvaluationRole);
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
            value={lodging}
            disabled={noLodging}
            onValueChange={(value) => {
              setLodging(value);
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
                  setLodging(undefined);
                  // A skipped hotel has no Komentar and owes none — clear both so a stale one
                  // cannot travel or light up. Skipping only lowers obligations, never raises.
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

        {ALWAYS_RATED.map((aspect) => (
          <div
            key={aspect}
            className="grid gap-2"
          >
            <RatingField
              namePrefix={namePrefix}
              aspect={aspect}
              label={PERJADIN_ASPECT_LABELS[aspect]}
              value={others[aspect]}
              onValueChange={(value) => {
                setOthers((previous) => ({ ...previous, [aspect]: value }));
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
    <div className="flex items-center justify-between gap-3">
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

/** A blank or whitespace-only field travels as nothing, matching the write's own `prose`. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export { EpForm };
