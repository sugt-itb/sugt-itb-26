import { ArrangeOnlineSessionForm } from "-/components/arrange-online-session-form";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { arrangeOnlineSessionForm } from "@sugt/db/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Jadwalkan Sesi Daring" };

/**
 * **Jadwalkan Sesi daring** — arranging one online Session, for one School (#70).
 *
 * A page rather than a dialog, and it **stands on its own with a School picker**, reached from
 * the nav — it no longer reads a Coverage selection. The same action also appears on Detail
 * Sekolah, where you already are when thinking about one School.
 *
 * **Staff-only, so the read is too.** `staffSurface` turns `@sugt/db`'s typed refusal into a 403
 * server-side. Without it on the read, a Teaching Team member who reached this URL directly would
 * be shown the whole form and refused only on submit.
 *
 * The route sits under its list route as `/sesi-daring/baru`, the way `/perjadin/baru` and the
 * `/cerita/baru` house pattern do (#308).
 */
export default async function Page() {
  const person = await requirePerson();

  const form = await staffSurface(() => arrangeOnlineSessionForm(person));

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Jadwalkan Sesi daring</h1>
        <p className="text-sm text-muted-foreground">
          Satu Sesi daring untuk satu Sekolah — tanggalnya, jam mulai dan jam selesainya.
        </p>
      </header>

      {form.schools.length === 0 ? (
        <p className="p-7 text-sm text-muted-foreground">Belum ada Sekolah.</p>
      ) : (
        <ArrangeOnlineSessionForm schools={form.schools} />
      )}
    </div>
  );
}
