import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { person } from "./people";

/** Whether the stored refresh token still works. "Belum terhubung" is no row at all. */
export type DriveConnectionStatus = "connected" | "broken";

/**
 * Why a stored connection is not reported **Terhubung** although its token works: the root or
 * `_staging` an earlier connect created is in the Drive trash, or gone — neither is quietly
 * recreated, since a new root would orphan every Perjadin folder under the old one (ADR-0040) — or
 * Drive failed partway through the last connect, so the fixed tree was not finished.
 */
export type DriveFolderProblem =
  | "root-trashed"
  | "root-missing"
  | "staging-trashed"
  | "staging-missing"
  | "folders-unfinished";

/**
 * **The company Google Drive connection** (ADR-0040, #372). One row or none, and the database holds
 * that: `singleton` is the primary key and CHECKed true, so a second row has nowhere to go.
 *
 * The refresh token is stored **only encrypted** — AES-256-GCM under `DRIVE_TOKEN_KEY`, a fresh
 * 12-byte IV per write — as three base64 columns. The key lives in the environment, never here, so
 * a database dump alone yields no token.
 *
 * The five Drive ids are nullable because the row is written before the folders are ensured, and a
 * reconnect that finds the root trashed keeps the token without them resolving. `status` and
 * `broken_at` move together: broken exactly when `broken_at` is set.
 */
export const driveConnection = pgTable(
  "drive_connection",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    accountEmail: text("account_email").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenTag: text("refresh_token_tag").notNull(),
    rootFolderId: text("root_folder_id"),
    stagingFolderId: text("staging_folder_id"),
    buktiTransaksiFolderId: text("bukti_transaksi_folder_id"),
    pelaksanaanOfflineFolderId: text("pelaksanaan_offline_folder_id"),
    readmeFileId: text("readme_file_id"),
    // `Dokumen/` and its `Pelaksanaan Offline/` (ADR-0042). Kept apart from the five above: a
    // connection made before them has neither, and receipts must not wait on them, so they are
    // ensured where a document needs them — connect, Periksa koneksi, the document reconcile.
    dokumenFolderId: text("dokumen_folder_id"),
    dokumenPelaksanaanOfflineFolderId: text("dokumen_pelaksanaan_offline_folder_id"),
    // `Foto & Video/` and its `Pelaksanaan Offline/` (ADR-0046), kept apart for the same reason and
    // ensured the same way, where footage needs them.
    footageFolderId: text("footage_folder_id"),
    footagePelaksanaanOfflineFolderId: text("footage_pelaksanaan_offline_folder_id"),
    // `Foto & Video — Unggahan/` and its `Pelaksanaan Offline/` (#561, ADR-0063): the upload tree,
    // where Staff put footage straight from Drive. Beside the archive above, never inside it, and
    // ensured where the archive is.
    footageUploadFolderId: text("footage_upload_folder_id"),
    footageUploadPelaksanaanOfflineFolderId: text("footage_upload_pelaksanaan_offline_folder_id"),
    folderProblem: text("folder_problem").$type<DriveFolderProblem>(),
    status: text("status").$type<DriveConnectionStatus>().notNull(),
    brokenAt: timestamp("broken_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    connectedByPersonId: uuid("connected_by_person_id")
      .notNull()
      .references(() => person.id),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("drive_connection_singleton_check", sql`${t.singleton}`),
    check("drive_connection_status_check", sql`${t.status} in ('connected', 'broken')`),
    check(
      "drive_connection_broken_at_check",
      sql`(${t.status} = 'broken') = (${t.brokenAt} is not null)`,
    ),
    check(
      "drive_connection_folder_problem_check",
      sql`${t.folderProblem} in ('root-trashed', 'root-missing', 'staging-trashed', 'staging-missing', 'folders-unfinished')`,
    ),
  ],
);
