"use client";

import { shortenKabupaten } from "-/lib/format-destination";
import type { MyPerjadinPengajar, MyPerjadinPimpinan, MyPerjadinStaff } from "@sugt/db/queries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import type { ReactElement, ReactNode } from "react";

/**
 * **Anggota Perjadin** — a read-only roll of everyone on the trip, opened from the dashboard card's
 * head-count. It writes nothing: adding or removing a member happens on the Perjadin edit page, so
 * this is purely a glance at who is going, grouped the way `docs/data-model.md` splits the three
 * kinds of member.
 *
 * `trigger` is required — the card supplies its own control (the "n anggota" line), and there is no
 * default surface for a modal that only ever opens from a card.
 *
 * The three lists mirror `MyUpcomingPerjadin.anggota` exactly, so the caller passes that object
 * straight through (minus its `anggotaTotal`, which the card already renders on its own trigger).
 */
function PerjadinAnggotaModal({
  destination,
  startsOn,
  endsOn,
  anggota,
  trigger,
}: {
  destination: string;
  startsOn: string;
  endsOn: string;
  anggota: {
    staff: MyPerjadinStaff[];
    pengajar: MyPerjadinPengajar[];
    pimpinan: MyPerjadinPimpinan[];
  };
  trigger: ReactElement;
}) {
  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          {/* Same render-time abbreviation the trip's own page uses on this line (#105). */}
          <DialogTitle>{shortenKabupaten(destination)}</DialogTitle>
          <DialogDescription className="tabular-nums">
            {startsOn} – {endsOn}
          </DialogDescription>
        </DialogHeader>

        {/*
          All three role headings always render, each keeping its category visible even when nobody
          fills it — a trip with no recorded Pimpinan reads differently from one whose list simply
          was not shown. An empty list says so in muted text rather than vanishing.
        */}
        <div className="grid gap-4">
          <RoleSection heading="Pendamping">
            {anggota.staff.map((member) => (
              <MemberRow
                key={member.personId}
                name={member.fullName}
                role={member.isPic ? "PIC" : "Pendamping"}
              />
            ))}
          </RoleSection>

          <RoleSection heading="Pengajar">
            {anggota.pengajar.map((teacher) => (
              <MemberRow
                key={teacher.id}
                name={teacher.name}
                role="Pengajar"
              />
            ))}
          </RoleSection>

          <RoleSection heading="Pimpinan">
            {anggota.pimpinan.map((pimpinan) => (
              <MemberRow
                key={pimpinan.personId}
                name={pimpinan.name}
                role="Pimpinan"
              />
            ))}
          </RoleSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One role group: a heading and its rows, or a muted "Belum ada" when the group is empty — the
 * emptiness is `children` having no elements, which `Children`-free code reads as an empty array.
 */
function RoleSection({ heading, children }: { heading: string; children: ReactNode[] }) {
  return (
    <div className="grid gap-1.5">
      <h3 className="font-heading text-sm font-medium">{heading}</h3>
      {children.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada</p>
      ) : (
        <ul className="space-y-1">{children}</ul>
      )}
    </div>
  );
}

/** One member: their name and role label, `name · role`, read-only. */
function MemberRow({ name, role }: { name: string; role: string }) {
  return (
    <li className="text-sm">
      {name} <span className="text-muted-foreground">· {role}</span>
    </li>
  );
}

export { PerjadinAnggotaModal };
