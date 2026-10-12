import { PerjadinPlanForm } from "-/components/perjadin-plan-form";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * **Which fields on Rencanakan Perjadin say they are required** (#354). The form is rendered to static
 * markup, before any Sub-Cluster is picked — so the per-Session rows are not on screen yet and
 * Tanggal Sesi / Jam Mulai are not covered here. Only the router is stubbed, because a client
 * component calling `useRouter` needs a mounted app router; nothing is submitted, and what is read is
 * only labels and attributes.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

function render() {
  return renderToStaticMarkup(
    <PerjadinPlanForm
      subClusters={[]}
      staff={[{ id: "s1", fullName: "Staf Satu" }]}
      pimpinan={[{ id: "p1", fullName: "Pimpinan Satu" }]}
    />,
  );
}

/**
 * Every `<label>` on the form: its visible text, the control it names (`for`), and whether it carries
 * the required mark.
 */
function labels(html: string) {
  return [...html.matchAll(/<label([^>]*)>(.*?)<\/label>/g)].map(
    ([, attributes = "", inner = ""]) => ({
      text: inner
        .replace(/<[^>]+>/g, "")
        .replace("*", "")
        .trim(),
      htmlFor: /\bfor="([^"]+)"/.exec(attributes)?.[1],
      required: inner.includes('data-slot="required-mark"'),
    }),
  );
}

/** The opening tag of the element with this `id`. */
function tagWithId(html: string, id: string) {
  return new RegExp(`<[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
}

describe("PerjadinPlanForm's required markers", () => {
  it("marks exactly the fields the submit guard requires, outside the Session rows", () => {
    const required = labels(render())
      .filter((label) => label.required)
      .map((label) => label.text);

    expect(required).toEqual(["Kelompok Sekolah", "PIC", "Tanggal mulai", "Tanggal selesai"]);
  });

  /** Optional fields stay simply unmarked. Uang Perjalanan is gone from the form (ADR-0051). */
  it("leaves Pendamping tambahan and Pimpinan unmarked, and asks for no Uang Perjalanan", () => {
    const html = render();
    const all = labels(html);

    expect(all.find((label) => label.text === "Pendamping tambahan")?.required).toBe(false);
    expect(all.find((label) => label.text === "Pimpinan")?.required).toBe(false);
    expect(html).not.toContain("Uang Perjalanan");
    expect(html).not.toContain("opsional");
  });

  it("flags the control behind each marked label, and no other, for a screen reader", () => {
    const html = render();
    const marked = labels(html).filter((label) => label.required);

    for (const label of marked) {
      expect(label.htmlFor, label.text).toBeDefined();
      expect(tagWithId(html, label.htmlFor ?? ""), label.text).toContain('aria-required="true"');
    }
    expect(html.match(/aria-required="true"/g)).toHaveLength(marked.length);
  });

  it("shows the legend once", () => {
    expect(render().match(/wajib diisi/g)).toHaveLength(1);
  });
});
