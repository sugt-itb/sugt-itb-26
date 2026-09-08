"use client";

import { loadParticipantFeedback, loadPerjadinFeedback } from "-/app/(app)/feedback/actions";
import { MODE_LABELS } from "-/components/session-labels";
import { shortenKabupaten } from "-/lib/format-destination";
import type {
  FeedbackCursor,
  FeedbackFilters,
  FeedbackFilterValue,
  FeedbackSort,
  ParticipantFeedbackRow,
  PerjadinFeedbackCursor,
  PerjadinFeedbackFilters,
  PerjadinFeedbackRow,
} from "@sugt/db/queries";
import { formatSessionStartTime, type ClassKind } from "@sugt/domain";
import { Badge } from "@sugt/ui/components/badge";
import { Button } from "@sugt/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@sugt/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@sugt/ui/components/tabs";
import Link from "next/link";
import { useState, useTransition } from "react";

/**
 * **The Feedback screen.** Two tabs — Peserta (what Participants said about a Session) and Perjadin
 * (what a filer said about a trip) — each with summary cards that never move, server-side filters,
 * two sort dropdowns (average, then date), and an OFFSET-paged card list driven from its own Server
 * Action. The list is sorted lowest-average-first by default, so the rows that need attention rise.
 *
 * **The averages are props and stay props.** They are dataset-wide and unfiltered by design, so
 * nothing here recomputes them when the filters narrow the list; the cards read the overall standing
 * while the list below reads a slice of it.
 *
 * **Filtering, sorting and paging are the server's, not the browser's.** The set is unbounded — a
 * submission per Participant, an evaluation per filer — so the filters, the sort and "load more" all
 * go back to the query. A filter or sort change refetches the first page (cursor `null`) and REPLACES
 * the list, resetting paging; "load more" carries the current sort and the cursor (an OFFSET) and
 * APPENDS the next page.
 *
 * **Switching tabs resets filters, sort and pagination to defaults.** Each tab is its own child
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

/** GTK and MS keep their acronyms; a Participant of the student Class is a Siswa on screen. */
const CLASS_KIND_LABELS: Record<ClassKind, string> = {
  GTK: "GTK",
  MS: "MS",
  Student: "Siswa",
};

/** One filter's three options, in Indonesian. `label` prefixes name the column the filter gates. */
type FilterOptions = Record<FeedbackFilterValue, string>;

const REVIEW_TYPE_OPTIONS: FilterOptions = {
  all: "Semua Ulasan",
  le7: "Ulasan ≤ 7",
  gt7: "Ulasan > 7",
};

const INSTRUCTOR_OPTIONS: FilterOptions = {
  all: "Semua: Pengajar",
  le7: "Pengajar ≤ 7",
  gt7: "Pengajar > 7",
};

const MATERIALS_OPTIONS: FilterOptions = {
  all: "Semua: Materi",
  le7: "Materi ≤ 7",
  gt7: "Materi > 7",
};

const RELEVANCE_OPTIONS: FilterOptions = {
  all: "Semua: Relevansi",
  le7: "Relevansi ≤ 7",
  gt7: "Relevansi > 7",
};

const LODGING_OPTIONS: FilterOptions = {
  all: "Semua: Penginapan",
  le7: "Penginapan ≤ 7",
  gt7: "Penginapan > 7",
};

const TRANSPORT_OPTIONS: FilterOptions = {
  all: "Semua: Transportasi",
  le7: "Transportasi ≤ 7",
  gt7: "Transportasi > 7",
};

const MEALS_OPTIONS: FilterOptions = {
  all: "Semua: Konsumsi",
  le7: "Konsumsi ≤ 7",
  gt7: "Konsumsi > 7",
};

const PUNCTUALITY_OPTIONS: FilterOptions = {
  all: "Semua: Ketepatan Waktu",
  le7: "Ketepatan Waktu ≤ 7",
  gt7: "Ketepatan Waktu > 7",
};

function FeedbackView({
  participantInitialRows,
  participantInitialCursor,
  participantAverages,
  perjadinInitialRows,
  perjadinInitialCursor,
  perjadinAverages,
}: {
  participantInitialRows: ParticipantFeedbackRow[];
  participantInitialCursor: FeedbackCursor | null;
  participantAverages: { instructor: number; materials: number; relevance: number };
  perjadinInitialRows: PerjadinFeedbackRow[];
  perjadinInitialCursor: PerjadinFeedbackCursor | null;
  perjadinAverages: { lodging: number; transport: number; meals: number; punctuality: number };
}) {
  const [tab, setTab] = useState<Tab>("peserta");

  return (
    <div className="flex min-h-full flex-col p-7">
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
          averages={participantAverages}
        />
      ) : (
        <PerjadinTab
          initialRows={perjadinInitialRows}
          initialCursor={perjadinInitialCursor}
          averages={perjadinAverages}
        />
      )}
    </div>
  );
}

