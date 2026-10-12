"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { markSessionDelivered, type MarkDeliveredResult } from "@sugt/db/queries";
import { revalidatePath } from "next/cache";

/**
 * **Tandai, from Pendamping.** Each Session on a "Perjalanan Dinas Anda" trip timeline (`/pendamping`,
 * #349) marks that offline Session delivered without opening `/sesi/[id]`. The write is the same
 * status-only mutation that page runs — `markSessionDelivered`, whose `for update` lock and rule
 * live in the query function (convention 5) — but the pages that must re-read differ: the Session's
 * own action revalidates `/sesi/[id]`, so it cannot be reused here. This one revalidates `/`, the
 * Dashboard whose delivery counts the mark changes. `/pendamping` needs no path of its own: a Server
 * Action that revalidates any path also re-renders the route it was called from, so the card's
 * Tandai goes and its node turns done without a reload — verified in a browser for #349.
 *
 * `staffSurface` is here for the same reason it is on the Session action: a non-Staff caller, or a
 * Staff one not in the trip's Group and without the Perjadin Editor Grant (ADR-0048), reaching this is a bug
 * or an attack, so it reads as a 403 rather than a crash. The `not-arranged`
 * refusal — a Session someone else already delivered or cancelled while the dialog was open — is a
 * value the dialog surfaces as a stale message rather than throwing.
 */
export async function markSessionDeliveredFromPendampingAction(
  sessionId: string,
): Promise<MarkDeliveredResult> {
  const person = await requirePerson();

  const result = await staffSurface(() => markSessionDelivered(person, sessionId));
  if (result.outcome === "delivered") revalidatePath("/");
  return result;
}
