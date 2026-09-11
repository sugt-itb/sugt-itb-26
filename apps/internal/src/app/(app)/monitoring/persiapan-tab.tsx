"use client";

import type { PreparationCard, PreparationChecklistItem } from "@sugt/db/queries";
import {
  MAX_PREPARATION_CHECKLIST_ITEMS,
  PREPARATION_JENIS,
  type PreparationJenis,
} from "@sugt/domain";
import { Badge } from "@sugt/ui/components/badge";
import { Button } from "@sugt/ui/components/button";
import { Card, CardContent, CardHeader } from "@sugt/ui/components/card";
import { Checkbox } from "@sugt/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { GripVerticalIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useMemo, useOptimistic, useRef, useState, useTransition } from "react";

import {
  addChecklistItemAction,
  createPreparationCardAction,
  deletePreparationCardAction,
  editPreparationCardAction,
  removeChecklistItemAction,
  reorderChecklistItemsAction,
  setChecklistItemCheckedAction,
} from "./preparation-actions";
import { preparationPercent } from "./preparation-derive";

/**
 * **The /monitoring Persiapan tab** — the free-standing Preparation Cards (#221, ADR-0028), a Card
 * being a title, a Jenis, a date or date-range, and a hand-ticked checklist that is *not* the
 * Perjadin Preparation Checklist (ADR-0018). The cards arrive read from the server; nothing here
 * fetches.
 *
 * **The Grant is the gate; `canEdit` is the courtesy.** `canEdit` is `hasGrant(person, "Monitoring
 * Editor")`, computed on the server. When false this is read-only — no "Persiapan Baru", no "Edit",
 * checkboxes disabled — but the Server Actions re-check the Grant regardless (a layout does not run
 * before a Server Action), so hiding the controls only spares a non-holder a 403 they would hit
 * anyway.
 *
 * **Two client-side sorts, no refetch.** "Urutkan" reorders the loaded cards in place — by nearest
 * date, or by lowest completion (the pure `preparationPercent` fold) so the least-ready cards rise.
 * The list read already arrives date-ascending, so that is the default and its own option.
 */

/** The two client-side orderings, in Indonesian. Nearest-date is the default and the read's order. */
type SortKey = "tanggal" | "persiapan";

const SORT_OPTIONS: Record<SortKey, string> = {
  tanggal: "Tanggal: Terdekat",
  persiapan: "Persiapan: Terendah",
};

