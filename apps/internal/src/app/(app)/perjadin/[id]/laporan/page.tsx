import { AcquittalTransactions } from "-/components/laporan-perjadin/acquittal-transactions";
import { FilePerjadinReport } from "-/components/laporan-perjadin/file-perjadin-report";
import { MoneyFigure } from "-/components/money-figure";
import { driveFileUrl, driveFolderUrl } from "-/lib/drive/receipt-files";
import { uploadGate, type UploadGate } from "-/lib/drive/upload-gate";
import { perjadinName } from "-/lib/perjadin-name";
import { requirePerson } from "-/lib/person";
import { canWritePerjadin, perjadinAcquittal, type AcquittalTransaction } from "@sugt/db/queries";
import { LinkButton } from "@sugt/ui/components/link-button";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { ViewableTransaction } from "./action-types";

/**
 * The browser-tab title: `Laporan — <name>`, the same name the page links back with (ADR-0044); a not-found id falls back to the section label (#309). Reads `perjadinAcquittal`
 * again — a minimal title query, as the ticket asks, not shared state.
 */
export async function generateMetadata({
  params,
}: PageProps<"/perjadin/[id]/laporan">): Promise<Metadata> {
  const person = await requirePerson();
  const { id } = await params;
  const acquittal = await perjadinAcquittal(person, id);
  return {
    title: acquittal ? `Laporan — ${perjadinName(acquittal)}` : "Laporan Perjadin",
  };
}

/**
 * **The Perjadin Report** — the acquittal of one trip, and the screen ADR-0007 says the whole
 * money side of this tool stands or falls on.
 *
 * **Readable by ANY signed-in Person now** (ADR-0004 reversed by [ADR-0026](../../../../../../../../docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md),
 * #180). `perjadinAcquittal` is an open money read, so a Pimpinan reaching this URL sees the whole
 * acquittal — money reads are open. Every **write** control on the page — Laporkan, Catat transaksi,
 * Unggah bukti and each receipt's Hapus (#462) — is the trip's Group's, an Editor's or an
 * Administrator's (ADR-0048): absent for anyone else, and refused server-side by each Server
 * Action's query (or, for the receipt actions, before Drive is asked anything — by `staffOnTrip`,
 * and for Hapus by `receiptDeleteTarget`). So a Pimpinan or a Staff member off the trip
 * reads the report but writes nothing — the enforcement is in the actions, not in what this page
 * chooses to render. (The per-member receipts-handed-in checklist that used to sit
 * here was removed with `group_member.receipts_settled_at`, #183.)
 *
 * It is a child of `/perjadin/[id]` rather than a top-level surface because the Perjadin Report
 * *is* the acquittal state on that Perjadin's row — `data-model.md` is explicit that there is no
 * `perjadin_report` table. Issue #30 owned the slug question and this is the answer: the placeholder
 * at `/laporan-perjadin` is gone, and with it the sidebar entry that pointed at it, because a
 * top-level link would have needed an index of trips that nothing asked for.
 *
 * **Three figures on it are derived and none is stored** — the remainder, the deadline and the days
 * left. Nothing is gated on the deadline: DITSAMA sets it for itself.
 */
export default async function Page({ params }: PageProps<"/perjadin/[id]/laporan">) {
  const person = await requirePerson();
  const { id } = await params;

  const acquittal = await perjadinAcquittal(person, id);
  if (!acquittal) notFound();

  const transactions = acquittal.transactions.map(withLinks);
  // Who writes this trip (ADR-0048): its Group, an Editor or an Administrator. Everyone else reads
  // the whole Laporan with Catat transaksi, Unggah bukti, Hapus and Laporkan absent.
  const canWrite = await canWritePerjadin(person, id);
  const gate = canWrite
    ? await uploadGate(person)
    : ({ open: false, reason: "" } satisfies UploadGate);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <Link
          href={`/perjadin/${id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {perjadinName(acquittal)}
        </Link>
        <h1 className="mt-1 font-heading text-lg font-medium">Laporan Perjadin</h1>
      </header>

      <div className="border-b border-border px-4 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-sm font-medium">Uang Perjalanan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Jatuh tempo <span className="tabular-nums">{acquittal.reportDueOn}</span> ·{" "}
              <Deadline daysRemaining={acquittal.daysRemaining} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/*
              A Route Handler rather than a Server Action: the response is a file with its own
              content type and `Content-Disposition`, which an action cannot set.
            */}
            <LinkButton
              href={`/perjadin/${id}/laporan/ekspor`}
              variant="outline"
              size="sm"
            >
              Ekspor rincian
            </LinkButton>
            <FilePerjadinReport
              perjadinId={id}
              filedAt={acquittal.reportFiledAt}
              canWrite={canWrite}
            />
          </div>
        </div>

        <dl className="mt-2.5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <MoneyFigure
            label="Diterima"
            amountIdr={acquittal.advanceIdr}
            unsetLabel="Belum diisi"
          />
          <MoneyFigure
            label="Terpakai"
            amountIdr={acquittal.spentIdr}
          />
          {/*
            The same Terpakai total split by the cohort each transaction served — the two sum to
            `spentIdr`, since `participant_type` is required and has no third value.
          */}
          <MoneyFigure
            label="Total Siswa"
            amountIdr={acquittal.siswaSpentIdr}
          />
          <MoneyFigure
            label="Total GTK-MS"
            amountIdr={acquittal.gtkMsSpentIdr}
          />
          {/*
            Derived and never stored: the Advance less the travel-float draw-down — only Konsumsi and
            Lainnya draw down (ADR-0029), so this can differ from Diterima − Terpakai. Negative means
            the Group overspent the float, which is a real state and not an error.
          */}
          <MoneyFigure
            label="Sisa"
            amountIdr={acquittal.remainderIdr}
          />
        </dl>
      </div>

      {acquittal.pimpinan.length > 0 && (
        <section className="border-b border-border px-4 py-5 sm:px-7">
          <h2 className="font-heading text-sm font-medium">Pimpinan yang turut serta</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            {acquittal.pimpinan.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      )}

      <AcquittalTransactions
        perjadinId={id}
        transactions={transactions}
        uploadGate={gate}
        canWrite={canWrite}
      />
    </div>
  );
}

/**
 * One line item with a link per receipt, and to its Drive folder when it has one.
 *
 * **Every receipt is a plain link to Drive** (ADR-0040), built from its id; the app renders nothing
 * of the file itself and signs nothing. The links reach any signed-in reader, since
 * `perjadinAcquittal` is an open money read (ADR-0026, #180).
 */
function withLinks(line: AcquittalTransaction): ViewableTransaction {
  const { driveFolderId, driveSyncedAt, ...rest } = line;
  return {
    ...rest,
    evidence: line.evidence.map((file) => ({
      id: file.id,
      contentType: file.contentType,
      byteSize: file.byteSize,
      url: driveFileUrl(file.driveFileId),
    })),
    folderUrl: driveFolderId ? driveFolderUrl(driveFolderId) : null,
    // Unsynced: never finished, and holding a receipt — an empty line never is.
    unsynced: driveSyncedAt === null && line.evidence.length > 0,
  };
}

/**
 * Days left against the deadline. **Nothing is gated on it** — DITSAMA sets that deadline itself,
 * and the tool is never stricter than the process it serves — so a passed deadline is stated and
 * not enforced.
 */
function Deadline({ daysRemaining }: { daysRemaining: number }) {
  if (daysRemaining < 0) {
    return <span className="text-destructive">terlambat {Math.abs(daysRemaining)} hari</span>;
  }
  return <span className="tabular-nums">sisa {daysRemaining} hari</span>;
}
