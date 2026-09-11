"use client";

import { Tabs, TabsList, TabsTrigger } from "@sugt/ui/components/tabs";
import { type ReactNode, useState } from "react";

/**
 * **The /monitoring tab switch.** Two tabs — Pelaksanaan (the delivery-and-budget overview that has
 * always been this screen) and Persiapan (the free-standing Preparation Cards, #221) — with
 * Pelaksanaan the default and first.
 *
 * **A thin client shell, so the two tabs stay server-composed.** Both panels are built in the server
 * `page.tsx` — one reads `monitoringData`, the other `preparationCards` — and handed in as ready
 * nodes; this only chooses which to show. Keeping the composition on the server means the existing
 * `MonitoringView` and its data path are untouched (the parent still passes it the identical props),
 * and the Persiapan tab's cards are fetched in the same request rather than through a client round
 * trip. Only the active node is rendered, mirroring `feedback-view.tsx`; the tab is local state, not
 * a URL param, because which tab you last looked at is nobody else's business.
 */
type Tab = "pelaksanaan" | "persiapan";

function MonitoringTabs({
  pelaksanaan,
  persiapan,
}: {
  pelaksanaan: ReactNode;
  persiapan: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("pelaksanaan");

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-7 pt-6">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab);
          }}
        >
          <TabsList>
            <TabsTrigger value="pelaksanaan">Pelaksanaan</TabsTrigger>
            <TabsTrigger value="persiapan">Persiapan</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "pelaksanaan" ? pelaksanaan : persiapan}
    </div>
  );
}

export { MonitoringTabs };
