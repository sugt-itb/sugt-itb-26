"use client";

import { markSessionDeliveredFromDashboardAction } from "-/app/(app)/actions";
import type { MyPerjadinSchool, MyPerjadinSession } from "@sugt/db/queries";
import { formatSessionStartTimeWithWib } from "@sugt/domain";
import { Alert, AlertDescription, AlertTitle } from "@sugt/ui/components/alert";
import { Button } from "@sugt/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sugt/ui/components/dialog";
import { type ReactElement, useState, useTransition } from "react";

/**
 * **Tandai Terlaksana, from the dashboard card** ([#209](https://github.com/mafiefa02/sugt/issues/209)).
 * One place to mark a trip's offline Sessions delivered without walking into each `/sesi/[id]`. A
 * Perjadin has only offline Sessions (ADR-0022), and every datum is already on `MyUpcomingPerjadin`
 * — `trip.schools[].sessions` — so this reads nothing; it lists what it was handed.
 *
 * **`delivered` is terminal** (`docs/data-model.md`; there is deliberately no un-deliver), so a
 * misclick here would be permanent. Every mark therefore goes through a confirmation that **names the
 * exact Session**, mirroring `OfflineMarkDelivered` on `/sesi/[id]`. A delivered Session shows a
 * read-only tag and a cancelled one greys out — neither offers a button, because neither has a
 * transition left to make.
 *
 * The `trigger` is required (the #198 pattern): the card's action-row button is the whole reason
 * this dialog exists, so there is no default surface for it.
 */
function PerjadinMarkDeliveredDialog({
  schools,
  trigger,
}: {
  schools: MyPerjadinSchool[];
  trigger: ReactElement;
}) {
  // Flattened across Schools, but ordered School-then-Session the way the query already returns them,
  // so same-School rows stay contiguous — grouped by School by construction, not by re-sorting.
  const rows = schools.flatMap((school) => school.sessions.map((session) => ({ school, session })));

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tandai Sesi terlaksana</DialogTitle>
          <DialogDescription>
            Tandai Sesi luring perjalanan ini sebagai terlaksana. Setiap penandaan dikonfirmasi dan
            tidak bisa dibatalkan.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada Sesi luring pada perjalanan ini.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map(({ school, session }) => (
              <SessionRow
                key={session.sessionId}
                school={school}
                session={session}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The Session's one-line name, the same shape the confirmation repeats: `School · date · time+tz`. */
function sessionLabel(school: MyPerjadinSchool, session: MyPerjadinSession): string {
  return `${school.name} · ${session.heldOn} · ${formatSessionStartTimeWithWib(session.startsAt, school.timeZone)}`;
}

/**
 * One Session in the list. What the row offers turns on its status — the same rule the write holds,
 * shown rather than enforced here: `arranged` can be marked, `delivered` is terminal, `cancelled` is
 * done.
 */
function SessionRow({ school, session }: { school: MyPerjadinSchool; session: MyPerjadinSession }) {
  const label = sessionLabel(school, session);

  if (session.status === "delivered") {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
          Terlaksana
        </span>
      </li>
    );
  }

  if (session.status === "cancelled") {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="line-through">{label}</span>
        <span className="text-xs">Dibatalkan</span>
      </li>
    );
  }

  return (
    <ArrangedSessionRow
      label={label}
      sessionId={session.sessionId}
    />
  );
}

/**
 * An `arranged` Session and its confirmation. The button opens a nested dialog that **names this
 * exact Session** before it writes, because `delivered` is terminal — the confirmation is the whole
 * safeguard. The only refusal it can meet is a Session someone else already moved (`not-arranged`),
 * surfaced as a stale message rather than thrown, exactly as `OfflineMarkDelivered` does.
 */
function ArrangedSessionRow({ label, sessionId }: { label: string; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function submit() {
    startSaving(async () => {
      const result = await markSessionDeliveredFromDashboardAction(sessionId);
      if (result.outcome === "delivered") {
        setOpen(false);
        return;
      }
      if (result.outcome === "not-arranged") setStale(STALE_MESSAGES[result.status]);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <Dialog
        open={open}
        onOpenChange={setOpen}
      >
        <DialogTrigger
          render={
            <Button
              variant="outline"
              size="sm"
            >
              Tandai terlaksana
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tandai Sesi terlaksana</DialogTitle>
            <DialogDescription>
              Tandai Sesi ini sebagai terlaksana:{" "}
              <span className="font-medium text-foreground">{label}</span>. Tindakan ini tidak bisa
              dibatalkan.
            </DialogDescription>
          </DialogHeader>

          {stale !== null && <StaleAlert message={stale} />}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Batal
            </Button>
            <Button
              disabled={saving}
              onClick={submit}
            >
              {saving ? "Menyimpan…" : "Tandai terlaksana"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/**
 * A refusal the screen could not have predicted: somebody else delivered or cancelled this Session
 * while the dialog was open. A user state, not a bug — so it reads as a sentence, the same way
 * `session-writes.tsx` shows it.
 */
function StaleAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Tidak jadi disimpan.</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

const STALE_MESSAGES = {
  delivered: "Sesi ini sudah ditandai terlaksana. Muat ulang halaman untuk melihat keadaannya.",
  cancelled: "Sesi ini sudah dibatalkan. Muat ulang halaman untuk melihat keadaannya.",
} as const;

export { PerjadinMarkDeliveredDialog };
