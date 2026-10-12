import type { Role } from "@sugt/domain";
import {
  Boxes,
  CalendarDays,
  ClipboardCheck,
  Gauge,
  Landmark,
  LayoutDashboard,
  ListVideo,
  type LucideIcon,
  MessageSquare,
  Newspaper,
  Plane,
  School,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import type { Route } from "next";

export type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  staffOnly: boolean;
  /** Shown only to a Daring Editor / Administrator. Absent means "no Grant gate". */
  daringEditorOnly?: boolean;
  /** Shown only to a Keuangan holder / Administrator (#472). Absent means "no Grant gate". */
  keuanganOnly?: boolean;
  /** Shown only to a Person who may read the Dashboard (`canViewDashboard`). Absent means "no gate". */
  dashboardView?: boolean;
  /** Shown only to an Administrator. Absent means "no gate". */
  administratorOnly?: boolean;
  /** Carries the badge while the company Google Drive needs an Administrator (#375). */
  driveBadge?: boolean;
};

/** A link as one viewer sees it: `badge` puts the Drive badge on it. */
export type VisibleNavItem = NavItem & { badge: boolean };

/**
 * The sidebar's destinations, in order — with one exception: **Pendamping moves to the top when the
 * viewer cannot see the Dashboard** (#353). The rule is keyed on `canViewDashboard`, not on a Role or
 * Grant name, and it means "if `/` would redirect you to `/pendamping`, Pendamping is your first
 * link" — today only a grant-less Staff. It is not a "home page" rule: sign-in lands every Staff on
 * `/pendamping` whatever their Grants, so for a Staff who sees the Dashboard the top link and the
 * landing page differ, deliberately.
 *
 * `staffOnly` is the sidebar's whole share of the access rule: **delivery data is open,
 * money is not** (ADR-0004). The Perjadin list and detail stay open, because a professor
 * gets a money-free variant of both and needs it to file a Perjadin Evaluation. Cerita is
 * Staff-only for a different reason: publishing is (ADR-0008), and a link to a screen
 * that will refuse you is worse than no link. Arranging delivery — Rencanakan Perjadin and
 * Jadwalkan Sesi Daring — is Staff-only too (the surface list, #9/#70), but those two create-actions
 * are no longer sidebar entries: each is a Staff-only button on its list page (`/perjadin`,
 * `/sesi-daring`) instead (#294), so the sidebar shows only the always-open list links.
 *
 * **Perjadin Report is not here, and its absence is the answer to a question issue #30
 * owned.** The Report is the acquittal state on one `perjadin` row — there is no
 * `perjadin_report` table — so it lives at `/perjadin/[id]/laporan` and is reached from the
 * trip it accounts for. A top-level entry would have needed an index of trips to point at,
 * and nothing asked for one.
 *
 * Omitting a link is not access control. The gate is a Staff-only choke point in the
 * data layer, which is issue #25 rather than this shell.
 *
 * `daringEditorOnly` is a second, narrower dimension beside `staffOnly` (ADR-0028): a link shown only to a
 * Daring Editor (an Administrator implies it). `/pretest` carries it — its page `forbidden()`s a
 * non-holder, so linking a screen that would refuse them is the same "worse than no link" rule the
 * Staff-only entries follow. The shell resolves the Grant once and passes the boolean down.
 *
 * `dashboardView` is a third such dimension (#322): the `/` link is shown only when the viewer may
 * read the Dashboard — a `Pimpinan` by Role, a `Staff` holding `Dashboard Viewer`
 * (or `Dashboard Editor` or `Administrator`, which imply it). Its
 * page redirects a grant-less Staff to `/pendamping`, so — same rule again — the link is hidden for
 * exactly the callers it would bounce. The shell computes `canViewDashboard` once (the one predicate
 * the page guard shares) and passes the boolean down.
 *
 * `keuanganOnly` is a fourth (#472): **Keuangan** is gated the same way, on the Keuangan Grant (an Administrator
 * implies it), since its page `forbidden()`s everyone else. It sits after Pendamping and keeps that
 * place when Pendamping moves to the top.
 *
 * `administratorOnly` is a fifth (#372): **Pengaturan** is shown only to an Administrator, because
 * its page `forbidden()`s everyone else — the same "worse than no link" rule once more. **Log**,
 * the Activity Log (#395), carries it for the same reason, and so does **Orang** (#488), whose
 * roster only an Administrator reads.
 *
 * **Pengaturan carries a badge while Drive needs an Administrator** (#375) — not connected, broken,
 * or its folders unresolved: the states in which nobody can upload a receipt. Only Administrators
 * see the link, so only they see the badge, and they are the ones who can act on it.
 */
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: Gauge, staffOnly: false, dashboardView: true },
  { href: "/kalender", label: "Kalender", icon: CalendarDays, staffOnly: false },
  {
    href: "/pretest",
    label: "Pretest",
    icon: ClipboardCheck,
    staffOnly: false,
    daringEditorOnly: true,
  },
  { href: "/pendamping", label: "Pendamping", icon: LayoutDashboard, staffOnly: true },
  { href: "/keuangan", label: "Keuangan", icon: Landmark, staffOnly: true, keuanganOnly: true },
  { href: "/perjadin", label: "Perjadin", icon: Plane, staffOnly: false },
  { href: "/sesi-daring", label: "Sesi Daring", icon: ListVideo, staffOnly: false },
  { href: "/feedback", label: "Feedback", icon: MessageSquare, staffOnly: false },
  { href: "/cerita", label: "Cerita", icon: Newspaper, staffOnly: true },
  { href: "/sekolah", label: "Direktori Sekolah", icon: School, staffOnly: false },
  { href: "/kelompok-sekolah", label: "Kelompok Sekolah", icon: Boxes, staffOnly: false },
  { href: "/orang", label: "Orang", icon: Users, staffOnly: true, administratorOnly: true },
  { href: "/log", label: "Log", icon: ScrollText, staffOnly: true, administratorOnly: true },
  {
    href: "/pengaturan",
    label: "Pengaturan",
    icon: Settings,
    staffOnly: true,
    administratorOnly: true,
    driveBadge: true,
  },
];

/**
 * **The links one viewer sees, in the order they see them.** A plain module rather than part of the
 * `"use client"` sidebar so the rule is testable without mounting it, the reason `table-sort.ts` is one.
 * The filter decides the set; the Pendamping-first exception only reorders it.
 */
export function sidebarItems({
  role,
  canEditDaring,
  canViewKeuangan,
  canViewDashboard,
  canAdminister,
  driveNeedsAttention,
}: {
  role: Role;
  canEditDaring: boolean;
  canViewKeuangan: boolean;
  canViewDashboard: boolean;
  canAdminister: boolean;
  /** Receipts cannot be uploaded until an Administrator fixes the Drive connection. */
  driveNeedsAttention: boolean;
}): VisibleNavItem[] {
  const visible = NAV.filter(
    (item) =>
      (!item.staffOnly || role === "Staff") &&
      (!item.daringEditorOnly || canEditDaring) &&
      (!item.keuanganOnly || canViewKeuangan) &&
      (!item.dashboardView || canViewDashboard) &&
      (!item.administratorOnly || canAdminister),
  ).map((item) => ({ ...item, badge: Boolean(item.driveBadge) && driveNeedsAttention }));
  if (canViewDashboard) return visible;
  const isPendamping = (item: NavItem) => item.href === "/pendamping";
  return [...visible.filter(isPendamping), ...visible.filter((item) => !isPendamping(item))];
}
