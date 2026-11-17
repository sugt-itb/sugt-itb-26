"use client";

import type { KeuanganDate, KeuanganKelompok, KeuanganSheet } from "-/lib/keuangan-sheet";
import { formatRupiah } from "@sugt/domain";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@sugt/ui/components/table";
import { cn } from "@sugt/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";

/**
 * **`/keuangan`'s tables** (#550): one summary row per Kelompok, in sheet order, and a grand total.
 * Opening a Kelompok expands it in place to its rows. The rows are already in the page — rendered
 * `hidden` until opened — so opening is state, not a fetch.
 *
 * Text appears exactly as the sheet has it: Kelompok names, Kegiatan and Link labels are not cleaned
 * up. A row whose own Kegiatan is empty shows a blank one rather than repeating its Budget Line.
 * Money is `formatRupiah`, rounded to the rupiah for display only; a negative Sisa is marked.
 *
 * Both tables are `@sugt/ui`'s `Table`, whose box scrolls sideways on its own, so a phone scrolls the
 * table and not the page.
 */
export function KeuanganTable({ sheet }: { sheet: KeuanganSheet }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kelompok</TableHead>
          <MoneyHead>Alokasi</MoneyHead>
          <MoneyHead>Realisasi</MoneyHead>
          <MoneyHead>Sisa</MoneyHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sheet.kelompok.map((kelompok, index) => {
          const isOpen = open.has(index);
          const rowsId = `kelompok-${index}-rows`;
          return (
            <Fragment key={rowsId}>
              <TableRow>
                <TableCell>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={rowsId}
                    onClick={() => {
                      setOpen((current) => toggled(current, index));
                    }}
                    className="flex items-center gap-1.5 rounded-sm text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-90")}
                    />
                    <span>{firstLine(kelompok.name)}</span>
                  </button>
                </TableCell>
                <MoneyCell value={kelompok.totals.alokasi} />
                <MoneyCell value={kelompok.totals.realisasi} />
                <MoneyCell
                  value={kelompok.totals.sisa}
                  marksNegative
                />
              </TableRow>
              <TableRow
                id={rowsId}
                hidden={!isOpen}
                className="bg-muted/30 hover:bg-muted/30"
              >
                <TableCell
                  colSpan={4}
                  className="p-3"
                >
                  <KelompokRows kelompok={kelompok} />
                </TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-medium">Total</TableCell>
          <MoneyCell value={sheet.totals.alokasi} />
          <MoneyCell value={sheet.totals.realisasi} />
          <MoneyCell
            value={sheet.totals.sisa}
            marksNegative
          />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** Which Kelompok are open after one is pressed: it opens if closed and closes if open. */
export function toggled(open: ReadonlySet<number>, index: number): ReadonlySet<number> {
  const next = new Set(open);
  if (!next.delete(index)) next.add(index);
  return next;
}

/** One Kelompok, opened: its full text, Schools and all, then its rows with the sheet's own values. */
function KelompokRows({ kelompok }: { kelompok: KeuanganKelompok }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm whitespace-pre-line text-muted-foreground">{kelompok.name.trim()}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tanggal</TableHead>
            <TableHead>Kegiatan</TableHead>
            <TableHead>Link</TableHead>
            <MoneyHead>Alokasi</MoneyHead>
            <MoneyHead>Realisasi</MoneyHead>
            <MoneyHead>Sisa</MoneyHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {kelompok.rows.map((row) => (
            <TableRow key={row.sheetRow}>
              <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
              <TableCell className="whitespace-pre-line">{row.kegiatan}</TableCell>
              <TableCell>
                {row.link?.url ? (
                  <a
                    href={row.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    {row.link.label}
                  </a>
                ) : (
                  row.link?.label
                )}
              </TableCell>
              <MoneyCell value={row.alokasi?.amount ?? null} />
              <MoneyCell value={row.realisasi} />
              <MoneyCell
                value={row.sisa}
                marksNegative
              />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MoneyHead({ children }: { children: React.ReactNode }) {
  return <TableHead className="text-right">{children}</TableHead>;
}

/** An amount, rounded to the rupiah; blank when the sheet has none. A negative Sisa is marked. */
function MoneyCell({
  value,
  marksNegative = false,
}: {
  value: number | null;
  marksNegative?: boolean;
}) {
  if (value === null) return <TableCell />;
  const rounded = Math.round(value);
  const negative = marksNegative && rounded < 0;
  return (
    <TableCell className="text-right whitespace-nowrap tabular-nums">
      <span
        data-negative={negative ? "true" : undefined}
        className={cn(negative && "font-medium text-destructive")}
      >
        {formatRupiah(rounded)}
      </span>
    </TableCell>
  );
}

/** A Kelompok's name in the summary: its first line, the Schools under it left for the open view. */
function firstLine(name: string): string {
  return name.trim().split("\n")[0]!.trim();
}

const MONTH = new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" });

/** `12 Okt 2026`, `Okt 2026` for a row with no Tgl, blank for a row with no date. */
function formatDate(date: KeuanganDate | null): string {
  if (!date) return "";
  const month = MONTH.format(new Date(Date.UTC(date.year, date.month - 1, 1)));
  return date.day === null ? `${month} ${date.year}` : `${date.day} ${month} ${date.year}`;
}