/**
 * The Peserta tab: three summary cards, four server-side filters, two sort dropdowns, and an
 * OFFSET-paged card list.
 *
 * A filter or sort change refetches the first page (cursor `null`) and REPLACES the list; "load
 * more" carries the current filters, sort and cursor and APPENDS what comes back. The pending state
 * covers each round trip so a second change cannot race the first.
 */
function ParticipantTab({
  initialRows,
  initialCursor,
  averages,
}: {
  initialRows: ParticipantFeedbackRow[];
  initialCursor: FeedbackCursor | null;
  averages: { instructor: number; materials: number; relevance: number };
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [filters, setFilters] = useState<FeedbackFilters>(ALL_FILTERS);
  const [sort, setSort] = useState<FeedbackSort>(DEFAULT_SORT);
  const [pending, startTransition] = useTransition();

  function changeFilter(key: keyof FeedbackFilters, value: FeedbackFilterValue) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    startTransition(async () => {
      const page = await loadParticipantFeedback(next, null, sort);
      setRows(page.rows);
      setCursor(page.nextCursor);
    });
  }

  function changeSort(next: FeedbackSort) {
    setSort(next);
    startTransition(async () => {
      const page = await loadParticipantFeedback(filters, null, next);
      setRows(page.rows);
      setCursor(page.nextCursor);
    });
  }

  function loadMore() {
    if (cursor === null) return;
    startTransition(async () => {
      const page = await loadParticipantFeedback(filters, cursor, sort);
      setRows((previous) => [...previous, ...page.rows]);
      setCursor(page.nextCursor);
    });
  }

  return (
    <>
      {/* The overall standing — dataset-wide, and unmoved by the filters below. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AverageCard
          label="Pengajar"
          value={averages.instructor}
        />
        <AverageCard
          label="Materi"
          value={averages.materials}
        />
        <AverageCard
          label="Relevansi"
          value={averages.relevance}
        />
      </div>

      {/* The two sort dropdowns. Each change refetches the first page and resets paging. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SortSelect
          ariaLabel="Urutkan nilai"
          options={SCORE_SORT_OPTIONS}
          value={sort.score}
          disabled={pending}
          onChange={(value) => {
            changeSort({ ...sort, score: value });
          }}
        />
        <SortSelect
          ariaLabel="Urutkan tanggal"
          options={DATE_SORT_OPTIONS}
          value={sort.date}
          disabled={pending}
          onChange={(value) => {
            changeSort({ ...sort, date: value });
          }}
        />
      </div>

      {/* The four server-side filters. Each change refetches the first page and resets paging. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          ariaLabel="Nilai Pengajar"
          options={INSTRUCTOR_OPTIONS}
          value={filters.instructor}
          disabled={pending}
          onChange={(value) => {
            changeFilter("instructor", value);
          }}
        />
        <FilterSelect
          ariaLabel="Nilai Materi"
          options={MATERIALS_OPTIONS}
          value={filters.materials}
          disabled={pending}
          onChange={(value) => {
            changeFilter("materials", value);
          }}
        />
        <FilterSelect
          ariaLabel="Nilai Relevansi"
          options={RELEVANCE_OPTIONS}
          value={filters.relevance}
          disabled={pending}
          onChange={(value) => {
            changeFilter("relevance", value);
          }}
        />
      </div>

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
 * The Perjadin tab: four summary cards, five server-side filters, two sort dropdowns, and an
 * OFFSET-paged card list. The shape is the Peserta tab's — the extra Aspect (`lodging`) is the only
 * difference — so the filter, sort and paging machinery is identical, just over `loadPerjadinFeedback`.
 */
function PerjadinTab({
  initialRows,
  initialCursor,
  averages,
}: {
  initialRows: PerjadinFeedbackRow[];
  initialCursor: PerjadinFeedbackCursor | null;
  averages: { lodging: number; transport: number; meals: number; punctuality: number };
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [filters, setFilters] = useState<PerjadinFeedbackFilters>(ALL_PERJADIN_FILTERS);
  const [sort, setSort] = useState<FeedbackSort>(DEFAULT_SORT);
  const [pending, startTransition] = useTransition();

  function changeFilter(key: keyof PerjadinFeedbackFilters, value: FeedbackFilterValue) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    startTransition(async () => {
      const page = await loadPerjadinFeedback(next, null, sort);
      setRows(page.rows);
      setCursor(page.nextCursor);
    });
  }

  function changeSort(next: FeedbackSort) {
    setSort(next);
    startTransition(async () => {
      const page = await loadPerjadinFeedback(filters, null, next);
      setRows(page.rows);
      setCursor(page.nextCursor);
    });
  }

  function loadMore() {
    if (cursor === null) return;
    startTransition(async () => {
      const page = await loadPerjadinFeedback(filters, cursor, sort);
      setRows((previous) => [...previous, ...page.rows]);
      setCursor(page.nextCursor);
    });
  }

  return (
    <>
      {/* The overall standing — dataset-wide, and unmoved by the filters below. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AverageCard
          label="Penginapan"
          value={averages.lodging}
        />
        <AverageCard
          label="Transportasi"
          value={averages.transport}
        />
        <AverageCard
          label="Konsumsi"
          value={averages.meals}
        />
        <AverageCard
          label="Ketepatan Waktu"
          value={averages.punctuality}
        />
      </div>

      {/* The two sort dropdowns. Each change refetches the first page and resets paging. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SortSelect
          ariaLabel="Urutkan nilai"
          options={SCORE_SORT_OPTIONS}
          value={sort.score}
          disabled={pending}
          onChange={(value) => {
            changeSort({ ...sort, score: value });
          }}
        />
        <SortSelect
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
      </div>

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

/** One summary card: the Aspect's name over its dataset-wide average, kept to one decimal. */
function AverageCard({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Nilai rata-rata · {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-medium">{value.toFixed(1)}</p>
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
 * One sort dropdown — the `FilterSelect` shape over a generic string value rather than the three
 * filter arms. Both the average sort (`asc`/`desc`) and the date tiebreak (`desc`/`asc`) drive one,
 * so the value type is the option map's own key. The value is always a valid key, so no placeholder.
 */
function SortSelect<T extends string>({
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
 * The header names who left it, from which Class, at which School, in which mode, on which Session
 * day and start time (in the School's zone), the day the Participant filed it ("Diisi"), and the
 * row average as the headline number. The mode label is the mode word only — `Luring` / `Daring` —
 * because the data model carries no session ordinal to number them with (#168).
 *
 * Below it, the three Aspects in a fixed order, each with its score and — when the Participant
 * left one — the comment they wrote about that Aspect.
 */
function ParticipantCard({ row }: { row: ParticipantFeedbackRow }) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{row.name}</span>
          <Badge variant="secondary">{CLASS_KIND_LABELS[row.classKind]}</Badge>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">{row.schoolName}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">{MODE_LABELS[row.sessionMode]}</span>
          <span className="text-muted-foreground">·</span>
          {/*
            The Session this feedback was filed against, linked through to its detail page (#194) —
            the Participant half of "every feedback links to its origin", parallel to how PerjadinCard
            links its destination. Routed by mode to skip the redirect hop (`/sesi/[id]` bounces an
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
            Sesi {row.heldOn} {formatSessionStartTime(row.startsAt, row.timeZone)}
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
          label="Pengajar"
          score={row.instructor}
          comment={row.instructorComment}
        />
        <AspectRow
          label="Materi"
          score={row.materials}
          comment={row.materialsComment}
        />
        <AspectRow
          label="Relevansi"
          score={row.relevance}
          comment={row.relevanceComment}
        />
      </CardContent>
    </Card>
  );
}

/**
 * One Perjadin Evaluation.
 *
 * The header names who filed it (`filedByName`), a badge for their self-declared role, the trip's
 * destination linking to `/perjadin/[id]` — the one card here that links, because a trip has a home
 * page a submission does not — the trip's date range, the day the filer filed it ("Diisi"), and the
 * row average as the headline number.
 *
 * Below it, the four Aspects in a fixed order, each with its score and — when the filer left one —
 * the comment about that Aspect. **The Penginapan row is omitted entirely when `lodging` is null**:
 * a day trip has no hotel to rate, and its average was already taken over the three present ratings.
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
            {shortenKabupaten(row.destination)}
          </Link>
          <span className="text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">
            {row.startsOn} - {row.endsOn}
          </span>
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
      </CardContent>
    </Card>
  );
}

/**
 * One Aspect's line: its label, its score, and — only when there is one — the comment beneath.
 *
 * **The score's rendering is the concern signal.** A score at or below 7 is a red `destructive`
 * pill; a score above 7 is a plain bold number with no pill, so the eye lands on the low ones.
 */
function AspectRow({
  label,
  score,
  comment,
}: {
  label: string;
  score: number;
  comment: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {score <= 7 ? (
          <Badge variant="destructive">{score}</Badge>
        ) : (
          <span className="text-sm font-bold">{score}</span>
        )}
      </div>
      {comment !== null && <Comment text={comment} />}
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
