import { fetchKeuanganSheet } from "-/lib/keuangan-sheet";
import { requirePerson } from "-/lib/person";
import { canViewKeuangan, hasGrant, keuanganSourceForRead } from "@sugt/db/queries";
import { Alert, AlertDescription } from "@sugt/ui/components/alert";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import { KeuanganTable } from "./keuangan-table";

export const metadata: Metadata = { title: "Keuangan" };

/**
 * **Keuangan** (#550, ADR-0064) — a read-only view of the Block B tab of Finance's spreadsheet: each
 * Kelompok's Budget Lines and their Alokasi, Realisasi and Sisa, and the grand total. Nothing is
 * entered here and nothing from the sheet is stored; Finance keeps working in the sheet.
 *
 * **Who reads it:** whoever `canViewKeuangan` admits — a Staff Person holding Keuangan (an
 * Administrator implies it) or a Pimpinan by Role. Anyone else gets `forbidden()` **before** the
 * stored source or the sheet is read, and the sidebar hides the link from the same people.
 *
 * **Two reads, in order:** the stored source (`keuanganSourceForRead`, #549), which an Administrator
 * sets on `/pengaturan` (#571), then the sheet itself (`fetchKeuanganSheet`, #548). The page never
 * sees the source's URL, and links to no spreadsheet. With no source set there is no sheet read,
 * only a notice — with a link to `/pengaturan` for an Administrator, the one viewer who can act on it.
 * A failed read shows the reader's generic sentence and no figures, never partial ones; the specific
 * reason belongs to `/pengaturan`.
 *
 * **`force-dynamic`**, like `/kalender`: the sheet is re-read on every visit.
 */
export const dynamic = "force-dynamic";

/** `4 Nov 2026`, the day the source was set, in WIB. */
const SET_ON = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

export default async function Page() {
  const person = await requirePerson();
  if (!canViewKeuangan(person)) forbidden();

  const source = await keuanganSourceForRead(person);
  const result = source
    ? await fetchKeuanganSheet({ sheetId: source.sheetId, gid: source.gid })
    : null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <h1 className="font-heading text-lg font-medium">Blok B — Pembelajaran Luring</h1>
        {source && (
          <p className="mt-1 text-sm text-muted-foreground">
            Angka dibaca dari spreadsheet Keuangan dan hanya untuk dibaca; ini bukan Uang Perjalanan
            Terpakai sebuah Perjadin. Sumber diatur {SET_ON.format(source.updatedAt)}.
          </p>
        )}
      </header>

      <div className="flex flex-col gap-4 px-4 py-6 sm:px-7">
        {!source ? (
          <p className="text-sm text-muted-foreground">
            Sumber data keuangan belum diatur.
            {hasGrant(person, "Administrator") && (
              <>
                {" "}
                <Link
                  href="/pengaturan"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Atur di Pengaturan
                </Link>
              </>
            )}
          </p>
        ) : result && !result.ok ? (
          <Alert variant="destructive">
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        ) : (
          result && <KeuanganTable sheet={result.sheet} />
        )}
      </div>
    </div>
  );
}
