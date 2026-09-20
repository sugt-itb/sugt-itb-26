"use client";

import { type CalendarEvent, MARKER_FILL } from "-/app/(app)/_calendar/calendar-derive";
import {
  type CalendarDay,
  longDateId,
  monthGrid,
  WEEKDAY_LABELS_ID_FULL,
} from "-/app/(app)/_calendar/calendar-grid";
import { CalendarMonthNav } from "-/app/(app)/_calendar/calendar-month-nav";
import { DayEventList, Swatch } from "-/app/(app)/_calendar/calendar-ui";
import { eventsOverflow } from "-/app/(app)/_calendar/events-overflow";
import { useMonthView } from "-/app/(app)/_calendar/use-month-view";
import { Card, CardContent } from "@sugt/ui/components/card";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@sugt/ui/components/popover";
import { cn } from "@sugt/ui/lib/utils";

/** Named-event pills a cell shows before it collapses the rest into "+N": three on desktop, one on
 *  the narrow phone column where three would not fit. Both counts feed the shared `eventsOverflow`
 *  helper, so the "+N" link never disagrees with how many pills are actually on screen. */
const PILLS_DESKTOP = 3;
const PILLS_MOBILE = 1;

/**
 * **The `/kalender` month view** — the full-width, GNOME-calendar-style sibling of `/monitoring`'s
 * compact dot grid. It reads the same `date → events` feed the shared `_calendar` core derives, so
 * the two calendars can never disagree, and shows each day's events as named, colour-swatched pills
 * inside the cell (with a "Lihat lebih banyak (+N)" link when a day carries more than fit). Like
 * `/monitoring` it owns only the month on view (‹ / › and **Hari ini** page it with the pure
 * `addMonths`/`monthOf` seam — the feed already covers every date, so paging never refetches) and
 * the one selected date. Monday-first, with the full Indonesian weekday bar.
 */
export function KalenderCalendar({
  events,
  today,
}: {
  events: Record<string, CalendarEvent[]>;
  today: string;
}) {
  const { view, selected, select, goToday, prevMonth, nextMonth } = useMonthView(today);
  const days = monthGrid(view, "monday");

  return (
    <Card>
      <CalendarMonthNav
        view={view}
        onToday={goToday}
        onPrev={prevMonth}
        onNext={nextMonth}
      />
      <CardContent>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS_ID_FULL.map((label, i) => (
            <div
              key={i}
              className="truncate pb-1 text-center text-xs font-medium text-muted-foreground"
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
              events={events[day.date] ?? []}
              onSelect={() => select(day.date)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One month cell: the date number, then up to three named event pills (one on mobile) with a
 * "Lihat lebih banyak (+N)" link for the rest. A day with events is a Popover trigger — clicking the
 * cell, a pill or the link opens an anchored popup listing every event; an empty day is still a
 * selecting button but opens no popup, matching `/monitoring`.
 */
function DayCell({
  day,
  isToday,
  isSelected,
  events,
  onSelect,
}: {
  day: CalendarDay;
  isToday: boolean;
  isSelected: boolean;
  events: CalendarEvent[];
  onSelect: () => void;
}) {
  const cellClassName = cn(
    "flex min-h-16 w-full min-w-0 cursor-pointer flex-col gap-1 rounded-md p-1 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-24",
    isSelected && "bg-accent ring-1 ring-primary",
  );
  // The two breakpoint caps, each via the shared helper so a pill count and its "+N" never drift.
  const desktop = eventsOverflow(events, PILLS_DESKTOP);
  const mobile = eventsOverflow(events, PILLS_MOBILE);
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
      {events.length > 0 && (
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* Render the desktop set of pills; the ones past the first collapse away on mobile, where
              the one-pill cap and the mobile "+N" link take over. */}
          {desktop.shown.map((event, i) => (
            <EventPill
              key={i}
              event={event}
              className={i >= PILLS_MOBILE ? "hidden md:flex" : undefined}
            />
          ))}
          {mobile.overflow > 0 && (
            <OverflowLink
              count={mobile.overflow}
              className="md:hidden"
            />
          )}
          {desktop.overflow > 0 && (
            <OverflowLink
              count={desktop.overflow}
              className="hidden md:block"
            />
          )}
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

  // Day with events — the cell is the Popover trigger; clicking it (or a pill, or the "+N" link)
  // selects the day and opens the anchored popup. Base UI takes a custom trigger via `render`.
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
      {/* `w-72` can overflow a ~360px phone; cap it to the viewport so the popup always fits. */}
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] gap-3">
        <PopoverHeader>
          <PopoverTitle className="tabular-nums">{longDateId(day.date)}</PopoverTitle>
        </PopoverHeader>
        <DayEventList events={events} />
      </PopoverContent>
    </Popover>
  );
}

/** One named event pill: a colour swatch and the event's name, truncated with an ellipsis so a long
 *  name never widens the cell. Coloured from `MARKER_FILL` via the shared `Swatch`. */
function EventPill({ event, className }: { event: CalendarEvent; className?: string }) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 rounded bg-muted px-1 py-0.5 text-xs",
        className,
      )}
      style={{ borderLeft: `2px solid ${MARKER_FILL[event.markerType]}` }}
    >
      <Swatch
        marker={event.markerType}
        className="size-1.5 shrink-0"
      />
      <span className="truncate">{event.name}</span>
    </span>
  );
}

/** The "Lihat lebih banyak (+N)" line beneath the pills. Presentational only — the whole cell is the
 *  Popover trigger, so a tap anywhere on it (this link included) opens the day's full list. */
function OverflowLink({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("px-1 text-xs font-medium text-muted-foreground", className)}>
      Lihat lebih banyak (+{count})
    </span>
  );
}
