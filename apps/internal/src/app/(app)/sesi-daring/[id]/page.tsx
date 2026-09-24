import { OnlineSessionFields } from "-/components/online-session-fields";
import { OnlineSessionWrites } from "-/components/online-session-writes";
import { MODE_LABELS, SessionStatusBadge } from "-/components/session-labels";
import { requirePerson } from "-/lib/person";
import { onlineSessionDetail } from "@sugt/db/queries";
import { formatSessionStartTimeWithWib } from "@sugt/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

/**
 * The browser-tab title: the School's name and the mode label, reusing the same heading fields the
 * page shows. A not-found — or an offline id, which the page redirects to /sesi/[id] — falls back to
 * the section label (#309). Reads `onlineSessionDetail` again, a minimal title query per the ticket.
 */
export async function generateMetadata({
  params,
}: PageProps<"/sesi-daring/[id]">): Promise<Metadata> {
  const person = await requirePerson();
  const { id } = await params;
  const lookup = await onlineSessionDetail(person, id);
  if (lookup.outcome !== "online") return { title: "Sesi Daring" };
  return { title: `${lookup.session.schoolName} — ${MODE_LABELS.online}` };
}

/**
 * **Detail Sesi daring** — one online Session, and every field the record form set, editable (#152,
 * #318). The online counterpart of `/perjadin/[id]`: the header, then the Session's fields (School,
 * date, times and the two cohort-named Pengajar) with an Edit dialog, and — for Staff — a hard Delete.
 * A born-`delivered` Session shows **Edit + Delete**; a legacy `arranged` one also shows Tandai
 * terlaksana and Batalkan Sesi.
 *
 * **Online-only.** An offline Session's detail surface is `/sesi/[id]`, so an offline id is
 * redirected there rather than rendered here, and an id naming nothing is a **404** — an ordinary
 * thing to arrive with, since a pasted link outlives its row.
 *
 * One `requirePerson()`, one query, one payload. **No role check on the read** — a Session carries no
 * money and ADR-0004 opens delivery data to everyone signed in. The edits are Staff-only, and they
 * are **absent rather than disabled** for a professor: `canEdit` hides the affordances, and
 * `requireStaff` inside each write is what actually closes the path, since a layout does not run
 * before a Server Action.
 */
export default async function Page({ params }: PageProps<"/sesi-daring/[id]">) {
  const person = await requirePerson();
  const { id } = await params;

  const lookup = await onlineSessionDetail(person, id);
  if (lookup.outcome === "not-found") notFound();
  // An offline Session is edited on `/sesi/[id]`; only online Sessions are rendered here.
  if (lookup.outcome === "offline") redirect(`/sesi/${id}`);

  const session = lookup.session;
  const canEdit = person.role === "Staff";

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
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
          <span className="text-sm text-muted-foreground">{MODE_LABELS.online}</span>
          <SessionStatusBadge status={session.status} />
        </div>

        {/*
          The reason a Session was called off, shown wherever the Session is. It counts for
          nothing and stays visible: a School that was planned for and missed looks different
          from one nobody has reached yet.
        */}
        {session.cancelledReason !== null && (
          <p className="mt-2 text-sm text-muted-foreground">{session.cancelledReason}</p>
        )}
      </header>

      <OnlineSessionFields
        session={session}
        canEdit={canEdit}
      />

      {canEdit && <OnlineSessionWrites session={session} />}
    </div>
  );
}
