import { SessionStatusBadge } from "-/components/session-labels";
import { requirePerson } from "-/lib/person";
import { onlineSessionDirectory } from "@sugt/db/queries";
import { formatSessionStartTimeWithWib } from "@sugt/domain";
import Link from "next/link";

/**
 * **Sesi daring** — every online Session, newest first.
 *
 * The online counterpart to `/perjadin`: offline Sessions are reached through their trip's page,
 * but an online Session has no Perjadin, so this is the one screen that lists them together. One
 * `requirePerson()`, one query, no role check — a Session's School, date, start time, PIC and
 * status are delivery data, open to everyone signed in (ADR-0004). Arranging one stays Staff-only,
 * on `/jadwalkan-sesi-daring`, so this page carries no create or edit affordance.
 *
 * The start time is rendered with its School's Time Zone the same way every other surface shows it
 * ([#72](https://github.com/mafiefa02/sugt/issues/72)); the zone comes from the School's Province,
 * never stated separately.
 */
export default async function Page() {
  const person = await requirePerson();
  const sessions = await onlineSessionDirectory(person);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Sesi daring</h1>
        <p className="text-sm text-muted-foreground">
          Setiap Sesi daring, yang terbaru di atas. Sesi daring dijadwalkan di Jadwalkan Sesi
          daring.
        </p>
      </header>

      {sessions.length === 0 ? (
        <p className="p-7 text-sm text-muted-foreground">
          Belum ada Sesi daring. Jadwalkan yang pertama di Jadwalkan Sesi daring.
        </p>
      ) : (
        <ul className="border-t border-border">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-border px-7 py-3"
            >
              <Link
                href={`/sekolah/${session.schoolSlug}`}
                className="text-sm font-medium hover:underline"
              >
                {session.schoolName}
              </Link>
              {/* Peserta as inline muted text beside the School, not a badge (#283). Absent on a
                  Session arranged before the column existed. */}
              {session.participantType !== null && (
                <span className="text-sm text-muted-foreground">{session.participantType}</span>
              )}
              <span className="text-sm text-muted-foreground tabular-nums">
                {session.heldOn} ·{" "}
                {formatSessionStartTimeWithWib(session.startsAt, session.timeZone)}
              </span>
              <span className="text-xs text-muted-foreground">PIC {session.picFullName}</span>
              <SessionStatusBadge status={session.status} />
              <Link
                href={`/sesi-daring/${session.id}`}
                className="ml-auto text-xs text-muted-foreground hover:underline"
              >
                Lihat sesi
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
