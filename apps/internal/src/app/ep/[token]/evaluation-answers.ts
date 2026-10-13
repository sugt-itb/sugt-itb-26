import type { NewPerjadinEvaluation } from "@sugt/db/queries";
import {
  CONCERN_AT_OR_BELOW,
  PERJADIN_ASPECTS,
  PERJADIN_ASPECTS_BY_ROLE,
  PERJADIN_EVALUATION_ROLES,
  type PerjadinAspect,
  type PerjadinEvaluationRole,
} from "@sugt/domain";

/**
 * **What the Perjadin Evaluation form keeps and sends** (#481) — plain functions, kept apart from the
 * `"use client"` form so each is tested without mounting it, as `f/[token]/feedback-answers.ts` is.
 * The Role decides whether Pendamping Support is asked (ADR-0054); everything here follows from
 * `PERJADIN_ASPECTS_BY_ROLE`.
 */

/** What the form holds per Aspect while it is filled: a Rating, a Komentar's text, a warning. */
export type AspectAnswers<T> = Partial<Record<PerjadinAspect, T>>;

/** The Aspects every Role is asked — what the form shows before a Role is picked. */
const EVERY_ROLE_ASPECTS = PERJADIN_ASPECTS.filter((aspect) =>
  PERJADIN_EVALUATION_ROLES.every((role) => PERJADIN_ASPECTS_BY_ROLE[role].includes(aspect)),
);

/**
 * The Aspects the form asks: the Role's own, or the ones every Role is asked until one is picked —
 * so Pendamping Support appears only once a Narasumber or a Pimpinan is chosen.
 */
export function askedAspects(role: PerjadinEvaluationRole | undefined): readonly PerjadinAspect[] {
  return role === undefined ? EVERY_ROLE_ASPECTS : PERJADIN_ASPECTS_BY_ROLE[role];
}

/**
 * The answers a Role keeps once it is picked: an Aspect it is not asked loses its Rating and its
 * Komentar, so switching to Pendamping drops a Pendamping Support already given — the way *Tidak
 * menginap* clears lodging.
 */
export function answersForRole<T>(
  role: PerjadinEvaluationRole,
  answers: AspectAnswers<T>,
): AspectAnswers<T> {
  const asked = PERJADIN_ASPECTS_BY_ROLE[role];
  return Object.fromEntries(
    Object.entries(answers).filter(([aspect]) => asked.includes(aspect as PerjadinAspect)),
  ) as AspectAnswers<T>;
}

/**
 * Whether every Rating the Role owes is given. `lodging` is settled either way — Rated, or skipped
 * with *Tidak menginap* — and every other asked Aspect must be Rated.
 */
export function ratingsComplete(form: {
  role: PerjadinEvaluationRole | undefined;
  ratings: AspectAnswers<number>;
  noLodging: boolean;
}): boolean {
  return askedAspects(form.role).every((aspect) =>
    aspect === "lodging"
      ? form.noLodging || form.ratings.lodging !== undefined
      : form.ratings[aspect] !== undefined,
  );
}

/**
 * The submission, as the write takes it: every Aspect present, `null` for one the Role is not asked
 * and for a skipped lodging; each Komentar trimmed, blank to `null`. Assumes `ratingsComplete` —
 * the form's Kirim waits for that.
 */
export function evaluationSubmission(form: {
  role: PerjadinEvaluationRole;
  name: string;
  ratings: AspectAnswers<number>;
  noLodging: boolean;
  comments: AspectAnswers<string>;
}): NewPerjadinEvaluation {
  const asked = PERJADIN_ASPECTS_BY_ROLE[form.role];
  const kept = (aspect: PerjadinAspect) =>
    asked.includes(aspect) && !(aspect === "lodging" && form.noLodging);
  const each = <T>(answer: (aspect: PerjadinAspect) => T | null) =>
    Object.fromEntries(
      PERJADIN_ASPECTS.map((aspect) => [aspect, kept(aspect) ? answer(aspect) : null]),
    ) as Record<PerjadinAspect, T | null>;
  return {
    role: form.role,
    name: form.name.trim(),
    ratings: each((aspect) => form.ratings[aspect] ?? null) as NewPerjadinEvaluation["ratings"],
    comments: each((aspect) => form.comments[aspect]?.trim() || null),
  };
}

/**
 * Which low Aspects still owe their own Komentar. Per-Aspect: prose on a different Aspect does not
 * satisfy a low one (#163). A null Rating — a skipped lodging, an unasked Pendamping Support — is
 * not low, exactly as Postgres `least()` leaves a NULL out of the minimum, so it never appears here.
 */
export function proseGaps(submission: NewPerjadinEvaluation): AspectAnswers<boolean> {
  const ratings: Record<PerjadinAspect, number | null> = submission.ratings;
  return Object.fromEntries(
    PERJADIN_ASPECTS.filter((aspect) => {
      const rating = ratings[aspect];
      return (
        rating !== null && rating <= CONCERN_AT_OR_BELOW && submission.comments[aspect] === null
      );
    }).map((aspect) => [aspect, true]),
  );
}
