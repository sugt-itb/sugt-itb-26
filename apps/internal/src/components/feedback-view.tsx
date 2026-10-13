"use client";

import {
  loadParticipantFeedback,
  loadParticipantFeedbackAverages,
  loadPerjadinFeedback,
  loadPerjadinFeedbackAverages,
} from "-/app/(app)/feedback/actions";
import { participantExportHref, perjadinExportHref } from "-/app/(app)/feedback/feedback-params";
import { participantScopeLabel, perjadinScopeLabel, withSchool } from "-/components/feedback-scope";
import { sesiLabel } from "-/components/session-labels";
import { SingleSelectCombobox } from "-/components/single-select-combobox";
import {
  PARTICIPANT_ASPECT_LABELS,
  PARTICIPANT_CLASS_LABELS,
  PARTICIPANT_WRITTEN_QUESTIONS,
} from "-/lib/participant-feedback-copy";
import { perjadinName, perjadinSchoolsLine } from "-/lib/perjadin-name";
import type {
  FeedbackCursor,
  FeedbackFilters,
  FeedbackFilterValue,
  FeedbackParticipantType,
  FeedbackPerjadinOption,
  FeedbackSchoolOption,
  FeedbackSort,
  ParticipantFeedbackAverages,
  ParticipantFeedbackRow,
  ParticipantFeedbackScope,
  PerjadinFeedbackAverages,
  PerjadinFeedbackCursor,
  PerjadinFeedbackFilters,
  PerjadinFeedbackRow,
  PerjadinFeedbackScope,
} from "@sugt/db/queries";
import {
  PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS,
  PERJADIN_EVALUATION_ROLES,
  type PerjadinEvaluationRole,
} from "@sugt/domain";
import { Badge } from "@sugt/ui/components/badge";
import { Button } from "@sugt/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sugt/ui/components/card";
import { LinkButton } from "@sugt/ui/components/link-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@sugt/ui/components/tabs";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

/**
 * **The Feedback screen.** Two tabs — Peserta (what Participants said about a Session) and Perjadin
 * (what a filer said about a trip) — each with summary cards, a scope (#466: Sekolah and Sesi, or
 * Perjadin and Peran pengisi), server-side score filters, two sort dropdowns (average, then date),
 * and an OFFSET-paged card list driven from its own Server Action. The list is sorted
 * lowest-average-first by default, so the rows that need attention rise.
 *
 * **The averages follow the scope, never the score filters.** A scope change refetches them with the
 * list, and each card's title names what it covers; a score filter leaves them alone, since averaging
 * only the low rows would read as the standing and mislead.
 *
 * **Filtering, sorting and paging are the server's, not the browser's.** The set is unbounded — a
 * submission per Participant, an evaluation per filer — so the filters, the sort and "load more" all
 * go back to the query. A filter or sort change refetches the first page (cursor `null`) and REPLACES
 * the list, resetting paging; "load more" carries the current sort and the cursor (an OFFSET) and
 * APPENDS the next page.
 *
 * **Switching tabs resets scope, filters, sort and pagination to defaults.** Each tab is its own child
 * component, seeded from the server's initial page and averages; only the active one is mounted, so
 * switching away unmounts it and switching back mounts it fresh — the target tab always shows its
 * first page with all filters at `all` and the default sort, and no round trip is needed because the
 * server sent both tabs' data (paged under that same default sort).
 */

/** The two tabs. Peserta is the default and first; Perjadin second. */
type Tab = "peserta" | "perjadin";

/**
 * All Peserta filters off — the client's initial state, mirroring the server's `NO_FEEDBACK_FILTERS`.
 * Declared here rather than imported: those consts are runtime values on `@sugt/db`, and importing a
 * value from that package into a client component drags the Postgres client into the browser bundle.
 * This component takes only *types* from `@sugt/db/queries` for that reason.
 */
const ALL_FILTERS: FeedbackFilters = {
  reviewType: "all",
  handsOnRbl: "all",
  instructor: "all",
  materials: "all",
  relevance: "all",
};

/** All Perjadin filters off — the mirror of `NO_PERJADIN_FEEDBACK_FILTERS`, declared for the same reason. */
const ALL_PERJADIN_FILTERS: PerjadinFeedbackFilters = {
  reviewType: "all",
  lodging: "all",
  transport: "all",
  meals: "all",
  punctuality: "all",
  pendampingSupport: "all",
};

