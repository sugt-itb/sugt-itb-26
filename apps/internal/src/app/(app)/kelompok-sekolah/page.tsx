import { KelompokSekolahEditor } from "-/components/kelompok-sekolah-editor";
import { requirePerson } from "-/lib/person";
import { subClusterBoard } from "@sugt/db/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Kelompok Sekolah" };

/**
 * **Kelompok Sekolah** — the Sub-Cluster editing screen, the tool's only admin surface over
 * anything in the reference-data section, and the reason is ADR-0016: nobody allocated the
 * Sub-Clusters, so DITSAMA edits them.
 *
 * One `requirePerson()` and one query, **no role check on the read**: anyone signed in reads the
 * grouping, because a Perjadin is planned against it. The create, rename, delete and move
 * controls render only for Staff, and `requireStaff` inside each write is the enforcement —
 * hiding them is a courtesy, since a layout does not run before a Server Action.
 */
export default async function Page() {
  const person = await requirePerson();
  const clusters = await subClusterBoard(person);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Kelompok Sekolah</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Kumpulan Sekolah dalam satu Cluster yang cukup dekat untuk dikunjungi dalam satu
          perjalanan. Perjadin direncanakan atas dasar ini. Siapa pun yang masuk bisa membacanya;
          hanya DITSAMA yang membuat, mengganti nama, menghapus, dan memindahkan Sekolah.
        </p>
      </header>

      <KelompokSekolahEditor
        clusters={clusters}
        canWrite={person.role === "Staff"}
      />
    </div>
  );
}
