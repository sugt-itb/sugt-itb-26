"use client";

import {
  PARTICIPANT_ASPECT_QUESTIONS,
  PARTICIPANT_CLASS_LABELS,
  PARTICIPANT_WRITTEN_QUESTIONS,
} from "-/lib/participant-feedback-copy";
import { RATING_SCALE_DIRECTION } from "-/lib/rating-copy";
import { CONCERN_AT_OR_BELOW, RATING_MAX, RATING_MIN, type ClassKind } from "@sugt/domain";
import { Button } from "@sugt/ui/components/button";
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import { RatingInput } from "@sugt/ui/components/rating-input";
import { Textarea } from "@sugt/ui/components/textarea";
import { useId, useState, useTransition } from "react";

import { submitFeedbackAction } from "./actions";
import {
  answersForClass,
  askedAspects,
  feedbackSubmission,
  type AspectAnswers,
} from "./feedback-answers";
import { GoneNotice } from "./gone-notice";

/**
 * The phone form a Participant fills after scanning the QR: the Class they sat in, a name they
 * type themselves, then each Aspect their Class is asked — a Rating, a one-line description of
 * what is being Rated, and an optional comment — and last two optional written questions (#446).
 * A Siswa is asked **Hands-on RBL** first; GTK and MS are not, and switching away from Siswa drops
 * whatever was given for it. **No elaboration rule** — a Participant owes nothing, so a low Rating
 * needs no sentence.
 *
 * Client-side because it holds a rubric's worth of state and swaps itself for a thank-you on
 * submit. The token is the only credential it carries; the submit re-resolves it server-side.
 *
 * The Rating cells are `size="sm"` — 23px — because this is filled on a phone in a classroom,
 * which is the one surface `RatingInput`'s small size exists for. Each Rating sits on its own line
 * under its label and description, so the form reads at 360px.
 */

const CLASS_KINDS_ORDERED = Object.keys(PARTICIPANT_CLASS_LABELS) as ClassKind[];

function FeedbackForm({ token }: { token: string }) {
  const [classKind, setClassKind] = useState<ClassKind | undefined>(undefined);
  const [name, setName] = useState("");
  const [ratings, setRatings] = useState<AspectAnswers<number>>({});
  const [comments, setComments] = useState<AspectAnswers<string>>({});
  const [knowledgeGain, setKnowledgeGain] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  const [saving, startSaving] = useTransition();
  const namePrefix = useId();
  const nameId = useId();

  const asked = askedAspects(classKind);
  const rated = asked.every((aspect) => ratings[aspect] !== undefined);
  const canSubmit = classKind !== undefined && name.trim() !== "" && rated;

  /** Pick a Class, dropping any answer to an Aspect it is not asked (`answersForClass`). */
  function chooseClass(kind: ClassKind) {
    setClassKind(kind);
    setRatings((previous) => answersForClass(kind, previous));
    setComments((previous) => answersForClass(kind, previous));
  }

  function submit() {
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    if (classKind === undefined || !rated) return;

    startSaving(async () => {
      const result = await submitFeedbackAction(
        token,
        feedbackSubmission({ classKind, name, ratings, comments, knowledgeGain, suggestions }),
      );
      if (result.outcome === "submitted") setDone(true);
      else if (result.outcome === "name-required") setNameError(true);
      else if (result.outcome === "ratings-mismatch") setIncomplete(true);
      else setGone(true);
    });
  }

  // The link died while the form was open — its Session was cancelled, or the link was removed by
  // hand (ADR-0049). The same notice a fresh dead load shows, and no form: there is nothing a second try here would reach.
  if (gone) return <GoneNotice />;

  // A thank-you and no form. A second submission is not prevented, so the page must not invite
  // one — there is no button back to the form.
  if (done) {
    return (
      <div className="text-center">
        <h1 className="font-heading text-lg font-medium">Terima kasih!</h1>
        <p className="mt-2 text-sm text-muted-foreground">Masukanmu sudah tercatat.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-heading text-lg font-medium">Umpan balik sesi</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Beri nilai {RATING_MIN}–{RATING_MAX} untuk tiap aspek. {RATING_SCALE_DIRECTION} Masukanmu
        membantu kami memperbaiki sesi berikutnya.
      </p>

      <div className="mt-5 grid gap-5">
        <div className="grid gap-1.5">
          <Label>Kelas yang kamu ikuti</Label>
          <div className="flex gap-2">
            {CLASS_KINDS_ORDERED.map((kind) => (
              <Button
                key={kind}
                type="button"
                variant={classKind === kind ? "default" : "outline"}
                onClick={() => {
                  chooseClass(kind);
                }}
              >
                {PARTICIPANT_CLASS_LABELS[kind]}
              </Button>
            ))}
          </div>
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

        {asked.map((aspect) => {
          const labelId = `${namePrefix}-${aspect}-label`;
          const commentId = `${namePrefix}-${aspect}-comment`;
          const question = PARTICIPANT_ASPECT_QUESTIONS[aspect];
          return (
            <div
              key={aspect}
              className="grid gap-2"
            >
              <div className="grid gap-0.5">
                <Label id={labelId}>{question.label}</Label>
                <p className="text-sm text-muted-foreground">{question.description}</p>
              </div>
              <RatingInput
                name={`${namePrefix}-${aspect}`}
                aria-labelledby={labelId}
                size="sm"
                min={RATING_MIN}
                max={RATING_MAX}
                concernAtOrBelow={CONCERN_AT_OR_BELOW}
                value={ratings[aspect]}
                onValueChange={(value) => {
                  setRatings((previous) => ({ ...previous, [aspect]: value }));
                }}
              />
              {/* One optional comment per Aspect, so it belongs to the Rating it explains (#102). */}
              <Label
                htmlFor={commentId}
                className="text-xs text-muted-foreground"
              >
                Komentar {question.label} (opsional)
              </Label>
              <Textarea
                id={commentId}
                value={comments[aspect] ?? ""}
                onChange={(event) => {
                  setComments((previous) => ({ ...previous, [aspect]: event.target.value }));
                }}
              />
            </div>
          );
        })}

        {/* The two written questions (#446): optional, and not Aspects — nothing Rates them. */}
        <div className="grid gap-1.5">
          <Label htmlFor={`${namePrefix}-knowledge-gain`}>
            {PARTICIPANT_WRITTEN_QUESTIONS.knowledgeGain.question}
          </Label>
          <Textarea
            id={`${namePrefix}-knowledge-gain`}
            value={knowledgeGain}
            onChange={(event) => {
              setKnowledgeGain(event.target.value);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${namePrefix}-suggestions`}>
            {PARTICIPANT_WRITTEN_QUESTIONS.suggestions.question}
          </Label>
          <Textarea
            id={`${namePrefix}-suggestions`}
            value={suggestions}
            onChange={(event) => {
              setSuggestions(event.target.value);
            }}
          />
        </div>

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

export { FeedbackForm };
