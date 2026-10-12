import DashboardPage from "-/app/(app)/page";
import PerjadinPage from "-/app/(app)/perjadin/page";
import PretestPage from "-/app/(app)/pretest/page";
import { requirePerson } from "-/lib/person";
import { isNotOnPerjadinError, requirePerjadinWriter, type Person } from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addGrant, addPerjadin, addPerson, resetDatabase } from "./support/fixtures";

/**
 * **Each Grant's reach, on the pages** (#469, ADR-0052): Editor split into Perjadin, Daring and
 * Dashboard Editor, and Keuangan added. No Grant implies another but Administrator, and Dashboard
 * Editor → Dashboard Viewer — so only those read `/`; Pretest is the Daring Editor's; Pengaturan
 * Perjadin stays the Administrator's; and a trip off one's Group is the Perjadin Editor's to write.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

/** What a call throws — its `digest` for a redirect or a 403 — or `null` when it returns. */
async function thrownBy(call: () => Promise<unknown>) {
  return call().then(
    () => null,
    (error: unknown) => error as { digest?: string },
  );
}

async function staffWith(grants: Grant[], email: string): Promise<Person> {
  const person = await addPerson({ fullName: email, email, role: "Staff" });
  for (const grant of grants) await addGrant(person.id, grant);
  return { ...person, grants } as Person;
}

const signIn = (person: Person) => vi.mocked(requirePerson).mockResolvedValue(person);

/** The `canEdit` the Dashboard page hands its Persiapan Program panel, found in its element tree. */
function persiapanProgramCanEdit(node: unknown): boolean | undefined {
  if (typeof node !== "object" || node === null || !("props" in node)) return undefined;
  const props = node.props as {
    persiapanProgram?: { props: { canEdit: boolean } };
    children?: unknown;
  };
  if (props.persiapanProgram) return props.persiapanProgram.props.canEdit;
  for (const child of [props.children].flat()) {
    const found = persiapanProgramCanEdit(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("the Dashboard (/)", () => {
  it.each(["Perjadin Editor", "Daring Editor", "Keuangan"] as const)(
    "redirects a Staff member holding only %s to /pendamping",
    async (grant) => {
      signIn(await staffWith([grant], "only@itb.ac.id"));

      const thrown = await thrownBy(() =>
        DashboardPage({ searchParams: Promise.resolve({}) } as never),
      );

      expect(thrown?.digest).toMatch(/^NEXT_REDIRECT;.*;\/pendamping;/);
    },
  );

  it.each([
    ["Dashboard Editor", true],
    ["Dashboard Viewer", false],
  ] as const)("lets %s read it, editing the Preparation Cards: %s", async (grant, edits) => {
    signIn(await staffWith([grant], "dash@itb.ac.id"));

    const page = await DashboardPage({ searchParams: Promise.resolve({}) } as never);

    expect(renderToStaticMarkup(page)).toContain("Persiapan Program");
    // The tab is a client component showing one panel at a time, so what the page hands the
    // Persiapan Program panel is read off the element rather than off the markup.
    expect(persiapanProgramCanEdit(page)).toBe(edits);
  });
});

describe("/pretest", () => {
  it("opens for a Daring Editor, and answers 403 to a Perjadin Editor or a Dashboard Editor", async () => {
    signIn(await staffWith(["Daring Editor"], "dina@itb.ac.id"));
    await expect(thrownBy(PretestPage)).resolves.toBeNull();

    for (const grant of ["Perjadin Editor", "Dashboard Editor"] as const) {
      signIn(await staffWith([grant], `${grant.split(" ")[0]!.toLowerCase()}@itb.ac.id`));
      expect((await thrownBy(PretestPage))?.digest, grant).toBe(FORBIDDEN);
    }
  });
});

describe("/perjadin", () => {
  it("shows a Perjadin Editor Rencanakan Perjadin but not Pengaturan Perjadin, which stays the Administrator's", async () => {
    signIn(await staffWith(["Perjadin Editor"], "budi@itb.ac.id"));

    const html = renderToStaticMarkup(await PerjadinPage());

    expect(html).toContain('href="/perjadin/baru"');
    expect(html).not.toContain("Pengaturan Perjadin");
  });
});

describe("writing a Perjadin off one's Group", () => {
  it("is the Perjadin Editor's, refused to every other Grant, and a member needs none", async () => {
    const pic = await staffWith([], "pic@itb.ac.id");
    const trip = await addPerjadin({ picPersonId: pic.id });

    await expect(requirePerjadinWriter(pic, trip.id)).resolves.toBeUndefined();
    await expect(
      requirePerjadinWriter(await staffWith(["Perjadin Editor"], "budi@itb.ac.id"), trip.id),
    ).resolves.toBeUndefined();
    for (const grant of [
      "Daring Editor",
      "Dashboard Editor",
      "Dashboard Viewer",
      "Keuangan",
    ] as const) {
      const other = await staffWith([grant], `${grant.replace(" ", "-").toLowerCase()}@itb.ac.id`);
      const refusal = await requirePerjadinWriter(other, trip.id).catch((error: unknown) => error);
      expect(isNotOnPerjadinError(refusal), grant).toBe(true);
    }
  });
});
