"use client";

import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@sugt/ui/components/accordion";
import { Alert, AlertAction, AlertDescription } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import { useState } from "react";

import { dismissWarning, initialWarningState, type Warning } from "./dashboard-state";

/**
 * **The Dashboard (`/`) Peringatan section, hoisted to page level (#235).** It used to live inside
 * `DashboardView`, so it showed only on the Pelaksanaan tab and vanished on Persiapan. Rendered
 * once in `page.tsx` **above** `DashboardTabs`, it now shows identically on both tabs and survives a
 * tab switch (the tabs are the thing that changes below it; this does not remount).
 *
 * It owns the one piece of client state the section has: the dismiss lists. `useState` seeds them
 * once from the merged `warnings` prop (the server's Luring-overdue warnings followed by the
 * Persiapan due-date warnings) and the pure reducer (`dismissWarning`, `dashboard-state.ts`) moves
 * an item from `active` to `ignored` on **Abaikan**. The state is deliberately ephemeral — it resets
 * on reload, which is right for warnings recomputed from the data every load.
 */
export function DashboardWarnings({ warnings }: { warnings: Warning[] }) {
  const [state, setState] = useState(() => initialWarningState(warnings));

  return (
    <div className="flex flex-col gap-6 px-7 pt-6">
      {/* Active warnings — one destructive Alert each; Abaikan sets it aside. */}
      {state.active.map((w) => (
        <Alert
          key={w.id}
          variant="destructive"
        >
          <AlertDescription>{w.message}</AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setState((s) => dismissWarning(s, w.id))}
            >
              Abaikan
            </Button>
          </AlertAction>
        </Alert>
      ))}

      {/* Ignored warnings — always rendered, populates live as warnings are set aside. */}
      <Accordion>
        <AccordionItem>
          <AccordionTrigger>Peringatan yang diabaikan</AccordionTrigger>
          <AccordionPanel>
            {state.ignored.length === 0 ? (
              <p>Belum ada.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {state.ignored.map((w) => (
                  <li key={w.id}>{w.message}</li>
                ))}
              </ul>
            )}
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
