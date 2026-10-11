"use client";

import { RailTooltip } from "-/components/sidebar-collapse";
import { sidebarItems } from "-/components/sidebar-items";
import type { Role } from "@sugt/domain";
import { cn } from "@sugt/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** What the badge means, for a screen reader and the collapsed rail's tooltip. */
const ATTENTION = "Google Drive perlu perhatian";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The sidebar's links. A client component because the current section is read from the
 * URL; the shell around it stays on the server. Which links, and in what order, is `sidebarItems`.
 *
 * **Two states on desktop** (#359, `sidebar-collapse.tsx`). Expanded, each link is its icon and its
 * label. On the collapsed rail the label becomes `sr-only` — so the link keeps its accessible name —
 * and a tooltip on the right shows it instead; the icon still navigates and still shows the active
 * state. Labels never wrap (`whitespace-nowrap`), so while the width animates they are clipped by
 * the aside rather than broken onto a second line. In the phone drawer nothing here collapses.
 */
function AppSidebarNav({
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
  driveNeedsAttention: boolean;
}) {
  const pathname = usePathname();
  const visible = sidebarItems({
    role,
    canEditDaring,
    canViewKeuangan,
    canViewDashboard,
    canAdminister,
    driveNeedsAttention,
  });

  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {visible.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <RailTooltip
            key={item.href}
            label={item.badge ? `${item.label} — ${ATTENTION}` : item.label}
            render={
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium whitespace-nowrap text-sidebar-foreground group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:px-0",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              />
            }
          >
            <span className="relative inline-flex shrink-0">
              <item.icon className={cn("size-4", !active && "text-muted-foreground")} />
              {item.badge && (
                <span
                  aria-hidden
                  className="absolute -top-1 -right-1 size-2 rounded-full bg-destructive ring-2 ring-sidebar"
                />
              )}
            </span>
            <span className="group-data-[state=collapsed]/sidebar:sr-only">{item.label}</span>
            {item.badge && <span className="sr-only"> — {ATTENTION}</span>}
          </RailTooltip>
        );
      })}
    </nav>
  );
}

export { AppSidebarNav };
