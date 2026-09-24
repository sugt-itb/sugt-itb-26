"use server";

import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import {
  arrangeOnlineSession,
  type ArrangeOnlineSessionInput,
  type ArrangeOnlineSessionResult,
} from "@sugt/db/queries";

/**
 * **Catat Sesi daring's write** — recording one already-delivered online Session (#70, #318).
 *
 * It resolves the Person, hands the input to `@sugt/db`, and returns what came back:
 *
 * - **It opens no transaction.** `arrangeOnlineSession` is a single insert now (#318), and the
 *   boundary rule (convention 5) lives in the query anyway — a Server Action that opened one would
 *   put it somewhere a second caller cannot reuse.
 * - **It re-checks nothing the query checks.** `arrangeOnlineSession` opens with `requireStaff`,
 *   which is what actually closes this path: the signed-in layout does not run before a Server
 *   Action, so a check written here and not there would protect nothing.
 * - **It does not turn a collision (or a future date) into an error.** Both are user states and come
 *   back as values, which the form renders beside the fields that caused them.
 *
 * `staffSurface` turns `@sugt/db`'s typed refusal into a **403** server-side rather than a crash.
 *
 * Nothing is revalidated here: the form navigates itself on success (#318) — the standalone screen
 * pushes to `/sesi-daring` where the new row appears, and the Detail Sekolah embed calls
 * `router.refresh()` to bring the Session into the School's own list.
 */
export async function arrangeOnlineSessionAction(
  input: ArrangeOnlineSessionInput,
): Promise<ArrangeOnlineSessionResult> {
  const person = await requirePerson();

  return staffSurface(() => arrangeOnlineSession(person, input));
}
