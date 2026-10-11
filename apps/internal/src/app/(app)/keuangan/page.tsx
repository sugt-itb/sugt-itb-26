import { StickyTable, StickyTableHeader } from "-/components/sortable-table";
import { UnsyncedMarker } from "-/components/unsynced-marker";
import { driveFileUrl } from "-/lib/drive/receipt-files";
import { RECEIPTS_UNSYNCED } from "-/lib/drive/upload-messages";
import { perjadinName } from "-/lib/perjadin-name";
import { requirePerson } from "-/lib/person";
import {
  hasGrant,
  KEUANGAN_RECEIPT_LINKS,
  keuanganPage,
  keuanganPerjadinOptions,
  type KeuanganRow,
  type KeuanganSort,
  type KeuanganSortKey,
} from "@sugt/db/queries";
import { formatRupiah } from "@sugt/domain";
import { Button } from "@sugt/ui/components/button";
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import { LinkButton } from "@sugt/ui/components/link-button";
import { TableBody, TableCell, TableHead, TableRow } from "@sugt/ui/components/table";
import { cn } from "@sugt/ui/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import {
  keuanganExportHref,
  keuanganHref,
  type KeuanganView,
  parseKeuanganParams,
  sortAfterClick,
} from "./keuangan-params";
import { PerjadinPicker } from "./perjadin-picker";

export const metadata: Metadata = { title: "Keuangan" };

/**
 * **Keuangan** (#472, ADR-0053) — every money Transaction across every Perjadin, as one table, for a
 * Keuangan holder or an Administrator. Anyone else, a Pimpinan included, gets `forbidden()` and the
 * 403; the sidebar hides the link from the same people, and every query checks the Grant again.
 *
 * **Everything the view shows is in the URL** (`?perjadin=&dari=&sampai=&urut=&arah=&page=`), so a
 * view can be bookmarked and **Ekspor CSV** exports exactly its filter: the filters are a plain GET
 * form, each sortable header a link, and paging two links. Filtering, sorting and paging all run on the
 * server over the whole filtered set, 50 a page; the summary line counts and totals that whole set.
 *
 * The table is wider than a phone, so it scrolls sideways inside its own box (`StickyTable`), never
 * the page; the filters stack.
 */
export default async function Page({ searchParams }: PageProps<"/keuangan">) {
  const person = await requirePerson();
  if (!hasGrant(person, "Keuangan")) forbidden();

  const view = parseKeuanganParams(await searchParams);
  const [result, options] = await Promise.all([
    keuanganPage(person, view),
    keuanganPerjadinOptions(person),
  ]);
  const filtered = Boolean(view.filters.perjadinId || view.filters.dari || view.filters.sampai);
  const current = { ...view, page: result.page };

  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <h1 className="font-heading text-lg font-medium">Keuangan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Semua transaksi dari setiap Perjadin, dengan buktinya. Saring menurut Perjadin atau
          tanggal mulai Perjadin, lalu ekspor yang tersaring.
        </p>
      </header>

      <form
        action="/keuangan"
        method="get"
        className="flex flex-wrap items-end gap-3 px-4 pt-5 sm:px-7"
      >
        <div className="grid w-full gap-1.5 sm:w-80">
          <Label htmlFor="keuangan-perjadin">Perjadin</Label>
          <PerjadinPicker
            options={options}
            initial={view.filters.perjadinId}
          />
        </div>
        {/* Below `sm` the dates stack and take the whole width, as on `/log`. */}
        <fieldset className="grid w-full min-w-0 gap-1.5 sm:w-auto">
          <legend className="mb-1.5 text-sm font-medium">Tanggal mulai Perjadin</legend>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              name="dari"
              type="date"
              aria-label="Dari tanggal"
              defaultValue={view.entered.dari ?? ""}
              className="w-full sm:w-40"
            />
            <span className="text-sm text-muted-foreground">sampai</span>
            <Input
              name="sampai"
              type="date"
              aria-label="Sampai tanggal"
              defaultValue={view.entered.sampai ?? ""}
              className="w-full sm:w-40"
            />
          </div>
        </fieldset>
        <Button type="submit">Terapkan</Button>
        {(filtered || view.rangeReversed) && (
          <LinkButton
            variant="ghost"
            render={<Link href="/keuangan" />}
          >
            Hapus saringan
          </LinkButton>
        )}
      </form>
      {view.rangeReversed && (
        <p className="px-4 pt-2 text-sm text-destructive sm:px-7">
          Tanggal &ldquo;dari&rdquo; jatuh setelah &ldquo;sampai&rdquo;, jadi rentang tanggal tidak
          diterapkan.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-5 sm:px-7">
        <p className="text-sm tabular-nums">
          {result.total} transaksi · {formatRupiah(result.totalIdr)}
        </p>
        <LinkButton
          variant="outline"
          size="sm"
          render={<a href={keuanganExportHref(view.filters)} />}
        >
          Ekspor CSV
        </LinkButton>
      </div>

      {result.rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground sm:px-7">
          {filtered
            ? "Tidak ada transaksi yang cocok dengan saringan ini."
            : "Belum ada transaksi."}
        </p>
      ) : (
        <div className="mt-3 px-2 sm:px-5">
          <StickyTable>
            <StickyTableHeader>
              <TableRow>
                <SortHead
                  view={current}
                  column="spentOn"
                >
                  Tanggal Transaksi
                </SortHead>
                <SortHead
                  view={current}
                  column="category"
                >
                  Kategori
                </SortHead>
                <SortHead
                  view={current}
                  column="description"
                >
                  Keterangan
                </SortHead>
                <SortHead
                  view={current}
                  column="perjadin"
                >
                  Perjadin
                </SortHead>
                <SortHead
                  view={current}
                  column="participantType"
                >
                  Tipe Peserta
                </SortHead>
                <SortHead
                  view={current}
                  column="amountIdr"
                  className="text-right"
                >
                  Jumlah (Rp)
                </SortHead>
                {Array.from({ length: KEUANGAN_RECEIPT_LINKS }, (_, index) => (
                  <TableHead key={index}>Link Bukti {index + 1}</TableHead>
                ))}
              </TableRow>
            </StickyTableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <KeuanganTableRow
                  key={row.id}
                  row={row}
                />
              ))}
            </TableBody>
          </StickyTable>
        </div>
      )}

      <nav
        aria-label="Halaman"
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 text-sm text-muted-foreground sm:px-7"
      >
        <span>
          Halaman {result.page} dari {result.pageCount}
        </span>
        <div className="flex gap-2">
          {result.page > 1 && (
            <LinkButton
              variant="outline"
              size="sm"
              render={<Link href={keuanganHref({ ...current, page: result.page - 1 }) as Route} />}
            >
              Sebelumnya
            </LinkButton>
          )}
          {result.page < result.pageCount && (
            <LinkButton
              variant="outline"
              size="sm"
              render={<Link href={keuanganHref({ ...current, page: result.page + 1 }) as Route} />}
            >
              Berikutnya
            </LinkButton>
          )}
        </div>
      </nav>
    </div>
  );
}

