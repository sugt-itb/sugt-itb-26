import type { TimeZone } from "@sugt/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Reference data: Provinces, the four Clusters, the forty-seven Schools.
 *
 * Seeded once by `seed/reference-data.sql` and never edited in the app —
 * `docs/product.md` is explicit that there are no admin screens for any of it.
 */

/**
 * Only the Provinces the Programme reaches, not all thirty-eight of Indonesia's.
 * A table rather than a text column for one reason: *provinces covered* is a
 * headline figure on the portfolio site, and a typo in free text would silently
 * inflate the one number nobody would think to check.
 */
export const province = pgTable(
  "province",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    // Indonesia has three Time Zones and no Province straddles a boundary, so the zone
    // lives here rather than on `school` — a column on School would admit two Schools in
    // one Province disagreeing about the hour. `province_time_zone_check` names exactly the
    // values `TIME_ZONES` holds; the CHECK is written out character for character, not
    // composed from the constant, for the reason `schema/index.ts` gives.
    timeZone: text("time_zone").$type<TimeZone>().notNull(),
  },
  (t) => [check("province_time_zone_check", sql`${t.timeZone} in ('WIB', 'WITA', 'WIT')`)],
);

/**
 * Four of them, at 7 / 18 / 12 / 10 Schools. The sizes are lopsided, so nothing
 * should assume they are comparable.
 *
 * `topic` and `problem` are columns rather than tables: each Cluster carries
 * exactly one of each and each Cluster's is different, so there is nothing to
 * share and nothing to join.
 */
export const cluster = pgTable("cluster", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  topic: text("topic").notNull(),
  problem: text("problem").notNull(),
});

/**
 * A set of Schools inside one Cluster close enough to be reached on one journey. Unlike
 * everything else in this file it has a Staff-facing editing screen, because DITSAMA
 * invented the groupings rather than being given them — see
 * `docs/adr/0016-sub-clusters-are-editable-because-nobody-allocated-them.md`.
 *
 * `unique (id, cluster_id)` carries no information on its own — `id` is already unique as
 * the primary key. It exists solely to be the target of `school`'s composite foreign key,
 * which is what makes a School's Cluster and its Sub-Cluster's Cluster unable to disagree.
 */
export const subCluster = pgTable(
  "sub_cluster",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => cluster.id),
  },
  (t) => [unique().on(t.id, t.clusterId)],
);

/**
 * `clusterId` is NOT NULL — Clusters are allocated, so "a School with no Cluster"
 * is not a state the coverage view ever has to render, and no Cluster join is
 * ever an outer join.
 *
 * `subClusterId` is NOT NULL: every School belongs to exactly one Sub-Cluster from the
 * moment the seed runs, so a School with no Sub-Cluster is one no trip can ever be planned
 * for and no screen would say so — the state ADR-0016 argues against. It was nullable while
 * no Sub-Cluster data existed; the seed (`reference-data.sql`) assigns all forty-seven Schools
 * and migration 0009 then tightens the column. `docs/data-model.md`'s Reference-data section
 * is the source for the invariant.
 *
 * A School carries both `clusterId` and `subClusterId`, and they cannot disagree: the
 * composite foreign key `(subClusterId, clusterId) → sub_cluster (id, cluster_id)` means a
 * row can only exist if the pair is true in `sub_cluster`. It is the same denormalisation
 * `group_member.role` already makes.
 *
 * `kabupatenKota` is plain text, unlike Province: nothing counts it, so a typo
 * costs a misspelt line rather than a wrong headline. It is kept because six
 * Schools are in Jakarta and three in Banda Aceh.
 */
export const school = pgTable(
  "school",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => cluster.id),
    subClusterId: uuid("sub_cluster_id")
      .notNull()
      .references(() => subCluster.id),
    provinceCode: text("province_code")
      .notNull()
      .references(() => province.code),
    kabupatenKota: text("kabupaten_kota").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.subClusterId, t.clusterId],
      foreignColumns: [subCluster.id, subCluster.clusterId],
    }),
  ],
);
