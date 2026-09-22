# The /kalender schedule is read from a link-shared Google Sheet, per request

`/kalender` shows the Programme's activity schedule — which school has what on which day. That
schedule is maintained by DITSAMA in an online Google Spreadsheet (the "Jadwal" tab), edited by
hand as trips and Sessions are arranged. The calendar's source of truth is therefore that
**external sheet**, fetched and parsed on every page load, rather than the database.

## What this replaces

The `/kalender` scaffold (#242) rendered `deriveCalendarEvents(monitoringData(...))` — Perjadin
spans, Monev, online Sessions and hardcoded Pretest/Posttest ranges derived from our own tables.
That was always placeholder wiring (#196). The real schedule lives in the sheet DITSAMA already
keeps, so the calendar reads the sheet instead. This ADR covers the **data layer** (#258); the UI
that consumes it is #259, and the now-unused DB calendar-derive functions are retired with the last
of their consumers separately.

## The decision

- **Read the sheet's CSV export endpoint** (`…/export?format=csv&gid=…`). The sheet is
  link-shared for read, so a plain `GET` returns the CSV with **no credentials** — no Google API
  key, no `googleapis` dependency, no service account. This is the whole reason the approach is
  cheap enough to prefer over the Sheets API.
- **The URL is configuration, not code.** It comes from `JADWAL_SHEET_CSV_URL`, read through
  `requireEnv` and declared on `build`/`typecheck`/`dev` in `turbo.json` (strict `envMode`). The
  URL is not committed — the sheet id and tab can change in production without a code change, and
  the repo is public.
- **Fetched per request, uncached** (`cache: "no-store"`; the page will also be `force-dynamic`).
  The sheet changes and each load must reflect it.
- **A tightened share degrades to a typed error, never to wrong data.** If the sheet is ever set
  to "restricted", the endpoint serves an HTML sign-in page instead of CSV. The fetch detects a
  non-2xx, a non-`text/csv` content type, or an HTML-looking body and returns a tagged failure the
  page renders as an inline banner ("Gagal memuat jadwal dari spreadsheet"). It is a discriminated
  union, not a thrown 500.

## The trade-offs, accepted

- **An external runtime dependency.** The calendar is only as available as the sheet and Google's
  export endpoint. A per-request fetch means a slow or down endpoint is a slow or failed page —
  mitigated only by the error state, not by a cache.
- **No offline, no snapshot.** Nothing stores the schedule, so there is no history and no fallback
  to a last-good copy; a load either reflects the sheet now or shows the error.
- **Correctness depends on the sheet staying link-shared and on its layout.** The parser keys off
  row 2's dates and column A's `Contoh` marker rather than fixed positions, so it survives row and
  column insertions — but a column relabelled away from `d-MMM-yyyy`, or the `No`/`Nama Sekolah`
  columns moving, would silently drop data. This is the cost of a human-maintained spreadsheet as a
  source of truth, and it is accepted because the alternative — re-entering the schedule into the
  tool — is the duplication the Programme is trying to avoid at this stage.

## Why not the database, or the Sheets API

Storing the schedule in our own tables would mean a second place to maintain it and a screen to
maintain it with, for data DITSAMA already keeps in a sheet everyone on the team can already edit.
The Sheets API would add an auth story (an API key or service account, its rotation, its storage)
for a sheet that is already world-readable by link. Both cost more than the link-shared CSV, whose
only real weakness — a tightened share — is caught and shown rather than hidden.
