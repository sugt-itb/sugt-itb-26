"use client";

import { type CalendarEvent, type MarkerType } from "-/app/(app)/_calendar/calendar-derive";
import {
  addMonths,
  type CalendarDay,
  longDateId,
  monthGrid,
  monthOf,
  monthTitle,
  WEEKDAY_LABELS,
} from "-/app/(app)/_calendar/calendar-grid";
import { DayEventList, Swatch } from "-/app/(app)/_calendar/calendar-ui";
import { Button } from "@sugt/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sugt/ui/components/card";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@sugt/ui/components/popover";
import { cn } from "@sugt/ui/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * The `/monitoring` Calendar — a static month grid of the scheduled activity `calendar-derive.ts`
 * folds into a `date → markers` map (the dots) and a `date → events` map (the popup rows). It owns
 * two pieces of client state: the month on view (seeded from the server's WIB "today"; ‹ / › and
 * **Hari ini** page it with pure `addMonths`/`monthOf`) and the one selected date. Because both maps
 * already cover every date in the data, paging is view-state only with no refetch. Everything
 * date-shaped is computed by the tested `calendar-grid.ts` seam; this component lays the cells out,
 * draws the dots, and — for a day that has events — anchors a popup listing them.
 */
export function MonitoringCalendar({
  markers,
  events,
  today,
}: {
  markers: Record<string, MarkerType[]>;
  events: Record<string, CalendarEvent[]>;
  today: string;
}) {
  const [view, setView] = useState(() => monthOf(today));
  // Exactly one selected date at a time, or none. The highlight persists across ‹ / › and **Hari
  // ini** — paging never clears it — so a date picked in one month stays lit if the operator returns.
  const [selected, setSelected] = useState<string | null>(null);
  const days = monthGrid(view);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base tabular-nums">{monthTitle(view)}</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView(monthOf(today))}
          >
            Hari ini
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Bulan sebelumnya"
            onClick={() => setView((v) => addMonths(v, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Bulan berikutnya"
            onClick={() => setView((v) => addMonths(v, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="pb-1 text-center text-xs font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}
          {days.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              isToday={day.date === today}
              isSelected={day.date === selected}
              markers={markers[day.date] ?? []}
              events={events[day.date] ?? []}
              onSelect={() => setSelected(day.date)}
            />
          ))}
        </div>
        <Legend />
      </CardContent>
    </Card>
  );
}

/**
 * One day: a clickable cell showing its date number (greyed off-month, circled when it is WIB today)
 * with the day's marker dots beneath in up to two rows of four. Clicking any cell selects it (a
 * persistent ring). A cell that has **events** is a Popover trigger — clicking it also opens an
 * anchored popup listing every event; a cell with none shows the highlight and no popup.
 */
function DayCell({
  day,
  isToday,
  isSelected,
  markers,
  events,
  onSelect,
}: {
  day: CalendarDay;
  isToday: boolean;
  isSelected: boolean;
  markers: MarkerType[];
  events: CalendarEvent[];
  onSelect: () => void;
}) {
  const cellClassName = cn(
    "flex min-h-14 cursor-pointer flex-col items-center gap-1 rounded-md py-1 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    isSelected && "bg-accent ring-1 ring-primary",
  );
  const label = `${day.dayNumber}${events.length > 0 ? `, ${events.length} kegiatan` : ""}`;
  const inner = (
    <>
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-sm tabular-nums",
          // Grey only a spillover day that is not today, so today's own colour is never in a
          // class-order race with the muted spillover colour.
          !day.inMonth && !isToday && "text-muted-foreground/50",
          isToday && "border border-primary font-medium text-primary",
        )}
      >
        {day.dayNumber}
      </span>
      {markers.length > 0 && (
        <div className="grid w-fit grid-cols-4 gap-0.5">
          {markers.map((marker, i) => (
            <Swatch
              key={i}
              marker={marker}
              className="size-1.5"
            />
          ))}
        </div>
      )}
    </>
  );

  // Empty day — a plain selecting button, never a popup.
  if (events.length === 0) {
    return (
      <button
        type="button"
        aria-label={label}
        className={cellClassName}
        onClick={onSelect}
      >
        {inner}
      </button>
    );
  }

  // Day with events — the cell is the Popover trigger; clicking it selects the day and opens the
  // anchored popup. Base UI takes a custom trigger via `render`, not `asChild`.
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cellClassName}
            onClick={onSelect}
          />
        }
      >
        {inner}
      </PopoverTrigger>
      <PopoverContent className="w-72 gap-3">
        <PopoverHeader>
          <PopoverTitle className="tabular-nums">{longDateId(day.date)}</PopoverTitle>
        </PopoverHeader>
        <DayEventList events={events} />
      </PopoverContent>
    </Popover>
  );
}

/** The four Cluster indices, in matrix order, for the two per-Cluster legend rows. */
const CLUSTER_INDICES = [1, 2, 3, 4] as const;

/**
 * The grouped legend, below the grid: the four offline Cluster colours ("Perjadin (Luring)"), the
 * four online Cluster colours ("Sesi Daring"), then Monev (grey) and Pretest/Posttest (white). Every
 * swatch reads its colour from `MARKER_FILL` via `Swatch`, so the legend can never drift from the
 * dots. Rows wrap on narrow screens.
 */
function Legend() {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs">
      <LegendRow label="Perjadin (Luring)">
        {CLUSTER_INDICES.map((n) => (
          <LegendSwatch
            key={n}
            marker={`offline-cluster-${n}` as MarkerType}
            label={`Klaster ${n}`}
          />
        ))}
      </LegendRow>
      <LegendRow label="Sesi Daring">
        {CLUSTER_INDICES.map((n) => (
          <LegendSwatch
            key={n}
            marker={`online-cluster-${n}` as MarkerType}
            label={`Klaster ${n}`}
          />
        ))}
      </LegendRow>
      <LegendRow label="Monev">
        <Swatch
          marker="monev"
          className="size-2.5"
        />
      </LegendRow>
      <LegendRow label="Pretest/Posttest">
        <Swatch
          marker="pretest-posttest"
          className="size-2.5"
        />
      </LegendRow>
    </div>
  );
}

/** One legend group: a muted group label and its wrapping row of swatches. */
function LegendRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1">{children}</div>
    </div>
  );
}

/** A swatch beside its label, one legend entry. */
function LegendSwatch({ marker, label }: { marker: MarkerType; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Swatch
        marker={marker}
        className="size-2.5"
      />
      {label}
    </span>
  );
}
