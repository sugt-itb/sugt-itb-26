import { randomUUID } from "node:crypto";

import PendampingPage from "-/app/(app)/pendamping/page";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import {
  isNotGrantedError,
  isNotStaffError,
  markSessionDelivered,
  myPerjadin,
  pendampingOptions,
  pendampingPerjadin,
  perjadinDetail,
  recordPerjadinDocument,
  togglePreparationItem,
  type Person,
} from "@sugt/db/queries";
import type { Grant } from "@sugt/domain";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addGrant,
  addGroupMember,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSubCluster,
  resetDatabase,
} from "./support/fixtures";

/**
 * **`/pendamping`'s "Anda" and "Pendamping Lain" tabs, for Administrators** (#440) — the ticket's T4
 * table on its own people:
 * - the two queries open with the Administrator Grant (Editor is not enough), a Pimpinan refused as
 *   non-Staff first;
 * - anyone but an Administrator gets their own page, the URL's `tab` and `pendamping` never read;
 * - an Administrator sees both tabs, picks another Pendamping and sees that Person's two sections as
 *   they do, with no greeting; a Person on no trip shows the empty state, and an id that names no
 *   Staff Person says so;
 * - a write done there lands under the Administrator's name.
 *
 * Against the real database; only the signed-in Person and the router are stubbed.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));
// The two Administrator queries, wrapped so a test can assert they never run for anyone else.
vi.mock("@sugt/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sugt/db/queries")>();
  return {
    ...actual,
    pendampingOptions: vi.fn(actual.pendampingOptions),
    pendampingPerjadin: vi.fn(actual.pendampingPerjadin),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(pendampingOptions).mockClear();
  vi.mocked(pendampingPerjadin).mockClear();
});

async function staffWith(grants: Grant[], fullName: string): Promise<Person> {
  const email = `${fullName.split(" ")[0]!.toLowerCase()}@itb.ac.id`;
  const person = await addPerson({ fullName, email, role: "Staff" });
  for (const grant of grants) await addGrant(person.id, grant);
  return { ...person, grants } as Person;
}

/** The ticket's people: Rina and Andi run Perjadin A, Fajar is on no trip. */
async function people() {
  return {
    rina: await staffWith([], "Rina Nurhayati"),
    andi: await staffWith([], "Andi Wijaya"),
    fajar: await staffWith([], "Fajar Pratama"),
    dewi: await staffWith(["Dashboard Viewer"], "Dewi Lestari"),
    budi: await staffWith(["Perjadin Editor"], "Budi Santoso"),
    sari: await staffWith(["Administrator"], "Sari Utami"),
    hadi: (await addPerson({
      fullName: "Pak Hadi",
      email: "hadi@itb.ac.id",
      role: "Pimpinan",
    })) as Person,
  };
}

type People = Awaited<ReturnType<typeof people>>;

/** Perjadin A, "Kelompok 10 · 12–13 Okt 2026": Rina (PIC) and Andi, one arranged Session. */
async function perjadinA(who: People) {
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
  const trip = await addPerjadin({
    subClusterId: subCluster.id,
    picPersonId: who.rina.id,
    startsOn: "2026-10-12",
    endsOn: "2026-10-13",
  });
  await addGroupMember(trip.id, who.andi.id);
  const session = await addOfflineSession({
    perjadinId: trip.id,
    schoolId: school.id,
    heldOn: "2026-10-12",
    startsAt: "08:00",
  });
  return { id: trip.id, sessionId: session.id };
}

