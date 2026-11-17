"use server";

import { randomBytes } from "node:crypto";

import { checkDriveConnection, type DriveCheckReport } from "-/lib/drive/check";
import { DRIVE_STATE_COOKIE } from "-/lib/drive/connect";
import { DRIVE_CALLBACK_PATH, driveAuthorizationUrl } from "-/lib/drive/google";
import { fetchKeuanganSheet, keuanganSourceFromUrl } from "-/lib/keuangan-sheet";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { requireGrant, setKeuanganSource } from "@sugt/db/queries";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * **Hubungkan Google Drive** / **Hubungkan ulang** (#372). Re-checks Administrator on the server —
 * the page's own check does not run before a Server Action — then sends the browser to Google's
 * consent screen with a fresh `state`.
 *
 * The `state` rides in an httpOnly, Secure, SameSite=Lax cookie scoped to the callback path, for ten
 * minutes. Lax is what lets it come back on Google's top-level redirect to the callback.
 */
export async function connectDriveAction(): Promise<never> {
  const person = await requirePerson();
  await staffSurface(async () => requireGrant(person, "Administrator"));

  const state = randomBytes(32).toString("base64url");
  (await cookies()).set(DRIVE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 10 * 60,
    path: DRIVE_CALLBACK_PATH,
  });
  // Google's consent screen is off-site, so typed routes has no entry for it.
  redirect(driveAuthorizationUrl(state) as Route);
}

/**
 * **Periksa koneksi** (#375): refresh the token, check the four fixed folders, check that no
 * link-sharing reaches the root or `_staging`, and sweep the unsynced transactions — bounded per press
 * (`checkDriveConnection`). Administrator only, re-checked here.
 *
 * It can change what every page shows — a refused token marks the connection broken, and the sweep
 * clears "belum tersinkron" markers — so the whole signed-in tree is revalidated, the sidebar's badge
 * included.
 */
export async function checkDriveConnectionAction(): Promise<DriveCheckReport> {
  const person = await requirePerson();
  await staffSurface(async () => requireGrant(person, "Administrator"));

  const report = await checkDriveConnection(person);
  revalidatePath("/", "layout");
  return report;
}

/** What saving the Block B source answered: the tab's size to check against the sheet, or why not. */
export type KeuanganSourceSaveResult =
  | { ok: true; kelompok: number; totalRealisasi: number }
  | { ok: false; detail: string };

/**
 * **Simpan** on the Block B source card (#571, ADR-0064). Administrator only, re-checked here: the
 * page's gate does not run before a Server Action. Then, in order, and stopping at the first failure:
 *
 * 1. `keuanganSourceFromUrl` reads the sheet id and gid out of the pasted text, refusing anything
 *    that is not a Google Sheets tab address — before any fetch.
 * 2. `fetchKeuanganSheet` reads and fully parses that tab, from the export URL it builds out of the id
 *    and gid alone, so the pasted text is never fetched and this cannot be aimed at another address.
 * 3. Only then `setKeuanganSource` stores the pasted address, the id, the gid, the time and the caller.
 *
 * A failure stores nothing, so the previous source stays, and answers the reader's **detailed** reason
 * — the row or column at fault — not the generic sentence `/keuangan` shows.
 */
export async function setKeuanganSourceAction(text: string): Promise<KeuanganSourceSaveResult> {
  const person = await requirePerson();
  await staffSurface(async () => requireGrant(person, "Administrator"));

  const source = keuanganSourceFromUrl(text);
  if (!source.ok) return { ok: false, detail: source.detail };

  const read = await fetchKeuanganSheet({ sheetId: source.sheetId, gid: source.gid });
  if (!read.ok) return { ok: false, detail: read.detail };

  await staffSurface(async () =>
    setKeuanganSource(person, { url: text.trim(), sheetId: source.sheetId, gid: source.gid }),
  );
  revalidatePath("/pengaturan");
  revalidatePath("/keuangan");
  return {
    ok: true,
    kelompok: read.sheet.kelompok.length,
    totalRealisasi: read.sheet.totals.realisasi,
  };
}
