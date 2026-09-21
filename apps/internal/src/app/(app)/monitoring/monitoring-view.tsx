"use client";

import { formatIdr } from "@sugt/domain";
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
import { cn } from "@sugt/ui/lib/utils";
import { Check } from "lucide-react";

import type { MatrixRow, PretestMeter, TimelineStep } from "./monitoring-derive";

/**
 * The `/monitoring` view — the presentational half of the screen, now fed **real** figures. Every
 * number is derived on the server by `deriveMonitoring` (`./monitoring-derive.ts`) from the rows
 * `monitoringData` reads, and handed down as props; this component only lays them out — it holds no
 * client state of its own now.
 *
 * `showBudget` gates the money card (money reads are open, ADR-0026), decided on the server. The
 * Peringatan section that once lived here has moved to `MonitoringWarnings`, rendered above the tabs
 * so it shows on both (#235); this view is warnings-free now.
 */
export function MonitoringView({
  showBudget,
  activitiesPercent,
  budget,
  clusters,
  luring,
  daring,
  timeline,
  pretest,
}: {
  showBudget: boolean;
  activitiesPercent: number;
  budget: { usedIdr: number; totalIdr: number; percent: number };
  clusters: { id: string; name: string }[];
  luring: MatrixRow[];
  daring: MatrixRow[];
  timeline: TimelineStep[];
  pretest: PretestMeter[];
}) {
  return (
    <div className="flex flex-col gap-6 px-7 py-6">
      {/* KPI cards. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Kegiatan terlaksana</CardDescription>
            <CardTitle className="font-heading text-3xl tabular-nums">
              {activitiesPercent}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={activitiesPercent} />
          </CardContent>
        </Card>

        {showBudget && (
          <Card>
            <CardHeader>
              <CardDescription>Penyerapan anggaran</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="font-heading text-2xl tabular-nums">
                    Rp {formatIdr(budget.usedIdr)}
                  </div>
                  <div className="text-sm text-muted-foreground">Anggaran terpakai</div>
                </div>
                <div className="text-right">
                  <div className="font-heading text-2xl tabular-nums">
                    Rp {formatIdr(budget.totalIdr)}
                  </div>
                  <div className="text-sm text-muted-foreground">Total anggaran</div>
                </div>
              </div>
              <Progress value={budget.percent} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pretest progress — four read-only meters, grouped STEM / Research (#248). */}
      <PretestCard meters={pretest} />

      {/* Timeline / stepper — horizontal, derived from each step's status. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lini masa pelaksanaan</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline steps={timeline} />
        </CardContent>
      </Card>

      {/* The two delivery matrices — stacked on mobile, side by side on `md`. The calendar that
          once spanned the right column has moved to `/kalender` (#257). */}
      <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start">
        <MatrixCard
          title="Luring Terlaksana"
          clusters={clusters}
          rows={luring}
        />
        <MatrixCard
          title="Daring Terlaksana"
          clusters={clusters}
          rows={daring}
        />
      </div>
    </div>
  );
}

/**
 * The read-only Pretest tracker (#248): the four meters grouped into two labelled columns, STEM and
 * Research, each with a Siswa and a GTK-MS row. Every row reads `done / total` (the always-47
 * denominator), its percent, and a `Progress` bar — the same visual language as "Kegiatan
 * terlaksana". The streams are taken from the meters in the order the derive emits them (STEM then
 * Research), so this holds no vocabulary of its own. Editing lives on `/pretest`.
 */
function PretestCard({ meters }: { meters: PretestMeter[] }) {
  const streams = [...new Set(meters.map((m) => m.stream))];
  const total = meters[0]?.total ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardDescription>Progress Pretest</CardDescription>
        <CardTitle className="text-base">
          Sekolah yang telah menyelesaikan Pretest, dari {total} sekolah
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {streams.map((stream) => (
          <div
            key={stream}
            className="flex flex-col gap-3"
          >
            <div className="text-sm font-medium">{stream}</div>
            {meters
              .filter((m) => m.stream === stream)
              .map((m) => (
                <div
                  key={m.participantType}
                  className="flex flex-col gap-1.5"
                >
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{m.participantType}</span>
                    <span className="tabular-nums">
                      {m.done} / {m.total} · {m.percent}%
                    </span>
                  </div>
                  <Progress value={m.percent} />
                </div>
              ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** A horizontal stepper: a filled, checked circle for completed steps, a muted ring for pending. */
function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex items-start">
      {steps.map((step, i) => {
        const completed = step.status === "completed";
        return (
          <li
            key={step.label}
            className="flex flex-1 flex-col items-center text-center"
          >
            <div className="flex w-full items-center">
              <div className="flex-1" />
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  completed
                    ? "bg-primary text-primary-foreground"
                    : "border-2 border-muted-foreground/40 text-muted-foreground",
                )}
              >
                {completed ? (
                  <Check className="size-4" />
                ) : (
                  <span className="text-sm">{i + 1}</span>
                )}
              </div>
              <div
                className={cn(
                  "h-0.5 flex-1",
                  i < steps.length - 1 ? "bg-primary" : "bg-transparent",
                )}
              />
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">{step.label}</div>
            <div className="text-xs text-muted-foreground tabular-nums">{step.window}</div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One delivery matrix: a Klaster column per Cluster across, Sesi rows down, `"delivered/total"` per
 * cell. The column headers are the `clusters` prop's names in order, so a cell's `i`th value lines
 * up under the `i`th Cluster — the same order `deliveryMatrix` builds the cells in.
 */
function MatrixCard({
  title,
  clusters,
  rows,
}: {
  title: string;
  clusters: { id: string; name: string }[];
  rows: MatrixRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Klaster</TableHead>
                {clusters.map((c) => (
                  <TableHead key={c.id}>{c.name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.session}>
                  <TableCell className="font-medium">{row.session}</TableCell>
                  {row.cells.map((cell, i) => (
                    <TableCell
                      key={clusters[i]?.id ?? i}
                      className="tabular-nums"
                    >
                      {cell}
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
