import type { PreparationJenis } from "@sugt/domain";
import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * **Monitoring Preparation** — the free-standing Preparation Cards on the `/monitoring` Persiapan
 * tab (ADR-0028's Monitoring Editor Grant gates writing them). A Card is a title, a Jenis, a date or
 * date-range, and a variable checklist.
 *
 * **This is a different concept from the Perjadin Preparation Checklist** ([ADR-0018](../../../../docs/adr/0018-the-preparation-checklist-stores-ticks-and-derives-the-list.md)),
 * despite both reading "Persiapan" in the UI. That one is a Perjadin's **seven fixed** boxes, stored
 * as ticks and derived against a fixed list; this one is a **standalone** Card with a **variable**,
 * ordered, hand-edited checklist and no Perjadin, School, Cluster or Session behind it. They share
 * no table and no code — see `CONTEXT.md`, **Monitoring Preparation** vs **Preparation Checklist**.
 */

/**
 * One Preparation Card. **Standalone**: no foreign key to any domain row — a Card is not about a
 * Perjadin or a School, it is its own monitoring artefact. `ends_on` is **nullable**: null means a
 * single-date Card, a value means a date range.
 *
 * `jenis` CHECKs the four `PREPARATION_JENIS` values character for character. **Its `Pimpinan` value
 * is a category label, not the Person Role** — a Card's Jenis never gates access; only the Monitoring
 * Editor Grant does. `title` carries a non-empty CHECK as a backstop; the write validates it first
 * and returns a value outcome, so the CHECK only ever refuses a hand-written row.
 */
export const preparationCard = pgTable(
  "preparation_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    jenis: text("jenis").$type<PreparationJenis>().notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("preparation_card_title_not_empty", sql`length(trim(${t.title})) > 0`),
    check(
      "preparation_card_jenis_check",
      sql`${t.jenis} in ('Teknis', 'Kurikulum', 'LAPI', 'Pimpinan')`,
    ),
  ],
);

/**
 * One line of a Card's checklist. `card_id` cascades on delete, so removing a Card takes its items
 * with it. `position` orders the items within the Card; a reorder rewrites the **unchecked** items'
 * positions. `checked` toggles both ways — a ticked item can be unticked. `label` carries a non-empty
 * CHECK as a backstop, the same as the Card's title.
 *
 * The `≤ 20 items per card` ceiling is **not** a column constraint — it is a per-Card count the
 * write enforces (`MAX_PREPARATION_CHECKLIST_ITEMS`), the same way the app caps trip-scoped teachers.
 */
export const preparationChecklistItem = pgTable(
  "preparation_checklist_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => preparationCard.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    checked: boolean("checked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("preparation_checklist_item_label_not_empty", sql`length(trim(${t.label})) > 0`)],
);
