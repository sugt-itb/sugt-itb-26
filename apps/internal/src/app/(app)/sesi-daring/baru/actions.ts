"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  arrangeOnlineSession,
  type ArrangeOnlineSessionInput,
  type ArrangeOnlineSessionResult,
} from "@sugt/db/queries";

/**
 * **Jadwalkan Sesi daring's write** — arranging one online Session (#70).
 *
 * It resolves the Person, hands the input to `@sugt/db`, and returns what came back:
 *
 * - **It opens no transaction.** The boundary is convention 5's, and it lives in
 *   `arrangeOnlineSession` — a Server Action that opened one would put it somewhere a second
 *   caller cannot reuse.
 * - **It re-checks nothing the query checks.** `arrangeOnlineSession` opens with `requireStaff`,
 *   which is what actually closes this path: the signed-in layout does not run before a Server
 *   Action, so a check written here and not there would protect nothing.
 * - **It does not turn a collision into an error.** A collision is a user state and comes back
 *   as a value, which the form renders beside the fields that caused it.
 *
 * `staffSurface` turns `@sugt/db`'s typed refusal into a **403** server-side rather than a crash.
 *
 * Nothing is revalidated here: the form calls `router.refresh()` itself on success, which is what
 * updates Detail Sekolah's Session list in place — and the standalone screen has no list of its
 * own to refresh.
 */
export async function arrangeOnlineSessionAction(
  input: ArrangeOnlineSessionInput,
): Promise<ArrangeOnlineSessionResult> {
  const person = await requirePerson();

  return staffSurface(() => arrangeOnlineSession(person, input));
}
