/**
 * `2026-10-05 09:30 WIB` — an instant as a wall-clock time in WIB, in the ISO form every date in the
 * internal app reads in (#166). Pinned to `Asia/Jakarta`, so the server's own zone never shows.
 */
export function formatWib(when: Date): string {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta",
    dateStyle: "short",
    timeStyle: "short",
  }).format(when);
  return `${formatted} WIB`;
}

/**
 * `2026-10-05` — the calendar day an instant falls on in WIB, in the same ISO form (#166). A day
 * read off a timestamp — the day an export is taken — is WIB's day, not UTC's: 06:00 WIB is still
 * that day, though it is the day before in UTC.
 */
export function formatWibDate(when: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", dateStyle: "short" }).format(
    when,
  );
}

const INDONESIAN_WIB = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Jakarta",
});

/**
 * `14 Okt 2026, 08.05` — an instant in WIB, written the Indonesian way. **The one exception to #166's
 * ISO form**: `/log`'s Waktu column (#395), where product.md asks for exactly this. Anywhere else,
 * use `formatWib`.
 */
export function formatWibIndonesian(when: Date): string {
  return INDONESIAN_WIB.format(when);
}
