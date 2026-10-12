import { AppShell } from "-/components/app-shell";
import { parseSidebarState, SIDEBAR_STATE_COOKIE } from "-/components/sidebar-state";
import { SignOutButton } from "-/components/sign-out-button";
import { uploadGate } from "-/lib/drive/upload-gate";
import { getPerson } from "-/lib/person";
import { canViewDashboard, hasGrant } from "@sugt/db/queries";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * The signed-in tree. Everything under this layout can assume a Person, and it is
 * where the shell goes — `/masuk` stays outside it, because a sign-in screen with a
 * sidebar offers navigation to someone who cannot navigate yet.
 *
 * **This is the cheap outer gate, and it is not the last word.** There are three
 * checks and only the third cannot be bypassed:
 *
 *   1. `proxy.ts` — optimistic, cookie present or not. Never authoritative.
 *   2. This layout — authoritative for **pages**, and only for pages.
 *   3. `@sugt/db`'s choke point — the one that covers writes.
 *
 * The distinction is load-bearing rather than pedantic: **a Next.js layout does not
 * run before a Server Action.** A Server Action runs before the layout re-renders, so
 * a layout-only check protects reads and leaves every write open. The query layer is
 * what closes that, and it is a separate spec.
 *
 * It calls `getPerson()` and redirects rather than `requirePerson()` and throwing,
 * because a revoked Person arriving mid-session should land on the sign-in screen and
 * not on an error page. Everything **inside** this tree uses `requirePerson()`, where
 * a null can only come from a bug. Both share one memoised read, so the page below
 * costs no second round trip.
 *
 * `role` and `personName` were a placeholder literal until this landed — the shell was
 * built against issue #14 while knowing-who-is-asking was still issue #24. They are now
 * the session's.
 */
export default async function SignedInLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const person = await getPerson();
  if (!person) redirect("/masuk");

  // Read here so the server renders the desktop sidebar at its stored width: no flash of the
  // expanded width on a collapsed reload (#359). No cookie, or an unknown value, is expanded.
  const sidebarState = parseSidebarState((await cookies()).get(SIDEBAR_STATE_COOKIE)?.value);

  // The Pengaturan badge (#375): read only for an Administrator, the only viewer of that link — one
  // small single-row query, and none at all for anyone else.
  const canAdminister = hasGrant(person, "Administrator");
  const driveNeedsAttention = canAdminister && !(await uploadGate(person)).open;

  return (
    <AppShell
      role={person.role}
      personName={person.fullName}
      canEditDaring={hasGrant(person, "Daring Editor")}
      canViewKeuangan={hasGrant(person, "Keuangan")}
      canViewDashboard={canViewDashboard(person)}
      canAdminister={canAdminister}
      driveNeedsAttention={driveNeedsAttention}
      sidebarState={sidebarState}
      footerAction={
        /* Sign-out ends the profile row of the shell's footer — the one `SidebarBody` the desktop
           sidebar and the mobile drawer both render (#122), so it is reachable in both, and on the
           collapsed rail it sits under the avatar (#359). The theme control is not here: on
           desktop it is the shell's own Mode Gelap row (or the rail's theme button), and on a
           phone the top bar's toggle (#127) — one per breakpoint (#358). */
        <SignOutButton />
      }
    >
      {children}
    </AppShell>
  );
}
