import { SchoolDirectoryTable } from "-/components/school-directory-table";
import { requirePerson } from "-/lib/person";
import { assessmentBoxesBySchool, schoolKegiatan } from "-/lib/programme-progress";
import { assessmentCompletions, schoolDirectory } from "@sugt/db/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Direktori Sekolah" };

/**
 * **Direktori Sekolah** — all forty-seven Schools, and the way into one School's Sessions.
 *
 * One `requirePerson()`, two open reads — and no role check, because delivery data is
 * open to everyone signed in (ADR-0004). The filtering runs in the browser over the
 * payload; see `SchoolDirectoryTable`.
 *
 * **Each School reads Kegiatan terlaksana** (#540, ADR-0031): its delivered Sessions plus
 * its assessment units, folded here from two separate reads, because joining the boxes
 * into the directory's Session join would multiply the rows and inflate the count.
 *
 * **The route stays at `/sekolah`.** This ticket owns the slug and could move it, but
 * the surface is called Direktori Sekolah in the enumerated list and in the sidebar,
 * and renaming the directory would buy a second name for one screen and a change to
 * `NAV` for nothing.
 */
export default async function Page() {
  const person = await requirePerson();
  const [directory, completions] = await Promise.all([
    schoolDirectory(person),
    assessmentCompletions(person),
  ]);
  const boxes = assessmentBoxesBySchool(completions);
  const schools = directory.map((school) => ({
    ...school,
    kegiatan: schoolKegiatan(school.deliveredSessions, boxes.get(school.id)),
  }));

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-7">
        <h1 className="font-heading text-lg font-medium">Direktori Sekolah</h1>
        <p className="text-sm text-muted-foreground">
          Setiap Sekolah peserta, dengan Cluster dan jumlah Kegiatan terlaksana.
        </p>
      </header>

      {schools.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground sm:p-7">
          Belum ada data Sekolah. Jalankan seed data referensi.
        </p>
      ) : (
        <SchoolDirectoryTable schools={schools} />
      )}
    </div>
  );
}