/**
 * The default sort — lowest average first, newest within a tie — mirroring the server's
 * `DEFAULT_FEEDBACK_SORT`. Declared here rather than imported for the same reason as the filter
 * defaults above: it is a runtime value on `@sugt/db`, and this client component takes only types
 * from that package. The server seeds the first paint with the same shape, so the two agree.
 */
const DEFAULT_SORT: FeedbackSort = { score: "asc", date: "desc" };

/** The two directions of the average sort, in Indonesian — lowest ("Terendah") or highest first. */
const SCORE_SORT_OPTIONS: Record<FeedbackSort["score"], string> = {
  asc: "Terendah",
  desc: "Tertinggi",
};

/** The two directions of the date tiebreak, in Indonesian — newest ("Terbaru") or oldest first. */
const DATE_SORT_OPTIONS: Record<FeedbackSort["date"], string> = {
  desc: "Terbaru",
  asc: "Terlama",
};

/** Every School, Session and Tipe Peserta — the Peserta tab's starting scope, as the server's. */
const ALL_PARTICIPANT_SCOPE: ParticipantFeedbackScope = {
  schoolId: null,
  sessionId: null,
  participantType: null,
};

/** Every trip, every Peran — the Perjadin tab's starting scope, mirroring the server's. */
const ALL_PERJADIN_SCOPE: PerjadinFeedbackScope = { perjadinId: null, role: null };

/** The Sesi, Tipe Peserta and Peran selects' "everything" option — a plain `Select` needs one. */
const ALL = "semua" as const;

/** The Peran pengisi select: Semua Peran, then the three self-declared roles as stored. */
const ROLE_OPTIONS: Record<PerjadinEvaluationRole | typeof ALL, string> = {
  [ALL]: "Semua Peran",
  ...(Object.fromEntries(PERJADIN_EVALUATION_ROLES.map((role) => [role, role])) as Record<
    PerjadinEvaluationRole,
    string
  >),
};

/**
 * The Tipe Peserta select (#487): Semua Tipe Peserta, then the two-way split as the server names it —
 * Siswa is the Student Class, GTK-MS the GTK and MS Classes together.
 */
const PARTICIPANT_TYPE_OPTIONS: Record<FeedbackParticipantType | typeof ALL, string> = {
  [ALL]: "Semua Tipe Peserta",
  Siswa: "Siswa",
  "GTK-MS": "GTK-MS",
};

/** One filter's three options, in Indonesian. `label` prefixes name the column the filter gates. */
type FilterOptions = Record<FeedbackFilterValue, string>;

const REVIEW_TYPE_OPTIONS: FilterOptions = {
  all: "Semua Ulasan",
  le7: "Ulasan ≤ 7",
  gt7: "Ulasan > 7",
};

/** One Aspect's three filter options, named with its short label. */
function aspectOptions(label: string): FilterOptions {
  return { all: `Semua: ${label}`, le7: `${label} ≤ 7`, gt7: `${label} > 7` };
}

/** Hands-on RBL (#446): a row without one — GTK, MS or an older Siswa row — is in neither arm. */
const HANDS_ON_RBL_OPTIONS = aspectOptions(PARTICIPANT_ASPECT_LABELS.hands_on_rbl);

const INSTRUCTOR_OPTIONS = aspectOptions(PARTICIPANT_ASPECT_LABELS.instructor);

const MATERIALS_OPTIONS = aspectOptions(PARTICIPANT_ASPECT_LABELS.materials);

const RELEVANCE_OPTIONS = aspectOptions(PARTICIPANT_ASPECT_LABELS.relevance);

const LODGING_OPTIONS = aspectOptions("Penginapan");

const TRANSPORT_OPTIONS = aspectOptions("Transportasi");

const MEALS_OPTIONS = aspectOptions("Konsumsi");

const PUNCTUALITY_OPTIONS = aspectOptions("Ketepatan Waktu");

/** Pendamping Support (#482): a row without one — a Pendamping's, or one filed before #481 — is in neither arm. */
const PENDAMPING_SUPPORT_OPTIONS = aspectOptions("Bantuan Pendamping");

