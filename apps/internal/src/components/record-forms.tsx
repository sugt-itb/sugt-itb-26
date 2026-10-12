"use client";

import { fileSessionRecordAction } from "-/app/(app)/sesi/[id]/actions";
import { RATING_SCALE_DIRECTION } from "-/lib/rating-copy";
import {
  CONCERN_AT_OR_BELOW,
  RATING_MAX,
  RATING_MIN,
  SESSION_RECORD_ASPECTS,
  type SessionRecordAspect,
} from "@sugt/domain";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import { Label } from "@sugt/ui/components/label";
import { RatingInput } from "@sugt/ui/components/rating-input";
import { Textarea } from "@sugt/ui/components/textarea";
import { useId, useState, useTransition } from "react";

/**
 * The **Session Record** form — the PIC's account of the visit (five Aspects). Offered from the
 * "who still owes what" list on Detail Sesi, to the PIC who owes it and nobody else, and not until
 * the Session is delivered.
 *
 * **The Class Record form was retired in T3** (#153): a Class Record was filed by a `Teaching Team`
 * Person, but that role is gone (online teachers are free-text names now, ADR-0022) and Class
 * Records are deferred for both modes, so nothing surfaces the form.
 *
 * Client component because it holds a rubric's worth of form state, and none of it is worth a URL.
 * The seam is the action; nothing here fetches.
 *
 * **The elaboration rule is checked here and again in the write.** A Rating of 7 or below
 * needs prose, and this catches it before the round trip so the message lands on the field —
 * `fileSessionRecord` holds the same rule, and the database CHECK holds it behind it. That is the
 * rule `docs/data-model.md` calls _enforced twice by design_, enforced here for the message and
 * there for the fact.
 *
 * The Aspect names are in Indonesian: the Aspects are English domain terms (`CONTEXT.md` §
 * *Language*), and this is the form copy around them. The translation lives at this edge rather
 * than in `@sugt/domain`, which names the columns and stays English.
 */
const SESSION_ASPECT_LABELS: Record<SessionRecordAspect, string> = {
  facilities: "Fasilitas",
  turnout: "Kehadiran",
  school_support: "Dukungan sekolah",
  timing: "Ketepatan waktu",
  coordination: "Koordinasi",
};

// The scale and the threshold come from `@sugt/domain` rather than the sentence, so the copy
// cannot drift from the rule it describes — the same reason `perjadin-report.ts` names its one
// zone as a constant. The threshold reads `7` today, and this reads whatever it becomes.
const INSTRUCTION = `Beri nilai ${RATING_MIN}–${RATING_MAX} untuk tiap aspek. ${RATING_SCALE_DIRECTION} Nilai ${CONCERN_AT_OR_BELOW} ke bawah wajib disertai penjelasan pada Kendala.`;

/** The message the Kendala field carries when a low Rating owes prose. Shared by both dialogs. */
const PROSE_REQUIRED = `Nilai ${CONCERN_AT_OR_BELOW} ke bawah wajib disertai penjelasan.`;

/** What a refusal the screen did not predict says — a page held open while the Session moved. */
const STALE_MESSAGES = {
  "session-not-delivered":
    "Sesi ini belum ditandai terlaksana. Muat ulang halaman untuk melihat keadaannya.",
  "already-filed": "Catatan ini sudah pernah diisi. Muat ulang halaman untuk melihat keadaannya.",
} as const;

/**
 * **File a Session Record** — five Aspects, plus what went wrong and what to do differently.
 * No *Yang diajarkan*: the PIC taught nothing. Filed by the PIC, who is Staff.
 */
function SessionRecordDialog({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [ratings, setRatings] = useState<Partial<Record<SessionRecordAspect, number>>>({});
  const [problems, setProblems] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [proseNeeded, setProseNeeded] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const namePrefix = useId();

  const full = complete(SESSION_RECORD_ASPECTS, ratings);

  function submit() {
    if (full === null) return;

    if (belowThreshold(Object.values(full)) && problems.trim() === "") {
      setProseNeeded(true);
      return;
    }

    startSaving(async () => {
      const result = await fileSessionRecordAction({
        sessionId,
        ratings: full,
        problems: blankToNull(problems),
        suggestions: blankToNull(suggestions),
      });
      if (result.outcome === "filed") {
        setOpen(false);
        return;
      }
      if (result.outcome === "prose-required") setProseNeeded(true);
      else setStale(STALE_MESSAGES[result.outcome]);
    });
  }

  return (
    <RecordDialog
      open={open}
      onOpenChange={setOpen}
      title="Catatan Sesi"
      stale={stale}
      saving={saving}
      canSubmit={full !== null}
      onSubmit={submit}
    >
      {SESSION_RECORD_ASPECTS.map((aspect) => (
        <RatingField
          key={aspect}
          namePrefix={namePrefix}
          aspect={aspect}
          label={SESSION_ASPECT_LABELS[aspect]}
          value={ratings[aspect]}
          onValueChange={(value) => {
            setRatings((previous) => ({ ...previous, [aspect]: value }));
            setProseNeeded(false);
          }}
        />
      ))}

      <ProseField
        label="Kendala"
        value={problems}
        invalid={proseNeeded}
        message={proseNeeded ? PROSE_REQUIRED : undefined}
        onChange={(value) => {
          setProblems(value);
          setProseNeeded(false);
        }}
      />
      <ProseField
        label="Saran"
        value={suggestions}
        onChange={setSuggestions}
      />
    </RecordDialog>
  );
}

/**
 * The dialog both forms share: the trigger, the instruction, the refusal alert and the
 * footer. The two differ in their title, their Aspects and which action they call — the
 * rubric arrives as children. **One component because the submit-guard-and-refusal shape is
 * the part worth having once.**
 */
function RecordDialog({
  open,
  onOpenChange,
  title,
  stale,
  saving,
  canSubmit,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  stale: string | null;
  saving: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
          >
            Isi
          </Button>
        }
      />
      <DialogContent size="panel">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{INSTRUCTION}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {stale !== null && (
            <Alert variant="destructive">
              <AlertTitle>Tidak jadi disimpan.</AlertTitle>
              <AlertDescription>{stale}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3.5">{children}</div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Batal
          </Button>
          <Button
            disabled={saving || !canSubmit}
            onClick={onSubmit}
          >
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One Aspect's label and its 1–10 control. The `name` is namespaced so two dialogs on one
 * page do not fuse into a single radio group. The label sits above the boxes, so the row fits a
 * 360px phone (#417). */
function RatingField({
  namePrefix,
  aspect,
  label,
  value,
  onValueChange,
}: {
  namePrefix: string;
  aspect: string;
  label: string;
  value: number | undefined;
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
        onValueChange={onValueChange}
      />
    </div>
  );
}

/** One free-text field. `Kendala` carries the elaboration message when a low Rating owes one. */
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
      <Label htmlFor={id}>{label}</Label>
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

/** The complete rubric, or `null` while any Aspect is still unrated. */
function complete<A extends string>(
  aspects: readonly A[],
  values: Partial<Record<A, number>>,
): Record<A, number> | null {
  const full = {} as Record<A, number>;
  for (const aspect of aspects) {
    const value = values[aspect];
    if (value === undefined) return null;
    full[aspect] = value;
  }
  return full;
}

/** Whether the lowest Rating reaches the concerns threshold, which is when prose is owed. */
function belowThreshold(ratings: number[]): boolean {
  return Math.min(...ratings) <= CONCERN_AT_OR_BELOW;
}

/** A blank or whitespace-only field travels as nothing, matching the write's own `prose`. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export { SessionRecordDialog };
