import { AppShellMobileBar } from "-/components/app-shell-mobile-bar";
import { AppSidebarNav } from "-/components/app-sidebar";
import { DesktopSidebar, RailFooter, SidebarHeader } from "-/components/sidebar-collapse";
import type { SidebarState } from "-/components/sidebar-state";
import { ThemeSwitchRow } from "-/components/theme-switch-row";
import { ROLE_LABELS, type Role } from "@sugt/domain";
import { Avatar, AvatarFallback } from "@sugt/ui/components/avatar";

/**
 * The internal tool's shell: a sidebar beside a fluid main on a wide viewport — 288px expanded, or
 * collapsed to a 64px icon rail (#359) — and a top bar with a drawer below `md`.
 *
 * It lives in `@sugt/internal` rather than `@sugt/ui` for two reasons. Only this app is
 * shaped this way, and an app owns what only it uses. And the sidebar is filtered by
 * `Role`, which comes from `@sugt/domain` — a package `@sugt/ui` may not import
 * (AGENTS.md rule 4), because both apps depend on it and the public one holds no
 * credentials.
 *
 * The responsive split is a shell job, not a page rewrite: the pages already stack on a
 * phone, and it was the always-on sidebar that stole their width. At `md` and up
 * nothing changes. Below `md` the sidebar hides and `AppShellMobileBar` renders a top
 * bar whose hamburger opens the same `SidebarBody` in a drawer — no `sidebar` primitive
 * in `@sugt/ui` (its absence is documented), only the existing `Sheet`.
 *
 * `role` is a prop rather than a session read, so the shell stays a plain component —
 * the signed-in layout does the reading and passes it down. `sidebarState` is the same: the layout
 * reads the collapse cookie, so the server renders the right width on first paint, and
 * `DesktopSidebar` (`sidebar-collapse.tsx`) holds the state from there and writes the cookie back.
 */
function AppShell({
  role,
  personName,
  canEditDaring,
  canViewDashboard,
  canAdminister,
  driveNeedsAttention,
  sidebarState,
  footerAction,
  children,
}: {
  role: Role;
  personName: string;
  /** Whether the viewer holds the Daring Editor Grant — gates the `/pretest` nav link. */
  canEditDaring: boolean;
  /** Whether the viewer may read the Dashboard (`/`) — gates its nav link (#322). */
  canViewDashboard: boolean;
  /** Whether the viewer holds the Administrator Grant — gates the `/pengaturan` nav link (#372). */
  canAdminister: boolean;
  /** Whether Drive needs an Administrator — the badge on Pengaturan (#375). False for anyone else. */
  driveNeedsAttention: boolean;
  /** The desktop sidebar's state as the layout read it from its cookie. */
  sidebarState: SidebarState;
  /** Sign-out, once there is a session to end: the end of the profile row, or on the rail under the avatar. */
  footerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const sidebarBody = (
    <SidebarBody
      role={role}
      personName={personName}
      canEditDaring={canEditDaring}
      canViewDashboard={canViewDashboard}
      canAdminister={canAdminister}
      driveNeedsAttention={driveNeedsAttention}
      footerAction={footerAction}
    />
  );

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <AppShellMobileBar>{sidebarBody}</AppShellMobileBar>

      <DesktopSidebar initialState={sidebarState}>{sidebarBody}</DesktopSidebar>

      <main className="min-w-0 flex-1 bg-background">{children}</main>
    </div>
  );
}

/**
 * The sidebar's contents — brand header, role-filtered nav, and a footer — as one subtree shared by
 * the desktop `<aside>` and the phone drawer, so the two cannot drift. It is written to sit inside a
 * flex column that fills its height (both the `<aside>` and the `Sheet` are): `mt-auto` pins the
 * footer to the bottom.
 *
 * **It has two layouts on desktop** (#359), and chooses between them with CSS: inside a collapsed
 * `DesktopSidebar` the aside carries `data-state="collapsed"`, and the parts marked
 * `group-data-[state=collapsed]/sidebar:` swap — the expanded footer hides and the rail footer
 * shows. The drawer renders this outside any such aside, so it is always the expanded layout. The
 * header and the nav read the state for themselves (`SidebarHeader`, `AppSidebarNav`).
 *
 * The rail footer stacks the theme button, a border, the avatar and sign-out beneath it, each with
 * a tooltip — sign-out stays reachable without expanding (#119, #122).
 *
 * The footer is two rows (#358), because one row held avatar, name, role, theme toggle and
 * sign-out and crowded the name. **Mode Gelap** (`ThemeSwitchRow`) sits above the profile row on
 * desktop only (`hidden md:block`): below `md` the drawer shows the profile row alone, since the
 * phone top bar already carries the theme toggle (#127) — one theme control per breakpoint. The
 * profile row is avatar, name over role, then `footerAction` (sign-out); the name truncates rather
 * than wrap or push sign-out off the row.
 */
function SidebarBody({
  role,
  personName,
  canEditDaring,
  canViewDashboard,
  canAdminister,
  driveNeedsAttention,
  footerAction,
}: {
  role: Role;
  personName: string;
  canEditDaring: boolean;
  canViewDashboard: boolean;
  canAdminister: boolean;
  driveNeedsAttention: boolean;
  footerAction?: React.ReactNode;
}) {
  return (
    <>
      <SidebarHeader />

      <AppSidebarNav
        role={role}
        canEditDaring={canEditDaring}
        canViewDashboard={canViewDashboard}
        canAdminister={canAdminister}
        driveNeedsAttention={driveNeedsAttention}
      />

      <div className="mt-auto border-t border-sidebar-border">
        <div className="group-data-[state=collapsed]/sidebar:hidden">
          <div className="hidden border-b border-sidebar-border md:block">
            <ThemeSwitchRow />
          </div>

          <div className="flex items-center gap-2.5 p-4">
            <Avatar>
              <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
                {initials(personName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{personName}</div>
              <div className="truncate text-xs text-muted-foreground">{ROLE_LABELS[role]}</div>
            </div>
            {footerAction ? <div className="shrink-0">{footerAction}</div> : null}
          </div>
        </div>

        <div className="hidden group-data-[state=collapsed]/sidebar:block">
          <RailFooter
            personName={personName}
            initials={initials(personName)}
            footerAction={footerAction}
          />
        </div>
      </div>
    </>
  );
}

/** Two letters for the sidebar's avatar. A Person is named before they ever sign in. */
function initials(personName: string) {
  return personName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export { AppShell };
