import { ADVANCE_DRAWDOWN_CATEGORIES } from "@sugt/domain";
import { sql, type SQL } from "drizzle-orm";

/**
 * The `('Konsumsi', 'Lainnya')` value list for a `category in (…)` filter on the **travel-float
 * draw-down** (ADR-0029), built from `ADVANCE_DRAWDOWN_CATEGORIES` so the two SQL remainder sites
 * that carry it — `myUpcomingPerjadin` and the Staff dashboard — cannot drift from the domain
 * constant or from each other (query-layer convention 3: SQL shared between modules lives in one
 * helper beneath them). Each category is a bound placeholder, never interpolated. The JS acquittal
 * uses `sumAdvanceDrawdownIdr` for the identical rule; a test pins all three equal.
 */
export function advanceDrawdownCategoryList(): SQL {
  return sql.join(
    ADVANCE_DRAWDOWN_CATEGORIES.map((category) => sql`${category}`),
    sql`, `,
  );
}
