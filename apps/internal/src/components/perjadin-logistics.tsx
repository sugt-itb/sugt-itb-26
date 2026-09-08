"use client";

import { updatePerjadinLogisticsAction } from "-/app/(app)/perjadin/[id]/actions";
import type { PerjadinTravelLeg } from "@sugt/db/queries";
import {
  formatSessionStartTime,
  TIME_ZONES,
  timeZoneSuffix,
  TRANSPORT_MODES,
  type TimeZone,
  type TransportMode,
} from "@sugt/domain";
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
import { Input } from "@sugt/ui/components/input";
import { Label } from "@sugt/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sugt/ui/components/select";
import { useId, useState, useTransition } from "react";

/** The `YYYY-MM-DD` half of a wall-clock `departure_at` / `return_at` string. */
function datePart(at: string): string {
  return at.slice(0, 10);
}

/** The `HH:MM` half — the seconds the column stores are dropped, as a start time is a wall-clock minute. */
function timePart(at: string): string {
  return at.slice(11, 16);
}

/**
 * A Perjadin's departure and return logistics, and the one way Staff correct them.
 *
 * Each leg is a wall-clock date and time shown with its zone — the departure from Bandung is WIB,
 * the return is the last-visited School's, so `09:00 WITA` is not `09:00 WIB`. A trip planned
 * before the logistics columns existed shows both legs as not yet recorded; the edit fills them.
 *
 * The edit is offered to Staff only, and `updatePerjadinLogistics` re-checks the role — a Server
 * Action is a public endpoint, so a professor's page simply never renders the trigger.
 */
function PerjadinLogistics({
  perjadinId,
  departure,
  returnLeg,
  canEdit,
}: {
  perjadinId: string;
  departure: PerjadinTravelLeg | null;
  returnLeg: PerjadinTravelLeg | null;
  canEdit: boolean;
}) {
  return (
    <div className="border-b border-border px-7 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-sm font-medium">Perjalanan</h2>
        {canEdit && (
          <EditLogistics
            perjadinId={perjadinId}
            departure={departure}
            returnLeg={returnLeg}
          />
        )}
      </div>

      <dl className="mt-2.5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Leg
          label="Keberangkatan"
          leg={departure}
        />
        <Leg
          label="Kepulangan"
          leg={returnLeg}
        />
      </dl>
    </div>
  );
}

function Leg({ label, leg }: { label: string; leg: PerjadinTravelLeg | null }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      {leg === null ? (
        <dd className="text-sm text-muted-foreground">Belum dicatat</dd>
      ) : (
        <dd className="mt-0.5 text-sm">
          <span className="tabular-nums">{datePart(leg.at)}</span>
          {" · "}
          <span className="tabular-nums">{formatSessionStartTime(timePart(leg.at), leg.zone)}</span>
          {" · "}
          {leg.mode}
        </dd>
      )}
    </div>
  );
}

/**
 * The logistics-edit dialog, opening on the trip's current values.
 *
 * **The return zone is an explicit control here**, unlike the plan form, where it is derived from
 * the last School — a derivation can be wrong, and a Group returning from a WITA/WIT city keeps
 * that city's wall-clock. The departure zone is not a control: it is always WIB (the origin is
 * Bandung), shown as a fixed label and set by the write.
 *
 * All seven inputs are required to save. A trip predating the columns opens the dialog empty.
 */
