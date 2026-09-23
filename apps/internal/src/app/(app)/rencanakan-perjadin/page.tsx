import { PerjadinPlanForm } from "-/components/perjadin-plan-form";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { perjadinPlan } from "@sugt/db/queries";
import { LinkButton } from "@sugt/ui/components/link-button";
import Link from "next/link";

/**
 * **Rencanakan Perjadin** — the trip, its Group and one Session per kept School, planned in one
 * pass around a **Sub-Cluster** (#69).
 *
 * A page rather than a dialog, for the reason Jadwalkan Sesi daring is: a dialog holding a
 * Group and a row per School is a page with a backdrop.
 *
 * **Reached from the nav**, not from a selection made elsewhere — the form begins by picking a
 * Sub-Cluster and revealing its Schools. **Staff-only, so the read is too:** without
 * `staffSurface` on the read, a Teaching Team member reaching this URL directly would be shown
 * the whole form and refused only on submit.
 *
 * The route is named after the surface, beside `/jadwalkan-sesi-daring`. The trip that results
 * is read at `/perjadin`, which is a different thing at a different name — one is the act, the
 * other is the record.
 */
export default async function Page() {
  const person = await requirePerson();

  const plan = await staffSurface(() => perjadinPlan(person));

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-7 py-5">
        <h1 className="font-heading text-lg font-medium">Rencanakan Perjadin</h1>
        <p className="text-sm text-muted-foreground">
          Pilih Kelompok Sekolah, lalu tambahkan Sesi untuk tiap Sekolah yang dikunjungi —
          masing-masing dengan tanggal, jam, dan Aliran sendiri. Setiap tanggal harus berada di
          dalam rentang Perjadin.
        </p>
      </header>

      {plan.subClusters.length === 0 ? (
        <div className="flex flex-col items-start gap-3.5 p-7">
          <p className="text-sm text-muted-foreground">
            Belum ada Kelompok Sekolah yang berisi Sekolah. Bentuk dan isi Kelompok Sekolah terlebih
            dahulu.
          </p>
          <LinkButton
            variant="outline"
            render={<Link href="/kelompok-sekolah" />}
          >
            Ke Kelompok Sekolah
          </LinkButton>
        </div>
      ) : (
        <PerjadinPlanForm
          subClusters={plan.subClusters}
          staff={plan.staff}
          pimpinan={plan.pimpinan}
        />
      )}
    </div>
  );
}