/** What a call throws, or `null` when it returns. */
async function refusalOf(call: () => Promise<unknown>) {
  return call().then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * The page's `searchParams`, as a thenable that records whether it was ever read — so a test can
 * prove a non-Administrator's request never looks at `tab` or `pendamping`.
 */
function searchParams(params: Record<string, string>) {
  const read = { value: false };
  const promise = {
    then(resolve: (value: Record<string, string>) => unknown) {
      read.value = true;
      return Promise.resolve(params).then(resolve);
    },
  };
  return { read, props: { searchParams: promise } as never };
}

async function render(viewer: Person, params: Record<string, string> = {}) {
  vi.mocked(requirePerson).mockResolvedValue(viewer as never);
  const { read, props } = searchParams(params);
  const html = renderToStaticMarkup(await PendampingPage(props));
  return { html, read: read.value };
}

describe("the two queries are an Administrator's", () => {
  it("refuse a Staff member with no Grant, with Dashboard Viewer and with Editor, and a Pimpinan as non-Staff", async () => {
    const who = await people();

    for (const caller of [who.rina, who.dewi, who.budi]) {
      expect(isNotGrantedError(await refusalOf(() => pendampingOptions(caller)))).toBe(true);
      expect(
        isNotGrantedError(await refusalOf(() => pendampingPerjadin(caller, who.andi.id))),
      ).toBe(true);
    }
    expect(isNotStaffError(await refusalOf(() => pendampingOptions(who.hadi)))).toBe(true);
    expect(isNotStaffError(await refusalOf(() => pendampingPerjadin(who.hadi, who.andi.id)))).toBe(
      true,
    );
  });

  it("offers every Staff Person but the Administrator, by name, with their email", async () => {
    const who = await people();

    const options = await pendampingOptions(who.sari);

    expect(options.map((option) => option.fullName)).toEqual([
      "Andi Wijaya",
      "Budi Santoso",
      "Dewi Lestari",
      "Fajar Pratama",
      "Rina Nurhayati",
    ]);
    expect(options.find((option) => option.id === who.rina.id)?.email).toBe("rina@itb.ac.id");
  });

  it("gives another Pendamping's trips exactly as that Pendamping reads them", async () => {
    const who = await people();
    await perjadinA(who);

    const viewed = await pendampingPerjadin(who.sari, who.rina.id);

    expect(viewed).toEqual({
      outcome: "ok",
      fullName: "Rina Nurhayati",
      perjadin: await myPerjadin(who.rina),
    });
  });

  it("answers no-such-pendamping for a Pimpinan, an unknown id and garbage", async () => {
    const who = await people();

    for (const id of [who.hadi.id, randomUUID(), "bukan-uuid"]) {
      await expect(pendampingPerjadin(who.sari, id)).resolves.toEqual({
        outcome: "no-such-pendamping",
      });
    }
  });
});

describe("the page", () => {
  it("gives anyone but an Administrator their own page, never reading the URL's tab or person", async () => {
    const who = await people();
    await perjadinA(who);
    const url = { tab: "lain", pendamping: who.rina.id };

    for (const viewer of [who.budi, who.dewi, who.fajar]) {
      const { html, read } = await render(viewer, url);
      expect(read).toBe(false);
      expect(html).toContain(`Selamat datang kembali, ${viewer.fullName}`);
      expect(html).not.toContain("Pendamping Lain");
      expect(html).not.toContain("Rina Nurhayati");
      expect(html).not.toContain("Kelompok 10");
    }
    expect(pendampingOptions).not.toHaveBeenCalled();
    expect(pendampingPerjadin).not.toHaveBeenCalled();

    // Rina's own page is unchanged by the same URL.
    const forRina = await render(who.rina, url);
    expect(forRina.read).toBe(false);
    expect(forRina.html).toContain("Selamat datang kembali, Rina Nurhayati");
    expect(forRina.html).toContain("Kelompok 10");
  });

  it("shows an Administrator both tabs, Anda being today's page", async () => {
    const who = await people();

    const { html } = await render(who.sari);

    expect(html).toContain(">Anda<");
    expect(html).toContain(">Pendamping Lain<");
    expect(html).toContain("Selamat datang kembali, Sari Utami");
    expect(html).toContain("Anda belum tergabung dalam Perjalanan Dinas.");
  });

  it("shows the picker alone on Pendamping Lain until someone is chosen", async () => {
    const who = await people();

    const { html } = await render(who.sari, { tab: "lain" });

    expect(html).toContain("Pilih pendamping…");
    expect(html).not.toContain("Selamat datang kembali");
    expect(html).not.toContain("Perjalanan Dinas Anda");
  });

  it("shows the chosen Pendamping's sections as they see them, with no greeting", async () => {
    const who = await people();
    await perjadinA(who);

    const { html } = await render(who.sari, { tab: "lain", pendamping: who.rina.id });

    expect(html).not.toContain("Selamat datang kembali");
    expect(html).toContain("Perjalanan Dinas Anda");
    expect(html).toContain("Kelompok 10");
    expect(html).toContain("PIC: Rina Nurhayati");
    expect(html).toContain("Perjalanan yang belum selesai, dan yang bisa Anda kerjakan");
  });

  it("shows the empty state of a Pendamping on no trip", async () => {
    const who = await people();
    await perjadinA(who);

    const { html } = await render(who.sari, { tab: "lain", pendamping: who.fajar.id });

    expect(html).toContain("Anda belum tergabung dalam Perjalanan Dinas.");
    expect(html).not.toContain("Kelompok 10");
  });

  it("says Pendamping tidak ditemukan for a Pimpinan's id, an unknown id and garbage", async () => {
    const who = await people();

    for (const pendamping of [who.hadi.id, randomUUID(), "bukan-uuid"]) {
      const { html } = await render(who.sari, { tab: "lain", pendamping });
      expect(html).toContain("Pendamping tidak ditemukan.");
    }
  });
});

describe("a write on Pendamping Lain is the Administrator's", () => {
  it("ticks Persiapan, marks a Session delivered and uploads a Dokumen, logged under Sari", async () => {
    const who = await people();
    const a = await perjadinA(who);

    const [item] = (await perjadinDetail(who.rina, a.id))!.preparation;
    await expect(
      togglePreparationItem(who.sari, { perjadinId: a.id, itemId: item!.itemId, checked: true }),
    ).resolves.toEqual({ outcome: "toggled" });
    const [tick] = await db.select().from(schema.perjadinPreparationTick);
    expect(tick?.checkedBy).toBe(who.sari.id);

    // Tandai is status-only: it writes no Log entry and the Session stores no actor, so what holds
    // for it is that the Administrator's own call lands.
    await expect(markSessionDelivered(who.sari, a.sessionId)).resolves.toEqual({
      outcome: "delivered",
    });

    await expect(
      recordPerjadinDocument(who.sari, {
        perjadinId: a.id,
        documentId: randomUUID(),
        driveFileId: randomUUID(),
        byteSize: 2048,
        kind: "Daftar Hadir Pendamping",
        documentDate: "2026-10-12",
      }),
    ).resolves.toEqual({ outcome: "recorded" });
    const entries = await db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.action, "document_uploaded"));
    expect(entries.map((entry) => entry.actorPersonId)).toEqual([who.sari.id]);
  });
});
