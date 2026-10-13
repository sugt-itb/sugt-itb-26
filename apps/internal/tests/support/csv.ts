import { expect } from "vitest";

/**
 * RFC 4180 as `csvDocument` writes it — a BOM, every field quoted, CRLF rows — parsed field by
 * field, so a field holding a comma, a doubled quote or a line break comes back whole. Fails the
 * test on anything `csvDocument` would never write.
 */
export function parseCsv(csv: string): string[][] {
  expect(csv.startsWith("﻿")).toBe(true);
  const rows: string[][] = [];
  let row: string[] = [];
  let at = 1;
  while (at < csv.length) {
    expect(csv[at]).toBe('"');
    let field = "";
    at += 1;
    for (;;) {
      if (csv[at] === '"' && csv[at + 1] === '"') {
        field += '"';
        at += 2;
      } else if (csv[at] === '"') {
        at += 1;
        break;
      } else {
        field += csv[at];
        at += 1;
      }
    }
    row.push(field);
    if (csv[at] === ",") {
      at += 1;
    } else {
      expect(csv.slice(at, at + 2)).toBe("\r\n");
      rows.push(row);
      row = [];
      at += 2;
    }
  }
  return rows;
}
