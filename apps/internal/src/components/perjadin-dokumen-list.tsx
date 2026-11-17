import { UnsyncedMarker } from "-/components/unsynced-marker";
import { driveFileUrl } from "-/lib/drive/receipt-files";
import type { PerjadinDocumentRow } from "@sugt/db/queries";
import { formatTimeRange, PERJADIN_DOCUMENT_KINDS } from "@sugt/domain";

/** What the "belum tersinkron" marker on a document says, in full. */
export const DOCUMENT_UNSYNCED_TOOLTIP =
  "Dokumen belum tersinkron ke Google Drive — Administrator dapat menyelesaikannya lewat Periksa koneksi.";

/**
 * One document as its row reads: the date, for a Peserta sheet its School, cohort and span, and for
 * an SPPD its School alone (#441).
 */
export function documentRowText(row: PerjadinDocumentRow): string {
  if (row.kind === "SPPD") return row.schoolName ?? "";
  if (row.schoolName && row.participantType && row.startsAt && row.endsAt && row.timeZone) {
    return [
      row.documentDate,
      row.schoolName,
      row.participantType,
      formatTimeRange(row.startsAt, row.endsAt, row.timeZone),
    ].join(" · ");
  }
  return row.documentDate ?? "";
}

/**
 * **`SPPD: x/y sekolah`** (#441): how many of the trip's Schools have their SPPD, so a missing one
 * shows. An SPPD for a School that has since left the trip still stands, but is not counted.
 */
export function sppdSummary(schools: { hasSppd: boolean }[]): string {
  return `SPPD: ${schools.filter((school) => school.hasSppd).length}/${schools.length} sekolah`;
}

/**
 * **A trip's Perjadin Documents, grouped by kind, read-only** (ADR-0042, ADR-0061): four headings,
 * each document with a **Buka** link to its PDF in Drive and "belum tersinkron" while it is not yet
 * in place. The SPPD heading carries **SPPD: x/y sekolah** (#441), so a School still missing its SPPD
 * shows. Nothing here uploads or deletes: documents are no longer filed in the tool (#559), and the
 * ones already recorded are only listed, on `/perjadin/[id]`.
 */
function PerjadinDokumenList({
  documents,
  schools,
}: {
  documents: PerjadinDocumentRow[];
  /** The trip's Schools, which the SPPD summary counts against. */
  schools: { hasSppd: boolean }[];
}) {
  return (
    <div className="grid gap-4">
      {PERJADIN_DOCUMENT_KINDS.map((kind) => {
        const rows = documents.filter((row) => row.kind === kind);
        return (
          <section key={kind}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="text-sm font-medium">{kind}</h3>
              {kind === "SPPD" && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {sppdSummary(schools)}
                </span>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Belum ada</p>
            ) : (
              <ul className="mt-1 grid gap-1 text-sm">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <span className="tabular-nums">{documentRowText(row)}</span>
                    <a
                      href={driveFileUrl(row.driveFileId)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4"
                    >
                      Buka
                    </a>
                    {row.unsynced && <UnsyncedMarker explanation={DOCUMENT_UNSYNCED_TOOLTIP} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export { PerjadinDokumenList };
