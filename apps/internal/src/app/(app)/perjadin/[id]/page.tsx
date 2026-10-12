import { MoneyFigure } from "-/components/money-figure";
import { PerjadinDates } from "-/components/perjadin-dates";
import { PerjadinDokumenList } from "-/components/perjadin-dokumen-list";
import { PerjadinFeedbackTokenDialog } from "-/components/perjadin-feedback-token";
import { PerjadinGroup } from "-/components/perjadin-group";
import { PerjadinPimpinan } from "-/components/perjadin-pimpinan";
import { PerjadinPreparation } from "-/components/perjadin-preparation";
import { PerjadinSessions } from "-/components/perjadin-sessions";
import { PerjadinTeachingTeam } from "-/components/perjadin-teaching-team";
import { perjadinName } from "-/lib/perjadin-name";
import { requirePerson } from "-/lib/person";
import {
  canWritePerjadin,
  perjadinAcquittal,
  perjadinDetail,
  perjadinDokumen,
} from "@sugt/db/queries";
import { LinkButton } from "@sugt/ui/components/link-button";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * The browser-tab title: `Perjadin — <name>`, the same name the H1 shows (ADR-0044); a not-found
 * id falls back to the section label (#309). Reads `perjadinDetail` again rather than share state —
 * a minimal title query, as the ticket asks.
 */
export async function generateMetadata({ params }: PageProps<"/perjadin/[id]">): Promise<Metadata> {
  const person = await requirePerson();
  const { id } = await params;
  const trip = await perjadinDetail(person, id);
  return { title: trip ? `Perjadin — ${perjadinName(trip)}` : "Perjadin" };
}

/**
 * **One Perjadin** — the trip, its Group, the Schools on it, and when the Report is due.
 *
 * **The money strip renders for ANY signed-in Person now** (Staff or Pimpinan), because money
 * reads are open — ADR-0004 reversed by [ADR-0026](../../../../../../../docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md)
 * (#180). `perjadinDetail` still carries no money; the acquittal comes from `perjadinAcquittal`,
 * which is an open money read, so the strip below is fetched and shown to a Pimpinan too. The strip
 * carries a link to the Laporan and one figure, Uang Perjalanan Terpakai — every transaction on the
 * trip (ADR-0051, #464). **Every write on this page is the trip's Group's, a
 * Perjadin Editor's or an Administrator's** (ADR-0048), enforced in each query rather than by what this page
 * renders, so a Pimpinan or a Staff member off the trip sees the figures but no edit.
 *
 * The Report has no deadline (ADR-0055, #489): it is neither filed nor due, so the strip shows
 * none.
 */
export default async function Page({ params }: PageProps<"/perjadin/[id]">) {
  const person = await requirePerson();
  const { id } = await params;

  const trip = await perjadinDetail(person, id);
  if (!trip) notFound();

  // Fetched for any signed-in Person: money reads are open now (ADR-0026, #180), so a Pimpinan
  // sees the money strip too. Writing it is the trip's writers', enforced in each query.
  const acquittal = await perjadinAcquittal(person, id);
  // The trip's attendance sheets and SPPDs (#398, #441): read-only here, for everyone who can see
  // the page. Upload and Hapus live on the `/pendamping` card's Dokumen dialog.
  const dokumen = await perjadinDokumen(person, id);
  // Who writes this trip (ADR-0048): its Group, a Perjadin Editor or an Administrator. Everyone else reads
  // it with every write control hidden; each write's query refuses them again, which is the real gate.
  const canWrite = await canWritePerjadin(person, id);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <Link
          href="/perjadin"
          className="text-sm text-muted-foreground hover:underline"
        >
          Perjadin
        </Link>
        <h1 className="mt-1 font-heading text-lg font-medium">{perjadinName(trip)}</h1>
        {/*
          The date range, typed (ADR-0041): whoever writes the trip corrects it here with Ubah
          tanggal; everyone else reads it.
        */}
        <div className="mt-0.5">
          <PerjadinDates
            perjadinId={trip.id}
            startsOn={trip.startsOn}
            endsOn={trip.endsOn}
            canEdit={canWrite}
          />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          PIC: <span className="text-foreground">{trip.picFullName}</span>
        </p>
      </header>

      {acquittal !== null && (
        <div className="border-b border-border px-4 py-5 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="font-heading text-sm font-medium">Pengeluaran</h2>
            <div className="flex flex-wrap items-center gap-2">
              {/*
                The Report is the acquittal state on this row, so it is a child of this page
                rather than a surface of its own. Reading it is open to any signed-in Person now
                (ADR-0026, #180), like the strip it sits in; writing money there is the trip's
                writers' (ADR-0048).
              */}
              <LinkButton
                href={`/perjadin/${trip.id}/laporan`}
                variant="outline"
                size="sm"
              >
                Laporan Perjadin
              </LinkButton>
            </div>
          </div>
          <dl className="mt-2.5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <MoneyFigure
              label="Uang Perjalanan Terpakai"
              amountIdr={acquittal.spentIdr}
            />
          </dl>
        </div>
      )}

      <PerjadinGroup
        perjadinId={trip.id}
        group={trip.group}
        picPersonId={trip.picPersonId}
        staff={trip.staff}
        canEdit={canWrite}
      />

      <PerjadinTeachingTeam
        perjadinId={trip.id}
        teachers={trip.teachers}
        canEdit={canWrite}
      />

      <PerjadinPimpinan
        perjadinId={trip.id}
        pimpinan={trip.pimpinan}
        roster={trip.pimpinanRoster}
        canEdit={canWrite}
      />

      {/*
        The Preparation Checklist — an internal Staff monitoring aid. Shown to everyone (it carries
        no money), interactive for whoever writes the trip, whom `togglePreparationItem` re-checks.
      */}
      <PerjadinPreparation
        perjadinId={trip.id}
        items={trip.preparation}
        canToggle={canWrite}
      />

      {/*
        The Evaluation is now filed through a shared link, not a signed-in dialog (ADR-0024): the
        people best placed to judge the trip include the name-based Narasumber and the record-only
        Pimpinan, neither of whom can sign in. Any signed-in Person issues the QR/link here and hands
        it out; the filer self-declares a Role and Name on `/ep/{token}`. So the old Group-member
        gate is gone — this block shows for everyone who can see the page.
      */}
      <div className="border-b border-border px-4 py-5 sm:px-7">
        <h2 className="font-heading text-sm font-medium">Evaluasi Perjadin</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bagikan tautan agar Narasumber, Pendamping dan Pimpinan dapat menilai perjalanannya —
          penginapan, transportasi, konsumsi dan ketepatan waktu — tanpa perlu masuk.
        </p>
        <div className="mt-3">
          <PerjadinFeedbackTokenDialog perjadinId={trip.id} />
        </div>
      </div>

      <PerjadinSessions
        perjadinId={trip.id}
        sessions={trip.sessions}
        eligibleSchools={trip.eligibleSchools}
        teachers={trip.teachers}
        startsOn={trip.startsOn}
        endsOn={trip.endsOn}
        canEdit={canWrite}
      />

      <section className="border-t border-border px-4 py-5 sm:px-7">
        <h2 className="font-heading text-sm font-medium">Dokumen</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          Daftar hadir dan SPPD perjalanan ini. Unggah dan hapus dari kartu perjalanan di
          Pendamping.
        </p>
        <PerjadinDokumenList
          documents={dokumen?.documents ?? []}
          schools={dokumen?.schools ?? []}
        />
      </section>
    </div>
  );
}
