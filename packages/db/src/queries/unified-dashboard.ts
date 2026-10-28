import { asc, eq } from "drizzle-orm";

import { db } from "../client";
import { province, school } from "../schema/reference";
import type { UnifiedDashboardCaller } from "./caller";

/** One School as the Unified Dashboard's summary carries it: who it is, and its Province. */
export type ProgrammeSchool = {
  slug: string;
  name: string;
  province: { code: string; name: string };
};

/**
 * **Every School the Programme reaches, with its Province** — the summary's `schools` (#528).
 * Flat and ordered by School name, the order `scope` lists them in; nothing is organised by
 * Province.
 *
 * Reference data the public site already publishes through `scope`, so leadership seeing it leaks
 * nothing ADR-0001 protects. **But it is its own read, naming `UnifiedDashboardCaller` only**: reusing
 * or widening `scope`, which takes `ServiceCaller`, would join the two readers' rights (ADR-0057).
 * It carries only the four fields the contract documents — every field added is one that cannot be
 * removed without a version bump — and no per-School figure.
 */
export async function programmeSchools(
  _caller: UnifiedDashboardCaller,
): Promise<ProgrammeSchool[]> {
  const rows = await db
    .select({
      slug: school.slug,
      name: school.name,
      provinceCode: province.code,
      provinceName: province.name,
    })
    .from(school)
    // Inner: `province_code` is NOT NULL, so no School is dropped.
    .innerJoin(province, eq(province.code, school.provinceCode))
    .orderBy(asc(school.name), asc(school.id));

  return rows.map(({ slug, name, provinceCode, provinceName }) => ({
    slug,
    name,
    province: { code: provinceCode, name: provinceName },
  }));
}
