import { requirePerson } from "-/lib/person";
import { monitoringData } from "@sugt/db/queries";

import { deriveMonitoring } from "./monitoring-derive";
import { showBudget } from "./monitoring-state";
import { MonitoringView } from "./monitoring-view";

/**
 * **Monitoring** — a one-screen overview of how far Session delivery has got and how much of the
 * Programme budget has been spent, across every Cluster. It now reads **real data** (#196): the
 * mock module is gone. `monitoringData` fetches the raw rows in one round trip and
 * `deriveMonitoring` (the pure, tested seam in `./monitoring-derive.ts`) folds them — ranking each
 * School's Sessions into Sesi, building the two matrices, the timeline and the overdue warnings —
 * against the programme constants in `@sugt/domain`.
 *
 * The server's decisions are the money gate and today's date. `showBudget(person.role)` returns
 * `true` for both signed-in roles — Staff and the read-only Pimpinan — because money is open to any
 * signed-in Person to READ (ADR-0004 reversed by ADR-0026, #180); writing money stays Staff-only
 * elsewhere. `today` is the **WIB** calendar date — the Programme's zone, the one Session times are
 * stored in — not UTC: an overdue warning or a completed step turns over at local midnight, and a
 * UTC date would flip it up to seven hours early against `LURING_SESI_WINDOWS`, which are WIB dates.
 */
export default async function Page() {
  const person = await requirePerson();
  const data = await monitoringData(person);
  // `en-CA` formats as `YYYY-MM-DD`; `Asia/Jakarta` pins it to WIB so the date compares like-for-like
  // against the WIB window bounds in `LURING_SESI_WINDOWS`.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const derived = deriveMonitoring(data, today);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Monitoring</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ringkasan kemajuan pelaksanaan Sesi dan penyerapan anggaran Program di seluruh Klaster.
        </p>
      </header>

      <MonitoringView
        showBudget={showBudget(person.role)}
        activitiesPercent={derived.activitiesPercent}
        budget={derived.budget}
        clusters={derived.clusters}
        luring={derived.luring}
        daring={derived.daring}
        timeline={derived.timeline}
        warnings={derived.warnings}
      />
    </div>
  );
}
