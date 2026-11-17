import type { NewParticipantFeedback } from "@sugt/db/queries";
import {
  CLASS_KINDS,
  PARTICIPANT_FEEDBACK_ASPECTS,
  PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS,
  type ClassKind,
  type ParticipantFeedbackAspect,
} from "@sugt/domain";

/**
 * **What the Participant Feedback form keeps and sends** (#446) — plain functions, kept apart from
 * the `"use client"` form so each is tested without mounting it, as `foto-video-form.ts` is.
 */

/** What the form holds per Aspect while it is filled: a Rating, or a comment's text. */
export type AspectAnswers<T> = Partial<Record<ParticipantFeedbackAspect, T>>;

/** The Aspects every Class is asked — what the form shows before a Class is picked. */
const EVERY_CLASS_ASPECTS = PARTICIPANT_FEEDBACK_ASPECTS.filter((aspect) =>
  CLASS_KINDS.every((kind) => PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS[kind].includes(aspect)),
);

/**
 * The Aspects the form asks: the Class's own, or the ones every Class is asked until one is picked.
 */
export function askedAspects(
  classKind: ClassKind | undefined,
): readonly ParticipantFeedbackAspect[] {
  return classKind === undefined
    ? EVERY_CLASS_ASPECTS
    : PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS[classKind];
}

/**
 * The answers a Class keeps once it is picked: an Aspect it is not asked loses its Rating and its
 * comment, so a Siswa's Hands-on RBL is dropped, not submitted, after a switch to GTK or MS.
 */
export function answersForClass<T>(
  classKind: ClassKind,
  answers: AspectAnswers<T>,
): AspectAnswers<T> {
  const asked = PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS[classKind];
  return Object.fromEntries(
    Object.entries(answers).filter(([aspect]) =>
      asked.includes(aspect as ParticipantFeedbackAspect),
    ),
  ) as AspectAnswers<T>;
}

/**
 * The submission, as the server takes it: every Aspect present, `null` for one the Class is not
 * asked; each comment and written answer trimmed, blank to `null`. Assumes every asked Aspect is
 * Rated — the form's Kirim waits for that.
 */
export function feedbackSubmission(form: {
  classKind: ClassKind;
  name: string;
  ratings: AspectAnswers<number>;
  comments: AspectAnswers<string>;
  knowledgeGain: string;
  suggestions: string;
}): NewParticipantFeedback {
  const asked = PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS[form.classKind];
  const each = <T>(answer: (aspect: ParticipantFeedbackAspect) => T | null) =>
    Object.fromEntries(
      PARTICIPANT_FEEDBACK_ASPECTS.map((aspect) => [
        aspect,
        asked.includes(aspect) ? answer(aspect) : null,
      ]),
    ) as Record<ParticipantFeedbackAspect, T | null>;
  return {
    classKind: form.classKind,
    name: form.name.trim(),
    ratings: each((aspect) => form.ratings[aspect] ?? null),
    comments: each((aspect) => form.comments[aspect]?.trim() || null),
    answers: {
      knowledgeGain: form.knowledgeGain.trim() || null,
      suggestions: form.suggestions.trim() || null,
    },
  };
}