function FeedbackView({
  participantInitialRows,
  participantInitialCursor,
  participantAverages,
  participantSchools,
  perjadinInitialRows,
  perjadinInitialCursor,
  perjadinAverages,
  perjadinTrips,
}: {
  participantInitialRows: ParticipantFeedbackRow[];
  participantInitialCursor: FeedbackCursor | null;
  participantAverages: ParticipantFeedbackAverages;
  /** The Sekolah and Sesi pickers' options: the Schools and Sessions with responses (#466). */
  participantSchools: FeedbackSchoolOption[];
  perjadinInitialRows: PerjadinFeedbackRow[];
  perjadinInitialCursor: PerjadinFeedbackCursor | null;
  perjadinAverages: PerjadinFeedbackAverages;
  /** The Perjadin picker's options: the trips with evaluations (#466). */
  perjadinTrips: FeedbackPerjadinOption[];
}) {
  const [tab, setTab] = useState<Tab>("peserta");

  return (
    <div className="flex min-h-full flex-col p-4 sm:p-7">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab);
        }}
        className="mb-5"
      >
        <TabsList>
          <TabsTrigger value="peserta">Peserta</TabsTrigger>
          <TabsTrigger value="perjadin">Perjadin</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Only the active tab is mounted; switching remounts the target from its server data, which is
          what resets its filters and paging to defaults. */}
      {tab === "peserta" ? (
        <ParticipantTab
          initialRows={participantInitialRows}
          initialCursor={participantInitialCursor}
          initialAverages={participantAverages}
          schools={participantSchools}
        />
      ) : (
        <PerjadinTab
          initialRows={perjadinInitialRows}
          initialCursor={perjadinInitialCursor}
          initialAverages={perjadinAverages}
          trips={perjadinTrips}
        />
      )}
    </div>
  );
}

/**
 * The Peserta tab: four summary cards, the Sekolah, Sesi and Tipe Peserta pickers, five server-side
 * filters, two sort dropdowns, and an OFFSET-paged card list.
 *
 * A scope, filter or sort change refetches the first page (cursor `null`) and REPLACES the list; a
 * scope change refetches the averages with it. "Load more" carries the current scope, filters, sort
 * and cursor and APPENDS what comes back. The pending state covers each round trip so a second change
 * cannot race the first.
 */
