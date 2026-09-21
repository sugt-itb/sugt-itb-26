import type { JadwalEvent } from "-/lib/jadwal-sheet";

/**
 * **The `/kalender` day-events list** — one entry per school that has a schedule cell on the
 * selected date: the school name in bold, then that cell's full text rendered **verbatim** with its
 * line breaks preserved (`whitespace-pre-line`). It is the body of the detail panel — the desktop
 * right-side aside and the mobile bottom drawer render it identically. No hooks, no state.
 */
export function DayEventList({ events }: { events: readonly JadwalEvent[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {events.map((event, i) => (
        <li
          key={i}
          className="min-w-0"
        >
          <p className="font-medium">{event.school}</p>
          <p className="text-sm whitespace-pre-line text-muted-foreground">{event.detail}</p>
        </li>
      ))}
    </ul>
  );
}
