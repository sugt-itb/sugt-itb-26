import { ArrangeOnlineSessionForm } from "-/components/arrange-online-session-form";
import { SchoolSessions } from "-/components/school-sessions";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { arrangeOnlineSessionAt, schoolDetail } from "@sugt/db/queries";
import { TOTAL_SESSIONS_PER_SCHOOL } from "@sugt/domain";
import { Progress } from "@sugt/ui/components/progress";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

/**
 * The browser-tab title: the School's name, falling back to the section label for a slug that names
 * no School (#309). Reads the same open query the page does — a minimal title query, as the ticket
 * asks, rather than shared state.
 */
export async function generateMetadata({
  params,
}: PageProps<"/sekolah/[slug]">): Promise<Metadata> {
  const person = await requirePerson();
  const { slug } = await params;
  const school = await schoolDetail(person, slug);
  return { title: school ? school.name : "Direktori Sekolah" };
}

/**
 * **Detail Sekolah** — one School's Sessions, and how much teaching has happened.
 *
 * One `requirePerson()`, one open query, and no role check on the read: this is delivery data
 * and ADR-0004 opens it to everyone signed in.
 *
 * **The arrange-a-Session affordance is the second entry point for Jadwalkan Sesi daring (#70)**
 * — you are already thinking about one School here. It is Staff-only, so its read runs only for a
 * Staff caller and renders only when it returns; `requireStaff` in the write is the enforcement,
 * since a layout does not run before a Server Action.
 *
 * Keyed on the School's `slug` rather than its id — the column is unique, it is what the public
 * site already addresses a School by, and it survives being pasted into a message. A slug naming
 * no School is an ordinary thing to arrive with, so it is a **404** and not an error.
 */
export default async function Page({ params }: PageProps<"/sekolah/[slug]">) {
  const person = await requirePerson();
  const { slug } = await params;

  const school = await schoolDetail(person, slug);
  if (!school) notFound();

  const arrange =
    person.role === "Staff" ? await staffSurface(() => arrangeOnlineSessionAt(person, slug)) : null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">{school.name}</h1>
        <p className="text-sm text-muted-foreground">
          {school.clusterName} · {school.kabupatenKota}
        </p>

        <div className="mt-3.5 flex max-w-sm items-center gap-3">
          <Progress
            className="w-40 shrink-0"
            value={school.deliveredSessions}
            max={TOTAL_SESSIONS_PER_SCHOOL}
            aria-label={`${school.name}: ${school.deliveredSessions} dari ${TOTAL_SESSIONS_PER_SCHOOL} Sesi terlaksana`}
          />
          {/*
            The denominator is `TOTAL_SESSIONS_PER_SCHOOL` and never travels in the
            payload: it is the same for every School and fixed from the start, so
            returning it per row would be a second source of truth for a constant.
          */}
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {school.deliveredSessions} / {TOTAL_SESSIONS_PER_SCHOOL} Sesi terlaksana
          </span>
        </div>
      </header>

      <SchoolSessions sessions={school.sessions} />

      {arrange !== null && (
        <section className="border-t border-border">
          <h2 className="px-7 pt-5 font-heading text-sm font-medium">Jadwalkan Sesi daring</h2>
          <ArrangeOnlineSessionForm school={arrange.school} />
        </section>
      )}
    </div>
  );
}
