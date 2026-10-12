import { EpForm } from "-/app/ep/[token]/ep-form";
import {
  answersForRole,
  askedAspects,
  evaluationSubmission,
  proseGaps,
  ratingsComplete,
} from "-/app/ep/[token]/evaluation-answers";
import { CONCERN_AT_OR_BELOW } from "@sugt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **What the Perjadin Evaluation form asks, keeps and sends** (#481, ADR-0054). Pendamping Support
 * is hidden until a Role is picked, asked — last, and required — of a Narasumber or a Pimpinan, and
 * never of a Pendamping, whose switch drops one already given. The pure functions are tested
 * directly; the form is rendered once to show the question is not there before a Role is.
 */

vi.mock("-/app/ep/[token]/actions", () => ({ submitPerjadinEvaluationAction: vi.fn() }));

const STATEMENT = "Pendamping membantu selama keberjalanan kegiatan.";

/** Every Rating a Narasumber owes, comfortably high. */
const RATED = { lodging: 9, transport: 9, meals: 9, punctuality: 9, pendamping_support: 9 };

describe("askedAspects", () => {
  it("asks no Pendamping Support before a Role is picked", () => {
    expect(askedAspects(undefined)).toEqual(["lodging", "transport", "meals", "punctuality"]);
  });

  it.each(["Narasumber", "Pimpinan"] as const)("asks a %s Pendamping Support, last", (role) => {
    expect(askedAspects(role)).toEqual([
      "lodging",
      "transport",
      "meals",
      "punctuality",
      "pendamping_support",
    ]);
  });

  it("never asks a Pendamping", () => {
    expect(askedAspects("Pendamping")).not.toContain("pendamping_support");
  });
});

describe("answersForRole", () => {
  it("drops a Pendamping Support Rating and Komentar on a switch to Pendamping, and keeps the rest", () => {
    expect(answersForRole("Pendamping", RATED)).toEqual({
      lodging: 9,
      transport: 9,
      meals: 9,
      punctuality: 9,
    });
    expect(answersForRole("Pendamping", { meals: "Enak", pendamping_support: "Sigap" })).toEqual({
      meals: "Enak",
    });
  });

  it("keeps them for a Narasumber or a Pimpinan", () => {
    expect(answersForRole("Pimpinan", RATED)).toEqual(RATED);
  });
});

describe("ratingsComplete", () => {
  const { pendamping_support: _unrated, ...withoutIt } = RATED;

  it("waits for Pendamping Support from a Narasumber or a Pimpinan", () => {
    expect(ratingsComplete({ role: "Narasumber", ratings: withoutIt, noLodging: false })).toBe(
      false,
    );
    expect(ratingsComplete({ role: "Narasumber", ratings: RATED, noLodging: false })).toBe(true);
  });

  it("does not wait for it from a Pendamping", () => {
    expect(ratingsComplete({ role: "Pendamping", ratings: withoutIt, noLodging: false })).toBe(
      true,
    );
  });

  it("counts a day trip's skipped lodging as settled", () => {
    const { lodging: _skipped, ...dayTrip } = RATED;
    expect(ratingsComplete({ role: "Pimpinan", ratings: dayTrip, noLodging: true })).toBe(true);
    expect(ratingsComplete({ role: "Pimpinan", ratings: dayTrip, noLodging: false })).toBe(false);
  });
});

describe("evaluationSubmission", () => {
  it("sends a Narasumber's Pendamping Support and its trimmed Komentar", () => {
    const submission = evaluationSubmission({
      role: "Narasumber",
      name: "  Pak Andi ",
      ratings: RATED,
      noLodging: false,
      comments: { pendamping_support: "  Sigap  ", meals: "   " },
    });

    expect(submission.name).toBe("Pak Andi");
    expect(submission.ratings.pendamping_support).toBe(9);
    expect(submission.comments).toEqual({
      lodging: null,
      transport: null,
      meals: null,
      punctuality: null,
      pendamping_support: "Sigap",
    });
  });

  it("sends a Pendamping's with both null, whatever the form still holds", () => {
    const submission = evaluationSubmission({
      role: "Pendamping",
      name: "Dewi",
      ratings: RATED,
      noLodging: false,
      comments: { pendamping_support: "Tertinggal" },
    });

    expect(submission.ratings.pendamping_support).toBeNull();
    expect(submission.comments.pendamping_support).toBeNull();
  });

  it("sends a skipped lodging as null", () => {
    const submission = evaluationSubmission({
      role: "Pimpinan",
      name: "Bu Sri",
      ratings: RATED,
      noLodging: true,
      comments: { lodging: "Hotel" },
    });

    expect(submission.ratings.lodging).toBeNull();
    expect(submission.comments.lodging).toBeNull();
  });
});

describe("proseGaps", () => {
  const low = { ...RATED, pendamping_support: CONCERN_AT_OR_BELOW };

  it("lights a low Pendamping Support with no Komentar of its own, whatever another Aspect says", () => {
    const submission = evaluationSubmission({
      role: "Pimpinan",
      name: "Bu Sri",
      ratings: low,
      noLodging: false,
      comments: { punctuality: "Jadwal molor" },
    });

    expect(proseGaps(submission)).toEqual({ pendamping_support: true });
  });

  it("is satisfied by its own Komentar", () => {
    const submission = evaluationSubmission({
      role: "Pimpinan",
      name: "Bu Sri",
      ratings: low,
      noLodging: false,
      comments: { pendamping_support: "Sulit dihubungi" },
    });

    expect(proseGaps(submission)).toEqual({});
  });
});

describe("the /ep form", () => {
  it("shows no Pendamping Support before a Role is picked", () => {
    const html = renderToStaticMarkup(
      <EpForm
        token="t"
        tripName="Sub-Cluster · 1–2 Okt"
        schoolsLine="SMA Satu"
      />,
    );

    expect(html).toContain("Ketepatan waktu");
    expect(html).not.toContain(STATEMENT);
    expect(html).not.toContain("Bantuan Pendamping");
  });
});
