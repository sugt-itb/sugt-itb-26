/**
 * **The app's one CSV module: a writer and a reader.**
 *
 * The **writer**, {@link csvDocument} (#472), is shared by the Laporan and `/feedback` exports, so the
 * files open the same way in a spreadsheet.
 *
 * - **A leading UTF-8 BOM**, because the reader is Excel, and Excel reads a UTF-8 CSV as the system
 *   code page without one. That mangles every Indonesian category name.
 * - **Every field quoted**, an embedded quote doubled — the whole of RFC 4180's escaping. A
 *   description is free text and a name can carry a comma, and a rule with no exceptions is one nobody
 *   has to check. Rows end in CRLF.
 * - **Formula-injection guard**: a text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage
 *   return gets a leading `'`, so a spreadsheet shows it as text instead of running it. A **number**
 *   cell is written as its plain digits and never touched, so an amount stays a number to the reader.
 *
 * The **reader**, {@link parseCsv}, is shared by the two link-shared Google Sheets read through their
 * CSV export (ADR-0033): `/kalender`'s schedule (`jadwal-sheet.ts`) and `/keuangan`'s Block B tab
 * (`keuangan-sheet.ts`, #548).
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

/**
 * Parse RFC-4180 CSV into a grid of rows of cells. Handles quoted fields containing commas,
 * newlines and doubled-quote (`""`) escapes — Google's export quotes any multi-line cell, so the
 * newlines inside a session's detail survive as part of one field rather than splitting the row.
 * A `\r\n` or `\r` row break **outside** a quoted field is treated as one break (bytes inside a
 * quoted field are kept verbatim). A trailing newline does not add an empty row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Whether the current cell has been opened (a quote or a character seen). It lets the
  // end-of-input flush tell a quoted empty final field (`""` → `[[""]]`) apart from no field at all.
  let cellOpened = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      cellOpened = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      cellOpened = false;
    } else if (char === "\n" || char === "\r") {
      // Collapse a `\r\n` pair into one row break.
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      cellOpened = false;
    } else {
      field += char;
      cellOpened = true;
    }
  }

  // Flush a final field/row — including a row whose only cell is a quoted empty string — but not a
  // phantom row when the text ended exactly on a row break.
  if (field !== "" || cellOpened || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
