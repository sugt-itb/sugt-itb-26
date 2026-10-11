"use client";

import { FeedbackTokenDialog } from "-/components/feedback-token";
import { FotoVideoDialog } from "-/components/foto-video-dialog";
import { RecordTransaction } from "-/components/laporan-perjadin/acquittal-transactions";
import { PerjadinDokumenDialog } from "-/components/perjadin-dokumen-dialog";
import { PerjadinFeedbackTokenDialog } from "-/components/perjadin-feedback-token";
import { SessionMarkDeliveredDialog } from "-/components/perjadin-mark-delivered";
import { PerjadinPreparationDialog } from "-/components/perjadin-preparation";
import { progressTone } from "-/components/progress-tone";
import { tripTimeline, type TimelineNode } from "-/components/trip-timeline";
import type { UploadGate } from "-/lib/drive/upload-gate";
import { perjadinName, perjadinSchoolsLine } from "-/lib/perjadin-name";
import type { MyPerjadinTrip } from "@sugt/db/queries";
import { formatRupiah, formatSessionStartTimeWithWib } from "@sugt/domain";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionPlainTrigger,
} from "@sugt/ui/components/accordion";
import { Button } from "@sugt/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@sugt/ui/components/collapsible";
import { LinkButton } from "@sugt/ui/components/link-button";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

/**
 * **One section of `/pendamping`'s own trips** (#199) — Perjalanan Dinas Anda or Perjalanan Dinas
 * Sebelumnya (#396), each the client island over its half of `myPerjadin`'s payload (#197). It
 * wires that read straight into the reusable dialogs #198
 * carved out: the Preparation checklist, the two feedback-QR dialogs and the transaction entry form
 * all open from a card's own labelled control rather than a page of their own, and each Session on a
 * trip's timeline carries its own Tandai confirmation (#349). Each trip is a card in one single-open
 * accordion (#348), all collapsed to start, with the Anggota roster shown inline.
 *
 * A client component for two reasons that have nothing to do with the data: the "show more" paging is
 * local state, and every dialog it mounts is itself a client component. The data is fetched on the
 * server and passed down whole, so this never refetches — paging only widens the slice already here.
 *
 * The whole section — heading included — is absent when it has no trip, rather than a heading over
 * an empty list: there is nothing to say, so nothing is shown. Each section is its own accordion and
 * pages on its own.
 */
function MyPerjadinSection({
  title,
  description,
  trips,
  uploadGate,
  canWrite,
}: {
  title: string;
  description: string;
  trips: MyPerjadinTrip[];
  uploadGate: UploadGate;
  /**
   * **Whether the viewer writes these trips** (ADR-0048), computed from the viewer and not from whose
   * trips they are. On a person's own `/pendamping` it is always true — every trip listed is one
   * whose Group they are in. Without it, every write control on the cards is absent: Catat
   * Transaksi, Dokumen, Tandai, the Persiapan boxes and Foto & Video's upload and Hapus.
   */
  canWrite: boolean;
}) {
  // Reveal three at a time from the client, never a refetch — the full list is already in hand, and
  // the button only widens the slice. Hidden once everything is shown.
  const [shown, setShown] = useState(3);

  if (trips.length === 0) return null;

  return (
    <section>
      <h2 className="font-heading text-sm font-medium">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>

      {/* One single-open accordion (Base UI's default), every card collapsed to start — including
          the ones "show more" reveals, since none is ever in the open value until it is clicked.
          Each item is its own bordered card with a gap between, not the stacked-divider box the
          primitive draws by default. */}
      <Accordion className="mt-3 flex flex-col gap-3 rounded-none border-0">
        {trips.slice(0, shown).map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            uploadGate={uploadGate}
            canWrite={canWrite}
          />
        ))}
      </Accordion>

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

