"use client";

import { loadParticipantFeedbackCharts } from "-/app/(app)/feedback/actions";
import {
  ALL_CHART_PARTS,
  chartParticipantTypes,
  participantChartFigure,
  type ChartParts,
  type ParticipantChartData,
} from "-/components/feedback-chart";
import { chartPngFileName } from "-/components/feedback-chart-export";
import { ParticipantChartFigure } from "-/components/feedback-chart-figure";
import { downloadChartPng } from "-/components/feedback-chart-png";
import { formatWibDate } from "-/lib/format-wib";
import type { FeedbackSchoolOption, ParticipantFeedbackScope } from "@sugt/db/queries";
import { Button } from "@sugt/ui/components/button";
import { Checkbox } from "@sugt/ui/components/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import { Label } from "@sugt/ui/components/label";
import { Skeleton } from "@sugt/ui/components/skeleton";
import { useId, useRef, useState, useTransition } from "react";

/** The four checkboxes, in order, with the part of every figure each one shows. */
const PART_LABELS: Record<keyof ChartParts, string> = {
  title: "Judul",
  legend: "Legenda",
  labels: "Label",
  values: "Nilai",
};

/**
 * **Lihat Grafik** (#510, #514, #516): the Peserta tab's donut charts, one figure per Tipe Peserta,
 * in a wide dialog. It has **no pickers of its own** — it reads the tab's scope as it was when it
 * opened, and fetches its figures then, a skeleton standing in until they land. The score filters
 * never reach it, as they never reach the average cards.
 *
 * Mounted for as long as the tab is, so the four checkboxes' choice outlives closing the dialog;
 * switching tabs unmounts the tab and resets it, like every other `/feedback` choice.
 */
function ParticipantChartDialog({
  scope,
  schools,
}: {
  scope: ParticipantFeedbackScope;
  schools: FeedbackSchoolOption[];
}) {
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<ChartParts>(ALL_CHART_PARTS);
  // The figures and the scope they were read for travel together, so a title never names a scope
  // its donuts are not over. `null` while they load.
  const [charts, setCharts] = useState<{
    data: ParticipantChartData[];
    scope: ParticipantFeedbackScope;
  } | null>(null);
  const [, startTransition] = useTransition();
  // Only the latest opening's read may land: close and reopen on a new scope before the first
  // returns, and the first is dropped.
  const latest = useRef(0);
  const idPrefix = useId();
  const figureCount = charts?.data.length ?? chartParticipantTypes(scope.participantType).length;

  function openWith(snapshot: ParticipantFeedbackScope) {
    setCharts(null);
    const request = ++latest.current;
    startTransition(async () => {
      const data = await loadParticipantFeedbackCharts(snapshot);
      if (request === latest.current) setCharts({ data, scope: snapshot });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) openWith(scope);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
          />
        }
      >
        Lihat Grafik
      </DialogTrigger>
      <DialogContent size="panel">
        <DialogHeader>
          <DialogTitle>Grafik masukan Peserta</DialogTitle>
          <DialogDescription>
            Nilai rata-rata tiap Aspek per Tipe Peserta, untuk Sekolah, Sesi dan Tipe Peserta yang
            dipilih. Saringan nilai tidak berlaku.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap gap-x-5 gap-y-2">
          {(Object.keys(PART_LABELS) as (keyof ChartParts)[]).map((part) => (
            <div
              key={part}
              className="flex items-center gap-2"
            >
              <Checkbox
                id={`${idPrefix}-${part}`}
                checked={parts[part]}
                onCheckedChange={(checked) => {
                  setParts((previous) => ({ ...previous, [part]: checked === true }));
                }}
              />
              <Label
                htmlFor={`${idPrefix}-${part}`}
                className="cursor-pointer font-normal"
              >
                {PART_LABELS[part]}
              </Label>
            </div>
          ))}
        </div>

        <DialogBody>
          {/* Side by side when there is room, stacked when not; a lone figure keeps a readable width. */}
          <div
            className={
              figureCount === 1
                ? "mx-auto grid w-full max-w-2xl grid-cols-1 gap-4"
                : "grid grid-cols-1 gap-4 md:grid-cols-2"
            }
          >
            {charts === null
              ? Array.from({ length: figureCount }, (_, index) => (
                  <Skeleton
                    key={index}
                    className="aspect-[3/2] w-full"
                  />
                ))
              : charts.data.map((chart) => (
                  <ParticipantChartPanel
                    key={chart.participantType}
                    chart={chart}
                    scope={charts.scope}
                    schools={schools}
                    parts={parts}
                  />
                ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One figure in its frame, with **Unduh PNG** (#511) under it — none on a "Belum ada tanggapan"
 * figure, which has nothing to report. The download is the figure as it stands, so the four
 * checkboxes decide what is in the image exactly as on screen.
 */
function ParticipantChartPanel({
  chart,
  scope,
  schools,
  parts,
}: {
  chart: ParticipantChartData;
  scope: ParticipantFeedbackScope;
  schools: FeedbackSchoolOption[];
  parts: ChartParts;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  const figure = participantChartFigure(schools, scope, chart);

  async function download() {
    if (svg.current === null) return;
    setExporting(true);
    setFailed(false);
    try {
      await downloadChartPng(
        svg.current,
        chartPngFileName(schools, scope, chart.participantType, formatWibDate(new Date())),
      );
    } catch (error) {
      console.error("Unduh PNG failed", error);
      setFailed(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-2">
      <ParticipantChartFigure
        ref={svg}
        figure={figure}
        parts={parts}
      />
      {!figure.empty && (
        <div className="flex items-center justify-end gap-3 p-1">
          {failed && <p className="text-sm text-destructive">Gagal membuat PNG. Coba lagi.</p>}
          <Button
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={download}
          >
            {exporting ? "Menyiapkan…" : "Unduh PNG"}
          </Button>
        </div>
      )}
    </div>
  );
}

export { ParticipantChartPanel, ParticipantChartDialog };
