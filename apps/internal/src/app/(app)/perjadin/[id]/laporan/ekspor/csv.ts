import type { PerjadinAcquittal } from "@sugt/db/queries";

/**
 * **The generic export, as pure text.**
 *
 * Split out of the Route Handler so it can be driven directly: `csvOf` is a total function of the
 * acquittal payload, and the acceptance for the export ("both Pimpinan appear; none leaves no stray
 * row") is about this text and nothing the HTTP layer adds. The handler stays a thin wrapper that
 * signs in, reads the payload — open to any signed-in Person now (ADR-0026, #180) — and sets the
 * file headers.
 *
 * **The constraint on it is that it invents nothing**, and that constraint is structural rather than
 * a promise: every column below is read off `perjadinAcquittal`, the same payload the screen renders.
 * There is no cost-centre, no account code, no payee and no `Ref Standar Biaya` — a view over
 * existing columns cannot be wrong when the real SPJ arrives; it is simply replaced.
 */

/**
 * The itemisation, plus its totals as trailing rows, plus who travelled.
 *
 * The totals ride in the same file rather than in a second one because the point of the export is
 * that nothing is retyped — a PIC who has to add the column up themselves has been handed a
 * spreadsheet with extra steps.
 */
export function csvOf(acquittal: PerjadinAcquittal): string {
  const rows = [
    ["Tanggal", "Keterangan", "Kategori", "Tipe Peserta", "Jumlah (Rp)", "Jumlah bukti"],
    ...acquittal.transactions.map((line) => [
      line.spentOn,
      line.description,
      line.category,
      line.participantType,
      String(line.amountIdr),
      String(line.evidence.length),
    ]),
    [],
    // Every transaction on the trip, all categories (ADR-0051) — the same figure every screen shows.
    ["Uang Perjalanan Terpakai", "", "", "", String(acquittal.spentIdr), ""],
    // The same total split by cohort, the same two figures the page tiles show; the payload
    // carries them so nothing is retyped or re-summed here.
    ["Total Siswa", "", "", "", String(acquittal.siswaSpentIdr), ""],
    ["Total GTK-MS", "", "", "", String(acquittal.gtkMsSpentIdr), ""],
    // Who travelled, one labelled row per Pimpinan (#142). Omitted entirely when none joined, so
    // no stray section appears. These are existing stored names, inventing no new column.
    ...(acquittal.pimpinan.length > 0
      ? [[], ...acquittal.pimpinan.map((name) => ["Pimpinan", name, "", "", "", ""])]
      : []),
  ];

  // A leading BOM, because the reader this file is opened in is Excel and Excel reads a UTF-8 CSV
  // as the system code page without one. That mangles every category name.
  return `﻿${rows.map((row) => row.map(quoted).join(",")).join("\r\n")}\r\n`;
}

/**
 * One CSV field.
 *
 * Everything is quoted rather than only the fields that need it: a description is free text and a
 * name can carry a comma, and a rule with no exceptions is one nobody has to check. An
 * embedded quote doubles, which is the whole of RFC 4180's escaping.
 */
function quoted(field: string): string {
  return `"${field.replaceAll('"', '""')}"`;
}
