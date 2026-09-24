import { requirePerson } from "-/lib/person";
import {
  assessmentCompletions,
  canViewDashboard,
  hasGrant,
  monitoringData,
  preparationCards,
} from "@sugt/db/queries";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { deriveDashboard } from "./dashboard-derive";
import { showBudget } from "./dashboard-state";
import { DashboardTabs } from "./dashboard-tabs";
import { DashboardView } from "./dashboard-view";
import { DashboardWarnings } from "./dashboard-warnings";
import { PersiapanTab } from "./persiapan-tab";
import { preparationWarnings } from "./preparation-derive";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * **Dashboard** (`/`) — a one-screen overview of how far Session delivery has got and how much of the
 * Programme budget has been spent, across every Cluster. It now reads **real data** (#196): the
 * mock module is gone. `monitoringData` fetches the raw rows in one round trip and
 * `deriveDashboard` (the pure, tested seam in `./dashboard-derive.ts`) folds them — ranking each
 * School's Sessions into Sesi, building the two matrices, the timeline and the overdue warnings —
 * against the programme constants in `@sugt/domain`. It is the landing surface for a Pimpinan and
 * for a **granted** Staff, but **reading it now needs a grant** (#322): a `Pimpinan` reads it by
 * Role, a `Staff` by holding `Editor` or `Dashboard Viewer` (an `Administrator` implies both). This
 * reverses the earlier "open to every signed-in Person" rule (#265) — a grant-less Staff Person is
 * redirected to `/pendamping`, the mirror of the `/pendamping → /` Pimpinan redirect. The predicate
 * is `canViewDashboard`, shared with the sidebar so a link is shown exactly when the page renders.
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
  // Reading the Dashboard needs a grant now (#322). A grant-less Staff Person is redirected to their
  // own landing screen — the mirror of `pendamping/page.tsx`'s `/pendamping → /` for a Pimpinan.
  // `canViewDashboard` is the one predicate the sidebar filters on too, so the link and the page
  // agree. The redirect throws, so nothing below runs for a grant-less Staff.
  if (!canViewDashboard(person)) redirect("/pendamping");
  // These three reads depend only on `person`, not on one another, so they run under a single
  // `Promise.all` — one round of latency, not a three-deep request waterfall. `pendamping/page.tsx`
  // batches the same way; this brings the landing surface back in line with the codebase's
  // `Promise.all` convention (#269). The destructured order matches the reads below.
  const [data, cards, completions] = await Promise.all([
    // The raw Pelaksanaan rows in one round trip, folded below by `deriveDashboard`.
    monitoringData(person),
    // The Persiapan tab's cards (#221). Reading is open to any signed-in Person; `canEdit` — the
    // "Editor" Grant — gates the tab's editor controls. The Grant is re-checked in every write, so
    // this only hides controls a non-holder could not use anyway. An Administrator implies the
    // Grant, which `hasGrant` already folds in.
    preparationCards(person),
    // The Pretest tracker card's rows (#248) — open to any signed-in Person, folded into the derive
    // against the always-47 School denominator. Editing lives on `/pretest`.
    assessmentCompletions(person),
  ]);
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
      <DashboardWarnings warnings={warnings} />

      <DashboardTabs
        pelaksanaan={
          <DashboardView
            showBudget={showBudget(person.role)}
            activitiesPercent={derived.activitiesPercent}
            budget={derived.budget}
            summary={derived.summary}
            luring={derived.luring}
            daring={derived.daring}
            pretestTable={derived.pretestTable}
            postestTable={derived.postestTable}
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
