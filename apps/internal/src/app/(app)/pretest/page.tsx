import { requirePerson } from "-/lib/person";
import { hasGrant, pretestEditorData } from "@sugt/db/queries";
import { forbidden } from "next/navigation";

import { PretestEditor } from "./pretest-editor";

/**
 * **Pretest** — where a grant-holder records which Schools have had their Pretest administered, per
 * Stream and participant-type (ticket #247). Four boxes a School: STEM·Siswa, STEM·GTK-MS,
 * Research·Siswa, Research·GTK-MS. Presence of a box = done.
 *
 * **The page is editor-only.** Unlike `/monitoring`, whose reads are open, this whole surface is a
 * data-entry tool with nothing to show a non-editor — so it gates *rendering* on the Monitoring
 * Editor Grant (an Administrator implies it, `hasGrant`) and `forbidden()`s everyone else into a
 * 403. That is a courtesy gate: `requireGrant` inside `setAssessmentCompletion` is the real
 * enforcement, since a layout does not run before a Server Action. The sidebar hides the link from
 * the same non-holders (`app-sidebar.tsx`), so the 403 is only ever reached by a direct URL.
 */
export default async function Page() {
  const person = await requirePerson();
  if (!hasGrant(person, "Editor")) forbidden();

  const data = await pretestEditorData(person);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Pretest</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tandai sekolah yang telah menyelesaikan Pretest, per Stream dan jenis peserta. Perubahan
          tersimpan otomatis.
        </p>
      </header>

      <PretestEditor
        clusters={data.clusters}
        schools={data.schools}
        completions={data.completions}
      />
    </div>
  );
}
