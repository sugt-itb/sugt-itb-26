import PerjadinBaruPage from "-/app/(app)/perjadin/baru/page";
import PerjadinPage from "-/app/(app)/perjadin/page";
import SekolahPage from "-/app/(app)/sekolah/[slug]/page";
import {
  cancelOnlineSessionAction,
  markOnlineSessionDeliveredAction,
} from "-/app/(app)/sesi-daring/[id]/actions";
import SesiDaringDetailPage from "-/app/(app)/sesi-daring/[id]/page";
import SesiDaringBaruPage from "-/app/(app)/sesi-daring/baru/page";
import SesiDaringPage from "-/app/(app)/sesi-daring/page";
import { requirePerson } from "-/lib/person";
import {
  arrangeOnlineSession,
  arrangeOnlineSessionAt,
  arrangeOnlineSessionForm,
  deleteOnlineSession,
  isNotGrantedError,
  isNotStaffError,
  perjadinPlan,
  planPerjadin,
  updateOnlineSession,
  type Person,
} from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addGrant,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * **Planning a Perjadin needs Perjadin Editor; online Sessions need Daring Editor** (#438, ADR-0047,
 * split by ADR-0052, #469). One block per group of cells:
 * - a Staff member with no Grant, or with only Dashboard Viewer, Dashboard Editor or Keuangan, is
 *   refused by every guarded query (`NotGrantedError`), gets a 403 on the two form pages, and is
 *   shown none of the controls;
 * - a Perjadin Editor plans but records no online Session, and a Daring Editor the reverse;
 * - an Administrator, holding neither Grant's row, can do all of it;
 * - a Pimpinan is refused as non-Staff first, as before;
 * - reading `/perjadin`, `/sesi-daring`, `/sesi-daring/[id]` and `/sekolah/[slug]` is unchanged.
 *
 * Against the real database; only the signed-in Person and the router are stubbed.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";

async function digestOf(call: Promise<unknown>) {
  const thrown = await call.then(
    () => null,
    (error: unknown) => error,
  );
  return (thrown as { digest?: string } | null)?.digest;
}

/** What a call throws, or `null` when it returns. */
async function refusalOf(call: () => Promise<unknown>) {
  return call().then(
    () => null,
    (error: unknown) => error,
  );
}

async function staffWith(grants: Grant[], email: string): Promise<Person> {
  const person = await addPerson({ fullName: email, email, role: "Staff" });
  for (const grant of grants) await addGrant(person.id, grant);
  return { ...person, grants } as Person;
}

/**
 * Rina (no Grant), Dewi (Dashboard Viewer), Eka (Dashboard Editor), Kiki (Keuangan), Budi (Perjadin
 * Editor), Dina (Daring Editor), Sari (Administrator), Pak Hadi (Pimpinan).
 */
async function people() {
  return {
    rina: await staffWith([], "rina@itb.ac.id"),
    dewi: await staffWith(["Dashboard Viewer"], "dewi@itb.ac.id"),
    eka: await staffWith(["Dashboard Editor"], "eka@itb.ac.id"),
    kiki: await staffWith(["Keuangan"], "kiki@itb.ac.id"),
    budi: await staffWith(["Perjadin Editor"], "budi@itb.ac.id"),
    dina: await staffWith(["Daring Editor"], "dina@itb.ac.id"),
    sari: await staffWith(["Administrator"], "sari@itb.ac.id"),
    hadi: (await addPerson({
      fullName: "Pak Hadi",
      email: "hadi@itb.ac.id",
      role: "Pimpinan",
    })) as Person,
  };
}

/** One School on a Sub-Cluster, and one delivered online Session at it. */
async function place() {
  await addProvince("KT", "Kalimantan Timur", "WITA");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const subCluster = await addSubCluster({
    slug: "k10",
    name: "Kelompok 10",
    clusterId: cluster.id,
  });
  const school = await addSchool({
    slug: "sman-1-bontang",
    name: "SMAN 1 Bontang",
    clusterId: cluster.id,
    subClusterId: subCluster.id,
    provinceCode: "KT",
  });
  const online = await addSession({
    schoolId: school.id,
    heldOn: "2026-01-15",
    status: "delivered",
  });
  return { subCluster, school, online };
}

const onlineInput = (schoolId: string) => ({
  schoolId,
  heldOn: "2026-01-20",
  startsAt: "09:00",
  endsAt: "10:00",
  pengajarSiswaName: "Prof. Bagus",
  pengajarGtkMsName: "Dr. Sari",
});

/** The Perjadin Editor's guarded queries, called as `caller`, against `place()`'s rows. */
function perjadinGuarded(caller: Person, where: Awaited<ReturnType<typeof place>>) {
  return {
    planPerjadin: () =>
      planPerjadin(caller, {
        subClusterId: where.subCluster.id,
        picPersonId: caller.id,
        teacherNames: [],
        sessions: [
          {
            schoolId: where.school.id,
            heldOn: "2026-10-12",
            startsAt: "09:00",
            taughtByTeacherIndexes: [],
            pimpinanPersonIds: [],
          },
        ],
        startsOn: "2026-10-12",
        endsOn: "2026-10-13",
      }),
    perjadinPlan: () => perjadinPlan(caller),
  };
}

/** The Daring Editor's guarded queries, called as `caller`, against `place()`'s rows. */
function daringGuarded(caller: Person, where: Awaited<ReturnType<typeof place>>) {
  return {
    arrangeOnlineSession: () => arrangeOnlineSession(caller, onlineInput(where.school.id)),
    arrangeOnlineSessionForm: () => arrangeOnlineSessionForm(caller),
    arrangeOnlineSessionAt: () => arrangeOnlineSessionAt(caller, where.school.slug),
    updateOnlineSession: () =>
      updateOnlineSession(caller, where.online.id, {
        ...onlineInput(where.school.id),
        heldOn: "2026-01-25",
      }),
    deleteOnlineSession: () => deleteOnlineSession(caller, where.online.id),
  };
}

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

/** Each guarded query, Perjadin's and Daring's, as `caller`. */
function guarded(caller: Person, where: Awaited<ReturnType<typeof place>>) {
  return { ...perjadinGuarded(caller, where), ...daringGuarded(caller, where) };
}

describe("the guarded queries", () => {
  it("refuse a Staff member with no Grant, or with only Dashboard Viewer, Dashboard Editor or Keuangan, with NotGrantedError", async () => {
    const { rina, dewi, eka, kiki } = await people();
    const where = await place();

    for (const caller of [rina, dewi, eka, kiki]) {
      for (const [name, call] of Object.entries(guarded(caller, where))) {
        expect(isNotGrantedError(await refusalOf(call)), `${caller.email} ${name}`).toBe(true);
      }
    }
  });

  it("refuse the online Session writes to a Perjadin Editor, and planning to a Daring Editor (ADR-0052)", async () => {
    const { budi, dina } = await people();
    const where = await place();

    for (const [caller, calls] of [
      [budi, daringGuarded(budi, where)],
      [dina, perjadinGuarded(dina, where)],
    ] as const) {
      for (const [name, call] of Object.entries(calls)) {
        expect(isNotGrantedError(await refusalOf(call)), `${caller.email} ${name}`).toBe(true);
      }
    }
  });

  it("refuse a Pimpinan as non-Staff first, as before", async () => {
    const { hadi } = await people();
    const where = await place();

    for (const [name, call] of Object.entries(guarded(hadi, where))) {
      expect(isNotStaffError(await refusalOf(call)), name).toBe(true);
    }
  });

  it.each(["budi", "sari"] as const)(
    "let %s (Perjadin Editor; Administrator with no such row) plan a Perjadin",
    async (who) => {
      const caller = (await people())[who];
      const calls = perjadinGuarded(caller, await place());

      await expect(calls.perjadinPlan()).resolves.toMatchObject({ subClusters: expect.any(Array) });
      await expect(calls.planPerjadin()).resolves.toMatchObject({ outcome: "planned" });
    },
  );

  it.each(["dina", "sari"] as const)(
    "let %s (Daring Editor; Administrator with no such row) record, edit and delete an online Session",
    async (who) => {
      const caller = (await people())[who];
      const where = await place();
      const calls = daringGuarded(caller, where);

      await expect(calls.arrangeOnlineSessionForm()).resolves.toMatchObject({
        schools: [expect.objectContaining({ id: where.school.id })],
      });
      await expect(calls.arrangeOnlineSessionAt()).resolves.not.toBeNull();
      await expect(calls.arrangeOnlineSession()).resolves.toMatchObject({ outcome: "recorded" });
      await expect(calls.updateOnlineSession()).resolves.toMatchObject({ outcome: "updated" });
      await expect(calls.deleteOnlineSession()).resolves.toMatchObject({ outcome: "deleted" });
    },
  );
});

describe("the pages", () => {
  it("answer 403 on /perjadin/baru without Perjadin Editor, and on /sesi-daring/baru without Daring Editor", async () => {
    const { rina, dewi, eka, kiki, budi, dina } = await people();

    for (const person of [rina, dewi, eka, kiki, dina]) {
      vi.mocked(requirePerson).mockResolvedValue(person);
      await expect(digestOf(PerjadinBaruPage()), person.email).resolves.toBe(FORBIDDEN);
    }
    for (const person of [rina, dewi, eka, kiki, budi]) {
      vi.mocked(requirePerson).mockResolvedValue(person);
      await expect(digestOf(SesiDaringBaruPage()), person.email).resolves.toBe(FORBIDDEN);
    }
  });

  it("show Rencanakan Perjadin, Catat Sesi Daring and the online edit/delete only with the Grant, and read the same for everyone", async () => {
    const { rina, dewi, eka, kiki, budi, dina, sari, hadi } = await people();
    const where = await place();
    await addPerjadin({
      picPersonId: budi.id,
      subClusterId: where.subCluster.id,
    });

    const render = async () => ({
      perjadin: renderToStaticMarkup(await PerjadinPage()),
      sesiDaring: renderToStaticMarkup(await SesiDaringPage()),
      sekolah: renderToStaticMarkup(
        await SekolahPage({ params: Promise.resolve({ slug: where.school.slug }) } as never),
      ),
      detail: renderToStaticMarkup(
        await SesiDaringDetailPage({ params: Promise.resolve({ id: where.online.id }) } as never),
      ),
    });

    // [person, plans a Perjadin, writes online Sessions]
    for (const [person, plans, daring] of [
      [rina, false, false],
      [dewi, false, false],
      [eka, false, false],
      [kiki, false, false],
      [hadi, false, false],
      [budi, true, false],
      [dina, false, true],
      [sari, true, true],
    ] as const) {
      vi.mocked(requirePerson).mockResolvedValue(person);
      const html = await render();
      const label = `${person.email}`;

      expect(html.perjadin.includes('href="/perjadin/baru"'), label).toBe(plans);
      expect(html.sesiDaring.includes('href="/sesi-daring/baru"'), label).toBe(daring);
      expect(html.sekolah.includes("Catat Sesi daring"), label).toBe(daring);
      expect(html.detail.includes("Hapus Sesi"), label).toBe(daring);
      expect(html.detail.includes("Ubah Sesi"), label).toBe(daring);

      // Reading is unchanged: every page renders its subject for everyone signed in.
      expect(html.perjadin, label).toContain("Kelompok 10");
      expect(html.sesiDaring, label).toContain("SMAN 1 Bontang");
      expect(html.sekolah, label).toContain("SMAN 1 Bontang");
      expect(html.detail, label).toContain("SMAN 1 Bontang");
    }
  });
});

describe("the legacy status writes on an arranged online Session", () => {
  it("refuse Tandai terlaksana and Batalkan Sesi without Daring Editor, and let a Daring Editor do them", async () => {
    const { rina, dewi, eka, budi, dina } = await people();
    const { school } = await place();
    const first = await addSession({ schoolId: school.id, heldOn: "2026-02-01" });
    const second = await addSession({ schoolId: school.id, heldOn: "2026-02-02" });

    for (const person of [rina, dewi, eka, budi]) {
      vi.mocked(requirePerson).mockResolvedValue(person);
      await expect(digestOf(markOnlineSessionDeliveredAction(first.id))).resolves.toBe(FORBIDDEN);
      await expect(digestOf(cancelOnlineSessionAction(second.id, "Hujan"))).resolves.toBe(
        FORBIDDEN,
      );
    }

    vi.mocked(requirePerson).mockResolvedValue(dina);
    await expect(markOnlineSessionDeliveredAction(first.id)).resolves.toEqual({
      outcome: "delivered",
    });
    await expect(cancelOnlineSessionAction(second.id, "Hujan")).resolves.toMatchObject({
      outcome: "cancelled",
    });
  });
});
