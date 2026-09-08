import type {
  Role,
  Stream,
  TimeZone,
  TransactionCategory,
  TransactionParticipantType,
  TransportMode,
} from "@sugt/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { person } from "./people";
import { subCluster } from "./reference";

/**
 * Travel: the Perjadin, its Group, and the acquittal state.
 *
 * There is no `perjadin_report` table. A Perjadin yields exactly one Report,
 * always, so the acquittal is the state already on `perjadin`.
 */

/**
 * Money is `bigint` in whole rupiah — `numeric(_, 2)` would imply a subunit nobody
 * uses. Every money column carries the `_idr` suffix so no reader has to guess.
 *
 * There is no `report_deadline`: the Report is due two days after the Group gets
 * back, so it is `ends_on + REPORT_DEADLINE_DAYS_AFTER_RETURN` and nothing stores
 * it. A derived deadline recomputes itself when a trip's dates are corrected; a
 * typed one goes stale.
 *
 * `picRole` is pinned to 'Staff' so the composite foreign key into
 * `person (id, role)` makes **the PIC is a Staff member** unbreakable, including
 * from the Supabase SQL editor.
 *
 * The other half of the PIC rule — that they are a member of their own Group — is a
 * DEFERRABLE self-referential foreign key, which Drizzle cannot express. It lives
 * in a hand-written migration; see `migrations/`.
 */
export const perjadin = pgTable(
  "perjadin",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Where the Perjadin goes: it fixes the Schools that may appear on the trip at all.
    // NOT NULL immediately — no Perjadin exists in any live database, so there is nothing
    // to backfill.
    subClusterId: uuid("sub_cluster_id")
      .notNull()
      .references(() => subCluster.id),
    // The Surat Tugas destination line. Derived server-side at insert from this Sub-Cluster's
    // label and its Schools' Kabupaten/Kota, then frozen here — a **snapshot**, never recomputed
    // on read, because Sub-Clusters are editable (ADR-0016) and a live read would rewrite an
    // already-issued Surat Tugas. See `planPerjadin` in `queries/perjadin-planning.ts` and
    // `docs/data-model.md`'s Travel section.
    destination: text("destination").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),

    advanceIdr: bigint("advance_idr", { mode: "number" }).notNull(),

    // **How the Group travels, on each leg.** Six nullable columns: nullable so the Perjadins
    // that predate them stay valid with nothing to backfill — the form requires all six on a new
    // plan, but the column cannot, because existing rows have none.
    //
    // Each `*_at` is a wall-clock date **and** time with **no instant** — a `timestamp` without a
    // time zone — carrying its zone in a separate `*_zone` tag, exactly as `session.starts_at` is
    // a wall-clock time meaningful only beside its Time Zone. Storing an instant would bake in a
    // conversion nobody asked for; the Surat Tugas says "07:30 WIB", not a UTC moment.
    //
    // `departure_zone` is always `WIB` (the origin is Bandung) and `return_zone` is derived at
    // insert from the Province of the last School visited — both snapshots, set server-side. The
    // zone columns still CHECK all three `TIME_ZONES`, because the edit surface may correct a
    // return zone. `*_mode` CHECKs `TRANSPORT_MODES`. Both lists are written out character for
    // character rather than composed, for the reason `transaction_category_check` gives.
    departureAt: timestamp("departure_at", { mode: "string" }),
    departureZone: text("departure_zone").$type<TimeZone>(),
    departureMode: text("departure_mode").$type<TransportMode>(),
    returnAt: timestamp("return_at", { mode: "string" }),
    returnZone: text("return_zone").$type<TimeZone>(),
    returnMode: text("return_mode").$type<TransportMode>(),

    picPersonId: uuid("pic_person_id").notNull(),
    picRole: text("pic_role").$type<"Staff">().notNull().default("Staff"),

    returnedToTreasurerIdr: bigint("returned_to_treasurer_idr", { mode: "number" }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    reportFiledAt: timestamp("report_filed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("perjadin_advance_check", sql`${t.advanceIdr} >= 0`),
    check("perjadin_pic_role_check", sql`${t.picRole} = 'Staff'`),
    check("perjadin_dates_check", sql`${t.endsOn} >= ${t.startsOn}`),
    // A null zone/mode passes (the columns are nullable); a present one must be in the set.
    check("perjadin_departure_zone_check", sql`${t.departureZone} in ('WIB', 'WITA', 'WIT')`),
    check("perjadin_return_zone_check", sql`${t.returnZone} in ('WIB', 'WITA', 'WIT')`),
    check(
      "perjadin_departure_mode_check",
      sql`${t.departureMode} in ('Pesawat', 'Kereta', 'Travel', 'Mobil Dalam Kota')`,
    ),
    check(
      "perjadin_return_mode_check",
      sql`${t.returnMode} in ('Pesawat', 'Kereta', 'Travel', 'Mobil Dalam Kota')`,
    ),
    check(
      "perjadin_returned_check",
      sql`(${t.returnedAt} is null) = (${t.returnedToTreasurerIdr} is null)`,
    ),
    foreignKey({
      name: "perjadin_pic_is_staff",
      columns: [t.picPersonId, t.picRole],
      foreignColumns: [person.id, person.role],
    }),
  ],
);

