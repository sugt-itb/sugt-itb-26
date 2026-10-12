import { FeedbackTokenDialog } from "-/components/feedback-token";
import { FotoVideoSection } from "-/components/foto-video-section";
import { MODE_LABELS, SessionStatusBadge } from "-/components/session-labels";
import { SessionRecords } from "-/components/session-records";
import { SessionWrites } from "-/components/session-writes";
import { uploadGate } from "-/lib/drive/upload-gate";
import { perjadinName } from "-/lib/perjadin-name";
import { requirePerson } from "-/lib/person";
import { canWritePerjadin, sessionDetail, sessionFootageList } from "@sugt/db/queries";
import { formatSessionStartTimeWithWib } from "@sugt/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

/**
 * The browser-tab title: the School's name and the mode label, reusing the same heading fields the
 * page shows. A not-found — or an online id, which the page redirects to /sesi-daring/[id] — falls
 * back to the section label (#309). Reads `sessionDetail` again, a minimal title query per the ticket.
 */
export async function generateMetadata({ params }: PageProps<"/sesi/[id]">): Promise<Metadata> {
  const person = await requirePerson();
  const { id } = await params;
  const session = await sessionDetail(person, id);
  if (!session || session.mode === "online") return { title: "Sesi" };
  return { title: `${session.schoolName} — ${MODE_LABELS[session.mode]}` };
}

/**
 * **Detail Sesi** — one Session: what has been filed against it, who still owes what, and
 * the PIC.
 *
 * One `requirePerson()`, the Session's query, then its Foto & Video and — for whoever writes its
 * trip — the upload gate, read together (#425). **No role check on the read**, because a
 * Session carries no money and ADR-0004 opens delivery data to everyone signed in — a
 * professor opening the Session they taught to see who else still owes a Record is the
 * ordinary case, not an edge one.
 *
 * The writes are the trip's Group's, a Perjadin Editor's or an Administrator's (ADR-0048), and they are
 * **absent rather than disabled** for anyone else. Hiding them is a courtesy and not the
 * enforcement: `requireSessionWriter` inside each query function is what actually closes the
 * path, since a layout does not run before a Server Action.
 *
 * Keyed on the Session's id rather than a slug — a Session has no natural name, and its
 * School and date are not unique between two Sessions on the same day. An id naming no
 * Session is an ordinary thing to arrive with, so it is a **404** and not an error.
 *
 * **This is the offline detail surface now (#152).** An online Session is edited on its own
 * `/sesi-daring/[id]`, so an online id is redirected there rather than rendered here — the reads and
 * writes below (Tandai terlaksana status-only, Batalkan Sesi, moving the date) are the offline half.
 */
export default async function Page({ params }: PageProps<"/sesi/[id]">) {
  const person = await requirePerson();
  const { id } = await params;

  const session = await sessionDetail(person, id);
  if (!session) notFound();
  // An online Session's detail and editing live on `/sesi-daring/[id]`; only offline stays here.
  if (session.mode === "online") redirect(`/sesi-daring/${id}`);

  // An offline Session is written by its trip's Group, a Perjadin Editor or an Administrator (ADR-0048).
  const canWrite =
    session.perjadin !== null && (await canWritePerjadin(person, session.perjadin.id));
  const [footage, gate] = await Promise.all([
    sessionFootageList(person, session.id),
    // Only the trip's writers upload or Hapus; for anyone else the gate is never read.
    canWrite ? uploadGate(person) : Promise.resolve({ open: false as const, reason: "" }),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <Link
          href={`/sekolah/${session.schoolSlug}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {session.schoolName}
        </Link>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="font-heading text-lg font-medium tabular-nums">{session.heldOn}</h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatSessionStartTimeWithWib(session.startsAt, session.timeZone)}
          </span>
          <span className="text-sm text-muted-foreground">{MODE_LABELS[session.mode]}</span>
          <SessionStatusBadge status={session.status} />
        </div>

        {/*
          The reason a Session was called off, shown wherever the Session is. It counts
          for nothing and stays visible: a School that was planned for and missed looks
          different from one nobody has reached yet.
        */}
        {session.cancelledReason !== null && (
          <p className="mt-2 text-sm text-muted-foreground">{session.cancelledReason}</p>
        )}

        <p className="mt-3 text-sm text-muted-foreground">
          PIC: <span className="text-foreground">{session.picFullName}</span>
          {session.perjadin !== null && (
            <>
              {" · "}
              Perjadin {perjadinName(session.perjadin)}
            </>
          )}
        </p>
      </header>

      <SessionRecords
        session={session}
        personId={person.id}
      />

      {/*
        The feedback QR, offered to everyone signed in — not only Staff, so it sits outside
        SessionWrites. Barred on a cancelled Session: the wrapper is gated here so the row is
        absent, and the dialog self-guards the same way as a backstop.
      */}
      {session.status !== "cancelled" && (
        <div className="flex flex-wrap gap-2.5 px-4 py-5 sm:px-7">
          <FeedbackTokenDialog session={session} />
        </div>
      )}

      {/*
        Foto & Video (#425, ADR-0046): the list for everyone signed in, a Pimpinan included; Hapus
        and the upload popup for the trip's writers, the upload hidden on a cancelled Session.
      */}
      <FotoVideoSection
        sessionId={session.id}
        heldOn={session.heldOn}
        schoolName={session.schoolName}
        footage={footage}
        canWrite={canWrite}
        cancelled={session.status === "cancelled"}
        uploadGate={gate}
      />

      {canWrite && <SessionWrites session={session} />}
    </div>
  );
}
