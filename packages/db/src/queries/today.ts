import { sql } from "drizzle-orm";

/**
 * **The zone "today" is reckoned in.** DITSAMA is in Bandung, and Indonesia spans three zones — so
 * a date compared against `now()` is compared against *Bandung's* current day, not the database
 * session's default zone.
 *
 * Shared beneath the query modules that compare against it — the personal trips read's `ends_on`
 * cutoff and the Preparation checklist's dated changes — the way `./group-rules.ts` is, so the one
 * decision has a single home (convention 3) and a zone change is one edit rather than several. It
 * stays here rather than in `@sugt/domain` because it is a fact about where the Programme is
 * administered, not a term `CONTEXT.md` defines, and no screen renders it.
 */
export const WIB_TIME_ZONE = "Asia/Jakarta";

/**
 * The current calendar day in {@link WIB_TIME_ZONE}, as a SQL `date`. `now() at time zone` yields a
 * timestamp *in* that zone, and casting it to `date` is the calendar day there; bare `current_date`
 * would be the session's zone, which nothing in this repository sets, so a value on the boundary
 * would read differently across sessions at one instant. Parenthesised so it drops into a larger
 * date expression unchanged.
 */
export const todayInWib = sql`(now() at time zone ${WIB_TIME_ZONE})::date`;
