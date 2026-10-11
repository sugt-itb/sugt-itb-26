import { calendarDate, first } from "-/lib/search-params";
import {
  ACTIVITY_LOG_AKSI_FILTERS,
  type ActivityLogAksiFilter,
  type ActivityLogFilters,
} from "@sugt/db/queries";

/** `/log`'s query string as Next hands it over. */
export type LogSearchParams = Record<string, string | string[] | undefined>;

/**
 * **The filters `/log`'s URL asks for** (`?q=&aksi=&dari=&sampai=&page=`), so a view can be
 * bookmarked. Anything malformed is dropped rather than refused: a bad `aksi` is Semua, a bad date
 * is no bound, a bad page is the first.
 */
export function parseLogParams(params: LogSearchParams): ActivityLogFilters {
  const aksi = first(params.aksi);
  const page = Number.parseInt(first(params.page) ?? "", 10);
  return {
    q: first(params.q)?.trim() ?? "",
    aksi:
      aksi && Object.hasOwn(ACTIVITY_LOG_AKSI_FILTERS, aksi)
        ? (aksi as ActivityLogAksiFilter)
        : null,
    dari: calendarDate(first(params.dari)),
    sampai: calendarDate(first(params.sampai)),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The `/log` URL for these filters on another page, carrying only what is set. */
export function logHref(filters: ActivityLogFilters, page: number): string {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.aksi) query.set("aksi", filters.aksi);
  if (filters.dari) query.set("dari", filters.dari);
  if (filters.sampai) query.set("sampai", filters.sampai);
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `/log?${search}` : "/log";
}
