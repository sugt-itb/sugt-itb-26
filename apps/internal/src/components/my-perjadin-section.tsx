"use client";

import { FeedbackTokenDialog } from "-/components/feedback-token";
import { RecordTransaction } from "-/components/laporan-perjadin/acquittal-transactions";
import { PerjadinAnggotaModal } from "-/components/perjadin-anggota-modal";
import { PerjadinFeedbackTokenDialog } from "-/components/perjadin-feedback-token";
import { PerjadinPreparationDialog } from "-/components/perjadin-preparation";
import { shortenKabupaten } from "-/lib/format-destination";
import type { MyPerjadinSchool, MyUpcomingPerjadin } from "@sugt/db/queries";
import {
  formatIdr,
  formatSessionStartTimeWithWib,
  type TimeZone,
  type TransportMode,
} from "@sugt/domain";
import { Button } from "@sugt/ui/components/button";
import Link from "next/link";
import { useState } from "react";

/**
 * **Perjalanan Dinas Anda** — the Staff home's own-trips section (#199), the client island over
 * `myUpcomingPerjadin`'s payload (#197). It wires that read straight into the reusable dialogs #198
 * carved out: the Preparation checklist, the Anggota roll, the two feedback-QR dialogs and the
 * transaction entry form all open from a card's own labelled control rather than a page of their own.
 *
 * A client component for two reasons that have nothing to do with the data: the "show more" paging is
 * local state, and every dialog it mounts is itself a client component. The data is fetched on the
 * server and passed down whole, so this never refetches — paging only widens the slice already here.
 *
 * The whole section — heading included — is absent when the caller is on no upcoming trip, rather
 * than a heading over an empty list: there is nothing to say, so nothing is shown.
 */
function MyPerjadinSection({ trips }: { trips: MyUpcomingPerjadin[] }) {
  // Reveal three at a time from the client, never a refetch — the full list is already in hand, and
  // the button only widens the slice. Hidden once everything is shown.
  const [shown, setShown] = useState(3);

  if (trips.length === 0) return null;

  return (
    <section>
      <h2 className="font-heading text-sm font-medium">Perjalanan Dinas Anda</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Perjalanan yang belum selesai, dan yang bisa Anda kerjakan pada masing-masing.
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {trips.slice(0, shown).map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
          />
        ))}
      </ul>

      {shown < trips.length && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            setShown((current) => current + 3);
          }}
        >
          Tampilkan lebih banyak
        </Button>
      )}
    </section>
  );
}

