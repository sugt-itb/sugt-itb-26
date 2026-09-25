import { PerjadinDirectoryList } from "-/components/perjadin-directory-list";
import { requirePerson } from "-/lib/person";
import { perjadinDirectory } from "@sugt/db/queries";
import { LinkButton } from "@sugt/ui/components/link-button";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Perjadin" };

/**
 * **Perjadin** — every trip, newest first.
 *
 * One `requirePerson()`, one query, no role check: a trip's dates, its destination and how
 * many Schools it reaches are delivery data, and ADR-0004 opens that to everyone signed in.
 * The Advance is not here at all — it is `perjadinAcquittal`'s, which any signed-in Person may
 * read now (ADR-0004 reversed by ADR-0026, #180); this list simply never fetches money, and
 * writing money stays Staff-only.
 *
 * The list rendering lives in the `"use client"` `PerjadinDirectoryList`, which filters the payload
 * in the browser (#334) — the page stays a Server Component that fetches the full list once.
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-7 py-5">
        <div>
          <h1 className="font-heading text-lg font-medium">Perjadin</h1>
          <p className="text-sm text-muted-foreground">
            Setiap perjalanan dinas, yang terbaru di atas. Perjadin direncanakan di Rencanakan
            Perjadin.
          </p>
        </div>
        {/* Staff-only create action, moved off the sidebar onto its list page (#294). Non-Staff
            render nothing — no disabled state. */}
        {person.role === "Staff" && (
          <LinkButton render={<Link href="/perjadin/baru" />}>
            <Plus data-icon="inline-start" />
            Rencanakan Perjadin
          </LinkButton>
        )}
      </header>

      {trips.length === 0 ? (
        <p className="p-7 text-sm text-muted-foreground">
          Belum ada Perjadin. Buka Rencanakan Perjadin untuk merencanakan yang pertama.
        </p>
      ) : (
        <PerjadinDirectoryList trips={trips} />
      )}
    </div>
  );
}
