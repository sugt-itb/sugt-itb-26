"use client";

import type { Role } from "@sugt/domain";
import { cn } from "@sugt/ui/lib/utils";
import {
  Boxes,
  CalendarPlus,
  Gauge,
  LayoutDashboard,
  ListVideo,
  MessageSquare,
  Newspaper,
  Plane,
  School,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The sidebar's destinations, in order.
 *
 * `staffOnly` is the sidebar's whole share of the access rule: **delivery data is open,
 * money is not** (ADR-0004). The Perjadin list and detail stay open, because a professor
 * gets a money-free variant of both and needs it to file a Perjadin Evaluation. Cerita is
 * Staff-only for a different reason: publishing is (ADR-0008), and a link to a screen
 * that will refuse you is worse than no link. Rencanakan Perjadin and Jadwalkan Sesi daring are
 * Staff-only by the same "worse than no link" rule: arranging delivery is Staff-only (the surface
 * list, #9/#70), so their reads are Staff-only too and a Teaching Team member gets no link.
 *
 * **Perjadin Report is not here, and its absence is the answer to a question issue #30
 * owned.** The Report is the acquittal state on one `perjadin` row — there is no
 * `perjadin_report` table — so it lives at `/perjadin/[id]/laporan` and is reached from the
 * trip it accounts for. A top-level entry would have needed an index of trips to point at,
 * and nothing asked for one.
 *
 * Omitting a link is not access control. The gate is a Staff-only choke point in the
 * data layer, which is issue #25 rather than this shell.
 */
const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, staffOnly: false },
  { href: "/monitoring", label: "Monitoring", icon: Gauge, staffOnly: false },
  { href: "/sekolah", label: "Direktori Sekolah", icon: School, staffOnly: false },
  { href: "/kelompok-sekolah", label: "Kelompok Sekolah", icon: Boxes, staffOnly: false },
  { href: "/feedback", label: "Feedback", icon: MessageSquare, staffOnly: false },
  { href: "/perjadin", label: "Perjadin", icon: Plane, staffOnly: false },
  {
    href: "/rencanakan-perjadin",
    label: "Rencanakan Perjadin",
    icon: CalendarPlus,
    staffOnly: true,
  },
  { href: "/sesi-daring", label: "Sesi daring", icon: ListVideo, staffOnly: false },
  {
    href: "/jadwalkan-sesi-daring",
    label: "Jadwalkan Sesi daring",
    icon: Video,
    staffOnly: true,
  },
  { href: "/cerita", label: "Cerita", icon: Newspaper, staffOnly: true },
  { href: "/orang", label: "Orang", icon: Users, staffOnly: false },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The sidebar's links. A client component because the current section is read from the
 * URL; the shell around it stays on the server.
 */
function AppSidebarNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = NAV.filter((item) => !item.staffOnly || role === "Staff");

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