/** One trip: its head, the members glance, the two legs, the money, its Schools and the actions. */
function TripCard({ trip }: { trip: MyUpcomingPerjadin }) {
  // The pill's `x/N` is read straight off the checklist the card also hands the dialog — one payload
  // for both, so the pill and the boxes can never disagree. `N` is always seven (amendment to ADR-0018).
  const preparationDone = trip.preparation.filter((item) => item.checked).length;
  const preparationTotal = trip.preparation.length;
  // The same three-way progress tone `/perjadin`'s `PreparationPill` wears — neutral before
  // anything is ticked, amber part-way, emerald once every item is done — so the two screens read
  // the pill the same way. This one stays a button (the checklist opens from it); the tone replaces
  // the plain border rather than the click.
  const preparationTone =
    preparationDone === preparationTotal
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : preparationDone > 0
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        : "bg-muted text-muted-foreground";

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        {/* Same render-time abbreviation the trip's own page and its dialogs use on this line (#105). */}
        <p className="font-medium">{shortenKabupaten(trip.destination)}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>PIC: {trip.picFullName}</span>
          {/* The pill *is* the dialog's trigger — clicking it opens the checklist, live-toggleable
              because `/` is Staff-only (canToggle), and the toggle write re-checks the role anyway. */}
          <PerjadinPreparationDialog
            perjadinId={trip.id}
            items={trip.preparation}
            canToggle
            trigger={
              <button
                type="button"
                className={`rounded-full px-2 py-0.5 font-medium tabular-nums transition-opacity hover:opacity-80 ${preparationTone}`}
              >
                Persiapan {preparationDone}/{preparationTotal}
              </button>
            }
          />
          <span className="tabular-nums">
            {trip.startsOn} – {trip.endsOn}
          </span>
        </div>
      </div>

      <div className="mt-2.5">
        <PerjadinAnggotaModal
          destination={trip.destination}
          startsOn={trip.startsOn}
          endsOn={trip.endsOn}
          anggota={{
            staff: trip.anggota.staff,
            pengajar: trip.anggota.pengajar,
            pimpinan: trip.anggota.pimpinan,
          }}
          trigger={
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Tampilkan {trip.anggota.anggotaTotal} Anggota
            </button>
          }
        />
      </div>

      {/* The two legs, each rendered only when its trip carries them: a Perjadin planned before the
          logistics columns existed (#106) has null legs, and the line is dropped rather than shown
          half-empty. */}
      <div className="mt-2.5 grid gap-1 text-sm text-muted-foreground">
        <LegLine
          label="Keberangkatan"
          at={trip.departureAt}
          zone={trip.departureZone}
          mode={trip.departureMode}
        />
        <LegLine
          label="Kepulangan"
          at={trip.returnAt}
          zone={trip.returnZone}
          mode={trip.returnMode}
        />
      </div>

      <div className="mt-2.5 grid gap-1 text-sm">
        <span className="text-muted-foreground">
          Uang Muka:{" "}
          <span className="text-foreground tabular-nums">Rp {formatIdr(trip.advanceIdr)}</span>
        </span>
        {/* The same remainder math the acquittal derives (`advanceIdr - spentIdr`), pinned equal by a
            query test so the two screens never show two answers. */}
        <span className="text-muted-foreground">
          Tersisa:{" "}
          <span className="text-foreground tabular-nums">
            Rp {formatIdr(trip.advanceIdr - trip.spentIdr)}
          </span>
        </span>
      </div>

      {trip.schools.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:flex-wrap">
          {trip.schools.map((school) => (
            <SchoolCard
              key={school.schoolId}
              school={school}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <RecordTransaction
          perjadinId={trip.id}
          trigger={
            <Button
              variant="outline"
              size="sm"
            >
              Catat Transaksi
            </Button>
          }
        />
        <PerjadinFeedbackTokenDialog
          perjadinId={trip.id}
          trigger={
            <Button
              variant="outline"
              size="sm"
            >
              Evaluasi Perjadin
            </Button>
          }
        />
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/perjadin/${trip.id}`}>Edit</Link>}
        />
      </div>
    </li>
  );
}

/**
 * One visited School and a Participant-Feedback QR per non-cancelled offline Session there. Cancelled
 * Sessions are filtered out here per the ticket (the dialog self-guards them too), so a School with
 * two live Sessions shows two links and one whose Sessions were all cancelled shows none.
 */
function SchoolCard({ school }: { school: MyPerjadinSchool }) {
  const sessions = school.sessions.filter((session) => session.status !== "cancelled");

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-medium">{school.name}</p>
      <p className="text-xs text-muted-foreground">{school.kabupatenKota}</p>

      {sessions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {sessions.map((session) => (
            <FeedbackTokenDialog
              key={session.sessionId}
              sessionId={session.sessionId}
              status={session.status}
              trigger={
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Feedback: {session.heldOn}{" "}
                  {formatSessionStartTimeWithWib(session.startsAt, school.timeZone)}
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One leg line, present only when the leg is: its three fields are nullable together (a pre-#106
 * trip has none), so the whole line is dropped rather than rendered with holes. The wall-clock `at`
 * is a `"YYYY-MM-DD HH:MM:SS"` string; the date and `HH:MM` are shown, seconds dropped.
 */
function LegLine({
  label,
  at,
  zone,
  mode,
}: {
  label: string;
  at: string | null;
  zone: TimeZone | null;
  mode: TransportMode | null;
}) {
  if (at === null || zone === null || mode === null) return null;
  const [date, time] = at.split(" ");
  return (
    <span>
      {label}: <span className="tabular-nums">{date}</span> ·{" "}
      <span className="tabular-nums">{time?.slice(0, 5)}</span> {zone} · {mode}
    </span>
  );
}

export { MyPerjadinSection };
