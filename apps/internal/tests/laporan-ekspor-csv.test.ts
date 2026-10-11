import type { PerjadinAcquittal } from "@sugt/db/queries";
import { describe, expect, it } from "vitest";

import { csvOf } from "../src/app/(app)/perjadin/[id]/laporan/ekspor/csv";

/**
 * **The acquittal export, tested with no database and no HTTP.**
 *
 * `csvOf` is a total function of the payload, so the export's acceptance — the Pimpinan appear when
 * present and leave no stray row when absent (#142) — is provable here, without standing up the
 * Route Handler or its Staff-only read. Those are the handler's concern and are covered where the
 * choke point is; this pins the text.
 */

/** A minimal acquittal with no transactions and no Pimpinan — each test overrides what it exercises. */
function acquittal(overrides: Partial<PerjadinAcquittal> = {}): PerjadinAcquittal {
  return {
    perjadinId: "00000000-0000-0000-0000-000000000001",
    subClusterName: "Kelompok 10",
    schoolNames: [],
    startsOn: "2026-09-01",
    endsOn: "2026-09-03",
    spentIdr: 0,
    siswaSpentIdr: 0,
    gtkMsSpentIdr: 0,
    reportDueOn: "2026-09-05",
    daysRemaining: 3,
    transactions: [],
    pimpinan: [],
    reportFiledAt: null,
    ...overrides,
  };
}

describe("the acquittal CSV", () => {
  it("carries Tipe Peserta per line and the two cohort subtotals, with no Atas nama column", () => {
    // `participant_type` replaced `incurred_by_person_id` (#182): each line names its cohort and
    // the totals gain a Siswa/GTK-MS split, summing to Uang Perjalanan Terpakai. The header no longer
    // carries "Atas nama".
    const csv = csvOf(
      acquittal({
        spentIdr: 300_000,
        siswaSpentIdr: 200_000,
        gtkMsSpentIdr: 100_000,
        transactions: [
          {
            id: "t1",
            spentOn: "2026-09-01",
            description: "Konsumsi",
            amountIdr: 200_000,
            category: "Konsumsi",
            participantType: "Siswa",
            driveFolderId: null,
            driveSyncedAt: null,
            evidence: [],
          },
          {
            id: "t2",
            spentOn: "2026-09-02",
            description: "Uang harian",
            amountIdr: 100_000,
            category: "Uang Harian",
            participantType: "GTK-MS",
            driveFolderId: null,
            driveSyncedAt: null,
            evidence: [],
          },
        ],
      }),
    );

    expect(csv).toContain(
      '"Tanggal","Keterangan","Kategori","Tipe Peserta","Jumlah (Rp)","Jumlah bukti"',
    );
    expect(csv).not.toContain("Atas nama");
    expect(csv).toContain('"2026-09-01","Konsumsi","Konsumsi","Siswa","200000","0"');
    expect(csv).toContain('"2026-09-02","Uang harian","Uang Harian","GTK-MS","100000","0"');
    // The two subtotals follow Uang Perjalanan Terpakai, and add back to it.
    expect(csv).toContain('"Uang Perjalanan Terpakai","","","","300000",""');
    expect(csv).toContain('"Total Siswa","","","","200000",""');
    expect(csv).toContain('"Total GTK-MS","","","","100000",""');
    expect(csv.indexOf('"Uang Perjalanan Terpakai"')).toBeLessThan(csv.indexOf('"Total Siswa"'));
    expect(csv.indexOf('"Total Siswa"')).toBeLessThan(csv.indexOf('"Total GTK-MS"'));
  });

  it("names each Pimpinan on its own labelled row, after the totals", () => {
    // `pimpinan` on the acquittal is a list of Pimpinan names now (#181) — the query orders them, so
    // the payload here is any two names in the order the query would hand back.
    const fatimah = "Fatimah Arofiati Noor";
    const anton = "Anton Timur Jaelani";
    const csv = csvOf(acquittal({ pimpinan: [anton, fatimah] }));

    // One labelled row per name, in the order the payload gave — the query orders them, not this.
    expect(csv).toContain(`"Pimpinan","${anton}","","","",""`);
    expect(csv).toContain(`"Pimpinan","${fatimah}","","","",""`);
    // After the totals, so the file reads money-then-who-travelled.
    expect(csv.indexOf('"Total GTK-MS"')).toBeLessThan(csv.indexOf('"Pimpinan"'));
  });

  it("adds no Pimpinan row — and no stray separator — when none joined", () => {
    const csv = csvOf(acquittal({ pimpinan: [] }));

    expect(csv).not.toContain("Pimpinan");
    // The last content row is the last total; nothing trails it but the record terminator, so an
    // empty Pimpinan list leaves no stray row (#142).
    expect(csv.trimEnd().endsWith('"Total GTK-MS","","","","0",""')).toBe(true);
  });

  it("carries no Advance: no Uang Perjalanan, Diterima or Sisa row (ADR-0051)", () => {
    const csv = csvOf(acquittal({ spentIdr: 250_000, siswaSpentIdr: 250_000 }));

    expect(csv).toContain('"Uang Perjalanan Terpakai","","","","250000",""');
    expect(csv).not.toContain('"Uang Perjalanan",');
    expect(csv).not.toContain('"Terpakai"');
    expect(csv).not.toContain("Diterima");
    expect(csv).not.toContain("Sisa");
  });
});
