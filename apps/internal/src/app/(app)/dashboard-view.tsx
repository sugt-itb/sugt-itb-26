"use client";

import { formatRupiah } from "@sugt/domain";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@sugt/ui/components/card";
import { Progress } from "@sugt/ui/components/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sugt/ui/components/table";

import type { PivotTable, ProgressSummary } from "./dashboard-derive";

/**
 * The Dashboard view — the presentational half of the screen, now fed **real** figures. Every
 * number is derived on the server by `deriveDashboard` (`./dashboard-derive.ts`) from the rows
 * `monitoringData` reads, and handed down as props; this component only lays them out — it holds no
 * client state of its own now.
 *
 * The tab reads, top to bottom (#313): the two KPI cards (Kegiatan terlaksana + the budget), a row
 * of four progress summary cards, the two pivoted delivery tables, then the two assessment tables —
 * every one a Klaster-row `"X/Y"` pivot. `showBudget` gates the money card (money reads are open,
 * ADR-0026), decided on the server. The Peringatan section that once lived here has moved to
 * `DashboardWarnings`, rendered above the tabs so it shows on both (#235); this view is
 * warnings-free now.
 */
export function DashboardView({
  showBudget,
  activitiesPercent,
  budget,
  summary,
  luring,
  daring,
  pretestTable,
  postestTable,
}: {
  showBudget: boolean;
  activitiesPercent: number;
  budget: { usedIdr: number; totalIdr: number; percent: number };
  summary: ProgressSummary;
  luring: PivotTable;
  daring: PivotTable;
  pretestTable: PivotTable;
  postestTable: PivotTable;
}) {
  return (
    <div className="flex flex-col gap-6 px-7 py-6">
      {/* KPI cards. Both are equal-height flex columns (the grid stretches them), each with a
          label-only header; the value text pins to the top of the content and the progress bar to the
          bottom (`justify-between`). So the two cards' value rows line up and their bars line up, even
          though the budget card's value block is taller than the activities card's single percentage
          (#329) — earlier the activities `%` sat in a two-row header and the two cards' bars diverged. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardDescription>Kegiatan Terlaksana</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-4">
            <div className="font-heading text-3xl tabular-nums">{activitiesPercent}%</div>
            <Progress value={activitiesPercent} />
          </CardContent>
        </Card>

        {showBudget && (
          <Card className="flex flex-col">
            <CardHeader>
              <CardDescription>Penyerapan Anggaran</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              {/* Stacked on a narrow phone (long rupiah figures collide side-by-side at ~320px),
                  side-by-side from `sm:` up. `min-w-0` lets a long value shrink rather than force
                  overflow; the number steps down to `text-lg` on mobile and the right block only
                  right-aligns once it is a row. Figures stay full and exact — a money surface. */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="font-heading text-lg tabular-nums sm:text-2xl">
                    {formatRupiah(budget.usedIdr)}
                  </div>
                  <div className="text-sm text-muted-foreground">Anggaran terpakai</div>
                </div>
                <div className="min-w-0 sm:text-right">
                  <div className="font-heading text-lg tabular-nums sm:text-2xl">
                    {formatRupiah(budget.totalIdr)}
                  </div>
                  <div className="text-sm text-muted-foreground">Total anggaran</div>
                </div>
              </div>
              <Progress value={budget.percent} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Four progress summary cards, left→right (#313): two-up on a phone, four across on `md`. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard
          label="Progress Pretest"
          percent={summary.pretest}
        />
        <SummaryCard
          label="Progress Daring"
          percent={summary.daring}
        />
        <SummaryCard
          label="Progress Luring"
          percent={summary.luring}
        />
        <SummaryCard
          label="Progress Posttest"
          percent={summary.posttest}
        />
      </div>

      {/* The two delivery tables — Klaster rows, Sesi columns — stacked on mobile, side by side on
          `md`. The calendar that once spanned the right column has moved to `/kalender` (#257). */}
      <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start">
        <MatrixCard
          title="Luring Terlaksana"
          table={luring}
        />
        <MatrixCard
          title="Daring Terlaksana"
          table={daring}
        />
      </div>

      {/* The two assessment tables — Klaster rows, Stream ∙ Peserta columns (#313). Postest reads
          all `0/Y` until posttest data-entry lands; the surface is honest by construction. */}
      <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start">
        <MatrixCard
          title="Pretest Terlaksana"
          table={pretestTable}
        />
        <MatrixCard
          title="Postest Terlaksana"
          table={postestTable}
        />
      </div>
    </div>
  );
}

/** One progress summary card: a label and a single whole-number percentage (#313). */
function SummaryCard({ label, percent }: { label: string; percent: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-3xl tabular-nums">{percent}%</CardTitle>
      </CardHeader>
    </Card>
  );
}

/**
 * One pivoted table: Klaster rows down, `table.columns` across, `"X/Y"` per cell (#313). A cell's
 * `i`th value lines up under the `i`th column — the same order the derive builds each row's cells
 * in, whether the columns are Sesi labels (delivery) or `stream|participantType` keys (assessment).
 * When `table.groups` is set (the assessment tables, #329) the header is two rows — each Stream group
 * spanning its Peserta sub-columns; otherwise it is the single flat row the delivery tables use.
 */
function MatrixCard({ title, table }: { title: string; table: PivotTable }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.groups ? (
                <>
                  <TableRow>
                    <TableHead rowSpan={2}>Klaster</TableHead>
                    {table.groups.map((group) => (
                      <TableHead
                        key={group.label}
                        colSpan={group.subColumns.length}
                        className="text-center"
                      >
                        {group.label}
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow>
                    {table.groups.flatMap((group) =>
                      group.subColumns.map((sub) => (
                        <TableHead key={`${group.label}-${sub}`}>{sub}</TableHead>
                      )),
                    )}
                  </TableRow>
                </>
              ) : (
                <TableRow>
                  <TableHead>Klaster</TableHead>
                  {table.columns.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {table.rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  {row.cells.map((cell, i) => (
                    <TableCell
                      key={table.columns[i] ?? i}
                      className="tabular-nums"
                    >
                      <FractionCell value={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One `"n/m"` fraction cell, with the `/` and the denominator dimmed so the numerator — the value
 * that matters — reads first (#335). The subtle half takes `text-muted-foreground`, the app's
 * established still-AA-legible muted token, so the denominator stays readable in both themes. This is
 * a purely presentational split: the cell string is still built whole in `dashboard-derive.ts`, and
 * a cell that is not an `n/m` fraction (the guard) renders unchanged.
 */
function FractionCell({ value }: { value: string }) {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (match === null) return value;
  return (
    <>
      {match[1]}
      <span className="text-muted-foreground">/{match[2]}</span>
    </>
  );
}
