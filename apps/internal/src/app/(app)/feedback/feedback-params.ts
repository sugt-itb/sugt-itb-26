import { first, uuidOrNull } from "-/lib/search-params";
import type {
  FeedbackFilterValue,
  FeedbackFilters,
  FeedbackParticipantType,
  FeedbackSort,
  ParticipantFeedbackScope,
  PerjadinFeedbackFilters,
  PerjadinFeedbackScope,
} from "@sugt/db/queries";
import { PERJADIN_EVALUATION_ROLES, type PerjadinEvaluationRole } from "@sugt/domain";

/**
 * **The `/feedback` export's query string** (#490). The screen keeps its choices in the browser,
 * not in its URL, so each tab's **Ekspor CSV** link carries them to a plain GET download, the way
 * `/keuangan`'s export reads its filter from query parameters. One module builds the link and
 * parses it, so the two cannot drift.
 *
 * **Lenient, like every parser here** (`/keuangan`, `/log`): a missing or malformed value is the
 * default — no scope, a filter off, the default sort — rather than an error. Only what differs from
 * the default is written.
 *
 * Types only from `@sugt/db/queries`: the tabs import this, and a runtime value from that package
 * would drag the Postgres client into the browser bundle (see `feedback-view.tsx`).
 */

/** A query string as Next hands it over, or as `URLSearchParams` yields it. */
export type FeedbackSearchParams = Record<string, string | string[] | undefined>;

/** One tab's choices: its scope, its score filters and its sort. */
export type FeedbackExportView<Scope, Filters> = {
  scope: Scope;
  filters: Filters;
  sort: FeedbackSort;
};

/** Each Peserta score filter's parameter. */
const PARTICIPANT_FILTER_PARAMS: Record<keyof FeedbackFilters, string> = {
  reviewType: "ulasan",
  instructor: "narasumber",
  materials: "materi",
  relevance: "relevansi",
  handsOnRbl: "rbl",
};

/** Each Perjadin score filter's parameter. */
const PERJADIN_FILTER_PARAMS: Record<keyof PerjadinFeedbackFilters, string> = {
  reviewType: "ulasan",
  lodging: "penginapan",
  transport: "transportasi",
  meals: "konsumsi",
  punctuality: "ketepatan",
  pendampingSupport: "pendamping",
};

/** Every Tipe Peserta, as a `Record`: a value added to the type fails the build until listed. */
const PARTICIPANT_TYPES: Record<FeedbackParticipantType, true> = { Siswa: true, "GTK-MS": true };

const isParticipantType = (value: string | undefined): value is FeedbackParticipantType =>
  value !== undefined && Object.hasOwn(PARTICIPANT_TYPES, value);

/** A filter value, or `all` — the filter off — for anything else. */
function filterValue(value: string | undefined): FeedbackFilterValue {
  return value === "le7" || value === "gt7" ? value : "all";
}

/**
 * The sort, each direction defaulting as `DEFAULT_FEEDBACK_SORT` does: lowest first, newest first.
 */
function parseSort(params: FeedbackSearchParams): FeedbackSort {
  return {
    score: first(params.nilai) === "desc" ? "desc" : "asc",
    date: first(params.tanggal) === "asc" ? "asc" : "desc",
  };
}

function parseFilters<Filters extends Record<string, FeedbackFilterValue>>(
  params: FeedbackSearchParams,
  names: Record<keyof Filters, string>,
): Filters {
  return Object.fromEntries(
    Object.entries(names).map(([key, name]) => [key, filterValue(first(params[name as string]))]),
  ) as Filters;
}

/** What the Peserta export's URL asks for (`?sekolah=&sesi=&tipe=&ulasan=&…&nilai=&tanggal=`). */
export function parseParticipantExportParams(
  params: FeedbackSearchParams,
): FeedbackExportView<ParticipantFeedbackScope, FeedbackFilters> {
  const tipe = first(params.tipe);
  const schoolId = uuidOrNull(first(params.sekolah));
  return {
    scope: {
      schoolId,
      // A Session is picked within a School (`withSchool`), so one without a School is dropped.
      sessionId: schoolId === null ? null : uuidOrNull(first(params.sesi)),
      participantType: isParticipantType(tipe) ? tipe : null,
    },
    filters: parseFilters<FeedbackFilters>(params, PARTICIPANT_FILTER_PARAMS),
    sort: parseSort(params),
  };
}

/** What the Perjadin export's URL asks for (`?perjadin=&peran=&ulasan=&…&nilai=&tanggal=`). */
export function parsePerjadinExportParams(
  params: FeedbackSearchParams,
): FeedbackExportView<PerjadinFeedbackScope, PerjadinFeedbackFilters> {
  const peran = first(params.peran);
  return {
    scope: {
      perjadinId: uuidOrNull(first(params.perjadin)),
      role:
        PERJADIN_EVALUATION_ROLES.find((role): role is PerjadinEvaluationRole => role === peran) ??
        null,
    },
    filters: parseFilters<PerjadinFeedbackFilters>(params, PERJADIN_FILTER_PARAMS),
    sort: parseSort(params),
  };
}

/** The filters and sort as parameters, each only when it differs from the default. */
function filterAndSortQuery<Filters extends Record<string, FeedbackFilterValue>>(
  query: URLSearchParams,
  filters: Filters,
  names: Record<keyof Filters, string>,
  sort: FeedbackSort,
): string {
  for (const [key, name] of Object.entries(names) as [keyof Filters, string][]) {
    if (filters[key] !== "all") query.set(name, filters[key]);
  }
  if (sort.score !== "asc") query.set("nilai", sort.score);
  if (sort.date !== "desc") query.set("tanggal", sort.date);
  return query.toString();
}

/** The Peserta tab's Ekspor CSV link, for its current choices. */
export function participantExportHref(
  view: FeedbackExportView<ParticipantFeedbackScope, FeedbackFilters>,
): string {
  const query = new URLSearchParams();
  if (view.scope.schoolId) query.set("sekolah", view.scope.schoolId);
  if (view.scope.sessionId) query.set("sesi", view.scope.sessionId);
  if (view.scope.participantType) query.set("tipe", view.scope.participantType);
  const search = filterAndSortQuery(query, view.filters, PARTICIPANT_FILTER_PARAMS, view.sort);
  return search ? `/feedback/ekspor/peserta?${search}` : "/feedback/ekspor/peserta";
}

/** The Perjadin tab's Ekspor CSV link, for its current choices. */
export function perjadinExportHref(
  view: FeedbackExportView<PerjadinFeedbackScope, PerjadinFeedbackFilters>,
): string {
  const query = new URLSearchParams();
  if (view.scope.perjadinId) query.set("perjadin", view.scope.perjadinId);
  if (view.scope.role) query.set("peran", view.scope.role);
  const search = filterAndSortQuery(query, view.filters, PERJADIN_FILTER_PARAMS, view.sort);
  return search ? `/feedback/ekspor/perjadin?${search}` : "/feedback/ekspor/perjadin";
}

/** Whether any score filter is on — the file name says `tersaring` when one is. */
export function anyFilterOn(filters: Record<string, FeedbackFilterValue>): boolean {
  return Object.values(filters).some((value) => value !== "all");
}
