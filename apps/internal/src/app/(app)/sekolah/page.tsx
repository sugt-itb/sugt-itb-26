import { SchoolDirectoryTable } from "-/components/school-directory-table";
import { requirePerson } from "-/lib/person";
import { schoolDirectory } from "@sugt/db/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Direktori Sekolah" };

/**
 * **Direktori Sekolah** — all forty-seven Schools, and the way into one School's Sessions.
 *
 * One `requirePerson()`, one query, one payload — and no role check, because delivery
 * data is open to everyone signed in (ADR-0004). The filtering runs in the browser over
 * the payload; see `SchoolDirectoryTable`.
 *
 * **The route stays at `/sekolah`.** This ticket owns the slug and could move it, but
 * the surface is called Direktori Sekolah in the enumerated list and in the sidebar,
 * and renaming the directory would buy a second name for one screen and a change to
 * `NAV` for nothing.
 */
export default async function Page() {
  const person = await requirePerson();
  const schools = await schoolDirectory(person);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Direktori Sekolah</h1>
        <p className="text-sm text-muted-foreground">
          Setiap Sekolah peserta, dengan Cluster dan jumlah Sesi terlaksana.
        </p>
      </header>

      {schools.length === 0 ? (
        <p className="p-7 text-sm text-muted-foreground">
          Belum ada data Sekolah. Jalankan seed data referensi.
        </p>
      ) : (
        <SchoolDirectoryTable schools={schools} />
      )}
    </div>
  );
}
