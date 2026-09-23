"use client";

import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@sugt/ui/components/accordion";
import { Button } from "@sugt/ui/components/button";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  dismissWarning,
  initialWarningState,
  restoreWarning,
  type Warning,
} from "./dashboard-state";

/**
 * **The Dashboard (`/`) Peringatan section, hoisted to page level (#235).** It used to live inside
 * `DashboardView`, so it showed only on the Pelaksanaan tab and vanished on Persiapan. Rendered
 * once in `page.tsx` **above** `DashboardTabs`, it now shows identically on both tabs and survives a
 * tab switch (the tabs are the thing that changes below it; this does not remount).
 *
 * It owns the one piece of client state the section has: the dismiss lists. `useState` seeds them
 * once from the merged `warnings` prop (the server's Luring-overdue warnings followed by the
 * Persiapan due-date warnings) and the pure reducers (`dashboard-state.ts`) move an item between
 * `active` and `ignored`: **Abaikan** sets it aside, **Tampilkan lagi** brings it back. The state is
 * deliberately ephemeral — it resets on reload, which is right for warnings recomputed from the data
 * every load.
 *
 * The two accordions are kept separate on purpose (#303): active warnings collapse under a single
 * destructive-toned **Peringatan (N)** trigger, open by default so the operator sees them, while the
 * "diabaikan" list is its own independently-toggled section. Both the trigger's default-open state
 * and the warnings themselves are deterministic (server-derived, no `Date.now()`/`Math.random()` in
 * render), and no button uses the base-ui `disabled` prop, so nothing here diverges across the
 * SSR/hydration boundary (#302).
 */
export function DashboardWarnings({ warnings }: { warnings: Warning[] }) {
  const [state, setState] = useState(() => initialWarningState(warnings));

  return (
    <div className="flex flex-col gap-6 px-7 pt-6">
      {/* Active warnings — one collapsible card, open by default, that folds to a single line. Hidden
          entirely when nothing is active, exactly as the per-warning stack was. */}
      {state.active.length > 0 && (
        <Accordion defaultValue={["peringatan"]}>
          <AccordionItem value="peringatan">
            <AccordionTrigger>
              <span className="flex items-center gap-2 text-destructive">
                <TriangleAlert className="size-4" />
                Peringatan ({state.active.length})
              </span>
            </AccordionTrigger>
            <AccordionPanel>
              <ul className="flex flex-col gap-2">
                {state.active.map((w) => (
                  <li
                    key={w.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-foreground">{w.message}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setState((s) => dismissWarning(s, w.id))}
                    >
                      Abaikan
                    </Button>
                  </li>
                ))}
              </ul>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      )}

      {/* Ignored warnings — always rendered, populates live as warnings are set aside. Each carries a
          Tampilkan lagi that returns it to the active card above. */}
      <Accordion>
        <AccordionItem>
          <AccordionTrigger>Peringatan yang diabaikan</AccordionTrigger>
          <AccordionPanel>
            {state.ignored.length === 0 ? (
              <p>Belum ada.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {state.ignored.map((w) => (
                  <li
                    key={w.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{w.message}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setState((s) => restoreWarning(s, w.id))}
                    >
                      Tampilkan lagi
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
