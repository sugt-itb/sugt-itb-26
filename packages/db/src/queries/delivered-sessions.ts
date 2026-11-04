import type { SessionStatus } from "@sugt/domain";
import { and, eq, sql } from "drizzle-orm";

import { session } from "../schema/delivery";
import { school } from "../schema/reference";

/**
 * How a School's delivered Session count is written, in the one place two surfaces
 * read it from.
 *
 * This is the unexported helper the convention beside these modules describes: *"SQL
 * shared between two of these modules belongs in an unexported helper beneath them …
 * the second one that wants the same expression is what earns the helper."* Coverage
 * was the first, Direktori Sekolah is the second, and the expression is a domain rule
 * rather than a formatting choice — **arranged and cancelled Sessions count for
 * nothing** — so two copies of it are two places to disagree about what progress
 * means.
 *
 * Nothing here is exported from `./index.ts`. It is an expression, not a payload.
 */

/**
 * The join between a School and the Sessions that count towards its progress.
 *
 * **The delivered filter belongs in the JOIN and not in a WHERE**, and that is
 * load-bearing rather than stylistic: in a WHERE it would drop every School that has
 * delivered nothing, which is exactly the School a reader of either screen is looking
 * for.
 */
export const onDeliveredSessions = and(
  eq(session.schoolId, school.id),
  eq(session.status, "delivered"),
);

/**
 * The count that goes with it. Counts `session.id` rather than rows, so a School the
 * join found nothing for counts zero instead of one.
 *
 * The denominator is not here and is not in either payload: each reader takes its own
 * constant from `@sugt/domain`, the same for every School and fixed from the start —
 * `TOTAL_SESSIONS_PER_SCHOOL` for the public figures, `KEGIATAN_UNITS_PER_SCHOOL` for the
 * directory, which adds assessment units to this count (#540). Returning it per row would
 * be a second source of truth for a constant.
 */
export const deliveredSessionCount = sql<number>`count(${session.id})`.mapWith(Number);

/**
 * The same rule again, for a caller that already has the Sessions in hand and would
 * otherwise ask the database to count what it just read.
 *
 * It is here rather than beside that caller so the rule has one home in both languages:
 * the SQL above and this predicate say the same thing, and a screen that decided for
 * itself which statuses count is exactly what the module exists to prevent.
 */
export function countsTowardsProgress(status: SessionStatus): boolean {
  return status === "delivered";
}
