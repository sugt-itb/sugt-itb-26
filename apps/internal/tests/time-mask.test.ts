import { isCompleteTime, maskTime } from "@sugt/ui/lib/time-mask";
import { describe, expect, it } from "vitest";

/**
 * The 24-hour masking behind `TimeField`. It replaces the native `<input type="time">`, whose
 * picker renders AM/PM on an en-US browser, with a text input that shows `HH:MM` on every
 * locale. The keystroke logic is a pure string transform so it can be checked without a DOM.
 */
describe("maskTime", () => {
  it("fills hours then minutes, inserting the colon once minutes begin", () => {
    expect(maskTime("")).toBe("");
    expect(maskTime("1")).toBe("1");
    expect(maskTime("07")).toBe("07");
    expect(maskTime("073")).toBe("07:3");
    expect(maskTime("0730")).toBe("07:30");
  });

  it("keeps a colon the user (or a seed value) already typed", () => {
    expect(maskTime("07:30")).toBe("07:30");
    expect(maskTime("23:59")).toBe("23:59");
  });

  it("drops non-digits and caps at four digits", () => {
    expect(maskTime("ab07:30cd")).toBe("07:30");
    expect(maskTime("073099")).toBe("07:30");
  });

  it("pads a leading hour digit above 2 so the next keystroke starts the minutes", () => {
    expect(maskTime("9")).toBe("09");
    expect(maskTime("3")).toBe("03");
    expect(maskTime("93")).toBe("09:3");
  });

  it("clamps out-of-range hours and minutes", () => {
    expect(maskTime("25")).toBe("23");
    expect(maskTime("2599")).toBe("23:59");
    expect(maskTime("1278")).toBe("12:59");
  });
});

describe("isCompleteTime", () => {
  it("accepts a full 00:00–23:59 value", () => {
    expect(isCompleteTime("00:00")).toBe(true);
    expect(isCompleteTime("07:30")).toBe(true);
    expect(isCompleteTime("23:59")).toBe(true);
  });

  it("rejects partial, empty, or out-of-range values", () => {
    expect(isCompleteTime("")).toBe(false);
    expect(isCompleteTime("7")).toBe(false);
    expect(isCompleteTime("07:3")).toBe(false);
    expect(isCompleteTime("24:00")).toBe(false);
    expect(isCompleteTime("07:60")).toBe(false);
  });
});
