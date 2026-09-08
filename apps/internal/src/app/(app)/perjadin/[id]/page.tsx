import { EditAdvance } from "-/components/perjadin-advance";
import { PerjadinDates } from "-/components/perjadin-dates";
import { PerjadinFeedbackTokenDialog } from "-/components/perjadin-feedback-token";
import { PerjadinGroup } from "-/components/perjadin-group";
import { PerjadinLogistics } from "-/components/perjadin-logistics";
import { PerjadinPimpinan } from "-/components/perjadin-pimpinan";
import { PerjadinPreparation } from "-/components/perjadin-preparation";
import { PerjadinSessions } from "-/components/perjadin-sessions";
import { PerjadinTeachingTeam } from "-/components/perjadin-teaching-team";
import { shortenKabupaten } from "-/lib/format-destination";
import { requirePerson } from "-/lib/person";
import { perjadinAcquittal, perjadinDetail } from "@sugt/db/queries";
import { formatIdr } from "@sugt/domain";
import { LinkButton } from "@sugt/ui/components/link-button";
import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * **One Perjadin** — the trip, its Group, the Schools on it, and when the Report is due.
 *
 * **The money strip renders for ANY signed-in Person now** (Staff or Pimpinan), because money
 * reads are open — ADR-0004 reversed by [ADR-0026](../../../../../../../docs/adr/0026-money-is-open-to-read-and-staff-only-to-write.md)
 * (#180). `perjadinDetail` still carries no money; the Advance and the acquittal come from
 * `perjadinAcquittal`, which is an open money read, so the strip below is fetched and shown to a
 * Pimpinan too. The strip carries a link to the Laporan, three figures, and — for Staff only — an
 * "Ubah uang muka" edit that corrects the Advance after planning (#192); the acquittal recomputes
 * the remainder live from it. Writing money stays Staff-only, enforced in each Server Action rather
 * than by what this page renders, so a Pimpinan sees the figures but no edit.
 *
 * The Report deadline rides with the money because the Perjadin Report *is* the acquittal state on
 * the row. It is derived and never stored — two days after the Group gets back, so it cannot be
 * typed wrong and it moves by itself if the trip's dates are corrected.
 */
export default async function Page({ params }: PageProps<"/perjadin/[id]">) {
  const person = await requirePerson();
  const { id } = await params;

  const trip = await perjadinDetail(person, id);
  if (!trip) notFound();

  // Fetched for any signed-in Person: money reads are open now (ADR-0026, #180), so a Pimpinan
  // sees the money strip too. Writing money stays Staff-only, enforced in each Server Action.
  const acquittal = await perjadinAcquittal(person, id);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <Link
          href="/perjadin"
          className="text-sm text-muted-foreground hover:underline"
        >
          Perjadin
        </Link>
        <h1 className="mt-1 font-heading text-lg font-medium">
          {shortenKabupaten(trip.destination)}
        </h1>
        {/*
          The date range, read-only: it is the departure→return span now (ADR-0021), so it is
          corrected by editing the legs in the Perjalanan section below, not here.
        */}
        <div className="mt-0.5">
          <PerjadinDates
            startsOn={trip.startsOn}
            endsOn={trip.endsOn}
          />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          PIC: <span className="text-foreground">{trip.picFullName}</span>
        </p>
      </header>

      {acquittal !== null && (
        <div className="border-b border-border px-7 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="font-heading text-sm font-medium">Uang muka</h2>
            <div className="flex flex-wrap items-center gap-2">
              {/*
                Correcting the Advance is a money write, so it is Staff-only (ADR-0026): the trigger
                is offered only when the viewer is Staff (#192). The strip itself renders for any
                signed-in Person, since money reads are open.
              */}
              <EditAdvance
                perjadinId={trip.id}
                advanceIdr={acquittal.advanceIdr}
                canEdit={person.role === "Staff"}
              />
              {/*
                The Report is the acquittal state on this row, so it is a child of this page
                rather than a surface of its own. Reading it is open to any signed-in Person now
                (ADR-0026, #180), like the strip it sits in; writing money there stays Staff-only.
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
          {/*
            The deadline rides with the money, because the Report *is* the acquittal. Nothing
            is gated on it — DITSAMA sets that deadline itself, and the tool is never stricter
            than the process it serves.
          */}
          <p className="mt-1 text-sm text-muted-foreground">
            Laporan jatuh tempo <span className="tabular-nums">{acquittal.reportDueOn}</span>
          </p>
          <dl className="mt-2.5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Figure
              label="Diterima"
              amountIdr={acquittal.advanceIdr}
            />
            <Figure
              label="Terpakai"
              amountIdr={acquittal.spentIdr}
            />
            {/*
              Derived and never stored: the Advance less every transaction against it.
              Negative means the Group overspent, which is a real state and not an error.
            */}
            <Figure
              label="Sisa"
              amountIdr={acquittal.remainderIdr}
            />
          </dl>
        </div>
      )}

      <PerjadinGroup
        perjadinId={trip.id}
        group={trip.group}
        picPersonId={trip.picPersonId}
        staff={trip.staff}
        canEdit={person.role === "Staff"}
      />

      <PerjadinTeachingTeam
        perjadinId={trip.id}
        teachers={trip.teachers}
        canEdit={person.role === "Staff"}
      />

      <PerjadinPimpinan
        perjadinId={trip.id}
        pimpinan={trip.pimpinan}
        roster={trip.pimpinanRoster}
        canEdit={person.role === "Staff"}
      />

      <PerjadinLogistics
        perjadinId={trip.id}
        departure={trip.departure}
        returnLeg={trip.return}
        canEdit={person.role === "Staff"}
      />

      {/*
        The Preparation Checklist — an internal Staff monitoring aid. Shown to everyone (it carries
        no money), interactive for Staff, whom `togglePreparationItem` re-checks.
      */}
      <PerjadinPreparation
        perjadinId={trip.id}
        items={trip.preparation}
        canToggle={person.role === "Staff"}
      />

      {/*
        The Evaluation is now filed through a shared link, not a signed-in dialog (ADR-0024): the
        people best placed to judge the trip include the name-based Pengajar and the record-only
        Pimpinan, neither of whom can sign in. Any signed-in Person issues the QR/link here and hands
        it out; the filer self-declares a Role and Name on `/ep/{token}`. So the old Group-member
        gate is gone — this block shows for everyone who can see the page.
      */}
      <div className="border-b border-border px-7 py-5">
        <h2 className="font-heading text-sm font-medium">Evaluasi Perjadin</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bagikan tautan agar Pengajar, Pendamping dan Pimpinan dapat menilai perjalanannya —
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
        canEdit={person.role === "Staff"}
      />
    </div>
  );
}

/**
 * Money in whole rupiah, which is what it is stored as — `numeric(_, 2)` would imply a
 * subunit nobody uses, so there is no cent to render and none is invented here.
 */
function Figure({ label, amountIdr }: { label: string; amountIdr: number }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">Rp {formatIdr(amountIdr)}</dd>
    </div>
  );
}
