import { fetchJadwal } from "-/lib/jadwal-sheet";
import { requirePerson } from "-/lib/person";

import { KalenderCalendar } from "./kalender-calendar";

/**
 * **Kalender** — a dedicated, full-width month view of the Programme's activity schedule: which
 * School has what on which day, drawn live from the "Jadwal" Google Sheet via `fetchJadwal` (#258),
 * not the database. Each day shows one neutral pill per School with a cell that day; clicking a day
 * opens a detail panel (a right-side aside on desktop, a bottom drawer on mobile) listing each
 * School and its verbatim schedule text.
 *
 * **`force-dynamic`** so the sheet is re-read on every visit and refresh — the schedule changes and
 * a stale cache would show the wrong day. If the fetch fails (the sheet's share was tightened, say),
 * the data layer returns its typed failure and the page renders the calendar with an inline error
 * banner and empty cells rather than a 500.
 *
 * Reading is open to any signed-in Person, so the page only calls `requirePerson()` for the shell's
 * sign-in gate and takes no money or Grant decision. `today` is the **WIB** calendar date — the
 * Programme's zone — so the grid seeds and highlights on the same day the rest of the app turns over
 * on.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePerson();
  // `en-CA` formats as `YYYY-MM-DD`; `Asia/Jakarta` pins it to WIB so the grid seeds the right month.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const result = await fetchJadwal();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Kalender</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Jadwal kegiatan Program per sekolah, dalam tampilan bulanan.
        </p>
      </header>

      <div className="px-7 py-6">
        <KalenderCalendar
          schedule={result.ok ? result.schedule : {}}
          error={result.ok ? null : result.error}
          today={today}
        />
      </div>
    </div>
  );
}