function EditLogistics({
  perjadinId,
  departure,
  returnLeg,
}: {
  perjadinId: string;
  departure: PerjadinTravelLeg | null;
  returnLeg: PerjadinTravelLeg | null;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    departureDate: departure ? datePart(departure.at) : "",
    departureTime: departure ? timePart(departure.at) : "",
    departureMode: (departure?.mode ?? "") as TransportMode | "",
    returnDate: returnLeg ? datePart(returnLeg.at) : "",
    returnTime: returnLeg ? timePart(returnLeg.at) : "",
    returnMode: (returnLeg?.mode ?? "") as TransportMode | "",
    returnZone: (returnLeg?.zone ?? "") as TimeZone | "",
  });
  const [refusal, setRefusal] = useState<string | null>(null);
  // A field-level message under the return date: the range is the leg dates now (ADR-0021), so the
  // two refusals a leg edit can hit — an inverted range, or one that would strand a still-arranged
  // Session — land here rather than in the stale-link Alert above.
  const [dateRefusal, setDateRefusal] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const fields = useId();

  const incomplete =
    form.departureDate === "" ||
    form.departureTime === "" ||
    form.departureMode === "" ||
    form.returnDate === "" ||
    form.returnTime === "" ||
    form.returnMode === "" ||
    form.returnZone === "";

  function set(patch: Partial<typeof form>) {
    setForm((previous) => ({ ...previous, ...patch }));
    setRefusal(null);
    setDateRefusal(null);
  }

  function submit() {
    if (incomplete) return;
    startSaving(async () => {
      const result = await updatePerjadinLogisticsAction(perjadinId, {
        departureDate: form.departureDate,
        departureTime: form.departureTime,
        departureMode: form.departureMode as TransportMode,
        returnDate: form.returnDate,
        returnTime: form.returnTime,
        returnMode: form.returnMode as TransportMode,
        returnZone: form.returnZone as TimeZone,
      });
      if (result.outcome === "updated") {
        setOpen(false);
        return;
      }
      // The range now moves with the legs (ADR-0021), so the write can refuse an inverted range or
      // one that would strand a still-arranged Session. Both point at the return date.
      if (result.outcome === "return-before-departure") {
        setDateRefusal("Tanggal Kepulangan tidak boleh lebih awal dari Keberangkatan.");
        return;
      }
      if (result.outcome === "would-strand") {
        setDateRefusal(
          `Rentang baru mengeluarkan ${result.strandedCount} Sesi yang masih terjadwal. ` +
            "Perlebar rentangnya atau ubah tanggal Sesi tersebut lebih dulu.",
        );
        return;
      }
      setRefusal("Perjadin ini sudah tidak ada. Muat ulang halaman untuk melihat keadaannya.");
    });
  }

  return (
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
            Ubah perjalanan
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah perjalanan</DialogTitle>
          <DialogDescription>
            Tanggal Keberangkatan dan Kepulangan menentukan rentang Perjadin. Mengubahnya menggeser
            rentang, tetapi tidak memindahkan Sesi — perubahan ditolak jika ada Sesi terjadwal yang
            jatuh di luar rentang baru. Keberangkatan selalu dari Bandung (WIB); zona waktu
            kepulangan mengikuti kota Sekolah terakhir dan bisa dikoreksi di sini.
          </DialogDescription>
        </DialogHeader>

        {refusal !== null && (
          <Alert variant="destructive">
            <AlertTitle>Perjalanan belum diubah.</AlertTitle>
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4">
          <fieldset className="grid gap-2.5">
            <legend className="text-sm font-medium">Keberangkatan (WIB)</legend>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`${fields}-dep-date`}>Tanggal</Label>
                <Input
                  id={`${fields}-dep-date`}
                  type="date"
                  value={form.departureDate}
                  onChange={(event) => {
                    set({ departureDate: event.target.value });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${fields}-dep-time`}>Jam (WIB)</Label>
                <Input
                  id={`${fields}-dep-time`}
                  type="time"
                  value={form.departureTime}
                  onChange={(event) => {
                    set({ departureTime: event.target.value });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${fields}-dep-mode`}>Moda</Label>
                <ModeSelect
                  id={`${fields}-dep-mode`}
                  value={form.departureMode}
                  onSelect={(mode) => {
                    set({ departureMode: mode });
                  }}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="grid gap-2.5">
            <legend className="text-sm font-medium">Kepulangan</legend>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${fields}-ret-date`}>Tanggal</Label>
                <Input
                  id={`${fields}-ret-date`}
                  type="date"
                  value={form.returnDate}
                  aria-invalid={dateRefusal !== null}
                  onChange={(event) => {
                    set({ returnDate: event.target.value });
                  }}
                />
                {dateRefusal !== null && <p className="text-sm text-destructive">{dateRefusal}</p>}
              </div>
              <div className="grid gap-1.5">
                {/* Return leg lands in the destination's zone; omit the suffix on a legacy trip before a zone is picked. */}
                <Label htmlFor={`${fields}-ret-time`}>Jam{timeZoneSuffix(form.returnZone)}</Label>
                <Input
                  id={`${fields}-ret-time`}
                  type="time"
                  value={form.returnTime}
                  onChange={(event) => {
                    set({ returnTime: event.target.value });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${fields}-ret-zone`}>Zona waktu</Label>
                <Select
                  items={Object.fromEntries(TIME_ZONES.map((zone) => [zone, zone]))}
                  value={form.returnZone === "" ? null : form.returnZone}
                  onValueChange={(value) => {
                    set({ returnZone: (value as TimeZone | null) ?? "" });
                  }}
                >
                  <SelectTrigger
                    id={`${fields}-ret-zone`}
                    aria-label="Zona waktu kepulangan"
                  >
                    <SelectValue placeholder="Pilih zona" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_ZONES.map((zone) => (
                      <SelectItem
                        key={zone}
                        value={zone}
                      >
                        {zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${fields}-ret-mode`}>Moda</Label>
                <ModeSelect
                  id={`${fields}-ret-mode`}
                  value={form.returnMode}
                  onSelect={(mode) => {
                    set({ returnMode: mode });
                  }}
                />
              </div>
            </div>
          </fieldset>
        </div>

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
            disabled={saving || incomplete}
            onClick={submit}
          >
            {saving ? "Menyimpan…" : "Simpan perjalanan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A transport-mode dropdown, the one control both legs share. */
function ModeSelect({
  id,
  value,
  onSelect,
}: {
  id: string;
  value: TransportMode | "";
  onSelect: (mode: TransportMode) => void;
}) {
  return (
    <Select
      items={Object.fromEntries(TRANSPORT_MODES.map((mode) => [mode, mode]))}
      value={value === "" ? null : value}
      onValueChange={(selected) => {
        if (selected !== null) onSelect(selected as TransportMode);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label="Moda transportasi"
      >
        <SelectValue placeholder="Pilih moda" />
      </SelectTrigger>
      <SelectContent>
        {TRANSPORT_MODES.map((mode) => (
          <SelectItem
            key={mode}
            value={mode}
          >
            {mode}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { PerjadinLogistics };