function ParticipantTab({
  initialRows,
  initialCursor,
  initialAverages,
  schools,
}: {
  initialRows: ParticipantFeedbackRow[];
  initialCursor: FeedbackCursor | null;
  initialAverages: ParticipantFeedbackAverages;
  schools: FeedbackSchoolOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [scope, setScope] = useState<ParticipantFeedbackScope>(ALL_PARTICIPANT_SCOPE);
  // The averages and the scope they were read for travel together, so a card's title never names a
  // scope its number is not yet over.
  const [averages, setAverages] = useState({
    values: initialAverages,
    scope: ALL_PARTICIPANT_SCOPE,
  });
  const [filters, setFilters] = useState<FeedbackFilters>(ALL_FILTERS);
  const [sort, setSort] = useState<FeedbackSort>(DEFAULT_SORT);
  const [pending, startTransition] = useTransition();

  const school = schools.find((option) => option.id === scope.schoolId) ?? null;
  const schoolOptions = useMemo(
    () =>
      schools.map((option) => ({
        value: option.id,
        label: option.name,
        keywords: option.kabupatenKota,
      })),
    [schools],
  );
  const sessionOptions: Record<string, string> = {
    [ALL]: "Semua Sesi",
    ...Object.fromEntries((school?.sessions ?? []).map((option) => [option.id, sesiLabel(option)])),
  };

  function changeScope(next: ParticipantFeedbackScope) {
    setScope(next);
    startTransition(async () => {
      const [page, values] = await Promise.all([
        loadParticipantFeedback(filters, next, null, sort),
        loadParticipantFeedbackAverages(next),
      ]);
      setRows(page.rows);
      setCursor(page.nextCursor);
      setAverages({ values, scope: next });
    });
  }

  function changeFilter(key: keyof FeedbackFilters, value: FeedbackFilterValue) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    startTransition(async () => {
      const page = await loadParticipantFeedback(next, scope, null, sort);
      setRows(page.rows);
      setCursor(page.nextCursor);
    });
  }

  function changeSort(next: FeedbackSort) {
    setSort(next);
    startTransition(async () => {
      const page = await loadParticipantFeedback(filters, scope, null, next);
      setRows(page.rows);
      setCursor(page.nextCursor);
    });
  }

  function loadMore() {
    if (cursor === null) return;
    startTransition(async () => {
      const page = await loadParticipantFeedback(filters, scope, cursor, sort);
      setRows((previous) => [...previous, ...page.rows]);
      setCursor(page.nextCursor);
    });
  }

  const covers = participantScopeLabel(schools, averages.scope);

  return (
    <>
      {/* The standing over the picked School, Session and Tipe Peserta — programme-wide with none —
          and unmoved by the score filters below. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AverageCard
          label={PARTICIPANT_ASPECT_LABELS.instructor}
          covers={covers}
          value={averages.values.instructor}
        />
        <AverageCard
          label={PARTICIPANT_ASPECT_LABELS.materials}
          covers={covers}
          value={averages.values.materials}
        />
        <AverageCard
          label={PARTICIPANT_ASPECT_LABELS.relevance}
          covers={covers}
          value={averages.values.relevance}
        />
        {/* Over the rows that have one; "—" until any does (#446), and always under GTK-MS (#487). */}
        <AverageCard
          label={PARTICIPANT_ASPECT_LABELS.hands_on_rbl}
          covers={covers}
          value={averages.values.handsOnRbl}
        />
      </div>

      {/* The scope (#466): a School, then one of its Sessions, and a Tipe Peserta (#487). Changing the
          School resets the Sesi. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SingleSelectCombobox
          aria-label="Sekolah"
          placeholder="Semua Sekolah"
          emptyLabel="Tidak ada Sekolah yang cocok."
          options={schoolOptions}
          value={scope.schoolId}
          disabled={pending}
          onValueChange={(schoolId) => {
            changeScope(withSchool(scope, schoolId));
          }}
        />
        <OptionSelect
          ariaLabel="Sesi"
          options={sessionOptions}
          value={scope.sessionId ?? ALL}
          disabled={pending || school === null}
          onChange={(sessionId) => {
            changeScope({ ...scope, sessionId: sessionId === ALL ? null : sessionId });
          }}
        />
        <OptionSelect
          ariaLabel="Tipe Peserta"
          options={PARTICIPANT_TYPE_OPTIONS}
          value={scope.participantType ?? ALL}
          disabled={pending}
          onChange={(participantType) => {
            changeScope({
              ...scope,
              participantType: participantType === ALL ? null : participantType,
            });
          }}
        />
      </div>

      {/* The two sort dropdowns. Each change refetches the first page and resets paging. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OptionSelect
          ariaLabel="Urutkan nilai"
          options={SCORE_SORT_OPTIONS}
          value={sort.score}
          disabled={pending}
          onChange={(value) => {
            changeSort({ ...sort, score: value });
          }}
        />
        <OptionSelect
          ariaLabel="Urutkan tanggal"
          options={DATE_SORT_OPTIONS}
          value={sort.date}
          disabled={pending}
          onChange={(value) => {
            changeSort({ ...sort, date: value });
          }}
        />
      </div>

      {/* The five server-side filters. Each change refetches the first page and resets paging. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FilterSelect
          ariaLabel="Jenis ulasan"
          options={REVIEW_TYPE_OPTIONS}
          value={filters.reviewType}
          disabled={pending}
          onChange={(value) => {
            changeFilter("reviewType", value);
          }}
        />
        <FilterSelect
          ariaLabel={`Nilai ${PARTICIPANT_ASPECT_LABELS.instructor}`}
          options={INSTRUCTOR_OPTIONS}
          value={filters.instructor}
          disabled={pending}
          onChange={(value) => {
            changeFilter("instructor", value);
          }}
        />
        <FilterSelect
          ariaLabel={`Nilai ${PARTICIPANT_ASPECT_LABELS.materials}`}
          options={MATERIALS_OPTIONS}
          value={filters.materials}
          disabled={pending}
          onChange={(value) => {
            changeFilter("materials", value);
          }}
        />
        <FilterSelect
          ariaLabel={`Nilai ${PARTICIPANT_ASPECT_LABELS.relevance}`}
          options={RELEVANCE_OPTIONS}
          value={filters.relevance}
          disabled={pending}
          onChange={(value) => {
            changeFilter("relevance", value);
          }}
        />
        <FilterSelect
          ariaLabel={`Nilai ${PARTICIPANT_ASPECT_LABELS.hands_on_rbl}`}
          options={HANDS_ON_RBL_OPTIONS}
          value={filters.handsOnRbl}
          disabled={pending}
          onChange={(value) => {
            changeFilter("handsOnRbl", value);
          }}
        />
      </div>

      <ExportLink href={participantExportHref({ scope, filters, sort })} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tidak ada masukan Peserta untuk saringan ini.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <ParticipantCard row={row} />
            </li>
          ))}
        </ul>
      )}

      {cursor !== null && (
        <LoadMore
          pending={pending}
          onClick={loadMore}
        />
      )}
    </>
  );
}

/**
 * The Perjadin tab: five summary cards, six server-side filters, two sort dropdowns, and an
 * OFFSET-paged card list. The shape is the Peserta tab's — one Aspect more — so the filter, sort and
 * paging machinery is identical, just over `loadPerjadinFeedback`.
 */
function PerjadinTab({
  initialRows,
  initialCursor,
  initialAverages,
  trips,
}: {
  initialRows: PerjadinFeedbackRow[];
  initialCursor: PerjadinFeedbackCursor | null;
  initialAverages: PerjadinFeedbackAverages;
  trips: FeedbackPerjadinOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [scope, setScope] = useState<PerjadinFeedbackScope>(ALL_PERJADIN_SCOPE);
  const [averages, setAverages] = useState({ values: initialAverages, scope: ALL_PERJADIN_SCOPE });
  const [filters, setFilters] = useState<PerjadinFeedbackFilters>(ALL_PERJADIN_FILTERS);
  const [sort, setSort] = useState<FeedbackSort>(DEFAULT_SORT);
  const [pending, startTransition] = useTransition();

  // A trip is found by its name or its Schools; the Schools are its second line too (ADR-0044).
  const tripOptions = useMemo(
    () =>
      trips.map((trip) => ({
        value: trip.id,
        label: perjadinName(trip),
        keywords: trip.schoolNames.join(" "),
        description: perjadinSchoolsLine(trip.schoolNames),
      })),
    [trips],
  );

  function changeScope(next: PerjadinFeedbackScope) {
    setScope(next);
    startTransition(async () => {
      const [page, values] = await Promise.all([
        loadPerjadinFeedback(filters, next, null, sort),
        loadPerjadinFeedbackAverages(next),
      ]);
      setRows(page.rows);
      setCursor(page.nextCursor);
      setAverages({ values, scope: next });
    });
  }

  function changeFilter(key: keyof PerjadinFeedbackFilters, value: FeedbackFilterValue) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    startTransition(async () => {
      const page = await loadPerjadinFeedback(next, scope, null, sort);
      setRows(page.rows);
      setCursor(page.nextCursor);
    });
  }

  function changeSort(next: FeedbackSort) {
    setSort(next);
    startTransition(async () => {
      const page = await loadPerjadinFeedback(filters, scope, null, next);
      setRows(page.rows);
      setCursor(page.nextCursor);
    });
  }

  function loadMore() {
    if (cursor === null) return;
    startTransition(async () => {
      const page = await loadPerjadinFeedback(filters, scope, cursor, sort);
      setRows((previous) => [...previous, ...page.rows]);
      setCursor(page.nextCursor);
    });
  }

  const covers = perjadinScopeLabel(trips, averages.scope);

  return (
    <>
      {/* The standing over the picked trip and Peran — programme-wide with neither — and unmoved by
          the score filters below. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <AverageCard
          label="Penginapan"
          covers={covers}
          value={averages.values.lodging}
        />
        <AverageCard
          label="Transportasi"
          covers={covers}
          value={averages.values.transport}
        />
        <AverageCard
          label="Konsumsi"
          covers={covers}
          value={averages.values.meals}
        />
        <AverageCard
          label="Ketepatan Waktu"
          covers={covers}
          value={averages.values.punctuality}
        />
        {/* Over the rows that have one; "—" until any in scope does, and always under Pendamping. */}
        <AverageCard
          label="Bantuan Pendamping"
          covers={covers}
          value={averages.values.pendampingSupport}
        />
      </div>

      {/* The scope (#466): one trip, and the filer's self-declared Peran. No School — a trip covers
          several, and the Perjadin picker finds one by its Schools. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SingleSelectCombobox
          aria-label="Perjadin"
          placeholder="Semua Perjadin"
          emptyLabel="Tidak ada Perjadin yang cocok."
          options={tripOptions}
          value={scope.perjadinId}
          disabled={pending}
          onValueChange={(perjadinId) => {
            changeScope({ ...scope, perjadinId });
          }}
        />
        <OptionSelect
          ariaLabel="Peran pengisi"
          options={ROLE_OPTIONS}
          value={scope.role ?? ALL}
          disabled={pending}
          onChange={(role) => {
            changeScope({ ...scope, role: role === ALL ? null : role });
          }}
        />
      </div>

      {/* The two sort dropdowns. Each change refetches the first page and resets paging. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OptionSelect
          ariaLabel="Urutkan nilai"
          options={SCORE_SORT_OPTIONS}
          value={sort.score}
          disabled={pending}
          onChange={(value) => {
            changeSort({ ...sort, score: value });
          }}
        />
        <OptionSelect
          ariaLabel="Urutkan tanggal"
          options={DATE_SORT_OPTIONS}
          value={sort.date}
          disabled={pending}
          onChange={(value) => {
            changeSort({ ...sort, date: value });
          }}
        />
      </div>

      {/* The six server-side filters. Each change refetches the first page and resets paging. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FilterSelect
          ariaLabel="Jenis ulasan"
          options={REVIEW_TYPE_OPTIONS}
          value={filters.reviewType}
          disabled={pending}
          onChange={(value) => {
            changeFilter("reviewType", value);
          }}
        />
        <FilterSelect
          ariaLabel="Nilai Penginapan"
          options={LODGING_OPTIONS}
          value={filters.lodging}
          disabled={pending}
          onChange={(value) => {
            changeFilter("lodging", value);
          }}
        />
        <FilterSelect
          ariaLabel="Nilai Transportasi"
          options={TRANSPORT_OPTIONS}
          value={filters.transport}
          disabled={pending}
          onChange={(value) => {
            changeFilter("transport", value);
          }}
        />
        <FilterSelect
          ariaLabel="Nilai Konsumsi"
          options={MEALS_OPTIONS}
          value={filters.meals}
          disabled={pending}
          onChange={(value) => {
            changeFilter("meals", value);
          }}
        />
        <FilterSelect
          ariaLabel="Nilai Ketepatan Waktu"
          options={PUNCTUALITY_OPTIONS}
          value={filters.punctuality}
          disabled={pending}
          onChange={(value) => {
            changeFilter("punctuality", value);
          }}
        />
        <FilterSelect
          ariaLabel="Nilai Bantuan Pendamping"
          options={PENDAMPING_SUPPORT_OPTIONS}
          value={filters.pendampingSupport}
          disabled={pending}
          onChange={(value) => {
            changeFilter("pendampingSupport", value);
          }}
        />
      </div>

      <ExportLink href={perjadinExportHref({ scope, filters, sort })} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tidak ada evaluasi Perjadin untuk saringan ini.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <PerjadinCard row={row} />
            </li>
          ))}
        </ul>
      )}

      {cursor !== null && (
        <LoadMore
          pending={pending}
          onClick={loadMore}
        />
      )}
    </>
  );
}

/**
 * **Ekspor CSV** (#490), shared by both tabs: a plain link to the tab's export, carrying its
 * current scope, filters and sort, so the file holds every matching row — not just the pages
 * loaded — in the order on screen. A plain `<a>`, as `/keuangan`'s, since the response is a
 * download.
 */
function ExportLink({ href }: { href: string }) {
  return (
    <div className="mb-3 flex justify-end">
      <LinkButton
        variant="outline"
        size="sm"
        render={<a href={href} />}
      >
        Ekspor CSV
      </LinkButton>
    </div>
  );
}

/** The "load more" button, shared by both tabs — the paging control at the foot of the list. */
function LoadMore({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <div className="mt-5 flex justify-center">
      <Button
        variant="outline"
        disabled={pending}
        onClick={onClick}
      >
        {pending ? "Memuat…" : "Tampilkan lebih banyak"}
      </Button>
    </div>
  );
}

/**
 * One summary card: the Aspect's name and what it `covers` over its average, kept to one decimal.
 * `covers` is null when the average is programme-wide.
 */
function AverageCard({
  label,
  covers,
  value,
}: {
  label: string;
  covers: string | null;
  value: number | null;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Nilai rata-rata · {label}
          {covers !== null && ` · ${covers}`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-medium">
          {value === null ? "—" : value.toFixed(1)}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * One filter dropdown. The value is always one of the three arms and never null, so no
 * placeholder branch — the trigger always shows the current option's label.
 */
function FilterSelect({
  ariaLabel,
  options,
  value,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  options: FilterOptions;
  value: FeedbackFilterValue;
  disabled: boolean;
  onChange: (value: FeedbackFilterValue) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        onChange(next as FeedbackFilterValue);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="w-full"
        disabled={disabled}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(options) as [FeedbackFilterValue, string][]).map(([key, label]) => (
          <SelectItem
            key={key}
            value={key}
          >
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One dropdown over a fixed option map — the `FilterSelect` shape over a generic string value rather
 * than the three filter arms. The average sort (`asc`/`desc`), the date tiebreak (`desc`/`asc`), the
 * Sesi and the Peran pengisi (#466) each drive one, so the value type is the option map's own key.
 * The value is always a valid key, so no placeholder.
 */
function OptionSelect<T extends string>({
  ariaLabel,
  options,
  value,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  options: Record<T, string>;
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        onChange(next as T);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="w-full"
        disabled={disabled}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(options) as [T, string][]).map(([key, label]) => (
          <SelectItem
            key={key}
            value={key}
          >
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One Participant's submission.
 *
 * The header names who left it, from which Class, at which School, the Session — its Sesi (ADR-0027),
 * mode, day and start time, in WIB when online, the line the Sesi picker shows (#466) — the day the
 * Participant filed it ("Diisi"), and the row average as the headline number.
 *
 * Below it, the Aspects in a fixed order, each with its score and — when the Participant left one
 * — the comment they wrote about that Aspect. A Siswa's card also carries **Hands-on RBL** (#446),
 * "—" on one filed before it existed; GTK and MS are never asked it, so theirs has no such line.
 * Then the two written answers under their headings, each only when the Participant wrote one.
 */
function ParticipantCard({ row }: { row: ParticipantFeedbackRow }) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{row.name}</span>
          <Badge variant="secondary">{PARTICIPANT_CLASS_LABELS[row.classKind]}</Badge>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">{row.schoolName}</span>
          <span className="text-muted-foreground">·</span>
          {/*
            The Session this feedback was filed against, linked through to its detail page (#194) —
            the Participant half of "every feedback links to its origin", parallel to how PerjadinCard
            links its trip. Routed by mode to skip the redirect hop (`/sesi/[id]` bounces an
            online id to `/sesi-daring/[id]` as a safety net); a cancelled Session still links.
          */}
          <Link
            href={
              row.sessionMode === "offline"
                ? `/sesi/${row.sessionId}`
                : `/sesi-daring/${row.sessionId}`
            }
            className="text-sm text-primary hover:underline"
          >
            {sesiLabel({ ...row, mode: row.sessionMode })}
          </Link>
          <span className="ml-auto text-sm text-muted-foreground">Diisi {row.submittedOn}</span>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Rata-rata
            <AverageBadge value={row.rowAverage} />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <AspectRow
          label={PARTICIPANT_ASPECT_LABELS.instructor}
          score={row.instructor}
          comment={row.instructorComment}
        />
        <AspectRow
          label={PARTICIPANT_ASPECT_LABELS.materials}
          score={row.materials}
          comment={row.materialsComment}
        />
        <AspectRow
          label={PARTICIPANT_ASPECT_LABELS.relevance}
          score={row.relevance}
          comment={row.relevanceComment}
        />
        {PARTICIPANT_FEEDBACK_ASPECTS_BY_CLASS[row.classKind].includes("hands_on_rbl") && (
          <AspectRow
            label={PARTICIPANT_ASPECT_LABELS.hands_on_rbl}
            score={row.handsOnRbl}
            comment={row.handsOnRblComment}
          />
        )}
        {row.knowledgeGain !== null && (
          <WrittenAnswer
            heading={PARTICIPANT_WRITTEN_QUESTIONS.knowledgeGain.heading}
            text={row.knowledgeGain}
          />
        )}
        {row.suggestions !== null && (
          <WrittenAnswer
            heading={PARTICIPANT_WRITTEN_QUESTIONS.suggestions.heading}
            text={row.suggestions}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One Perjadin Evaluation.
 *
 * The header names who filed it (`filedByName`), a badge for their self-declared role, the trip's
 * name (`{Sub-Cluster} · {dates}`, ADR-0044) linking to `/perjadin/[id]` — the one card here that
 * links, because a trip has a home page a submission does not — the day the filer filed it
 * ("Diisi"), and the row average as the headline number.
 *
 * Below it, the five Aspects in a fixed order, each with its score and — when the filer left one —
 * the comment about that Aspect. **The Penginapan row is omitted entirely when `lodging` is null**:
 * a day trip has no hotel to rate. **So is Bantuan Pendamping when `pendampingSupport` is**: a
 * Pendamping is not asked it, and an evaluation filed before #481 holds none (ADR-0054). Either way
 * the row average was already taken over the ratings present, never counting a missing one as 0.
 */
function PerjadinCard({ row }: { row: PerjadinFeedbackRow }) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{row.filedByName}</span>
          <Badge variant="secondary">{row.filedByRole}</Badge>
          <span className="text-muted-foreground">·</span>
          <Link
            href={`/perjadin/${row.perjadinId}`}
            className="text-sm text-primary hover:underline"
          >
            {perjadinName(row)}
          </Link>
          <span className="ml-auto text-sm text-muted-foreground">Diisi {row.createdOn}</span>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Rata-rata
            <AverageBadge value={row.rowAverage} />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {row.lodging !== null && (
          <AspectRow
            label="Penginapan"
            score={row.lodging}
            comment={row.lodgingComment}
          />
        )}
        <AspectRow
          label="Transportasi"
          score={row.transport}
          comment={row.transportComment}
        />
        <AspectRow
          label="Konsumsi"
          score={row.meals}
          comment={row.mealsComment}
        />
        <AspectRow
          label="Ketepatan Waktu"
          score={row.punctuality}
          comment={row.punctualityComment}
        />
        {row.pendampingSupport !== null && (
          <AspectRow
            label="Bantuan Pendamping"
            score={row.pendampingSupport}
            comment={row.pendampingSupportComment}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One Aspect's line: its label, its score, and — only when there is one — the comment beneath.
 *
 * **The score's rendering is the concern signal.** A score at or below 7 is a red `destructive`
 * pill; a score above 7 is a plain bold number with no pill, so the eye lands on the low ones. A
 * missing score — a Siswa's Hands-on RBL filed before it was asked (#446) — reads "—".
 */
function AspectRow({
  label,
  score,
  comment,
}: {
  label: string;
  score: number | null;
  comment: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {score === null ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : score <= 7 ? (
          <Badge variant="destructive">{score}</Badge>
        ) : (
          <span className="text-sm font-bold">{score}</span>
        )}
      </div>
      {comment !== null && <Comment text={comment} />}
    </div>
  );
}

/** One written answer (#446) under its short heading, clamped like a comment. Never scored. */
function WrittenAnswer({ heading, text }: { heading: string; text: string }) {
  return (
    <div>
      <span className="text-sm font-medium">{heading}</span>
      <Comment text={text} />
    </div>
  );
}

/**
 * The row average as a pill: red `destructive` at or below 7, neutral `secondary` above it. Unlike
 * a single Aspect's score — where a high one is a bare number — the average is always a pill, so
 * the headline number reads as a headline whether the row is a concern or not.
 */
function AverageBadge({ value }: { value: number }) {
  return <Badge variant={value <= 7 ? "destructive" : "secondary"}>{value.toFixed(1)}</Badge>;
}

/**
 * A filer's comment, clamped to two lines with an inline "selengkapnya" / "sembunyikan" toggle.
 * Local state only — whether one comment is expanded is nobody else's business and not worth a URL.
 */
function Comment({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-1">
      <p
        className={
          expanded ? "text-sm text-muted-foreground" : "line-clamp-2 text-sm text-muted-foreground"
        }
      >
        {text}
      </p>
      <button
        type="button"
        className="mt-0.5 text-xs font-medium text-primary hover:underline"
        onClick={() => {
          setExpanded((previous) => !previous);
        }}
      >
        {expanded ? "sembunyikan" : "selengkapnya"}
      </button>
    </div>
  );
}

export { FeedbackView };
