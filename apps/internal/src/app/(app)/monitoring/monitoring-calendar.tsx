"use client";

import { Button } from "@sugt/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sugt/ui/components/card";
import { cn } from "@sugt/ui/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { MARKER_FILL, MARKER_STROKE, type MarkerType } from "./calendar-derive";
import {
  addMonths,
  type CalendarDay,
  monthGrid,
  monthOf,
  monthTitle,
  WEEKDAY_LABELS,
} from "./calendar-grid";

/**
 * The `/monitoring` Calendar — a static month grid of the scheduled activity `calendar-derive.ts`
 * folded into a `date → markers` map. It owns **one** piece of client state, the month on view,
 * seeded from the server's WIB "today"; ‹ / › page it with pure `addMonths`, and because the marker
 * map already covers every date in the data, paging is view-state only with no refetch (an empty
 * month is simply a blank grid). Everything date-shaped is computed by the tested `calendar-grid.ts`
 * seam; this component only lays the cells out and draws the dots.
 */
export function MonitoringCalendar({
  markers,
  today,
}: {
  markers: Record<string, MarkerType[]>;
  today: string;
}) {
  const [view, setView] = useState(() => monthOf(today));
  const days = monthGrid(view);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base tabular-nums">{monthTitle(view)}</CardTitle>
        <div className="flex items-center gap-1">
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
      <CardContent>
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
              markers={markers[day.date] ?? []}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** One day: its date number (greyed off-month, circled when it is WIB today) with the day's markers
 *  laid out beneath in up to two rows of four. */
function DayCell({
  day,
  isToday,
  markers,
}: {
  day: CalendarDay;
  isToday: boolean;
  markers: MarkerType[];
}) {
  return (
    <div className="flex min-h-14 flex-col items-center gap-1 py-1">
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
            <span
              key={i}
              className="size-1.5 rounded-full"
              style={{ backgroundColor: MARKER_FILL[marker], border: `1px solid ${MARKER_STROKE}` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
