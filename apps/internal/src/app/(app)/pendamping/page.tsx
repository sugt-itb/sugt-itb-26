import { MyPerjadinSection } from "-/components/my-perjadin-section";
import { PendampingPicker, type PendampingTab, PendampingTabs } from "-/components/pendamping-tabs";
import { uploadGate, type UploadGate } from "-/lib/drive/upload-gate";
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
 * that are). A past trip keeps every action, because the transactions and the attendance sheets are
 * often finished after it. The cards carry no Laporan line (#419); the Laporan is reached through Edit.
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

  // Each trip card's Catat Transaksi is closed, with the reason, while Drive is (ADR-0040). Always
  // the viewer's gate, on Pendamping Lain too: the viewer is who uploads.
  if (params === null || tab === "anda") {
    const [trips, gate] = await Promise.all([myPerjadin(person), uploadGate(person)]);
    const own = (
      <OwnPage
        person={person}
        trips={trips}
        gate={gate}
      />
    );
    return (
      <PageFrame>
        {params === null ? own : <PendampingTabs tab="anda">{own}</PendampingTabs>}
      </PageFrame>
    );
  }

  const chosen = typeof params.pendamping === "string" ? params.pendamping : null;
  const [options, viewed, gate] = await Promise.all([
    pendampingOptions(person),
    chosen === null ? null : pendampingPerjadin(person, chosen),
    uploadGate(person),
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
            gate={gate}
            canWrite
          />
        )}
      </PendampingTabs>
    </PageFrame>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-col gap-6 px-4 py-5 sm:p-7">{children}</div>;
}

/** Today's page: the greeting, then the viewer's own trips. */
function OwnPage({ person, trips, gate }: { person: Person; trips: MyPerjadin; gate: UploadGate }) {
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
        gate={gate}
        canWrite
      />
    </>
  );
}

/**
 * **One Pendamping's two sections**, or their empty state — the same words whoever is looking, since
 * Pendamping Lain is a screenshot of that Person's page. `canWrite` is the **viewer's** (#439).
 */
function PendampingTrips({
  trips,
  gate,
  canWrite,
}: {
  trips: MyPerjadin;
  gate: UploadGate;
  canWrite: boolean;
}) {
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
        uploadGate={gate}
        canWrite={canWrite}
      />
      <MyPerjadinSection
        title="Perjalanan Dinas Sebelumnya"
        description="Perjalanan yang sudah selesai, yang terbaru di atas. Transaksi dan dokumennya masih bisa dikerjakan."
        trips={trips.previous}
        uploadGate={gate}
        canWrite={canWrite}
      />
    </>
  );
}
