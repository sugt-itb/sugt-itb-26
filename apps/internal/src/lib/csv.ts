/**
 * **The app's one CSV writer** (#472), shared by the Laporan export and `/keuangan`'s, so the two files
 * open the same way in a spreadsheet.
 *
 * - **A leading UTF-8 BOM**, because the reader is Excel, and Excel reads a UTF-8 CSV as the system
 *   code page without one. That mangles every Indonesian category name.
 * - **Every field quoted**, an embedded quote doubled — the whole of RFC 4180's escaping. A
 *   description is free text and a name can carry a comma, and a rule with no exceptions is one nobody
 *   has to check. Rows end in CRLF.
 * - **Formula-injection guard**: a text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage
 *   return gets a leading `'`, so a spreadsheet shows it as text instead of running it. A **number**
 *   cell is written as its plain digits and never touched, so an amount stays a number to the reader.
 */

/** One cell: text, guarded; or a number, written as its digits. */
export type CsvCell = string | number;

/** The characters a spreadsheet reads a cell as a formula from. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One field, quoted, a text one guarded first. */
function field(cell: CsvCell): string {
  const text = typeof cell === "number" ? String(cell) : cell.replace(FORMULA_START, "'$&");
  return `"${text.replaceAll('"', '""')}"`;
}

/** The whole file: a BOM, then each row as quoted fields, CRLF after every row. An empty row is blank. */
export function csvDocument(rows: readonly (readonly CsvCell[])[]): string {
  return `﻿${rows.map((row) => row.map(field).join(",")).join("\r\n")}\r\n`;
}
