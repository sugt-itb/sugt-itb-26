import { PerjadinDirectoryList } from "-/components/perjadin-directory-list";
import { requirePerson } from "-/lib/person";
import { hasGrant, perjadinDirectory } from "@sugt/db/queries";
import { LinkButton } from "@sugt/ui/components/link-button";
import { Plus, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Perjadin" };

/**
 * **Perjadin** — every trip, newest first.
 *
 * One `requirePerson()`, one query, no role check: a trip's name, its Schools and how
 * many Schools it reaches are delivery data, and ADR-0004 opens that to everyone signed in.
 * Money is not here at all — it is `perjadinAcquittal`'s, which any signed-in Person may
 * read now (ADR-0004 reversed by ADR-0026, #180); this list simply never fetches money, and
 * writing it is the trip's writers' (ADR-0048).
 *
 * **Pengaturan Perjadin** (#422) is a button here, beside Rencanakan Perjadin, for an Administrator
 * only — not a sidebar entry. Anyone else is not shown it; the page itself answers them 403.
 *
 * The table lives in the `"use client"` `PerjadinDirectoryList`, which filters (#334) and sorts
 * (#343) the payload in the browser — the page stays a Server Component that fetches the full list
 * once. The Persiapan checklist toggles from a row only for whoever writes that trip — its Group, an
 * Editor or an Administrator (ADR-0048); every other row's pill is static.
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-5 sm:px-7">
        <div>
          <h1 className="font-heading text-lg font-medium">Perjadin</h1>
          <p className="text-sm text-muted-foreground">
            Setiap perjalanan dinas, yang terbaru di atas. Perjadin direncanakan di Rencanakan
            Perjadin.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Administrator only (#422); everyone else renders nothing — no disabled state. */}
          {hasGrant(person, "Administrator") && (
            <LinkButton
              variant="outline"
              render={<Link href="/perjadin/pengaturan" />}
            >
              <Settings data-icon="inline-start" />
              Pengaturan Perjadin
            </LinkButton>
          )}
          {/* The create action, moved off the sidebar onto its list page (#294). It needs the
              Editor Grant (ADR-0047); anyone without it renders nothing — no disabled state. */}
          {hasGrant(person, "Editor") && (
            <LinkButton render={<Link href="/perjadin/baru" />}>
              <Plus data-icon="inline-start" />
              Rencanakan Perjadin
            </LinkButton>
          )}
        </div>
      </header>

      {trips.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground sm:p-7">
          Belum ada Perjadin.
          {hasGrant(person, "Editor") &&
            " Buka Rencanakan Perjadin untuk merencanakan yang pertama."}
        </p>
      ) : (
        <PerjadinDirectoryList trips={trips} />
      )}
    </div>
  );
}
