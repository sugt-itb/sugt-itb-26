import { logHref, parseLogParams } from "-/app/(app)/log/log-params";
import Page from "-/app/(app)/log/page";
import { formatWibIndonesian } from "-/lib/format-wib";
import { requirePerson } from "-/lib/person";
import { db, schema } from "@sugt/db";
import type { Person } from "@sugt/db/queries";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addActivityLogEntry,
  addGrant,
  addPerjadin,
  addPerson,
  addSchoolOnTrip,
  addTransaction,
  resetDatabase,
} from "./support/fixtures";

/**
 * **`/log`, the page** (#395): Administrator only — a grant-less Staff member and a Pimpinan get
 * the 403 — and its URL is the whole view, parsed leniently.
 */

vi.mock("-/lib/person", () => ({ requirePerson: vi.fn() }));

const FORBIDDEN = "NEXT_HTTP_ERROR_FALLBACK;403";

async function digestOf(call: Promise<unknown>) {
  const thrown = await call.then(
    () => null,
    (error: unknown) => error,
  );
  return (thrown as { digest?: string } | null)?.digest;
}

const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) } as never));

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "1");
});

describe("only an Administrator reaches /log", () => {
  it("forbids a grant-less Staff member, an Editor and a Pimpinan", async () => {
    const staff = await addPerson({ fullName: "Staf", email: "staf@itb.ac.id", role: "Staff" });
    const editor = await addPerson({ fullName: "Ed", email: "ed@itb.ac.id", role: "Staff" });
    await addGrant(editor.id, "Perjadin Editor");
    const pimpinan = await addPerson({ fullName: "Pim", email: "pim@itb.ac.id", role: "Pimpinan" });

    for (const person of [staff, { ...editor, grants: ["Perjadin Editor"] } as Person, pimpinan]) {
      vi.mocked(requirePerson).mockResolvedValue(person);
      await expect(digestOf(render())).resolves.toBe(FORBIDDEN);
    }
  });

  it("shows an Administrator the table, a backfilled row marked and the line's Drive folder", async () => {
    const admin = await addPerson({ fullName: "Admin", email: "admin@itb.ac.id", role: "Staff" });
    await addGrant(admin.id, "Administrator");
    vi.mocked(requirePerson).mockResolvedValue({ ...admin, grants: ["Administrator"] } as Person);
    const rina = await addPerson({
      fullName: "Rina Setiawati",
      email: "rina@ditsama.itb.ac.id",
      role: "Staff",
    });
    const trip = await addPerjadin({
      picPersonId: rina.id,
      subClusterName: "Kelompok 18",
      startsOn: "2026-10-12",
      endsOn: "2026-10-15",
    });
    await addSchoolOnTrip({ perjadin: trip, name: "SMAN 1 Tenggarong" });
    const line = await addTransaction({
      perjadinId: trip.id,
      amountIdr: 3_400_000,
      createdByPersonId: rina.id,
    });
    await db
      .update(schema.transaction)
      .set({ driveFolderId: "folder-1" })
      .where(eq(schema.transaction.id, line.id));
    await addActivityLogEntry({
      perjadinId: trip.id,
      actorPersonId: rina.id,
      actorEmail: rina.email,
      action: "transaction_recorded",
      details: {
        transactionId: line.id,
        category: "Tiket Pesawat/Kereta PP",
        amountIdr: 3_400_000,
        participantType: "GTK-MS",
        spentOn: "2026-09-18",
        receiptCount: 1,
      },
      occurredAt: new Date("2026-09-20T07:02:00Z"),
      backfilled: true,
    });

    const html = await render();

    for (const text of [
      "Waktu (WIB)",
      "20 Sep 2026, 14.02",
      "rina@ditsama.itb.ac.id",
      "Kelompok 18 · 12–15 Okt 2026",
      "SMAN 1 Tenggarong",
      "PIC: Rina Setiawati",
      "Catat transaksi (dari data lama)",
      "Tiket Pesawat/Kereta PP · Rp3.400.000 · GTK-MS · tgl 2026-09-18 · 1 bukti",
      'href="https://drive.google.com/drive/folders/folder-1"',
      `href="/perjadin/${trip.id}"`,
      "1 entri · halaman 1 dari 1",
    ]) {
      expect(html).toContain(text);
    }
    await expect(render({ q: "tidak ada" })).resolves.toContain(
      "Tidak ada entri yang cocok dengan saringan ini.",
    );
  });
});

describe("the URL is the view", () => {
  it("parses every filter, and drops what is malformed", () => {
    expect(
      parseLogParams({
        q: "  rina ",
        aksi: "uang-perjalanan",
        dari: "2026-10-01",
        sampai: "2026-10-31",
        page: "3",
      }),
    ).toEqual({
      q: "rina",
      aksi: "uang-perjalanan",
      dari: "2026-10-01",
      sampai: "2026-10-31",
      page: 3,
    });
    expect(
      parseLogParams({ aksi: "toString", dari: "2026-02-30", sampai: "kemarin", page: "-1" }),
    ).toEqual({ q: "", aksi: null, dari: null, sampai: null, page: 1 });
    expect(parseLogParams({ aksi: "semua", page: ["2", "5"] })).toMatchObject({
      aksi: null,
      page: 2,
    });
  });

  it("writes back only what is set, for the paging links", () => {
    const filters = parseLogParams({ q: "rina", aksi: "laporan" });
    expect(logHref(filters, 2)).toBe("/log?q=rina&aksi=laporan&page=2");
    expect(logHref(filters, 1)).toBe("/log?q=rina&aksi=laporan");
    expect(logHref(parseLogParams({}), 1)).toBe("/log");
  });

  it("formats Waktu in WIB", () => {
    expect(formatWibIndonesian(new Date("2026-10-14T01:05:00Z"))).toBe("14 Okt 2026, 08.05");
  });
});
