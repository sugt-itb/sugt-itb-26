import { deriveCalendarEvents } from "-/app/(app)/_calendar/calendar-derive";
import { requirePerson } from "-/lib/person";
import { monitoringData } from "@sugt/db/queries";

import { KalenderCalendar } from "./kalender-calendar";

/**
 * **Kalender** — a dedicated, full-width month view of the Programme's scheduled activity: offline
 * Perjadin, Monev, online Sessions and the fixed Pretest/Posttest windows, each a named event in
 * the day it falls on. It reads the same feed `/monitoring`'s compact calendar does —
 * `deriveCalendarEvents(monitoringData(person))`, the pure `_calendar` core (#240) — so the two can
 * never disagree; the difference is only the layout (named pills in the cell, not dots).
 *
 * Reading is open to any signed-in Person, so the page only calls `requirePerson()` for the shell's
 * sign-in gate and takes no money or Grant decision. `today` is the **WIB** calendar date — the
 * Programme's zone, the one Session times are stored in — computed the same way `/monitoring` does,
 * so the grid seeds and highlights on the same day the rest of the app turns over on.
 *
 * The feed is still the mock `monitoringData` (real wiring deferred to #196); this page ships as
 * presentational scaffold on the same footing as `/monitoring`.
 */
export default async function Page() {
  const person = await requirePerson();
  const data = await monitoringData(person);
  // `en-CA` formats as `YYYY-MM-DD`; `Asia/Jakarta` pins it to WIB so it seeds the same month and
  // highlights the same "today" cell as `/monitoring`.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const events = deriveCalendarEvents(data);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Kalender</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Jadwal kegiatan Program — Perjadin, Monev, Sesi Daring, dan Pretest/Posttest — dalam
          tampilan bulanan.
        </p>
      </header>

      <div className="px-7 py-6">
        <KalenderCalendar
          events={events}
          today={today}
        />
      </div>
    </div>
  );
}
