"use client";

import {
  type CalendarDay,
  longDateId,
  monthGrid,
  WEEKDAY_LABELS_ID_FULL,
} from "-/app/(app)/_calendar/calendar-grid";
import { CalendarMonthNav } from "-/app/(app)/_calendar/calendar-month-nav";
import { DayEventList } from "-/app/(app)/_calendar/calendar-ui";
import { eventsOverflow } from "-/app/(app)/_calendar/events-overflow";
import { useMonthView } from "-/app/(app)/_calendar/use-month-view";
import type { JadwalEvent, JadwalSchedule } from "-/lib/jadwal-sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@sugt/ui/components/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@sugt/ui/components/sheet";
import { cn } from "@sugt/ui/lib/utils";
import { useEffect, useState } from "react";

/** Named-event pills a cell shows before it collapses the rest into "(+N)": two on desktop, none on
 *  the narrow phone column, where the "(+N)" count carries the whole day. Both counts feed the shared
 *  `eventsOverflow` helper, so the "(+N)" link never disagrees with how many pills are actually on
 *  screen. */
const PILLS_DESKTOP = 2;
const PILLS_MOBILE = 0;

/** True at the `lg` breakpoint and up. Drives the one behaviour CSS cannot express: the detail panel
 *  is a persistent aside on desktop, so a day click must NOT also open the mobile drawer there. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/**
 * **The `/kalender` month view** — a full-width, GNOME-calendar-style grid whose events come **live
 * from the Jadwal Google Sheet** (#258), not the database. Each day shows one neutral pill per
 * School with a cell that day (School name only; the old Cluster colour coding is gone — it no longer
 * maps to sheet data), collapsing to a "(+N)" link past the per-breakpoint cap.
 *
 * Clicking anywhere on a day (or the "+N" link) selects it and opens a **detail panel**: a persistent
 * right-side aside on desktop, a bottom drawer on mobile, both listing each School's name and its full
 * schedule text with line breaks preserved. Paging (‹ / › and **Hari ini**) is pure view-state via
 * the shared `_calendar` core — the sheet feed already covers every date, so it never refetches.
 * A `null` `error` renders normally; a non-null one shows an inline banner above the grid.
 */
export function KalenderCalendar({
  schedule,
  error,
  today,
}: {
  schedule: JadwalSchedule;
  error: string | null;
  today: string;
}) {
  const { view, selected, select, goToday, prevMonth, nextMonth } = useMonthView(today);
  const days = monthGrid(view, "monday");
  const isDesktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const onSelect = (date: string) => {
    select(date);
    // Desktop shows the persistent aside, so only the narrow layout opens the drawer.
    if (!isDesktop) setDrawerOpen(true);
  };

  const selectedEvents = selected ? (schedule[selected] ?? []) : [];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Card className="lg:flex-1">
        {error && (
          <div className="mx-6 mt-6 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
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
                events={schedule[day.date] ?? []}
                onSelect={() => onSelect(day.date)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Desktop: a persistent right-side detail panel that tracks the selected day. */}
      <aside className="hidden lg:block lg:w-80 lg:shrink-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base tabular-nums">
              {selected ? longDateId(selected) : "Kegiatan"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PanelBody
              date={selected}
              events={selectedEvents}
            />
          </CardContent>
        </Card>
      </aside>

      {/* Mobile / narrow: the same panel content in a bottom drawer, opened on selection. */}
      <Sheet
        open={drawerOpen && !isDesktop}
        onOpenChange={setDrawerOpen}
      >
        <SheetContent
          side="bottom"
          className="max-h-[80vh] overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle className="tabular-nums">
              {selected ? longDateId(selected) : "Kegiatan"}
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <PanelBody
              date={selected}
              events={selectedEvents}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The detail panel's body: a prompt when no day is selected, the empty-day line when the selected
 *  day has no schedule, otherwise the per-School list. Shared by the desktop aside and mobile drawer
 *  so the two never diverge. */
function PanelBody({ date, events }: { date: string | null; events: readonly JadwalEvent[] }) {
  if (!date) {
    return <p className="text-sm text-muted-foreground">Pilih tanggal untuk melihat kegiatan.</p>;
  }
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Tidak ada kegiatan pada tanggal ini.</p>;
  }
  return <DayEventList events={events} />;
}

/**
 * One month cell: the date number, then up to two School pills (none on mobile) with a
 * "(+N)" link for the rest. The whole cell is a button — clicking it, a pill or the
 * link selects the day and opens the detail panel; an empty day selects too (its panel reads "no
 * activity"), so there is no separate empty-vs-full behaviour.
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
  events: JadwalEvent[];
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

  return (
    <button
      type="button"
      aria-label={label}
      className={cellClassName}
      onClick={onSelect}
    >
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
          {/* Render the desktop set of pills; each is desktop-only (mobile cap is 0), so below `md`
              they all collapse away and the mobile "(+N)" link carries the whole day's count. */}
          {desktop.shown.map((event, i) => (
            <EventPill
              key={i}
              event={event}
              className={i >= PILLS_MOBILE ? "hidden md:block" : undefined}
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
    </button>
  );
}

/** One School pill: the School's name, in a single uniform neutral style, truncated so a long name
 *  never widens the cell. No colour coding — the sheet carries no Cluster taxonomy. */
function EventPill({ event, className }: { event: JadwalEvent; className?: string }) {
  return (
    <span className={cn("block truncate rounded bg-muted px-1 py-0.5 text-xs", className)}>
      {event.school}
    </span>
  );
}

/** The "(+N)" line beneath the pills. Presentational only — the whole cell is the button, so a tap
 *  anywhere on it (this link included) opens the day's detail panel. */
function OverflowLink({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("px-1 text-xs font-medium text-muted-foreground", className)}>
      (+{count})
    </span>
  );
}
