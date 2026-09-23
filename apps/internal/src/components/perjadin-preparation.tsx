"use client";

import { togglePreparationItemAction } from "-/app/(app)/perjadin/[id]/actions";
import type { PreparationItem } from "@sugt/db/queries";
import { Checkbox } from "@sugt/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import { type ReactElement, useId, useOptimistic, useTransition } from "react";

/**
 * The Preparation Checklist — a private, hand-ticked pre-departure to-do list
 * ([#114](https://github.com/mafiefa02/sugt/issues/114)).
 *
 * **An internal-monitoring aid, and nothing more**: no money, no deadline, not a record, and
 * nothing ever ticks a box automatically. The seven fixed items are derived server-side
 * (`perjadinDetail`); this only flips them.
 *
 * Each box is **optimistic**: it flips on click, fires the toggle action, and reconciles when the
 * route revalidates. Toggling is offered to Staff only — `togglePreparationItem` re-checks the
 * role, so a professor's page renders the boxes read-only rather than trusting the client.
 *
 * **The optimistic state and the toggle live in one hook, `usePreparationChecklist`**, so the two
 * surfaces that show the checklist — the inline section on the edit page and the dashboard-card
 * dialog — run the identical toggle rather than forking it, and each surface's own count and boxes
 * read the *same* optimistic state (which is why the inline `n/N` pill flips the instant a box does,
 * not only after a revalidate). The two surfaces are never on screen together, so each mount holding
 * its own optimistic state is correct — there is nothing to keep in sync between them.
 */
function usePreparationChecklist(perjadinId: string, items: PreparationItem[]) {
  const [optimisticItems, setOptimisticChecked] = useOptimistic(
    items,
    (state, patch: { itemKey: string; checked: boolean }) =>
      state.map((item) =>
        item.itemKey === patch.itemKey ? { ...item, checked: patch.checked } : item,
      ),
  );
  const [, startToggle] = useTransition();

  function toggle(itemKey: string, checked: boolean) {
    startToggle(async () => {
      // Inside the transition so the flip and the pending state are one update, then the action —
      // its `revalidatePath` re-reads the real state and `useOptimistic` falls back to it.
      setOptimisticChecked({ itemKey, checked });
      await togglePreparationItemAction(perjadinId, itemKey, checked);
    });
  }

  return { items: optimisticItems, toggle };
}

/** The checkbox list itself — presentational, over the optimistic items and toggle the hook owns. */
function PreparationChecklist({
  items,
  canToggle,
  onToggle,
}: {
  items: PreparationItem[];
  canToggle: boolean;
  onToggle: (itemKey: string, checked: boolean) => void;
}) {
  const fields = useId();

  return (
    <ul className="mt-2.5 space-y-1.5">
      {items.map((item) => {
        const id = `${fields}-${item.itemKey}`;
        return (
          <li
            key={item.itemKey}
            className="flex items-center gap-2.5 text-sm"
          >
            <Checkbox
              id={id}
              checked={item.checked}
              disabled={!canToggle}
              onCheckedChange={(checked) => {
                onToggle(item.itemKey, checked === true);
              }}
            />
            <label
              htmlFor={id}
              className={canToggle ? "cursor-pointer" : undefined}
            >
              {item.label}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The inline section on the Perjadin edit page — the framed block with its heading and `done/total`
 * count, wrapping the shared checklist. The count reads the hook's **optimistic** items, so it flips
 * with the box on click and reconciles against server state on revalidate, exactly as before.
 */
function PerjadinPreparation({
  perjadinId,
  items,
  canToggle,
}: {
  perjadinId: string;
  items: PreparationItem[];
  canToggle: boolean;
}) {
  const { items: optimisticItems, toggle } = usePreparationChecklist(perjadinId, items);
  const done = optimisticItems.filter((item) => item.checked).length;
  const total = optimisticItems.length;

  return (
    <div className="border-b border-border px-7 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-medium">Persiapan</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {done}/{total}
        </span>
      </div>

      <PreparationChecklist
        items={optimisticItems}
        canToggle={canToggle}
        onToggle={toggle}
      />
    </div>
  );
}

/**
 * The same checklist as a dialog, opened from a caller's own control — the dashboard card's
 * "Persiapan n/7" pill. `trigger` is required because there is no default surface for it here; the
 * pill is the whole reason this variant exists. Live check/uncheck runs through the same
 * `usePreparationChecklist` hook as the inline section, so the toggle is not forked.
 */
function PerjadinPreparationDialog({
  perjadinId,
  items,
  canToggle,
  trigger,
}: {
  perjadinId: string;
  items: PreparationItem[];
  canToggle: boolean;
  trigger: ReactElement;
}) {
  const { items: optimisticItems, toggle } = usePreparationChecklist(perjadinId, items);

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Persiapan</DialogTitle>
        </DialogHeader>

        <PreparationChecklist
          items={optimisticItems}
          canToggle={canToggle}
          onToggle={toggle}
        />
      </DialogContent>
    </Dialog>
  );
}

export { PerjadinPreparation, PerjadinPreparationDialog };
