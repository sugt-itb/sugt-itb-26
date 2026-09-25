"use client";

import { SessionStatusBadge } from "-/components/session-labels";
import type { DirectoryOnlineSession } from "@sugt/db/queries";
import { formatSessionStartTimeWithWib } from "@sugt/domain";
import { Input } from "@sugt/ui/components/input";
import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * The online-Session list, narrowed by a search box.
 *
 * **The filtering happens here and not in the query.** The page fetches every online Session and
 * hands the full array down; the browser narrows it as you type, the same one-round-trip shape
 * `SchoolDirectoryTable` uses — the list is bounded and its payload already carries every field the
 * search reads. Search matches the School name, the only text on a row worth scanning for.
 */
function OnlineSessionDirectoryList({ sessions }: { sessions: DirectoryOnlineSession[] }) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return sessions;
    return sessions.filter((session) => session.schoolName.toLowerCase().includes(needle));
  }, [sessions, query]);

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-7 pt-5">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Cari Sekolah"
          aria-label="Cari Sekolah"
          className="h-8 w-full max-w-72"
        />
        <p className="mt-2.5 text-xs text-muted-foreground">
          Menampilkan {shown.length} dari {sessions.length} Sesi daring
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="px-7 py-10 text-center text-sm text-muted-foreground">
          Tidak ada Sesi daring yang cocok dengan pencarian ini.
        </p>
      ) : (
        <ul className="mt-3 border-t border-border">
          {shown.map((session) => (
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
              <span className="text-sm text-muted-foreground tabular-nums">
                {session.heldOn} ·{" "}
                {formatSessionStartTimeWithWib(session.startsAt, session.timeZone)}
              </span>
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

export { OnlineSessionDirectoryList };
