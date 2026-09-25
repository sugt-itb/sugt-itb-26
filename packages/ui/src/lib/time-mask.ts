/**
 * The keystroke logic behind {@link "@sugt/ui/components/time-field".TimeField}, split out as
 * a pure string transform so it can be tested without a DOM. It exists because there is no way
 * to force a native `<input type="time">` to 24-hour on every browser locale (the picker format
 * follows the browser language, not the page), so the field masks a plain text input itself and
 * renders `HH:MM` identically everywhere.
 */

/** A complete, valid 24-hour wall-clock time — `00:00` through `23:59`. */
const COMPLETE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Shape an arbitrary keystroke buffer into a 24-hour `HH:MM` value as the user types. Non-digits
 * are dropped, so the caller can hand back the raw field text on every change; digits fill
 * `HH` then `MM`, the colon appears once minutes begin, and out-of-range parts are clamped
 * (`99` → `23`, `:78` → `:59`). A leading hour digit above `2` can only be a units hour (there
 * is no 30–99 o'clock), so it is padded to `0X` and the next digit starts the minutes — typing
 * `9` yields `09`, not a dead end. The result is either `""` or a `HH:MM` prefix; completeness
 * is a separate question ({@link isCompleteTime}).
 */
export function maskTime(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";

  // A first hour digit of 3–9 cannot lead a two-digit hour ≤ 23, so it is a units hour: pad it
  // to `0X` so the following keystroke lands in the minutes rather than being rejected.
  if (Number(digits[0]) > 2) digits = `0${digits}`;
  digits = digits.slice(0, 4);

  let hours = digits.slice(0, 2);
  let minutes = digits.slice(2, 4);

  if (hours.length === 2) hours = String(Math.min(Number(hours), 23)).padStart(2, "0");
  if (minutes.length === 2) minutes = String(Math.min(Number(minutes), 59)).padStart(2, "0");

  return digits.length <= 2 ? hours : `${hours}:${minutes}`;
}

/** Whether `value` is a complete, valid 24-hour `HH:MM` — the field reports only these (or `""`). */
export function isCompleteTime(value: string): boolean {
  return COMPLETE_TIME.test(value);
}
