import { sql } from "drizzle-orm";

/**
 * **The zone "today" is reckoned in.** DITSAMA is in Bandung, and Indonesia spans three zones — so
 * a date compared against `now()` is compared against *Bandung's* current day, not the database
 * session's default zone.
 *
 * Shared beneath the query modules that compare against it in SQL — the personal trips read's
 * `ends_on` cutoff and the Preparation checklist's dated changes — the way `./group-rules.ts` is
 * (convention 3). It stays in `@sugt/db` rather than `@sugt/domain` because only SQL here reads it;
 * the app's own `wibToday()` helpers work the same day out in JavaScript.
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
