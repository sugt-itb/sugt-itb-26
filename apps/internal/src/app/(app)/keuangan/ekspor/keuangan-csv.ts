import { csvDocument } from "-/lib/csv";
import { driveFileUrl } from "-/lib/drive/receipt-files";
import { perjadinName, slugify } from "-/lib/perjadin-name";
import {
  KEUANGAN_RECEIPT_LINKS,
  type KeuanganFilters,
  type KeuanganPerjadinOption,
  type KeuanganRow,
} from "@sugt/db/queries";

/**
 * **`/keuangan`'s export, as pure text** (#472): one row per transaction, oldest first as
 * `keuanganExport` hands them over, and nothing else — no Perjadin column, by decision, and no total
 * row; the page's summary line carries the total. Written by the shared `csvDocument`, the same as the
 * Laporan export: a BOM, every field quoted, a formula-looking text cell guarded. Jumlah goes in as a
 * number, so a spreadsheet reads it as one; each receipt is its full Drive URL as plain text.
 */
export function keuanganCsv(rows: readonly KeuanganRow[]): string {
  const links = Array.from({ length: KEUANGAN_RECEIPT_LINKS }, (_, index) => index);
  return csvDocument([
    [
      "Tanggal Transaksi",
      "Kategori",
      "Keterangan",
      "Tipe Peserta",
      "Jumlah (Rp)",
      ...links.map((index) => `Link Bukti ${index + 1}`),
    ],
    ...rows.map((row) => [
      row.spentOn,
      row.category,
      row.description,
      row.participantType,
      row.amountIdr,
      ...links.map((index) => {
        const fileId = row.receiptFileIds[index];
        return fileId === undefined ? "" : driveFileUrl(fileId);
      }),
    ]),
  ]);
}

/**
 * `keuangan-<filter>-<today>.csv`: `semua` with no filter, else the Perjadin's name slugified and the
 * date range as `dari_sampai` (an open end left blank), joined by `-`. `today` is the WIB day.
 */
export function keuanganCsvFileName(
  filters: KeuanganFilters,
  trip: KeuanganPerjadinOption | null,
  today: string,
): string {
  const parts = [
    trip ? slugify(perjadinName(trip)) : null,
    filters.dari || filters.sampai ? `${filters.dari ?? ""}_${filters.sampai ?? ""}` : null,
  ].filter((part): part is string => part !== null);
  return `keuangan-${parts.length > 0 ? parts.join("-") : "semua"}-${today}.csv`;
}