function PersiapanTab({ cards, canEdit }: { cards: PreparationCard[]; canEdit: boolean }) {
  const [sort, setSort] = useState<SortKey>("tanggal");

  const sortedCards = useMemo(() => {
    const copy = [...cards];
    if (sort === "persiapan") {
      // Least-ready first — the reading the tab wants, so the cards needing work rise to the top.
      copy.sort((a, b) => preparationPercent(a.items) - preparationPercent(b.items));
    } else {
      // Nearest date first — a plain string compare, since `startsOn` is `YYYY-MM-DD`.
      copy.sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0));
    }
    return copy;
  }, [cards, sort]);

  return (
    <div className="flex flex-col gap-5 px-7 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          items={SORT_OPTIONS}
          value={sort}
          onValueChange={(value) => {
            setSort(value as SortKey);
          }}
        >
          <SelectTrigger aria-label="Urutkan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(SORT_OPTIONS) as [SortKey, string][]).map(([key, label]) => (
              <SelectItem
                key={key}
                value={key}
              >
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canEdit && <CardFormDialog mode="create" />}
      </div>

      {sortedCards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada Persiapan.</p>
      ) : (
        <ul className="space-y-3">
          {sortedCards.map((card) => (
            <li key={card.id}>
              <PreparationCardView
                card={card}
                canEdit={canEdit}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The circumference of the ring's arc, so the dash offset is a fraction of the whole stroke. */
const RING_RADIUS = 16;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * **The completion ring.** An SVG donut whose arc is a fraction of the circumference — grey when a
 * Card has done none of its checklist, amber while partway, green at 100%. The number sits in the
 * middle. `percent` is the pure `preparationPercent` fold, so the ring recomputes from whatever
 * items it is handed — including the optimistic set while a box is mid-flip.
 */
function PreparationRing({ percent }: { percent: number }) {
  const colorClass =
    percent >= 100
      ? "text-emerald-600 dark:text-emerald-500"
      : percent > 0
        ? "text-amber-500"
        : "text-muted-foreground/40";

  return (
    <div
      className="relative size-12 shrink-0"
      role="img"
      aria-label={`${percent}% selesai`}
    >
      <svg
        viewBox="0 0 36 36"
        className="size-full -rotate-90"
      >
        <circle
          cx="18"
          cy="18"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          className="stroke-muted"
        />
        {percent > 0 && (
          <circle
            cx="18"
            cy="18"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            stroke="currentColor"
            className={colorClass}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-medium tabular-nums">
        {percent}
      </span>
    </div>
  );
}

/**
 * One Preparation Card on the tab: the completion ring, the title, the Kegiatan date (single or a
 * range), a Jenis pill, and the checklist — with "Edit" in the corner for a holder.
 *
 * **Ticking is optimistic and live-re-sorts.** The boxes read a `useOptimistic` copy of the items;
 * a click flips the box, moves it between the unchecked-top and checked-bottom groups, and moves the
 * ring — all before the action's `revalidatePath` re-reads the real order. The list is (re)sorted
 * `(checked, position)` on every render, the same order the read hands down, so the optimistic flip
 * and the server truth agree.
 */
function PreparationCardView({ card, canEdit }: { card: PreparationCard; canEdit: boolean }) {
  const [optimisticItems, patchChecked] = useOptimistic(
    card.items,
    (state, patch: { itemId: string; checked: boolean }) =>
      state.map((item) => (item.id === patch.itemId ? { ...item, checked: patch.checked } : item)),
  );
  const [, startToggle] = useTransition();
  const fieldPrefix = useId();

  function toggle(itemId: string, checked: boolean) {
    startToggle(async () => {
      patchChecked({ itemId, checked });
      await setChecklistItemCheckedAction(itemId, checked);
    });
  }

  // Unchecked first (by editor position), then checked — the read's `(checked, position)` order,
  // recomputed here so an optimistic flip re-sorts the row without waiting on the server.
  const sortedItems = [...optimisticItems].sort(
    (a, b) => Number(a.checked) - Number(b.checked) || a.position - b.position,
  );
  const percent = preparationPercent(optimisticItems);

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start gap-4">
          <PreparationRing percent={percent} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{card.title}</span>
              <Badge variant="secondary">{card.jenis}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {card.endsOn === null ? card.startsOn : `${card.startsOn} – ${card.endsOn}`}
            </p>
          </div>
          {canEdit && (
            <CardFormDialog
              mode="edit"
              card={card}
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {sortedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada checklist.</p>
        ) : (
          <ul className="space-y-1.5">
            {sortedItems.map((item) => {
              const id = `${fieldPrefix}-${item.id}`;
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 text-sm"
                >
                  <Checkbox
                    id={id}
                    checked={item.checked}
                    disabled={!canEdit}
                    onCheckedChange={(checked) => {
                      toggle(item.id, checked === true);
                    }}
                  />
                  <label
                    htmlFor={id}
                    className={`${canEdit ? "cursor-pointer " : ""}${
                      item.checked ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {item.label}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** A draft checklist line on the create form — a label with no id yet; the write numbers them. */
type DraftItem = string;

/**
 * **The create/edit popup.** One dialog in two modes, since the fields — Judul, the Tanggal /
 * Rentang tanggal pair, and Jenis — are identical; only the checklist and the save path differ.
 *
 * **Create batches; edit is incremental.** On create the checklist is a list of plain labels sent
 * inline with `createPreparationCardAction` in one write. On edit the Card's own fields save through
 * `editPreparationCardAction`, but each checklist change is its own guarded action against real item
 * ids — add, remove, and drag-reorder of the *unchecked* items — and edit alone can delete the Card.
 * The `mode` prop is discriminated so `card` is present exactly when editing.
 */
function CardFormDialog(props: { mode: "create" } | { mode: "edit"; card: PreparationCard }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger
        render={
          props.mode === "create" ? (
            <Button size="sm">
              <PlusIcon />
              Persiapan Baru
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
            >
              Edit
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.mode === "create" ? "Persiapan Baru" : "Edit Persiapan"}</DialogTitle>
        </DialogHeader>

        {props.mode === "create" ? (
          <CreateCardForm onDone={() => setOpen(false)} />
        ) : (
          <EditCardForm
            card={props.card}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The shared header fields — Judul, the Tanggal / Rentang tanggal pair, Jenis. Both forms drive the
 * same controlled shape, so the popup looks identical whichever mode it is in. `range` toggles
 * between a single "Tanggal" and a "Mulai"/"Selesai" pair using native date inputs; unchecking it
 * drops the end date at save.
 */
type CardFields = {
  title: string;
  range: boolean;
  startsOn: string;
  endsOn: string;
  jenis: PreparationJenis;
};

function CardFieldset({
  fields,
  onChange,
}: {
  fields: CardFields;
  onChange: (patch: Partial<CardFields>) => void;
}) {
  const titleId = useId();
  const rangeId = useId();
  const startId = useId();
  const endId = useId();
  const jenisId = useId();

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor={titleId}>Judul Persiapan</Label>
        <Input
          id={titleId}
          value={fields.title}
          onChange={(event) => {
            onChange({ title: event.target.value });
          }}
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center gap-2.5">
          <Checkbox
            id={rangeId}
            checked={fields.range}
            onCheckedChange={(checked) => {
              onChange({ range: checked === true });
            }}
          />
          <Label
            htmlFor={rangeId}
            className="cursor-pointer font-normal"
          >
            Rentang tanggal
          </Label>
        </div>

        {fields.range ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={startId}>Tanggal Mulai</Label>
              <Input
                id={startId}
                type="date"
                value={fields.startsOn}
                onChange={(event) => {
                  onChange({ startsOn: event.target.value });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={endId}>Tanggal Selesai</Label>
              <Input
                id={endId}
                type="date"
                min={fields.startsOn || undefined}
                value={fields.endsOn}
                onChange={(event) => {
                  onChange({ endsOn: event.target.value });
                }}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor={startId}>Tanggal</Label>
            <Input
              id={startId}
              type="date"
              value={fields.startsOn}
              onChange={(event) => {
                onChange({ startsOn: event.target.value });
              }}
            />
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={jenisId}>Jenis</Label>
        <Select
          items={Object.fromEntries(PREPARATION_JENIS.map((jenis) => [jenis, jenis]))}
          value={fields.jenis}
          onValueChange={(value) => {
            onChange({ jenis: value as PreparationJenis });
          }}
        >
          <SelectTrigger
            id={jenisId}
            aria-label="Jenis"
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PREPARATION_JENIS.map((jenis) => (
              <SelectItem
                key={jenis}
                value={jenis}
              >
                {jenis}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Turn the controlled fields into the write's input — the end date drops when the range is off. */
function toInput(fields: CardFields) {
  return {
    title: fields.title,
    jenis: fields.jenis,
    startsOn: fields.startsOn,
    endsOn: fields.range ? fields.endsOn : null,
  };
}

/** True while a required field is blank — the submit guard the write also enforces server-side. */
function fieldsIncomplete(fields: CardFields): boolean {
  return (
    fields.title.trim() === "" || fields.startsOn === "" || (fields.range && fields.endsOn === "")
  );
}

/**
 * The create form. The checklist is a list of plain labels, added one at a time and capped at
 * `MAX_PREPARATION_CHECKLIST_ITEMS`; nothing is written until "Buat", which sends the fields and the
 * labels in one `createPreparationCardAction`. A refusal (blank title, too many items) comes back as
 * a value and is shown inline; on success the dialog closes.
 */
function CreateCardForm({ onDone }: { onDone: () => void }) {
  const [fields, setFields] = useState<CardFields>({
    title: "",
    range: false,
    startsOn: "",
    endsOn: "",
    jenis: PREPARATION_JENIS[0],
  });
  const [items, setItems] = useState<DraftItem[]>([]);
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const draftId = useId();

  const atCap = items.length >= MAX_PREPARATION_CHECKLIST_ITEMS;

  function addDraft() {
    const label = draft.trim();
    if (label === "" || atCap) return;
    setItems((previous) => [...previous, label]);
    setDraft("");
  }

  function submit() {
    startSaving(async () => {
      const result = await createPreparationCardAction({
        ...toInput(fields),
        items: items.map((label) => label.trim()).filter((label) => label !== ""),
      });
      if (result.outcome === "created") {
        onDone();
        return;
      }
      setRefusal(refusalMessage(result.outcome));
    });
  }

  return (
    <div className="grid gap-5">
      <CardFieldset
        fields={fields}
        onChange={(patch) => {
          setFields((previous) => ({ ...previous, ...patch }));
        }}
      />

      <div className="grid gap-2">
        <Label htmlFor={draftId}>Checklist</Label>
        <div className="flex gap-2">
          <Input
            id={draftId}
            placeholder="Tambah checklist"
            value={draft}
            disabled={atCap}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDraft();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={draft.trim() === "" || atCap}
            onClick={addDraft}
          >
            Tambah checklist
          </Button>
        </div>
        {atCap && (
          <p className="text-xs text-muted-foreground">
            Maksimal {MAX_PREPARATION_CHECKLIST_ITEMS} checklist.
          </p>
        )}

        {items.length > 0 && (
          <ul className="mt-1 space-y-1.5">
            {items.map((label, index) => (
              <li
                // The list only grows at the end or shrinks by removal, so a positional key is stable.
                key={`draft-${index}`}
                className="flex items-center gap-2 text-sm"
              >
                <span className="flex-1">{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Hapus ${label}`}
                  onClick={() => {
                    setItems((previous) => previous.filter((_, i) => i !== index));
                  }}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {refusal !== null && <p className="text-sm text-destructive">{refusal}</p>}

      <DialogFooter>
        <Button
          disabled={fieldsIncomplete(fields) || saving}
          onClick={submit}
        >
          {saving ? "Menyimpan…" : "Buat"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * The edit form. The Card's own fields save through `editPreparationCardAction` on "Simpan"; the
 * checklist is edited in place against real item ids — add and remove through their actions, and the
 * **unchecked** items drag-reorder via native HTML5 drag, committing the new order with
 * `reorderChecklistItemsAction`. Checked items are shown but are neither draggable nor part of the
 * reorder, matching the write, which only ever renumbers unchecked rows. "Hapus Persiapan" deletes
 * the whole Card. Each item action revalidates `/monitoring`, so the `card` prop reflows and the
 * transient drag order falls back to the server truth.
 */
function EditCardForm({ card, onDone }: { card: PreparationCard; onDone: () => void }) {
  const [fields, setFields] = useState<CardFields>({
    title: card.title,
    range: card.endsOn !== null,
    startsOn: card.startsOn,
    endsOn: card.endsOn ?? "",
    jenis: card.jenis,
  });
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  // While a drag is mid-flight this holds the unchecked ids in their new order; null falls back to
  // the server order (which the reorder's revalidate makes authoritative once it lands).
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const draggingId = useRef<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [itemPending, startItemAction] = useTransition();
  const draftId = useId();

  const byId = new Map(card.items.map((item) => [item.id, item]));
  const uncheckedIds =
    dragOrder ?? card.items.filter((item) => !item.checked).map((item) => item.id);
  const uncheckedItems = uncheckedIds
    .map((id) => byId.get(id))
    .filter((item): item is PreparationChecklistItem => item !== undefined);
  const checkedItems = card.items.filter((item) => item.checked);
  const atCap = card.items.length >= MAX_PREPARATION_CHECKLIST_ITEMS;

  function saveFields() {
    startSaving(async () => {
      const result = await editPreparationCardAction(card.id, toInput(fields));
      if (result.outcome === "updated") {
        onDone();
        return;
      }
      setRefusal(refusalMessage(result.outcome));
    });
  }

  function addItem() {
    const label = draft.trim();
    if (label === "" || atCap) return;
    startItemAction(async () => {
      const result = await addChecklistItemAction(card.id, label);
      if (result.outcome === "added") setDraft("");
      else setRefusal(refusalMessage(result.outcome));
    });
  }

  function removeItem(itemId: string) {
    startItemAction(async () => {
      await removeChecklistItemAction(itemId);
    });
  }

  /** Drop the dragged unchecked row onto `targetId`'s slot, then persist the new unchecked order. */
  function dropOnto(targetId: string) {
    const sourceId = draggingId.current;
    draggingId.current = null;
    if (sourceId === null || sourceId === targetId) return;

    const order = [...uncheckedIds];
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, sourceId);
    setDragOrder(order);

    startItemAction(async () => {
      await reorderChecklistItemsAction(card.id, order);
      setDragOrder(null);
    });
  }

  function deleteCard() {
    startSaving(async () => {
      const result = await deletePreparationCardAction(card.id);
      if (result.outcome === "deleted") {
        onDone();
        return;
      }
      setRefusal(refusalMessage(result.outcome));
    });
  }

  return (
    <div className="grid gap-5">
      <CardFieldset
        fields={fields}
        onChange={(patch) => {
          setFields((previous) => ({ ...previous, ...patch }));
        }}
      />

      <div className="grid gap-2">
        <Label htmlFor={draftId}>Checklist</Label>
        <div className="flex gap-2">
          <Input
            id={draftId}
            placeholder="Tambah checklist"
            value={draft}
            disabled={atCap || itemPending}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addItem();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={draft.trim() === "" || atCap || itemPending}
            onClick={addItem}
          >
            Tambah checklist
          </Button>
        </div>
        {atCap && (
          <p className="text-xs text-muted-foreground">
            Maksimal {MAX_PREPARATION_CHECKLIST_ITEMS} checklist.
          </p>
        )}

        {(uncheckedItems.length > 0 || checkedItems.length > 0) && (
          <ul className="mt-1 space-y-1.5">
            {uncheckedItems.map((item) => (
              <li
                key={item.id}
                draggable
                onDragStart={() => {
                  draggingId.current = item.id;
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={() => {
                  dropOnto(item.id);
                }}
                className="flex items-center gap-2 rounded-2xl bg-muted/40 px-2.5 py-1.5 text-sm"
              >
                <GripVerticalIcon className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                <span className="flex-1">{item.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Hapus ${item.label}`}
                  disabled={itemPending}
                  onClick={() => {
                    removeItem(item.id);
                  }}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
            {checkedItems.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 px-2.5 py-1.5 text-sm"
              >
                {/* Checked rows keep their place at the bottom and are not draggable — the write
                    only ever renumbers unchecked items. */}
                <span className="flex-1 text-muted-foreground line-through">{item.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Hapus ${item.label}`}
                  disabled={itemPending}
                  onClick={() => {
                    removeItem(item.id);
                  }}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {refusal !== null && <p className="text-sm text-destructive">{refusal}</p>}

      <DialogFooter className="sm:justify-between">
        <Button
          variant="destructive"
          disabled={saving}
          onClick={deleteCard}
        >
          Hapus Persiapan
        </Button>
        <Button
          disabled={fieldsIncomplete(fields) || saving}
          onClick={saveFields}
        >
          {saving ? "Menyimpan…" : "Simpan"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** The reachable write refusals as a one-line message; the missing-Grant case throws, not returns. */
function refusalMessage(outcome: string): string {
  switch (outcome) {
    case "title-required":
      return "Judul Persiapan wajib diisi.";
    case "label-required":
      return "Checklist tidak boleh kosong.";
    case "too-many-items":
      return `Checklist terlalu banyak: maksimal ${MAX_PREPARATION_CHECKLIST_ITEMS}.`;
    case "no-such-card":
      return "Persiapan sudah tidak ada — muat ulang halaman.";
    case "no-such-item":
      return "Checklist sudah tidak ada — muat ulang halaman.";
    default:
      return "Tidak dapat menyimpan.";
  }
}

export { PersiapanTab };
