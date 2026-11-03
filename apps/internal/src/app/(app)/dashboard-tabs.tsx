"use client";

import { Tabs, TabsList, TabsTrigger } from "@sugt/ui/components/tabs";
import { type ReactNode, useState } from "react";

/**
 * **The Dashboard (`/`) tab switch.** Three tabs, left to right — Pelaksanaan (the delivery overview
 * that has always been this screen), Persiapan Program (the free-standing Preparation
 * Cards, #221, named Persiapan until #423) and Persiapan Luring (one week's Perjadin Preparation
 * Checklists, #423) — with Pelaksanaan the default and first.
 *
 * **A thin client shell, so the tabs stay server-composed.** Every panel is built in the server
 * `page.tsx` — from `programmeDelivery`, `preparationCards` and `preparationWeek` — and handed in as
 * ready nodes; this only chooses which to show. Only the active node is rendered, mirroring
 * `feedback-view.tsx`.
 *
 * **The tab is local state, not a URL param**, because which tab you last looked at is nobody else's
 * business. Persiapan Luring's *week* is in the URL (`?minggu=`) — a week is worth bookmarking — and
 * a URL carrying one opens on that tab (`initialTab`). Moving between weeks is a soft navigation, so
 * this component keeps its state and the tab stays put; switching tabs leaves the URL, and so the
 * week, alone.
 */
type Tab = "pelaksanaan" | "persiapan-program" | "persiapan-luring";

function DashboardTabs({
  initialTab = "pelaksanaan",
  pelaksanaan,
  persiapanProgram,
  persiapanLuring,
}: {
  initialTab?: Tab;
  pelaksanaan: ReactNode;
  persiapanProgram: ReactNode;
  persiapanLuring: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pt-6 sm:px-7">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab);
          }}
        >
          {/* Three tabs are wider than a 360px phone. The list keeps its natural width inside a
              scrolling frame: a centred list that overflows spills off both sides, and the first tab's
              start could never be scrolled back into view. */}
          <div className="max-w-full overflow-x-auto">
            <TabsList className="w-max">
              <TabsTrigger value="pelaksanaan">Pelaksanaan</TabsTrigger>
              <TabsTrigger value="persiapan-program">Persiapan Program</TabsTrigger>
              <TabsTrigger value="persiapan-luring">Persiapan Luring</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
      </div>

      {tab === "pelaksanaan"
        ? pelaksanaan
        : tab === "persiapan-program"
          ? persiapanProgram
          : persiapanLuring}
    </div>
  );
}

export { DashboardTabs };