/**
 * One trip as one accordion item (#348): a header row that is all a collapsed card shows, and a
 * two-column body — the money, the actions and the trip timeline on the left, the Anggota roster on
 * the right.
 *
 * **Every collapsed card is the same shape** (#419) — past, current or future, PIC or not: the name
 * and the Schools on the left; PIC, the Persiapan pill and the chevron on the right. Nothing else, so
 * no card's row is squeezed by a line the others lack. The Laporan is reached through Edit.
 *
 * The header row holds a second control, the Persiapan pill, so the trigger cannot wrap the row — a
 * button inside a button is invalid HTML. Instead the trigger wraps only the title and is *stretched*
 * over the whole row by an `after:` overlay (the row is its containing block): clicking the PIC, the
 * School line, the chevron or empty space lands on the overlay and toggles the card, and the trigger's
 * accessible name is the title alone. The pill sits above the overlay (`relative z-10`), so it takes
 * its own click and opens the checklist without toggling. The chevron is decorative and outside the
 * trigger, rotated from the item's `data-open`.
 */
function TripCard({
  trip,
  uploadGate,
  canWrite,
}: {
  trip: MyPerjadinTrip;
  uploadGate: UploadGate;
  canWrite: boolean;
}) {
  // The pill's `x/N` is read straight off the checklist the card also hands the dialog — one payload
  // for both, so the pill and the boxes can never disagree. `N` is the trip's own (ADR-0045).
  const preparationDone = trip.preparation.filter((item) => item.checked).length;
  const preparationTotal = trip.preparation.length;
  // The shared three-way progress tone `/perjadin`'s pill wears too — neutral before anything is
  // ticked, amber part-way, emerald once every item is done — so the two screens read the pill the
  // same way. This one stays a button (the checklist opens from it).
  const preparationTone = progressTone(preparationDone, preparationTotal);

  return (
    <AccordionItem
      value={trip.id}
      className="group/trip rounded-lg border border-border bg-card last:border-b"
    >
      <div className="relative flex items-start gap-3 p-3 sm:p-4">
        {/* Left and right share a line whenever they fit and wrap on a phone, PIC + Persiapan then
            sitting under the Schools. The left block's basis is its own width, so the right block
            wraps away before the name would; the Schools line is `w-0 min-w-full` so its length
            never counts toward that width, only the name's does. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-auto">
            <AccordionHeader className="font-heading text-lg font-normal text-foreground">
              <AccordionPlainTrigger className="after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50">
                {/* The name already carries the dates (ADR-0044), so the card shows no date line. */}
                {perjadinName(trip)}
              </AccordionPlainTrigger>
            </AccordionHeader>
            {trip.schoolNames.length > 0 && (
              <p className="mt-0.5 w-0 min-w-full text-xs text-muted-foreground">
                {perjadinSchoolsLine(trip.schoolNames)}
              </p>
            )}
          </div>
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>PIC: {trip.picFullName}</span>
            {/* The pill *is* the dialog's trigger — clicking it opens the checklist, live-toggleable
                for whoever writes the trip (ADR-0048), and the toggle write re-checks that anyway. */}
            <PerjadinPreparationDialog
              perjadinId={trip.id}
              items={trip.preparation}
              canToggle={canWrite}
              trigger={
                <button
                  type="button"
                  className={`relative z-10 rounded-full px-2 py-0.5 font-medium tabular-nums transition-opacity hover:opacity-80 ${preparationTone}`}
                >
                  Persiapan {preparationDone}/{preparationTotal}
                </button>
              }
            />
          </div>
        </div>
        <ChevronDown
          aria-hidden
          className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-open/trip:rotate-180"
        />
      </div>

      {/* 12px inside the card on a phone, 16px from `sm`: the primitive's own `px-4` is on its inner
          div, so this card narrows it from outside rather than changing it for every accordion. */}
      <AccordionPanel className="text-foreground *:px-3 sm:*:px-4">
        <div className="grid gap-6 pt-2 pb-1 lg:grid-cols-[11fr_9fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <TripMoney spentIdr={trip.spentIdr} />

            {/* A full-width two-column grid on a phone, each button stretched to its cell. */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {canWrite && (
                <>
                  <RecordTransaction
                    perjadinId={trip.id}
                    uploadGate={uploadGate}
                    trigger={
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-full"
                      >
                        Catat Transaksi
                      </Button>
                    }
                  />
                  <PerjadinDokumenDialog
                    perjadinId={trip.id}
                    name={perjadinName(trip)}
                    uploadGate={uploadGate}
                    trigger={
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-full"
                      >
                        Dokumen
                      </Button>
                    }
                  />
                </>
              )}
              <PerjadinFeedbackTokenDialog
                perjadinId={trip.id}
                trigger={
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-full"
                  >
                    Evaluasi Perjadin
                  </Button>
                }
              />
              <LinkButton
                size="sm"
                className="rounded-full"
                render={<Link href={`/perjadin/${trip.id}`} />}
              >
                Edit
              </LinkButton>
            </div>
            {/* Said as text, not only as the disabled button's title: a title never shows on touch. */}
            {canWrite && !uploadGate.open && (
              <p className="-mt-2 text-xs text-muted-foreground">{uploadGate.reason}</p>
            )}

            <TripTimeline
              nodes={tripTimeline(trip)}
              uploadGate={uploadGate}
              canWrite={canWrite}
            />
          </div>

          <AnggotaRoster anggota={trip.anggota} />
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}

/**
 * **The card's Uang Perjalanan Terpakai** (ADR-0051): every transaction on the trip, all categories —
 * the same figure as the trip page, the Laporan and the CSV, pinned equal by a query test. There is
 * no Advance to measure it against, so no remainder and no bar.
 */
function TripMoney({ spentIdr }: { spentIdr: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">Uang Perjalanan Terpakai</p>
      <p className="mt-1 font-heading text-lg tabular-nums">{formatRupiah(spentIdr)}</p>
    </div>
  );
}

/**
 * Who is on the trip, inline: Pendamping (the Staff Group), Narasumber (the trip-scoped teacher
 * names) and Pimpinan (record-only), in that order. Pendamping and Pimpinan are plain lists, left
 * out when empty — the PIC is already named in the header. Narasumber is always there, folded by
 * School (#447): a trip's dozen-and-more titled names would otherwise crowd the card.
 */
function AnggotaRoster({ anggota }: { anggota: MyPerjadinTrip["anggota"] }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <NameList
        label="Pendamping"
        names={anggota.staff.map((person) => ({ key: person.personId, name: person.fullName }))}
      />
      <NarasumberBlock
        total={anggota.pengajar.length}
        pengajarBySchool={anggota.pengajarBySchool}
      />
      <NameList
        label="Pimpinan"
        names={anggota.pimpinan.map((person) => ({ key: person.personId, name: person.name }))}
      />
    </div>
  );
}

/** One labelled list of names, one per line; absent when nobody is in it. */
function NameList({ label, names }: { label: string; names: { key: string; name: string }[] }) {
  if (names.length === 0) return null;

  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <ul className="mt-1 grid gap-0.5 text-sm">
        {names.map((person) => (
          <li key={person.key}>{person.name}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * **Narasumber (n), folded by School** (#447). n is the trip's distinct Narasumber, the unassigned
 * included, so someone listed under two Schools counts once; with none it is `Narasumber (0)` and
 * nothing beneath. Each School with a list gets its own toggle; one with none says "belum
 * ditugaskan" with nothing to open; the unassigned get a last toggle when there are any. The order
 * — Schools by their earliest live Session, names A–Z — is the query's.
 */
function NarasumberBlock({
  total,
  pengajarBySchool,
}: {
  total: number;
  pengajarBySchool: MyPerjadinTrip["anggota"]["pengajarBySchool"];
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">Narasumber ({total})</p>
      {total > 0 && (
        <ul className="mt-1 flex flex-col">
          {pengajarBySchool.bySchool.map((school) => (
            <li key={school.schoolId}>
              {school.pengajar.length > 0 ? (
                <NarasumberToggle
                  label={`Narasumber ${school.name}`}
                  names={school.pengajar}
                />
              ) : (
                <p className="py-2.5 pl-6 text-sm text-muted-foreground">
                  Narasumber {school.name}: belum ditugaskan
                </p>
              )}
            </li>
          ))}
          {pengajarBySchool.unassigned.length > 0 && (
            <li>
              <NarasumberToggle
                label="Narasumber belum ditugaskan"
                names={pengajarBySchool.unassigned}
              />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * One fold: "Tampilkan {label} (n)" closed, "Sembunyikan {label} (n)" open, the names one per line
 * beneath. Closed on every load and on its own — nothing remembers it. The panel stays mounted
 * (hidden) so `aria-controls` names a real element even while closed, which Base UI only sets while
 * open. Its height animates over 200 ms and snaps under `prefers-reduced-motion`.
 */
function NarasumberToggle({
  label,
  names,
}: {
  label: string;
  names: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger
        aria-controls={panelId}
        className="group/fold flex min-h-11 w-full items-center gap-2 rounded-md text-left text-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/fold:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 break-words">
          {open ? "Sembunyikan" : "Tampilkan"} {label} ({names.length})
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent
        id={panelId}
        keepMounted
        className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none"
      >
        <ul className="grid gap-0.5 pb-2 pl-6 text-sm">
          {names.map((person) => (
            <li
              key={person.id}
              className="break-words"
            >
              {person.name}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The trip as it happens, top to bottom (#349): each live Session across the Schools in
 * date-then-time order — the order and the done state already decided by `tripTimeline`.
 * Left out entirely when there is nothing on it. An ordered list, so assistive tech reads it as a
 * sequence.
 *
 * Each node is a circle on a vertical rail: done is solid primary with a check, pending a muted ring
 * with a primary dot. The rail segment below a node is primary only when that node is done; every
 * other segment is muted.
 */
function TripTimeline({
  nodes,
  uploadGate,
  canWrite,
}: {
  nodes: TimelineNode[];
  uploadGate: UploadGate;
  /** Tandai and Foto & Video's upload and Hapus are the trip's writers' (ADR-0048). */
  canWrite: boolean;
}) {
  if (nodes.length === 0) return null;

  return (
    <ol className="flex flex-col text-sm">
      {nodes.map((node, index) => (
        <li
          key={node.key}
          className="flex gap-3"
        >
          <div className="flex flex-col items-center">
            <TimelineMarker done={node.done} />
            {index < nodes.length - 1 && (
              <div
                aria-hidden
                className={`w-0.5 flex-1 ${node.done ? "bg-primary" : "bg-muted-foreground/30"}`}
              />
            )}
          </div>
          <div
            className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 ${index < nodes.length - 1 ? "pb-4" : ""}`}
          >
            <span className="sr-only">{node.done ? "Selesai: " : "Belum: "}</span>
            <SessionNode
              node={node}
              uploadGate={uploadGate}
              canWrite={canWrite}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The node's circle. Decorative: the row's hidden "Selesai"/"Belum" says the same in words. */
function TimelineMarker({ done }: { done: boolean }) {
  return done ? (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
    >
      <Check className="size-3" />
    </span>
  ) : (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/30 bg-card"
    >
      <span className="size-1.5 rounded-full bg-primary" />
    </span>
  );
}

/**
 * `{heldOn} · {start time} · {School}`, then the Session's own controls: **Tandai** only while it is
 * `arranged` (a delivered Session has no transition left, so the pill goes once it lands),
 * **Feedback** — the Participant-Feedback QR — which stays after delivery, and **Foto & Video**
 * (#425), the Session's photos and videos, in both sections since footage is often uploaded after
 * the trip. It opens even while Drive is down, so the files can be viewed; uploading is closed then.
 */
function SessionNode({
  node,
  uploadGate,
  canWrite,
}: {
  node: TimelineNode;
  uploadGate: UploadGate;
  canWrite: boolean;
}) {
  const { school, session } = node;
  const text = `${session.heldOn} · ${formatSessionStartTimeWithWib(session.startsAt, school.timeZone)} · ${school.name}`;

  return (
    <>
      <span className="tabular-nums">{text}</span>
      <span className="flex flex-wrap gap-2">
        {canWrite && session.status === "arranged" && (
          <SessionMarkDeliveredDialog
            school={school}
            session={session}
            trigger={
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full"
                aria-label={`Tandai ${text}`}
              >
                Tandai
              </Button>
            }
          />
        )}
        <FeedbackTokenDialog
          sessionId={session.sessionId}
          status={session.status}
          trigger={
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              aria-label={`Feedback ${text}`}
            >
              Feedback
            </Button>
          }
        />
        <FotoVideoDialog
          sessionId={session.sessionId}
          heldOn={session.heldOn}
          schoolName={school.name}
          uploadGate={uploadGate}
          // The timeline holds no cancelled Session; who writes the trip uploads and deletes.
          canUpload={canWrite}
          canDelete={canWrite}
          trigger={
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              aria-label={`Foto & Video ${text}`}
            >
              Foto & Video
            </Button>
          }
        />
      </span>
    </>
  );
}

export { AnggotaRoster, MyPerjadinSection, TripMoney, TripTimeline };
