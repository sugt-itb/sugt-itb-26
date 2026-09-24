import { CeritaBaruForm } from "-/components/cerita/cerita-baru-form";
import { requirePerson } from "-/lib/person";
import { schoolDirectory } from "@sugt/db/queries";
import type { Metadata } from "next";
import { forbidden } from "next/navigation";

export const metadata: Metadata = { title: "Cerita baru" };

/**
 * **Start a Story.** Pick a School and a title; creation and the redirect into the editor happen in
 * `createStoryAction`.
 *
 * **Staff-only, gated here as defence in depth.** Unlike the editor and the index, this page's only
 * read is the School directory, which is open to anyone signed in — so there is no `@sugt/db`
 * refusal for `staffSurface` to translate. The gate is an explicit role check instead: the write
 * behind the form is Staff-only in the query layer, and a non-Staff who navigates straight here
 * should get a 403, not a form that refuses on submit.
 */
export default async function Page() {
  const person = await requirePerson();
  if (person.role !== "Staff") forbidden();

  const schools = await schoolDirectory(person);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Cerita baru</h1>
        <p className="text-sm text-muted-foreground">
          Pilih Sekolah dan beri judul. Sisanya — isi, jenis, Stream, dan foto — ditulis di editor.
        </p>
      </header>

      <CeritaBaruForm
        schools={schools.map((school) => ({
          id: school.id,
          name: school.name,
          kabupatenKota: school.kabupatenKota,
        }))}
      />
    </div>
  );
}
