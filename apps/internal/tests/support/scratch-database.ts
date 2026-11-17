import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { migrationsFolder } from "@sugt/db/migrations";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterEach, beforeEach } from "vitest";

/** See `scratchDatabaseThrough`: dropping a database under the suite's load can overrun 10 s. */
const SCRATCH_HOOK_TIMEOUT_MS = 30_000;

/**
 * **A scratch database stopped at one migration, for testing the next.** The suite's own database is
 * already past every migration, so a test of what one migration does to the rows before it makes a
 * database beside it on the same cluster, migrates it through `tag`, seeds it as the schema stood
 * then, and applies the rest with `applyRemainingMigrations`.
 *
 * Fresh per test: `beforeEach` creates and migrates it, `afterEach` drops it. Dropping a database
 * forces a checkpoint, which crawls while the rest of the suite writes in parallel, so both hooks get
 * a longer timeout than vitest's default 10 s — a drop under load overran it.
 */
export function scratchDatabaseThrough(tag: string): { readonly url: string } {
  let scratchUrl = "";
  let maintenanceUrl = "";
  let scratchName = "";
  let throughTag = "";

  beforeEach(async () => {
    const testUrl = new URL(process.env.DATABASE_URL!);
    scratchName = `${decodeURIComponent(testUrl.pathname.slice(1))}_${tag.slice(0, 4)}_${randomUUID().slice(0, 8)}`;
    const maintenance = new URL(testUrl);
    maintenance.pathname = "/postgres";
    maintenanceUrl = maintenance.toString();
    const scratch = new URL(testUrl);
    scratch.pathname = `/${scratchName}`;
    scratchUrl = scratch.toString();

    await withClient(maintenanceUrl, (sql) => sql.unsafe(`create database "${scratchName}"`));
    throughTag = await migrationsThrough(tag);
    await withClient(scratchUrl, (sql) => migrate(drizzle(sql), { migrationsFolder: throughTag }));
  }, SCRATCH_HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await withClient(maintenanceUrl, (sql) =>
      sql.unsafe(`drop database if exists "${scratchName}" with (force)`),
    );
    await rm(throughTag, { recursive: true, force: true });
  }, SCRATCH_HOOK_TIMEOUT_MS);

  return {
    get url() {
      return scratchUrl;
    },
  };
}

/** Apply every migration after the scratch database's stopping point. */
export function applyRemainingMigrations(url: string) {
  return withClient(url, (sql) => migrate(drizzle(sql), { migrationsFolder }));
}

/**
 * Apply the migrations after the scratch database's stopping point **up to and including `tag`**, and
 * no further — for a test of what one migration did that a later one has since reversed.
 */
export async function applyMigrationsThrough(url: string, tag: string) {
  const folder = await migrationsThrough(tag);
  try {
    await withClient(url, (sql) => migrate(drizzle(sql), { migrationsFolder: folder }));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** One short-lived connection, closed whatever `run` does. */
export async function withClient<T>(url: string, run: (sql: postgres.Sql) => Promise<T>) {
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** A copy of the migrations folder whose journal stops at `tag`. */
async function migrationsThrough(tag: string) {
  const folder = await mkdtemp(path.join(tmpdir(), "sugt-migrations-"));
  await cp(migrationsFolder, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.findIndex((entry) => entry.tag === tag);
  if (last < 0) throw new Error(`No migration ${tag} in the journal.`);
  journal.entries = journal.entries.slice(0, last + 1);
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}
