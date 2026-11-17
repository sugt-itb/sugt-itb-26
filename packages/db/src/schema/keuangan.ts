import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { person } from "./people";

/**
 * **Which spreadsheet tab `/keuangan` reads** (ADR-0064, #549). One row or none, held by the database
 * the way `drive_connection` holds its own: `singleton` is the primary key and CHECKed true, so a
 * second row has nowhere to go.
 *
 * The budget itself is never stored — Finance's spreadsheet is its source of truth, and `/keuangan`
 * reads a prepared copy's Block B tab on every request. Only this pointer is: each fresh copy has a
 * new URL, so an Administrator pastes it on `/pengaturan` (#571), and the row is **replaced, never
 * deleted**. The URL as pasted and who set it are for Administrators only; the page's readers get the
 * sheet id, the gid and `updated_at`, which says how old the copy may be.
 */
export const keuanganSource = pgTable(
  "keuangan_source",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    url: text("url").notNull(),
    sheetId: text("sheet_id").notNull(),
    gid: text("gid").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    setByPersonId: uuid("set_by_person_id")
      .notNull()
      .references(() => person.id),
  },
  (t) => [check("keuangan_source_singleton_check", sql`${t.singleton}`)],
);
