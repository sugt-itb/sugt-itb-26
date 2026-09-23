import { requirePerson } from "-/lib/person";
import { perjadinAcquittal } from "@sugt/db/queries";
import { notFound } from "next/navigation";

import { csvOf, fileNameOf } from "./csv";

/**
 * **The generic export.**
 *
 * ADR-0007 promises a filled acquittal template and its amendment explains why this is not one
 * yet: nobody has filed an acquittal for this Programme, and no prior trip's completed set is
 * available to borrow, so there is no real form to fill. The screen ships anyway, with a plain
 * itemisation the PIC attaches. The text itself is `./csv`'s `csvOf` — a pure function of the
 * payload, split out so it can be driven directly; this handler only signs in, reads the payload —
 * open to any signed-in Person now (ADR-0004 reversed by ADR-0026, #180) — and sets the file
 * headers.
 *
 * **A Route Handler rather than a Server Action**, because the response is a file: it needs its own
 * content type and a `Content-Disposition`, neither of which an action can set.
 *
 * Open to any signed-in Person, like the screen it exports (ADR-0004 reversed by ADR-0026, #180):
 * `perjadinAcquittal` is an open money read now, so a Pimpinan can export the acquittal too. Only
 * `requirePerson()` gates this — money reads are open, and every money write stays Staff-only in its
 * own query.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/perjadin/[id]/laporan/ekspor">,
) {
  const person = await requirePerson();
  const { id } = await params;

  const acquittal = await perjadinAcquittal(person, id);
  if (!acquittal) notFound();

  return new Response(csvOf(acquittal), {
    headers: {
      // `charset=utf-8` is load-bearing: the categories are Indonesian and the descriptions are
      // whatever a PIC typed, so a reader defaulting to a single-byte encoding mangles both.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileNameOf(acquittal)}"`,
      // The figures change whenever a line item does, and it is money. Nothing caches it.
      "cache-control": "no-store",
    },
  });
}
