"use client";

import { formatIdr } from "@sugt/domain";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@sugt/ui/components/accordion";
import { Alert, AlertAction, AlertDescription } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
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
import { useState } from "react";

import type { MatrixRow, TimelineStep } from "./monitoring-derive";
import { dismissWarning, initialWarningState, type Warning } from "./monitoring-state";

/**
 * The `/monitoring` view — the presentational half of the screen, now fed **real** figures. Every
 * number is derived on the server by `deriveMonitoring` (`./monitoring-derive.ts`) from the rows
 * `monitoringData` reads, and handed down as props; this component only lays them out and moves the
 * one piece of client state — the operator setting a warning aside.
 *
 * That state is deliberately ephemeral. `useState` seeds the two warning lists once from the
 * `warnings` prop and the reducer (`dismissWarning`, the pure seam in `monitoring-state.ts`) moves
 * an item from `active` to `ignored` on **Abaikan** — a browser-only interaction with no
 * persistence, which is right for a warning that is recomputed from the data on the next load.
 * `showBudget` gates the money card (money reads are open, ADR-0026), decided on the server.
 */
export function MonitoringView({
  showBudget,
  activitiesPercent,
  budget,
  clusters,
  luring,
  daring,
  timeline,
  warnings,
}: {
  showBudget: boolean;
  activitiesPercent: number;
  budget: { usedIdr: number; totalIdr: number; percent: number };
  clusters: { id: string; name: string }[];
  luring: MatrixRow[];
  daring: MatrixRow[];
  timeline: TimelineStep[];
  warnings: Warning[];
}) {
  const [state, setState] = useState(() => initialWarningState(warnings));

  return (
    <div className="flex flex-col gap-6 px-7 py-6">
      {/* Active warnings — one destructive Alert each; Abaikan sets it aside. */}
      {state.active.map((w) => (
        <Alert
          key={w.id}
          variant="destructive"
        >
          <AlertDescription>{w.message}</AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setState((s) => dismissWarning(s, w.id))}
            >
              Abaikan
            </Button>
          </AlertAction>
        </Alert>
      ))}

      {/* Ignored warnings — always rendered, populates live as warnings are set aside. */}
      <Accordion>
        <AccordionItem>
          <AccordionTrigger>Peringatan yang diabaikan</AccordionTrigger>
          <AccordionPanel>
            {state.ignored.length === 0 ? (
              <p>Belum ada.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {state.ignored.map((w) => (
                  <li key={w.id}>{w.message}</li>
                ))}
              </ul>
            )}
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

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

      {/* Timeline / stepper — horizontal, derived from each step's status. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lini masa pelaksanaan</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline steps={timeline} />
        </CardContent>
      </Card>

      {/* Delivery matrices, one Card each. */}
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
