"use client";

import type { Role } from "@sugt/domain";
import { cn } from "@sugt/ui/lib/utils";
import {
  Boxes,
  CalendarDays,
  ClipboardCheck,
  Gauge,
  LayoutDashboard,
  ListVideo,
  type LucideIcon,
  MessageSquare,
  Newspaper,
  Plane,
  School,
  Users,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The sidebar's destinations, in order.
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
 * `editorOnly` is a second, narrower dimension beside `staffOnly` (ADR-0028): a link shown only to an
 * Editor (an Administrator implies it). `/pretest` carries it — its page `forbidden()`s a
 * non-holder, so linking a screen that would refuse them is the same "worse than no link" rule the
 * Staff-only entries follow. The shell resolves the Grant once and passes the boolean down.
 */
type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  staffOnly: boolean;
  /** Shown only to an Editor / Administrator. Absent means "no Grant gate". */
  editorOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: Gauge, staffOnly: false },
  { href: "/pendamping", label: "Pendamping", icon: LayoutDashboard, staffOnly: true },
  { href: "/kalender", label: "Kalender", icon: CalendarDays, staffOnly: false },
  { href: "/pretest", label: "Pretest", icon: ClipboardCheck, staffOnly: false, editorOnly: true },
  { href: "/sekolah", label: "Direktori Sekolah", icon: School, staffOnly: false },
  { href: "/kelompok-sekolah", label: "Kelompok Sekolah", icon: Boxes, staffOnly: false },
  { href: "/feedback", label: "Feedback", icon: MessageSquare, staffOnly: false },
  { href: "/perjadin", label: "Perjadin", icon: Plane, staffOnly: false },
  { href: "/sesi-daring", label: "Sesi Daring", icon: ListVideo, staffOnly: false },
  { href: "/cerita", label: "Cerita", icon: Newspaper, staffOnly: true },
  { href: "/orang", label: "Orang", icon: Users, staffOnly: false },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The sidebar's links. A client component because the current section is read from the
 * URL; the shell around it stays on the server.
 */
function AppSidebarNav({ role, canEditMonitoring }: { role: Role; canEditMonitoring: boolean }) {
  const pathname = usePathname();
  const visible = NAV.filter(
    (item) => (!item.staffOnly || role === "Staff") && (!item.editorOnly || canEditMonitoring),
  );

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {visible.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon className={cn("size-4", !active && "text-muted-foreground")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export { AppSidebarNav };
