import type { ScopeSchool } from "-/lib/aggregates-types";
import Link from "next/link";

/**
 * **A list of Schools** — each with where it is, linking to its own page.
 *
 * Shared by Program (all forty-seven) and a Cluster's page (that Cluster's). The Schools arrive already
 * ordered by name from the scope payload, so this preserves that order. No delivery figure sits
 * beside a School: ADR-0001 keeps per-School delivery off every public surface.
 */
function SchoolList({ schools }: { schools: ScopeSchool[] }) {
  return (
    <ul className="divide-y divide-border">
      {schools.map((school) => (
        <li key={school.id}>
          <Link
            href={`/sekolah/${school.slug}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3 hover:underline"
          >
            <span className="font-medium">{school.name}</span>
            <span className="text-sm text-muted-foreground">
              {school.kabupatenKota}, {school.provinceName}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export { SchoolList };
