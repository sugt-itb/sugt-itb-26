import { RATING_MAX, RATING_MIN } from "@sugt/domain";

/**
 * **Which end of the scale is the top** (#480) — every form that files a Rating says it, near the top,
 * before the filer rates anything: Participant Feedback (`/f/[token]`), Perjadin Evaluation
 * (`/ep/[token]`) and the Session Record dialog. A Participant on a phone may otherwise read
 * `RATING_MIN` as "best". Said once in the instruction, not as captions on each control: those
 * repeat on every row and are cramped on a phone.
 *
 * Built from the domain bounds, like the instructions around it, so it cannot drift from the scale
 * it describes.
 */
export const RATING_SCALE_DIRECTION = `Skala ${RATING_MIN}–${RATING_MAX}: ${RATING_MIN} = paling rendah, ${RATING_MAX} = paling tinggi.`;

/**
 * The opening every Rating form's instruction shares: the scale, then its direction. Each form
 * follows it with its own sentence — the elaboration rule where it has one, a thank-you where it
 * does not.
 */
export const RATING_INSTRUCTION = `Beri nilai ${RATING_MIN}–${RATING_MAX} untuk tiap aspek. ${RATING_SCALE_DIRECTION}`;
