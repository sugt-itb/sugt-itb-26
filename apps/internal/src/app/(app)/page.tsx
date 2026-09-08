import { DashboardStaff } from "-/components/dashboard-staff";
import { requirePerson } from "-/lib/person";
import { staffSurface } from "-/lib/staff-surface";
import { myUpcomingPerjadin, staffDashboard } from "@sugt/db/queries";
import { redirect } from "next/navigation";

/**
 * **Beranda** — the landing screen (#40). A dashboard **assembles** from everything else; it does
 * not invent, so this page is one `requirePerson()`, one dashboard read, and the component that
 * renders it.
 *
 * **A non-Staff Pimpinan is redirected to `/monitoring` first** (#179). `staffDashboard` calls
 * `requireStaff` and aggregates money, so a Pimpinan — a signed-in, read-only role — would 403 here;
 * their home is `/monitoring` (#178), so they are sent there before the Staff-only read runs. This
 * is a real branch now, unlike the retired second landing for Teaching-Team professors (T3, #153):
 * for a Staff Person the redirect never fires and the Beranda is unchanged — one `staffDashboard`
 * read behind `staffSurface`, which for a Staff caller is defense in depth its `requireStaff` never
 * actually refuses.
 */
export default async function Page() {
  const person = await requirePerson();
  if (person.role !== "Staff") redirect("/monitoring");

  // Two independent reads, in parallel. `myUpcomingPerjadin` is scoped *by* the caller, not gated by
  // role, and carries no money that needs the choke point (ADR-0026) — so it is read directly rather
  // than behind `staffSurface`, unlike the dashboard aggregate.
  const [dashboard, upcoming] = await Promise.all([
    staffSurface(() => staffDashboard(person)),
    myUpcomingPerjadin(person),
  ]);
  return (
    <DashboardStaff
      dashboard={dashboard}
      upcoming={upcoming}
    />
  );
}
