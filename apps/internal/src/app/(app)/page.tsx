import { requirePerson } from "-/lib/person";
import {
  assessmentCompletions,
  hasGrant,
  monitoringData,
  preparationCards,
} from "@sugt/db/queries";

import { deriveDashboard } from "./dashboard-derive";
import { showBudget } from "./dashboard-state";
import { DashboardTabs } from "./dashboard-tabs";
import { DashboardView } from "./dashboard-view";
import { DashboardWarnings } from "./dashboard-warnings";
import { PersiapanTab } from "./persiapan-tab";
import { preparationWarnings } from "./preparation-derive";

/**
 * **Dashboard** (`/`) — a one-screen overview of how far Session delivery has got and how much of the
 * Programme budget has been spent, across every Cluster. It now reads **real data** (#196): the
 * mock module is gone. `monitoringData` fetches the raw rows in one round trip and
 * `deriveDashboard` (the pure, tested seam in `./dashboard-derive.ts`) folds them — ranking each
 * School's Sessions into Sesi, building the two matrices, the timeline and the overdue warnings —
 * against the programme constants in `@sugt/domain`. It is the landing surface, **open to every
 * signed-in Person** — Staff and the read-only Pimpinan alike — so it carries no role guard (#265).
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
  // The Persiapan tab's cards (#221), read in the same request as the Pelaksanaan data. Reading is
  // open to any signed-in Person; `canEdit` — the "Editor" Grant — gates the tab's editor
  // controls. The Grant is re-checked in every write, so this only hides controls a non-holder could
  // not use anyway. An Administrator implies the Grant, which `hasGrant` already folds in.
  const cards = await preparationCards(person);
  // The Pretest tracker card's rows (#248), read in the same request — open to any signed-in Person,
  // folded into the derive against the always-47 School denominator. Editing lives on `/pretest`.
  const completions = await assessmentCompletions(person);
  const canEdit = hasGrant(person, "Editor");
  // `en-CA` formats as `YYYY-MM-DD`; `Asia/Jakarta` pins it to WIB so the date compares like-for-like
  // against the WIB window bounds in `LURING_SESI_WINDOWS`.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const derived = deriveDashboard(data, today, completions);
  // The Peringatan section's warnings, merged in a stable order — the server's Luring-overdue
  // warnings first, then the Persiapan due-date warnings (#234) folded from the same `cards` already
  // fetched above (no new query). Rendered once above the tabs so the section shows on both (#235).
  const warnings = [...derived.warnings, ...preparationWarnings(cards, today)];

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ringkasan kemajuan pelaksanaan Sesi dan penyerapan anggaran Program di seluruh Klaster.
        </p>
      </header>

      <DashboardWarnings warnings={warnings} />

      <DashboardTabs
        pelaksanaan={
          <DashboardView
            showBudget={showBudget(person.role)}
            activitiesPercent={derived.activitiesPercent}
            budget={derived.budget}
            clusters={derived.clusters}
            luring={derived.luring}
            daring={derived.daring}
            timeline={derived.timeline}
            pretest={derived.pretest}
          />
        }
        persiapan={
          <PersiapanTab
            cards={cards}
            canEdit={canEdit}
          />
        }
      />
    </div>
  );
}
