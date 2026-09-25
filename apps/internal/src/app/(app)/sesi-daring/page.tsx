import { OnlineSessionDirectoryList } from "-/components/online-session-directory-list";
import { requirePerson } from "-/lib/person";
import { onlineSessionDirectory } from "@sugt/db/queries";
import { LinkButton } from "@sugt/ui/components/link-button";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sesi Daring" };

/**
 * **Sesi daring** — every online Session, newest first.
 *
 * The online counterpart to `/perjadin`: offline Sessions are reached through their trip's page,
 * but an online Session has no Perjadin, so this is the one screen that lists them together. One
 * `requirePerson()`, one query, no role check — a Session's School, date, start time and status are
 * delivery data, open to everyone signed in (ADR-0004). Recording one stays Staff-only, on
 * `/sesi-daring/baru` (#318), and its create action is the only affordance here.
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-7 py-5">
        <div>
          <h1 className="font-heading text-lg font-medium">Sesi daring</h1>
          <p className="text-sm text-muted-foreground">
            Setiap Sesi daring, yang terbaru di atas. Sesi daring dicatat setelah terlaksana di
            Catat Sesi daring.
          </p>
        </div>
        {/* Staff-only create action, moved off the sidebar onto its list page (#294). Non-Staff
            render nothing — no disabled state. */}
        {person.role === "Staff" && (
          <LinkButton render={<Link href="/sesi-daring/baru" />}>
            <Plus data-icon="inline-start" />
            Catat Sesi Daring
          </LinkButton>
        )}
      </header>

      {sessions.length === 0 ? (
        <p className="p-7 text-sm text-muted-foreground">
          Belum ada Sesi daring. Jadwalkan yang pertama di Jadwalkan Sesi daring.
        </p>
      ) : (
        <OnlineSessionDirectoryList sessions={sessions} />
      )}
    </div>
  );
}
