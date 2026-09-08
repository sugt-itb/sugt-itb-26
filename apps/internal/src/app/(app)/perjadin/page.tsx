import { shortenKabupaten } from "-/lib/format-destination";
import { requirePerson } from "-/lib/person";
import { perjadinDirectory } from "@sugt/db/queries";
import Link from "next/link";

/**
 * **Perjadin** — every trip, newest first.
 *
 * One `requirePerson()`, one query, no role check: a trip's dates, its destination and how
 * many Schools it reaches are delivery data, and ADR-0004 opens that to everyone signed in.
 * The Advance is not here at all — it is `perjadinAcquittal`'s, which any signed-in Person may
 * read now (ADR-0004 reversed by ADR-0026, #180); this list simply never fetches money, and
 * writing money stays Staff-only.
 *
 * The route keeps the `/perjadin` slug [#14](https://github.com/mafiefa02/sugt/issues/14)
 * chose. It mirrors the surface name enumerated in
 * [#9](https://github.com/mafiefa02/sugt/issues/9), it is the word the sidebar already
 * uses, and it is what a Perjadin is called in every other document — renaming it would
 * make the URL the one place the Programme's own term is avoided.
 */
export default async function Page() {
  const person = await requirePerson();
  const trips = await perjadinDirectory(person);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Perjadin</h1>
        <p className="text-sm text-muted-foreground">
          Setiap perjalanan dinas, yang terbaru di atas. Perjadin direncanakan di Rencanakan
          Perjadin.
        </p>
      </header>

      {trips.length === 0 ? (
        <p className="p-7 text-sm text-muted-foreground">
          Belum ada Perjadin. Buka Rencanakan Perjadin untuk merencanakan yang pertama.
        </p>
      ) : (
        <ul className="border-t border-border">
          {trips.map((trip) => (
            <li
              key={trip.id}
              className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-border px-7 py-3"
            >
              <Link
                href={`/perjadin/${trip.id}`}
                className="text-sm font-medium hover:underline"
              >
                {shortenKabupaten(trip.destination)}
              </Link>
              <span className="text-sm text-muted-foreground tabular-nums">
                {trip.startsOn} – {trip.endsOn}
              </span>
              <span className="text-xs text-muted-foreground">PIC {trip.picFullName}</span>
              <PreparationPill
                done={trip.preparationDone}
                total={trip.preparationTotal}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {trip.schoolCount} Sekolah
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * **The `Persiapan: x/N` pill**, coloured by progress ([#114](https://github.com/mafiefa02/sugt/issues/114)):
 * neutral before anything is ticked, amber part-way, green when every item is done. `N` is at least
 * the six fixed items, so it is never zero and "complete" is `done === total`.
 */
function PreparationPill({ done, total }: { done: number; total: number }) {
  const tone =
    done === total
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : done > 0
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`}>
      Persiapan: {done}/{total}
    </span>
  );
}