/**
 * The Group. **Replaced wholesale, never edited** — there is no "remove one member"
 * operation. Substituting a professor submits an entire replacement Group, and one
 * transaction deletes every member row and inserts the new set, so the Perjadin
 * keeps its id and its Sessions, Advance and transactions are untouched.
 *
 * `role` is denormalised from `person`, but it cannot drift: the composite foreign
 * key means a row can only exist if the pair is true there.
 *
 * **This table is Staff-only** (ADR-0020, and T3/#153): the Group is the PIC plus up to ten other
 * DITSAMA Staff, and the teaching team left it entirely for `perjadin_teacher` (trip-scoped names).
 * The roster now carries a second role — `Pimpinan`, a signed-in read-only principal (#179, ADR-0025)
 * — but the Group does not admit it: `group_member_role_check` still pins `'Staff'` and the composite
 * `(id, role)` FK below asks `person` for a Staff pair, so a Pimpinan can never be a member. `stream`
 * can never be carried by a Group member either — so the old
 * `group_member_stream_iff_teaching` equivalence (which pinned Stream to Teaching-Team rows)
 * collapses to `group_member_stream_null`: a Group member holds no Stream at all. See
 * `docs/data-model.md`'s Group section.
 */
export const groupMember = pgTable(
  "group_member",
  {
    perjadinId: uuid("perjadin_id")
      .notNull()
      .references(() => perjadin.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    // `group_member_stream_check` names exactly the values `STREAMS` holds. `group_member_role_check`
    // deliberately pins `'Staff'` alone — a subset of `ROLES` now that `Pimpinan` exists (#179) — which
    // is what keeps a Pimpinan out of the Group. `stream` stays nullable, so it reads as `Stream | null`;
    // the CHECK pins which strings are allowed, and `group_member_stream_null` below pins that it is
    // always null now.
    role: text("role").$type<Role>().notNull(),
    stream: text("stream").$type<Stream>(),
  },
  (t) => [
    primaryKey({ columns: [t.perjadinId, t.personId] }),
    check("group_member_role_check", sql`${t.role} = 'Staff'`),
    check("group_member_stream_check", sql`${t.stream} in ('STEM', 'Research')`),
    // A Group is Staff and only Staff now (ADR-0020, T3/#153), so no member carries a Stream:
    // the teaching team who used to carry a Stream assignment are trip-scoped names, not Group
    // members. This replaces `group_member_stream_iff_teaching`, whose Teaching-Team side is now
    // unreachable.
    check("group_member_stream_null", sql`${t.stream} is null`),
    foreignKey({
      name: "group_member_person_role_fk",
      columns: [t.personId, t.role],
      foreignColumns: [person.id, person.role],
    }),
  ],
);

/**
 * A Perjadin's **Teaching Team as trip-scoped names** — plain strings entered on the trip, up to
 * twenty, not `person` rows (ADR-0020). They are never invited, hold no sign-in, carry no Stream and
 * are not `group_member` rows; the professors who deliver offline Sessions are external to DITSAMA
 * and will not sign in. Editing is per-member — names are added, renamed and removed one at a time on
 * `/perjadin/[id]` (T3), not by wholesale replacement — which is why this is a table of its own rather
 * than a column on `perjadin`.
 *
 * The cap of twenty is an app rule (`MAX_TEACHING_TEAM_PER_PERJADIN`), not a DB one, in the same
 * spirit as the Group caps. `on delete cascade`: the names are the trip's and outlive nothing.
 * Which of them taught each offline Session is recorded through `session_teaching_team`.
 */
export const perjadinTeacher = pgTable("perjadin_teacher", {
  id: uuid("id").primaryKey().defaultRandom(),
  perjadinId: uuid("perjadin_id")
    .notNull()
    .references(() => perjadin.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

/**
 * The **Pimpinan** recorded on a Perjadin — record-only (ADR-0020, and the Pimpinan entry in
 * `CONTEXT.md`). A leader of DITSAMA ITB who rarely joins the Kelompok Perjalanan to monitor the
 * offline Sessions is noted here and named on the Laporan Perjadin, but is **not a working Group
 * member**: they file no Perjadin Evaluation and add nothing to the Preparation Checklist, so they
 * are deliberately not a `group_member` row.
 *
 * A row references a **real Person of role Pimpinan** — the Pimpinan roster is the single source of
 * truth now (#181), so the old fixed-three `PIMPINAN` constant and the `name` CHECK that mirrored it
 * are gone. `role` is pinned to `'Pimpinan'` and the composite `(person_id, role)` foreign key into
 * `person (id, role)` guarantees a non-Pimpinan can never be recorded here, the same discipline the
 * PIC-is-Staff family (`perjadin_pic_is_staff`, `group_member_person_role_fk`) enforces. The primary
 * key `(perjadin_id, person_id)` makes a Pimpinan recordable at most once per trip.
 */
export const perjadinPimpinan = pgTable(
  "perjadin_pimpinan",
  {
    perjadinId: uuid("perjadin_id")
      .notNull()
      .references(() => perjadin.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    role: text("role").$type<"Pimpinan">().notNull().default("Pimpinan"),
  },
  (t) => [
    primaryKey({ columns: [t.perjadinId, t.personId] }),
    check("perjadin_pimpinan_role_check", sql`${t.role} = 'Pimpinan'`),
    foreignKey({
      name: "perjadin_pimpinan_is_pimpinan",
      columns: [t.personId, t.role],
      foreignColumns: [person.id, person.role],
    }),
  ],
);

/**
 * The acquittal's line items. **The Advance is one pot and the acquittal reconciles the
 * pot** — a transaction consumes the Advance, not a person's share of it.
 *
 * **Two orthogonal axes describe each line.** `category` is *what kind of spend* it was — a
 * closed set read off DITSAMA's own approved budget. `participantType` is *which cohort* it
 * served — `Siswa` (the Student Class) or `GTK-MS` (the GTK and MS Classes together) — so the
 * Laporan can split every acquittal's spend by Class. Both are required, and both are closed
 * sets whose CHECKs below are written out character for character rather than composed from
 * `TRANSACTION_CATEGORIES` / `TRANSACTION_PARTICIPANT_TYPES`, for the reason `./index.ts` gives:
 * a composed constraint string is not the one the drizzle-kit snapshot holds, and the two would
 * then diff forever.
 */
export const transaction = pgTable(
  "transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    perjadinId: uuid("perjadin_id")
      .notNull()
      .references(() => perjadin.id, { onDelete: "cascade" }),
    spentOn: date("spent_on").notNull(),
    description: text("description").notNull(),
    amountIdr: bigint("amount_idr", { mode: "number" }).notNull(),
    category: text("category").$type<TransactionCategory>().notNull(),
    participantType: text("participant_type").$type<TransactionParticipantType>().notNull(),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("transaction_amount_check", sql`${t.amountIdr} > 0`),
    check(
      "transaction_category_check",
      sql`${t.category} in ('Tiket Pesawat/Kereta PP', 'Uang Harian', 'Honorarium Narasumber', 'Akomodasi', 'Transport Bandara/Stasiun', 'Transport Lokal Dalam Provinsi', 'Konsumsi', 'Modul', 'ATK', 'Alat dan Bahan Research Project', 'Seminar kit', 'Lainnya')`,
    ),
    check("transaction_participant_type_check", sql`${t.participantType} in ('Siswa', 'GTK-MS')`),
  ],
);

/**
 * The Preparation Checklist's ticks — **one row per ticked item, and nothing else**
 * ([#114](https://github.com/mafiefa02/sugt/issues/114)).
 *
 * The *set of items that exists* is not stored: since the amendment to ADR-0018 it is a **flat
 * fixed seven** — `sk_perjalanan`, the two tickets, lodging, local transport, `staff`, and
 * `pengajar_lengkap` — derived at read time in the query layer with no per-member part. This table
 * holds only which of those a Staff member has hand-ticked, so an un-tick is a `DELETE` and there is
 * no "unchecked" row to keep in sync.
 *
 * `itemKey` is one of those seven fixed keys. `pengajar_lengkap` is the one box the tool clears by
 * itself: the Teaching-Team mutation queries (`./queries/perjadin-teachers.ts`) delete its tick on
 * any add/rename/remove, so each change forces a fresh manual confirmation the team is complete.
 * `dosen:{personId}` ticks the **old** per-teacher model left behind are orphans — no item derives
 * them, so they are silently ignored and never cleaned up. See ADR-0018 and `docs/data-model.md`.
 *
 * The composite primary key `(perjadin_id, item_key)` is what makes a toggle idempotent: the
 * write upserts on it, so ticking twice is one row. `checked_by`/`checked_at` record who and when
 * for later use; nothing renders them yet.
 */
export const perjadinPreparationItem = pgTable(
  "perjadin_preparation_item",
  {
    perjadinId: uuid("perjadin_id")
      .notNull()
      .references(() => perjadin.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    checkedBy: uuid("checked_by")
      .notNull()
      .references(() => person.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.perjadinId, t.itemKey] })],
);

/**
 * Many per transaction. `storagePath` is the object key in the private `receipts` bucket,
 * and it is **opaque** — a bare UUID naming no Perjadin, no transaction and no person.
 * A signed URL carries its object path inside the JWT it is signed with, so a structured
 * key would put the trip's identifiers into every link the screen renders.
 *
 * `unique` on it means one uploaded object can be attached exactly once.
 */
export const transactionEvidence = pgTable("transaction_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transaction.id, { onDelete: "cascade" }),
  storagePath: text("storage_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  uploadedByPersonId: uuid("uploaded_by_person_id")
    .notNull()
    .references(() => person.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});
