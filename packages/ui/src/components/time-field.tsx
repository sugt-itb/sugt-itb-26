"use client";

import { Input } from "@sugt/ui/components/input";
import { isCompleteTime, maskTime } from "@sugt/ui/lib/time-mask";
import * as React from "react";

/**
 * A 24-hour time input for every locale. The native `<input type="time">` picker renders in the
 * browser's language — AM/PM on an en-US browser — and no HTML attribute forces it to 24-hour,
 * so this masks a plain text input instead ({@link maskTime}) and shows `HH:MM` identically
 * everywhere. It keeps the native value contract: `value` in and `onValueChange` out are 24-hour
 * `HH:MM` strings (or `""` when incomplete), so a form's state, submit guards and DB are unchanged.
 *
 * Purely presentational, per the UI-package rules: no data, no `@sugt/domain`, no environment. It
 * carries an internal display buffer so a half-typed `07:3` stays on screen (its reported value is
 * `""` until complete); an external change to a complete `value` — a reset or an edit-form seed —
 * still refreshes the buffer.
 */
function TimeField({
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange" | "onValueChange"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [text, setText] = React.useState(value);

  // Follow the canonical value when it changes from outside (a reset, an edit-form seed) without
  // clobbering the partial the user is mid-typing — whose canonical form we have already reported.
  React.useEffect(() => {
    setText((current) => ((isCompleteTime(current) ? current : "") === value ? current : value));
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder="--:--"
      maxLength={5}
      className={className}
      value={text}
      onChange={(event) => {
        const masked = maskTime(event.target.value);
        setText(masked);
        onValueChange(isCompleteTime(masked) ? masked : "");
      }}
      {...props}
    />
  );
}

export { TimeField };
