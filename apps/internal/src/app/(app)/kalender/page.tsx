import { fetchJadwal } from "-/lib/jadwal-sheet";
import { requirePerson } from "-/lib/person";
import type { Metadata } from "next";

import { KalenderCalendar } from "./kalender-calendar";

export const metadata: Metadata = { title: "Kalender" };

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
 *
 * **On desktop (`lg+`) this page is fit-to-viewport, which diverges from the app-wide pattern**
 * (#278): every other internal page is `flex min-h-full flex-col` and scrolls at the document level,
 * but here the page root clamps to `h-dvh` and hides its own overflow, so the calendar grid and the
 * detail panel each scroll *internally* and the document never moves. It carries no page header — the
 * sidebar/drawer already marks the active page — to reclaim the vertical space the full-height grid
 * needs. Mobile (`< lg`) is unchanged: stacked, natural height, document scroll, bottom drawer. The
 * trade-off is CSS-only and reversible, so it lives here rather than in an ADR.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePerson();
  // `en-CA` formats as `YYYY-MM-DD`; `Asia/Jakarta` pins it to WIB so the grid seeds the right month.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const result = await fetchJadwal();

  return (
    // No page header — item 1 of #278 reclaims the vertical space. `lg:h-dvh` + `lg:overflow-hidden`
    // is the desktop fit-to-viewport anchor (`lg:min-h-0` neutralises the mobile `min-h-full` there);
    // below `lg` this stays a plain document-scrolling column.
    <div className="flex min-h-full flex-col px-7 py-6 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <KalenderCalendar
        schedule={result.ok ? result.schedule : {}}
        error={result.ok ? null : result.error}
        today={today}
      />
    </div>
  );
}
