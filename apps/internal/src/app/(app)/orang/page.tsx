import { OrangRoster } from "-/components/orang-roster";
import { requirePerson } from "-/lib/person";
import { hasGrant, roster } from "@sugt/db/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Orang" };

/**
 * **Orang** — the roster, which is also the invite list (`person` is the invite list).
 *
 * One `requirePerson()` and one query, **no role check on the read**: anyone signed in reads the
 * roster, because a Group is assembled from it (ADR-0004).
 *
 * **Every write here is an Administrator's** (#470, ADR-0028): adding, Nonaktifkan and the Grant
 * picker render only for one, gated on the viewer's own Grants threaded onto the caller — a courtesy,
 * with `requireGrant("Administrator")` inside each write as the enforcement, since a layout does not
 * run before a Server Action. `hasGrant` asserts the viewer is Staff first, so a Pimpinan is never
 * handed the controls. The viewer's id goes down so their own row offers no lockout.
 */
export default async function Page() {
  const person = await requirePerson();
  const people = await roster(person);
  const canAdminister = hasGrant(person, "Administrator");

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <h1 className="font-heading text-lg font-medium">Orang</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Roster sekaligus daftar undangan. Siapa pun yang masuk bisa membacanya; hanya
          Administrator yang menambah dan menonaktifkan orang. Peran terkunci setelah seseorang
          dipakai.
        </p>
      </header>

      <OrangRoster
        people={people}
        viewerId={person.id}
        canAdminister={canAdminister}
      />
    </div>
  );
}
