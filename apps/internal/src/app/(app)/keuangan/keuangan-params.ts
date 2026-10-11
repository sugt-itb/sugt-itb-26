import { calendarDate } from "-/lib/calendar-date";
import {
  DEFAULT_KEUANGAN_SORT,
  KEUANGAN_SORT_KEYS,
  type KeuanganFilters,
  type KeuanganSort,
  type KeuanganSortKey,
} from "@sugt/db/queries";

/** `/keuangan`'s query string as Next hands it over. */
export type KeuanganSearchParams = Record<string, string | string[] | undefined>;

/** What `/keuangan`'s URL asks for, after the lenient parse. */
export type KeuanganView = {
  filters: KeuanganFilters;
  sort: KeuanganSort;
  page: number;
  /**
   * Dari was after Sampai: neither date is applied, and the page says so. The dates as typed stay in
   * `entered`, so the form shows what was asked for.
   */
  rangeReversed: boolean;
  entered: { dari: string | null; sampai: string | null };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * **What `/keuangan`'s URL asks for** (`?perjadin=&dari=&sampai=&urut=&arah=&page=`), so a view can be
 * bookmarked and the export reuses its filter exactly. Anything malformed falls back to the default:
 * a bad `perjadin` is every Perjadin, a bad date no bound, a bad sort the newest-first default, a bad
 * page the first. A column named without a direction starts descending, as a header click does.
 */
export function parseKeuanganParams(params: KeuanganSearchParams): KeuanganView {
  const perjadin = first(params.perjadin);
  const dari = calendarDate(first(params.dari));
  const sampai = calendarDate(first(params.sampai));
  const rangeReversed = dari !== null && sampai !== null && dari > sampai;
  const urut = first(params.urut);
  const arah = first(params.arah);
  const key = KEUANGAN_SORT_KEYS.find((candidate) => candidate === urut);
  const page = Number.parseInt(first(params.page) ?? "", 10);
  return {
    filters: {
      perjadinId: perjadin && UUID.test(perjadin) ? perjadin : null,
      dari: rangeReversed ? null : dari,
      sampai: rangeReversed ? null : sampai,
    },
    sort: key ? { key, direction: arah === "asc" ? "asc" : "desc" } : DEFAULT_KEUANGAN_SORT,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    rangeReversed,
    entered: { dari, sampai },
  };
}

/** The filter as query parameters, carrying only what is set. */
function filterQuery(filters: KeuanganFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.perjadinId) query.set("perjadin", filters.perjadinId);
  if (filters.dari) query.set("dari", filters.dari);
  if (filters.sampai) query.set("sampai", filters.sampai);
  return query;
}

/** The `/keuangan` URL for a filter, sort and page, carrying only what differs from the default. */
export function keuanganHref(view: {
  filters: KeuanganFilters;
  sort: KeuanganSort;
  page: number;
}): string {
  const query = filterQuery(view.filters);
  const { key, direction } = view.sort;
  if (key !== DEFAULT_KEUANGAN_SORT.key || direction !== DEFAULT_KEUANGAN_SORT.direction) {
    query.set("urut", key);
    query.set("arah", direction);
  }
  if (view.page > 1) query.set("page", String(view.page));
  const search = query.toString();
  return search ? `/keuangan?${search}` : "/keuangan";
}

/** The export's URL: the same filter, and nothing else — the export has its own order and no pages. */
export function keuanganExportHref(filters: KeuanganFilters): string {
  const search = filterQuery(filters).toString();
  return search ? `/keuangan/ekspor?${search}` : "/keuangan/ekspor";
}

/** The sort a click on `key`'s header asks for: a new column descending, the sorted one flipped. */
export function sortAfterClick(current: KeuanganSort, key: KeuanganSortKey): KeuanganSort {
  if (current.key !== key) return { key, direction: "desc" };
  return { key, direction: current.direction === "desc" ? "asc" : "desc" };
}
