"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { markSessionDelivered, type MarkDeliveredResult } from "@sugt/db/queries";
import { revalidatePath } from "next/cache";

/**
 * **Tandai terlaksana, from the Beranda.** The Staff dashboard's own "Perjalanan Dinas Anda" card
 * marks a trip's offline Session delivered without opening `/sesi/[id]`. The write is the same
 * status-only mutation that page runs — `markSessionDelivered`, whose `for update` lock and rule
 * live in the query function (convention 5) — but the page that must re-read differs: the Session's
 * own action revalidates `/sesi/[id]`, so it cannot be reused here. This one revalidates `/`.
 *
 * `staffSurface` is here for the same reason it is on the Session action: a non-Staff caller
 * reaching this is a bug or an attack, so it reads as a 403 rather than a crash. The `not-arranged`
 * refusal — a Session someone else already delivered or cancelled while the dialog was open — is a
 * value the dialog surfaces as a stale message rather than throwing.
 */
export async function markSessionDeliveredFromDashboardAction(
  sessionId: string,
): Promise<MarkDeliveredResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => markSessionDelivered(person, sessionId));
  if (result.outcome === "delivered") revalidatePath("/");
  return result;
}
