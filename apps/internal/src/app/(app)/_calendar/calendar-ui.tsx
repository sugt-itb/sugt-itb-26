import { cn } from "@sugt/ui/lib/utils";

import { type CalendarEvent, MARKER_FILL, MARKER_STROKE, type MarkerType } from "./calendar-derive";
import { longDateId } from "./calendar-grid";

/**
 * **The presentational atoms both calendars share** — the marker `Swatch` and the day-events
 * `<ul>`. They read colour from `MARKER_FILL` / `MARKER_STROKE` and dates from `longDateId`, so the
 * compact `/monitoring` dot calendar and the wide `/kalender` month view can never disagree on how
 * a marker looks or how an event's date reads. No hooks and no state — a plain shared module either
 * app half can render.
 */

/** A coloured marker chip — the same fill/stroke the grid dots use, from `MARKER_FILL`. Shared by
 *  the day dots, the popup rows and the legend so all three stay one source of truth for colour. */
export function Swatch({ marker, className }: { marker: MarkerType; className?: string }) {
  return (
    <span
      className={cn("rounded-full", className)}
      style={{ backgroundColor: MARKER_FILL[marker], border: `1px solid ${MARKER_STROKE}` }}
    />
  );
}

/** An event's date line: a single long-form date, or `start – end` for a range. */
export function eventDates(event: CalendarEvent): string {
  return event.endDate === null
    ? longDateId(event.startDate)
    : `${longDateId(event.startDate)} – ${longDateId(event.endDate)}`;
}

/**
 * The list of a day's events — one row per event: a `Swatch` in the event's colour, its `name`, and
 * its long-Indonesian date or date range. Ordered exactly as `deriveCalendarEvents` returns them
 * (offline → Monev → online → Pretest/Posttest), uncapped. Shared so `/monitoring`'s popover and
 * `/kalender`'s day popup render a day identically.
 */
export function DayEventList({ events }: { events: readonly CalendarEvent[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {events.map((event, i) => (
        <li
          key={i}
          className="flex items-start gap-2"
        >
          <Swatch
            marker={event.markerType}
            className="mt-1 size-2 shrink-0"
          />
          <div className="min-w-0">
            <p className="font-medium">{event.name}</p>
            <p className="text-xs text-muted-foreground tabular-nums">{eventDates(event)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
