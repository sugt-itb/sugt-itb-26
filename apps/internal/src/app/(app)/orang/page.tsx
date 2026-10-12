import { OrangRoster } from "-/components/orang-roster";
import { requirePerson } from "-/lib/person";
import { hasGrant, roster } from "@sugt/db/queries";
import type { Metadata } from "next";
import { forbidden } from "next/navigation";

export const metadata: Metadata = { title: "Orang" };

/**
 * **Orang** — the roster, which is also the invite list (`person` is the invite list).
 *
 * **Administrator only, to read as well as to write** (#488): anyone else, a Pimpinan included,
 * gets `forbidden()` and the 403, as on `/log` and `/pengaturan`; the sidebar hides the link from
 * the same people. Each Session's Pimpinan picker — on the Perjadin form (`activeRosters`) and in
 * the trip's Session dialog (`perjadinDetail`) — reads its own roster, never this page, so planning
 * or running a Perjadin needs no Administrator.
 *
 * **Every write here is an Administrator's** too (#470, ADR-0028), with
 * `requireGrant("Administrator")` inside each write as the enforcement, since a layout does not run
 * before a Server Action. The viewer's id goes down so their own row offers no lockout.
 */
export default async function Page() {
  const person = await requirePerson();
  if (!hasGrant(person, "Administrator")) forbidden();
  const people = await roster(person);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <h1 className="font-heading text-lg font-medium">Orang</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Roster sekaligus daftar undangan. Hanya Administrator yang membaca roster ini, menambah
          orang, dan menonaktifkannya. Peran terkunci setelah seseorang dipakai.
        </p>
      </header>

      <OrangRoster
        people={people}
        viewerId={person.id}
      />
    </div>
  );
}
