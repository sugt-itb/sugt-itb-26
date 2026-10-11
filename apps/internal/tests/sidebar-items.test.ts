import { sidebarItems } from "-/components/sidebar-items";
import { canViewDashboard, hasGrant, type Person } from "@sugt/db/queries";
import type { Grant, Role } from "@sugt/domain";
import { describe, expect, it } from "vitest";

/**
 * **The sidebar's links, in order, per viewer** (#353). Pure over three booleans and a Role — no DB,
 * nothing mounted. The inputs come from the real `hasGrant` / `canViewDashboard`, exactly as the shell
 * computes them, so each row is the sidebar a Person with that Role and those Grants actually sees.
 */

function hrefsFor(role: Role, grants: Grant[]) {
  const person: Person = { id: "p", fullName: "P", email: "p@example.com", role, grants };
  return sidebarItems({
    role,
    canEditDaring: hasGrant(person, "Daring Editor"),
    canViewDashboard: canViewDashboard(person),
    canAdminister: hasGrant(person, "Administrator"),
    driveNeedsAttention: false,
  }).map((item) => item.href);
}

const FULL = [
  "/",
  "/kalender",
  "/pretest",
  "/pendamping",
  "/perjadin",
  "/sesi-daring",
  "/feedback",
  "/cerita",
  "/sekolah",
  "/kelompok-sekolah",
  "/orang",
];

describe("sidebarItems", () => {
  it("gives a Staff Administrator every link, Dashboard first and Log then Pengaturan last", () => {
    expect(hrefsFor("Staff", ["Administrator"])).toEqual([...FULL, "/log", "/pengaturan"]);
    expect(hrefsFor("Staff", ["Administrator", "Dashboard Viewer"])).toEqual([
      ...FULL,
      "/log",
      "/pengaturan",
    ]);
  });

  it("gives a Staff Daring Editor who reads the Dashboard every link but Log and Pengaturan", () => {
    expect(hrefsFor("Staff", ["Daring Editor", "Dashboard Viewer"])).toEqual(FULL);
    expect(hrefsFor("Staff", ["Daring Editor", "Dashboard Editor"])).toEqual(FULL);
  });

  it("puts Pendamping first for a Staff holding only Daring Editor, Pretest kept (ADR-0052)", () => {
    expect(hrefsFor("Staff", ["Daring Editor"])).toEqual([
      "/pendamping",
      "/kalender",
      "/pretest",
      "/perjadin",
      "/sesi-daring",
      "/feedback",
      "/cerita",
      "/sekolah",
      "/kelompok-sekolah",
      "/orang",
    ]);
  });

  it.each(["Perjadin Editor", "Keuangan"] as const)(
    "puts Pendamping first, with no Dashboard or Pretest, for a Staff holding only %s (ADR-0052)",
    (grant) => {
      expect(hrefsFor("Staff", [grant])).toEqual(hrefsFor("Staff", []));
    },
  );

  it("drops only Pretest for a Staff Dashboard Viewer, and for a Dashboard Editor", () => {
    expect(hrefsFor("Staff", ["Dashboard Editor"])).toEqual(
      hrefsFor("Staff", ["Dashboard Viewer"]),
    );
    expect(hrefsFor("Staff", ["Dashboard Viewer"])).toEqual([
      "/",
      "/kalender",
      "/pendamping",
      "/perjadin",
      "/sesi-daring",
      "/feedback",
      "/cerita",
      "/sekolah",
      "/kelompok-sekolah",
      "/orang",
    ]);
  });

  it("puts Pendamping first for a grant-less Staff, who cannot see the Dashboard", () => {
    expect(hrefsFor("Staff", [])).toEqual([
      "/pendamping",
      "/kalender",
      "/perjadin",
      "/sesi-daring",
      "/feedback",
      "/cerita",
      "/sekolah",
      "/kelompok-sekolah",
      "/orang",
    ]);
  });

  it("gives a Pimpinan the Dashboard first and no Staff-only or Grant-gated links", () => {
    expect(hrefsFor("Pimpinan", [])).toEqual([
      "/",
      "/kalender",
      "/perjadin",
      "/sesi-daring",
      "/feedback",
      "/sekolah",
      "/kelompok-sekolah",
      "/orang",
    ]);
  });

  it("badges Pengaturan, and nothing else, while Drive needs an Administrator", () => {
    const admin: Person = {
      id: "p",
      fullName: "P",
      email: "p@example.com",
      role: "Staff",
      grants: ["Administrator"],
    };
    const items = (driveNeedsAttention: boolean) =>
      sidebarItems({
        role: "Staff",
        canEditDaring: true,
        canViewDashboard: true,
        canAdminister: hasGrant(admin, "Administrator"),
        driveNeedsAttention,
      });

    expect(
      items(true)
        .filter((item) => item.badge)
        .map((item) => item.href),
    ).toEqual(["/pengaturan"]);
    expect(items(false).some((item) => item.badge)).toBe(false);
  });
});
