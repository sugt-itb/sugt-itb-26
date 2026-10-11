import { formatWibDate } from "-/lib/format-wib";
import { requirePerson } from "-/lib/person";
import { hasGrant, keuanganExport, keuanganPerjadinOptions } from "@sugt/db/queries";
import { forbidden } from "next/navigation";

import { parseKeuanganParams } from "../keuangan-params";
import { keuanganCsv, keuanganCsvFileName } from "./keuangan-csv";

/**
 * **`/keuangan`'s export** (#472): every row of the page's filter, oldest first, as CSV. The text is
 * `./keuangan-csv`'s, a pure function of the rows; this handler signs in, refuses anyone without the
 * Keuangan Grant (an Administrator holds it implicitly) with the 403 the page gives, and sets the file
 * headers. It reads the same `perjadin`, `dari` and `sampai` the page does, through the same parser;
 * the page's sort and page are ignored — the export has its own order and no pages.
 *
 * A Route Handler rather than a Server Action, because the response is a file, as the Laporan export.
 */
export async function GET(request: Request) {
  const person = await requirePerson();
  if (!hasGrant(person, "Keuangan")) forbidden();

  const { filters } = parseKeuanganParams(Object.fromEntries(new URL(request.url).searchParams));
  const [rows, trips] = await Promise.all([
    keuanganExport(person, filters),
    filters.perjadinId === null ? [] : keuanganPerjadinOptions(person),
  ]);
  const trip = trips.find((option) => option.id === filters.perjadinId) ?? null;
  const fileName = keuanganCsvFileName(filters, trip, formatWibDate(new Date()));

  return new Response(keuanganCsv(rows), {
    headers: {
      // `charset=utf-8` is load-bearing: the categories are Indonesian and the descriptions are free
      // text, so a reader defaulting to a single-byte encoding mangles both.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      // Money, changing whenever a line does. Nothing caches it.
      "cache-control": "no-store",
    },
  });
}
