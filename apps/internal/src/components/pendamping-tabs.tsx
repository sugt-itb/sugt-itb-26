"use client";

import type { PendampingOption } from "@sugt/db/queries";
import { Tabs, TabsList, TabsTrigger } from "@sugt/ui/components/tabs";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { SingleSelectCombobox } from "./single-select-combobox";

/** Which `/pendamping` tab the viewer is on: their own page, or another Pendamping's. */
export type PendampingTab = "anda" | "lain";

/**
 * The one place `/pendamping`'s URL is built: Anda is the bare route; Pendamping Lain is `?tab=lain`,
 * plus `&pendamping=<id>` once someone is chosen. The page reads the same two parameters back.
 */
function pendampingHref(tab: PendampingTab, personId: string | null = null): Route {
  if (tab === "anda") return "/pendamping";
  return personId === null
    ? "/pendamping?tab=lain"
    : (`/pendamping?tab=lain&pendamping=${encodeURIComponent(personId)}` as Route);
}

/**
 * **`/pendamping`'s two tabs, for a Perjadin Editor or an Administrator** (#440, #539): **Anda** and
 * **Pendamping Lain**.
 * The tab lives in the URL (`?tab=lain`), unlike the Dashboard's local-state tabs, because the server
 * needs it to load the other Person's trips; so switching navigates, and the server renders the
 * chosen tab's content as `children`. A refresh or a pasted link keeps the view.
 */
function PendampingTabs({ tab, children }: { tab: PendampingTab; children: ReactNode }) {
  const router = useRouter();

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          router.push(pendampingHref(value as PendampingTab));
        }}
      >
        <TabsList>
          <TabsTrigger value="anda">Anda</TabsTrigger>
          <TabsTrigger value="lain">Pendamping Lain</TabsTrigger>
        </TabsList>
      </Tabs>
      {children}
    </>
  );
}

/**
 * **Pendamping Lain's picker**: every Staff Person but the viewer, searchable by name and by
 * email. Choosing one navigates to `?tab=lain&pendamping=<id>`; clearing it goes back to the picker
 * alone.
 */
function PendampingPicker({
  options,
  value,
}: {
  options: PendampingOption[];
  value: string | null;
}) {
  const router = useRouter();

  return (
    <div className="max-w-sm">
      <SingleSelectCombobox
        aria-label="Pendamping"
        placeholder="Pilih pendamping…"
        emptyLabel="Tidak ada pendamping yang cocok."
        options={options.map((option) => ({
          value: option.id,
          label: option.fullName,
          keywords: option.email,
        }))}
        value={value}
        onValueChange={(next) => {
          router.push(pendampingHref("lain", next));
        }}
      />
    </div>
  );
}

export { PendampingPicker, PendampingTabs };
