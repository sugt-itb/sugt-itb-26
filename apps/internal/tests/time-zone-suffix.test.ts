import { timeZoneSuffix } from "@sugt/domain";
import { describe, expect, it } from "vitest";

/**
 * The parenthesised Time Zone tag on a time-of-day input label, named once so the four internal
 * labels that carry it (offline Move-date, online edit, Perjadin add/edit, return leg) cannot
 * drift apart on spacing or on the "no zone yet" empty case. A leading space is part of the tag,
 * so a label is `` `Jam Mulai${timeZoneSuffix(zone)}` ``.
 */
describe("timeZoneSuffix", () => {
  it("wraps a known zone in ` (ZONE)` with a leading space", () => {
    expect(timeZoneSuffix("WIB")).toBe(" (WIB)");
    expect(timeZoneSuffix("WITA")).toBe(" (WITA)");
    expect(timeZoneSuffix("WIT")).toBe(" (WIT)");
  });

  it("returns an empty string when no zone is in scope", () => {
    expect(timeZoneSuffix("")).toBe("");
    expect(timeZoneSuffix(null)).toBe("");
    expect(timeZoneSuffix(undefined)).toBe("");
  });
});
