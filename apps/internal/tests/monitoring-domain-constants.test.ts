import {
  LURING_SESI_WINDOWS,
  PROGRAMME_BUDGET_IDR,
  SESSIONS_PER_SCHOOL,
  TOTAL_SESSIONS_PER_SCHOOL,
} from "@sugt/domain";
import { describe, expect, it } from "vitest";

/**
 * **The programme facts `/monitoring` will be wired against** (#195). These are constants, not
 * behaviour, but they are load-bearing: the offline count feeds every "delivered / N" denominator
 * app-wide, and the budget + Luring windows are what #196's queries consume. Pinning them here means
 * flipping offline back to four, or nudging a window date, fails a test rather than silently shifting
 * every readout.
 */

describe("monitoring domain constants", () => {
  it("gives each School two offline Sessions and six online — eight in all", () => {
    expect(SESSIONS_PER_SCHOOL.offline).toBe(2);
    expect(SESSIONS_PER_SCHOOL.online).toBe(6);
    expect(TOTAL_SESSIONS_PER_SCHOOL).toBe(8);
  });

  it("holds the programme budget as a single whole-rupiah constant", () => {
    expect(PROGRAMME_BUDGET_IDR).toBe(15_000_000_000);
  });

  it("carries the two Luring Sesi windows as inclusive 2026 date ranges", () => {
    expect(LURING_SESI_WINDOWS).toEqual([
      { sesi: 1, startsOn: "2026-10-05", endsOn: "2026-10-23" },
      { sesi: 2, startsOn: "2026-11-02", endsOn: "2026-11-20" },
    ]);
    // One window per offline Sesi — the ranks, not the numbering source (ADR-0027).
    expect(LURING_SESI_WINDOWS).toHaveLength(SESSIONS_PER_SCHOOL.offline);
  });
});
