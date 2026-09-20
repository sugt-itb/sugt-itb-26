import { Button } from "@sugt/ui/components/button";
import { CardHeader, CardTitle } from "@sugt/ui/components/card";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { type CalendarMonth, monthTitle } from "./calendar-grid";

/**
 * **The shared month-calendar header** — the Indonesian month/year title and the **Hari ini** / ‹ / ›
 * paging cluster, identical on `/monitoring`'s dot grid and `/kalender`'s pill grid so an
 * aria-label, a restyle or a new control lands in one place rather than drifting between two. The
 * navigation itself lives in `useMonthView`; this only renders it. Sits inside a `Card` as its
 * `CardHeader`.
 */
export function CalendarMonthNav({
  view,
  onToday,
  onPrev,
  onNext,
}: {
  view: CalendarMonth;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
      <CardTitle className="text-base tabular-nums">{monthTitle(view)}</CardTitle>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onToday}
        >
          Hari ini
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Bulan sebelumnya"
          onClick={onPrev}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Bulan berikutnya"
          onClick={onNext}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </CardHeader>
  );
}
