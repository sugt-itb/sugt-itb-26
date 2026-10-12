import { formatWibDate } from "-/lib/format-wib";
import { requirePerson } from "-/lib/person";
import { perjadinFeedbackExport, perjadinFeedbackTrips } from "@sugt/db/queries";

import { parsePerjadinExportParams } from "../../feedback-params";
import { perjadinFeedbackCsv, perjadinFeedbackCsvFileName } from "../feedback-csv";

/**
 * **The Perjadin tab's export** (#490), the twin of the Peserta tab's: every evaluation the tab's
 * Perjadin, Peran and score filters match, across all pages, in the tab's sort, as CSV. Open to
 * anyone signed in, as `/feedback` is (ADR-0004).
 */
export async function GET(request: Request) {
  const person = await requirePerson();

  const view = parsePerjadinExportParams(Object.fromEntries(new URL(request.url).searchParams));
  const [rows, trips] = await Promise.all([
    perjadinFeedbackExport(person, view),
    view.scope.perjadinId === null ? [] : perjadinFeedbackTrips(person),
  ]);
  const fileName = perjadinFeedbackCsvFileName(view, trips, formatWibDate(new Date()));

  return new Response(perjadinFeedbackCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}
