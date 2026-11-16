import { FotoVideoNotice } from "-/components/foto-video-notice";
import { MyPerjadinSection } from "-/components/my-perjadin-section";
import { PendampingPicker, type PendampingTab, PendampingTabs } from "-/components/pendamping-tabs";
import { requirePerson, type Person } from "-/lib/person";
import {
  hasGrant,
  myPerjadin,
  pendampingOptions,
  pendampingPerjadin,
  type MyPerjadin,
} from "@sugt/db/queries";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Pendamping" };

/**
 * **Pendamping** — a Staff member's own trips, and nothing else (#396): a one-line greeting,
 * **Perjalanan Dinas Anda** (the trips not yet over) and **Perjalanan Dinas Sebelumnya** (the ones
 * that are). A past trip keeps every action, because its photos and videos are often uploaded after
 * it. The cards carry no Laporan line (#419); the Laporan is reached through Edit.
 *
 * **"Pendamping" here is a route/label and collides in name only** with the Perjadin role label
 * (`PERJADIN_ROLE_LABELS.Staff` → "Pendamping"): this is the Staff landing screen, not that trip role.
 *
 * **It is Staff-only, at `/pendamping`** (#265). A Pimpinan — a signed-in, read-only role, on no
 * Group — has no trips here; their home is the Dashboard at `/` (#178), so a non-Staff caller is
 * redirected there. `myPerjadin` is scoped *by* the caller, not gated by role, and the money it
 * carries is open to read (ADR-0026), so it needs no Staff choke point.
 *
 * **A Perjadin Editor gets two tabs** (#440, #539), and so does an Administrator, who implies the
 * Grant: **Anda**, which is this page, and **Pendamping Lain**, where they pick any other Staff Person
 * and see that Person's two sections exactly as that Person does, with no greeting — to show someone
 * how to use their own page. The tab and the Person are in the URL
 * (`?tab=lain&pendamping=<id>`); for anyone else the server never reads them.
 */
export default async function Page({ searchParams }: PageProps<"/pendamping">) {
  const person = await requirePerson();
  if (person.role !== "Staff") redirect("/");

  // **Anyone without the Perjadin Editor Grant gets today's page**, and `searchParams` is never read
  // for them: `?tab=lain&pendamping=<id>` changes nothing, and nothing of anyone else is loaded or sent.
  const params = hasGrant(person, "Perjadin Editor") ? await searchParams : null;
  const tab: PendampingTab = params?.tab === "lain" ? "lain" : "anda";

  if (params === null || tab === "anda") {
    const trips = await myPerjadin(person);
    const own = (
      <OwnPage
        person={person}
        trips={trips}
      />
    );
    return (
      <PageFrame>
        {params === null ? own : <PendampingTabs tab="anda">{own}</PendampingTabs>}
      </PageFrame>
    );
  }

  const chosen = typeof params.pendamping === "string" ? params.pendamping : null;
  const [options, viewed] = await Promise.all([
    pendampingOptions(person),
    chosen === null ? null : pendampingPerjadin(person, chosen),
  ]);

  return (
    <PageFrame>
      <PendampingTabs tab="lain">
        <PendampingPicker
          options={options}
          value={viewed?.outcome === "ok" ? chosen : null}
        />
        {viewed?.outcome === "no-such-pendamping" && (
          <p className="text-sm text-muted-foreground">Pendamping tidak ditemukan.</p>
        )}
        {/*
          Their two sections exactly as they see them — same titles, descriptions and empty state,
          no greeting — so a screenshot shows their page. Every control works as the viewer, a
          Perjadin Editor or an Administrator, who writes every Perjadin (ADR-0048), and every logged
          write names the viewer.
        */}
        {viewed?.outcome === "ok" && (
          <PendampingTrips
            trips={viewed.perjadin}
            canWrite
          />
        )}
      </PendampingTabs>
    </PageFrame>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col gap-6 px-4 py-5 sm:p-7">
      {/* Foto & Video sent the tab back (#552); read in the browser, never by this render. */}
      <FotoVideoNotice />
      {children}
    </div>
  );
}

/** Today's page: the greeting, then the viewer's own trips. */
function OwnPage({ person, trips }: { person: Person; trips: MyPerjadin }) {
  return (
    <>
      <h1 className="font-heading text-lg font-semibold">
        Selamat datang kembali, {person.fullName}
      </h1>
      {/*
        The viewer writes every trip listed here (ADR-0048): `myPerjadin` lists only trips whose
        Group they are in.
      */}
      <PendampingTrips
        trips={trips}
        canWrite
      />
    </>
  );
}

/**
 * **One Pendamping's two sections**, or their empty state — the same words whoever is looking, since
 * Pendamping Lain is a screenshot of that Person's page. `canWrite` is the **viewer's** (#439).
 */
function PendampingTrips({ trips, canWrite }: { trips: MyPerjadin; canWrite: boolean }) {
  if (trips.current.length === 0 && trips.previous.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Anda belum tergabung dalam Perjalanan Dinas.</p>
    );
  }
  return (
    <>
      <MyPerjadinSection
        title="Perjalanan Dinas Anda"
        description="Perjalanan yang belum selesai, dan yang bisa Anda kerjakan pada masing-masing."
        trips={trips.current}
        canWrite={canWrite}
      />
      <MyPerjadinSection
        title="Perjalanan Dinas Sebelumnya"
        description="Perjalanan yang sudah selesai, yang terbaru di atas."
        trips={trips.previous}
        canWrite={canWrite}
      />
    </>
  );
}
