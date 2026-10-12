import { formatWibDate } from "-/lib/format-wib";
import { requirePerson } from "-/lib/person";
import { participantFeedbackExport, participantFeedbackSchools } from "@sugt/db/queries";

import { parseParticipantExportParams } from "../../feedback-params";
import { participantFeedbackCsv, participantFeedbackCsvFileName } from "../feedback-csv";

/**
 * **The Peserta tab's export** (#490): every submission the tab's scope, Tipe Peserta and score
 * filters match, across all pages, in the tab's sort, as CSV. The text is `../feedback-csv`'s, a
 * pure function of the rows; this handler signs in, parses the link `participantExportHref` built,
 * and sets the file headers. Open to anyone signed in, as `/feedback` is — feedback carries no
 * money (ADR-0004) — and `requirePerson` sends anyone else to sign in, as the page does.
 *
 * A Route Handler rather than a Server Action, because the response is a file, as `/keuangan`'s.
 */
export async function GET(request: Request) {
  const person = await requirePerson();

  const view = parseParticipantExportParams(Object.fromEntries(new URL(request.url).searchParams));
  const [rows, schools] = await Promise.all([
    participantFeedbackExport(person, view),
    view.scope.schoolId === null ? [] : participantFeedbackSchools(person),
  ]);
  const fileName = participantFeedbackCsvFileName(view, schools, formatWibDate(new Date()));

  return new Response(participantFeedbackCsv(rows), {
    headers: {
      // `charset=utf-8` is load-bearing: names and comments are free Indonesian text.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      // A new submission changes it at any moment. Nothing caches it.
      "cache-control": "no-store",
    },
  });
}