/**
 * A sortable header, as a link: the sort `/perjadin`'s headers make — a new column descending first,
 * the sorted one flipped — but carried in the URL and applied on the server, back to page one.
 */
function SortHead({
  view,
  column,
  className,
  children,
}: {
  view: Pick<KeuanganView, "filters" | "sort">;
  column: KeuanganSortKey;
  className?: string;
  children: React.ReactNode;
}) {
  const sorted = view.sort.key === column;
  const Icon = !sorted ? ArrowUpDown : view.sort.direction === "asc" ? ArrowUp : ArrowDown;
  const next: KeuanganSort = sortAfterClick(view.sort, column);

  return (
    <TableHead
      aria-sort={!sorted ? "none" : view.sort.direction === "asc" ? "ascending" : "descending"}
      className={className}
    >
      <Link
        href={keuanganHref({ filters: view.filters, sort: next, page: 1 }) as Route}
        className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        {children}
        <Icon
          aria-hidden
          className={cn("size-3.5", !sorted && "text-muted-foreground/60")}
        />
      </Link>
    </TableHead>
  );
}

function KeuanganTableRow({ row }: { row: KeuanganRow }) {
  return (
    <TableRow className="align-top">
      <TableCell className="tabular-nums">
        {row.spentOn}
        {row.driveSyncedAt === null && row.receiptFileIds.length > 0 && (
          <div>
            <UnsyncedMarker explanation={RECEIPTS_UNSYNCED} />
          </div>
        )}
      </TableCell>
      <TableCell>{row.category}</TableCell>
      <TableCell className="min-w-48 whitespace-normal">{row.description}</TableCell>
      <TableCell className="min-w-48 whitespace-normal">
        <Link
          href={`/perjadin/${row.perjadin.id}/laporan`}
          className="underline-offset-4 hover:underline"
        >
          {perjadinName(row.perjadin)}
        </Link>
      </TableCell>
      <TableCell>{row.participantType}</TableCell>
      <TableCell className="text-right tabular-nums">{formatRupiah(row.amountIdr)}</TableCell>
      {Array.from({ length: KEUANGAN_RECEIPT_LINKS }, (_, index) => {
        const fileId = row.receiptFileIds[index];
        return (
          <TableCell key={index}>
            {fileId !== undefined && (
              <a
                href={driveFileUrl(fileId)}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Buka ↗
              </a>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
