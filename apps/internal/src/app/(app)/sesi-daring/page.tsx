import { OnlineSessionDirectoryList } from "-/components/online-session-directory-list";
import { requirePerson } from "-/lib/person";
import { hasGrant, onlineSessionDirectory } from "@sugt/db/queries";
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
 * delivery data, open to everyone signed in (ADR-0004). Recording one needs the Daring Editor Grant
 * (ADR-0047), on `/sesi-daring/baru` (#318), and its create action is the only affordance here.
 *
 * The table lives in the `"use client"` `OnlineSessionDirectoryList`, which filters (#333) and sorts
 * (#344) the payload in the browser. An online Session is always WIB (#283), so its times are shown
 * as bare `HH:MM` under "Jam Mulai (WIB)" and "Jam Selesai (WIB)" headers rather than per cell.
 */
export default async function Page() {
  const person = await requirePerson();
  const sessions = await onlineSessionDirectory(person);

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-5 sm:px-7">
        <div>
          <h1 className="font-heading text-lg font-medium">Sesi daring</h1>
          <p className="text-sm text-muted-foreground">
            Setiap Sesi daring, yang terbaru di atas. Sesi daring dicatat setelah terlaksana di
            Catat Sesi daring.
          </p>
        </div>
        {/* The create action, moved off the sidebar onto its list page (#294). It needs the Daring
            Editor Grant (ADR-0047); anyone without it renders nothing — no disabled state. */}
        {hasGrant(person, "Daring Editor") && (
          <LinkButton render={<Link href="/sesi-daring/baru" />}>
            <Plus data-icon="inline-start" />
            Catat Sesi Daring
          </LinkButton>
        )}
      </header>

      {sessions.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground sm:p-7">
          Belum ada Sesi daring. Jadwalkan yang pertama di Jadwalkan Sesi daring.
        </p>
      ) : (
        <OnlineSessionDirectoryList sessions={sessions} />
      )}
    </div>
  );
}
