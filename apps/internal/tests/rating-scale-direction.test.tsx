import { EpForm } from "-/app/ep/[token]/ep-form";
import { FeedbackForm } from "-/app/f/[token]/feedback-form";
import { SessionRecordDialog } from "-/components/record-forms";
import { RATING_SCALE_DIRECTION } from "-/lib/rating-copy";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **Every form that files a Rating says which end of the scale is good** (#480). Each form is
 * rendered to static markup and must carry the sentence in its instruction — the forms' own text,
 * read before any Aspect. Nothing is submitted, so the server actions are stubbed out.
 *
 * The Session Record dialog renders nothing until it is opened, and a static render cannot open it.
 * So the dialog primitives are swapped for plain wrappers that always render their children: what is
 * checked is the description the form passes the dialog, not the dialog's own behaviour.
 */

vi.mock("-/app/f/[token]/actions", () => ({ submitFeedbackAction: vi.fn() }));
vi.mock("-/app/ep/[token]/actions", () => ({ submitPerjadinEvaluationAction: vi.fn() }));
vi.mock("-/app/(app)/sesi/[id]/actions", () => ({ fileSessionRecordAction: vi.fn() }));
vi.mock("@sugt/ui/components/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Pass,
    DialogBody: Pass,
    DialogContent: Pass,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DialogTrigger: () => null,
  };
});

/**
 * The text of the paragraph that opens with "Beri nilai" — each form's instruction — tags stripped.
 * Found by its words rather than its classes, so a restyle does not fail a test about copy.
 */
function instruction(html: string): string {
  const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map(([, inner = ""]) =>
    inner.replace(/<[^>]+>/g, ""),
  );
  const found = paragraphs.find((text) => text.startsWith("Beri nilai"));
  expect(found).toBeDefined();
  return found ?? "";
}

describe("the Rating scale's direction (#480)", () => {
  it("reads 1 = paling rendah, 10 = paling tinggi", () => {
    expect(RATING_SCALE_DIRECTION).toBe("Skala 1–10: 1 = paling rendah, 10 = paling tinggi.");
  });

  it("is in the Participant Feedback form's instruction, before the first Aspect", () => {
    const html = renderToStaticMarkup(<FeedbackForm token="t" />);
    expect(instruction(html)).toContain(RATING_SCALE_DIRECTION);
    expect(instruction(html)).toContain("Masukanmu membantu kami memperbaiki sesi berikutnya.");
    expect(html.indexOf("Skala")).toBeLessThan(html.indexOf('role="radiogroup"'));
  });

  it("is in the Perjadin Evaluation form's instruction, beside the low-Rating rule", () => {
    const html = renderToStaticMarkup(
      <EpForm
        token="t"
        tripName="Sub-Cluster · 1–2 Okt"
        schoolsLine="SMA Satu"
      />,
    );
    expect(instruction(html)).toContain(RATING_SCALE_DIRECTION);
    expect(instruction(html)).toContain("wajib disertai penjelasan pada Komentar aspek tersebut.");
  });

  it("is in the Session Record dialog's description, beside the low-Rating rule", () => {
    const html = renderToStaticMarkup(<SessionRecordDialog sessionId="s" />);
    expect(instruction(html)).toContain(RATING_SCALE_DIRECTION);
    expect(instruction(html)).toContain("wajib disertai penjelasan pada Kendala.");
  });
});
