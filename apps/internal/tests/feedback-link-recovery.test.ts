import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveFeedbackToken } from "-/lib/feedback-token";
import { resolvePerjadinFeedbackToken } from "-/lib/perjadin-feedback-token";
import { db, schema } from "@sugt/db";
import {
  formatRecoveryReport,
  parseRecoveryCsv,
  reattachFeedbackLinks,
  type RecoveryLine,
} from "@sugt/db/feedback-link-recovery";
import { issueFeedbackToken, issuePerjadinFeedbackToken } from "@sugt/db/queries";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCluster,
  addPerjadin,
  addPerjadinFeedbackToken,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  resetDatabase,
} from "./support/fixtures";

/**
 * **`db:reattach-links`** (#453, ADR-0049) — attaching links an earlier reissue overwrote back to
 * their Session or Perjadin, as additional links. Every row of the ticket's table is a test here,
 * and so are the two properties that make it safe to run against production: a dry run writes
 * nothing, and a second `--apply` of the same file attaches nothing.
 */

const BASE = "https://internal.sugt.example";
const OLD_F = "0a000000-0000-4000-8000-000000000001";
const OLD_EP = "0b000000-0000-4000-8000-000000000002";

const sql = db.$client;

async function world() {
  const operator = await addPerson({
    fullName: "Rina Nurhayati",
    email: "rina@ditsama.itb.ac.id",
    role: "Staff",
  });
  await addProvince("JB", "Jawa Barat");
  const cluster = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
  const school = await addSchool({
    slug: "sman-1-bandung",
    name: "SMAN 1 Bandung",
    clusterId: cluster.id,
    provinceCode: "JB",
  });
  const session = await addSession({ schoolId: school.id, heldOn: "2026-09-10" });
  const otherSession = await addSession({ schoolId: school.id, heldOn: "2026-09-11" });
  const trip = await addPerjadin({ picPersonId: operator.id });
  return { operator, school, session, otherSession, trip };
}

let n = 0;
const line = (link: string, target: string, kind: string | null = null): RecoveryLine => ({
  line: ++n,
  link,
  target,
  kind,
});

async function run(lines: RecoveryLine[], apply: boolean) {
  return reattachFeedbackLinks(sql, { lines, operatorEmail: "rina@ditsama.itb.ac.id", apply });
}

async function allTokens() {
  const sessionRows = await db.select().from(schema.sessionFeedbackToken);
  const perjadinRows = await db.select().from(schema.perjadinFeedbackToken);
  return { sessionRows, perjadinRows };
}

describe("db:reattach-links", () => {
  beforeEach(async () => {
    n = 0;
    await resetDatabase();
  });

  it("attaches an old /f link beside the Session's own, and issuing still returns the original", async () => {
    const { operator, session } = await world();
    const original = await issueFeedbackToken(operator, session.id);

    const report = await run([line(`${BASE}/f/${OLD_F}`, session.id)], true);

    expect(report.results.map((r) => r.outcome)).toEqual(["attached"]);
    expect(await resolveFeedbackToken(OLD_F)).toEqual({
      outcome: "open",
      caller: { kind: "participant", sessionId: session.id },
    });
    expect(await issueFeedbackToken(operator, session.id)).toEqual(original);
    const [row] = (await allTokens()).sessionRows.filter((r) => r.token === OLD_F);
    expect(row!.issuedByPersonId).toBe(operator.id);
  });

  it("attaches an old /ep link to its Perjadin, and a bare token given its kind", async () => {
    const { operator, trip } = await world();
    const original = await issuePerjadinFeedbackToken(operator, trip.id);
    const bare = "0c000000-0000-4000-8000-000000000003";

    const report = await run(
      [line(`${BASE}/ep/${OLD_EP}/`, trip.id), line(bare, trip.id, "perjadin")],
      true,
    );

    expect(report.results.map((r) => r.outcome)).toEqual(["attached", "attached"]);
    for (const token of [OLD_EP, bare]) {
      expect(await resolvePerjadinFeedbackToken(token)).toMatchObject({
        outcome: "open",
        caller: { kind: "perjadin", perjadinId: trip.id },
      });
    }
    expect(await issuePerjadinFeedbackToken(operator, trip.id)).toEqual(original);
  });

  it("writes nothing on a dry run, and reports what --apply would do", async () => {
    const { session, trip } = await world();
    const before = await allTokens();

    const report = await run(
      [line(`${BASE}/f/${OLD_F}`, session.id), line(`${BASE}/ep/${OLD_EP}`, trip.id)],
      false,
    );

    expect(report.results.map((r) => r.outcome)).toEqual(["would-attach", "would-attach"]);
    expect(await allTokens()).toEqual(before);
    expect(formatRecoveryReport(report)).toContain("Jalankan lagi dengan --apply");
  });

  it("is sudah aktif for a token already on the same target — a live link, or a line repeated", async () => {
    const { operator, session } = await world();
    const live = await issueFeedbackToken(operator, session.id);
    if (live.outcome !== "issued") throw new Error("unreachable");
    const lines = [
      line(`${BASE}/f/${live.token}`, session.id),
      line(`${BASE}/f/${OLD_F}`, session.id),
      line(`${BASE}/f/${OLD_F}`, session.id),
    ];

    for (const apply of [false, true]) {
      const report = await run(lines, apply);
      expect(report.results.map((r) => r.outcome)).toEqual([
        "already-active",
        apply ? "attached" : "would-attach",
        "already-active",
      ]);
    }
    expect((await allTokens()).sessionRows).toHaveLength(2);
  });

  it("refuses a token another target holds, and never moves it", async () => {
    const { operator, session, otherSession, trip } = await world();
    const theirs = await issueFeedbackToken(operator, otherSession.id);
    if (theirs.outcome !== "issued") throw new Error("unreachable");
    const tripLink = await addPerjadinFeedbackToken({
      perjadinId: trip.id,
      issuedByPersonId: operator.id,
    });
    const before = await allTokens();

    const report = await run(
      [
        line(`${BASE}/f/${theirs.token}`, session.id),
        // The same string under the other kind is not a new link either.
        line(tripLink.token, session.id, "session"),
      ],
      true,
    );

    expect(report.results.map((r) => r.outcome)).toEqual(["refused", "refused"]);
    expect(report.results[0]!.reason).toContain(otherSession.id);
    expect(await allTokens()).toEqual(before);
  });

  it("refuses a target that does not exist", async () => {
    await world();

    const report = await run(
      [
        line(`${BASE}/f/${OLD_F}`, "99999999-9999-4999-8999-999999999999"),
        line(`${BASE}/f/${OLD_F}`, "not-an-id"),
      ],
      true,
    );

    expect(report.results.map((r) => [r.outcome, r.reason])).toEqual([
      ["refused", "target tidak ditemukan"],
      ["refused", "target tidak ditemukan"],
    ]);
    expect((await allTokens()).sessionRows).toEqual([]);
  });

  it("refuses a malformed link or token", async () => {
    const { session } = await world();

    const report = await run(
      [
        line("https://bit.ly/3xYzAbc", session.id),
        line(`${BASE}/x/${OLD_F}`, session.id),
        line(`${BASE}/f/not-a-token`, session.id),
        line("not-a-token", session.id, "session"),
        line(OLD_F, session.id),
        line(OLD_F, session.id, "kelas"),
      ],
      true,
    );

    expect(report.results.map((r) => r.outcome)).toEqual(Array(6).fill("refused"));
    expect((await allTokens()).sessionRows).toEqual([]);
  });

  it("refuses an /f link against a Perjadin and an /ep link against a Session", async () => {
    const { session, trip } = await world();

    const report = await run(
      [line(`${BASE}/f/${OLD_F}`, trip.id), line(`${BASE}/ep/${OLD_EP}`, session.id)],
      true,
    );

    expect(report.results.map((r) => r.outcome)).toEqual(["refused", "refused"]);
    expect(report.results[0]!.reason).toContain("Perjadin");
    expect(await allTokens()).toEqual({ sessionRows: [], perjadinRows: [] });
  });

  it("attaches to a cancelled Session but flags it, because the link still resolves to gone", async () => {
    const { school } = await world();
    const cancelled = await addSession({
      schoolId: school.id,
      heldOn: "2026-09-12",
      status: "cancelled",
    });

    const report = await run([line(`${BASE}/f/${OLD_F}`, cancelled.id)], true);

    expect(report.results[0]!.outcome).toBe("attached");
    expect(report.results[0]!.flag).toContain("dibatalkan");
    expect(await resolveFeedbackToken(OLD_F)).toEqual({ outcome: "gone" });
  });

  it("attaches nothing on a second --apply of the same file, and calls every line sudah aktif", async () => {
    const { session, trip } = await world();
    const lines = [line(`${BASE}/f/${OLD_F}`, session.id), line(`${BASE}/ep/${OLD_EP}`, trip.id)];

    await run(lines, true);
    const after = await allTokens();
    const again = await run(lines, true);

    expect(again.results.map((r) => r.outcome)).toEqual(["already-active", "already-active"]);
    expect(await allTokens()).toEqual(after);
  });

  it("refuses an operator who is not an active Staff Person, before reading a line", async () => {
    const { session } = await world();
    await addPerson({ fullName: "Bu Sri", email: "sri@itb.ac.id", role: "Pimpinan" });
    const lines = [line(`${BASE}/f/${OLD_F}`, session.id)];

    await expect(
      reattachFeedbackLinks(sql, { lines, operatorEmail: "sri@itb.ac.id", apply: true }),
    ).rejects.toThrow(/bukan Staff/);
    await expect(
      reattachFeedbackLinks(sql, { lines, operatorEmail: "nobody@itb.ac.id", apply: true }),
    ).rejects.toThrow(/Tidak ada Person aktif/);
    expect((await allTokens()).sessionRows).toEqual([]);
  });

  it("reads the CSV a spreadsheet exports: header, comments, quotes and blank lines skipped", () => {
    const text = [
      "link,target,kind",
      "# collected from bit.ly",
      "",
      `"${BASE}/f/${OLD_F}", "s-1"`,
      `${OLD_EP},t-1,perjadin`,
    ].join("\r\n");

    expect(parseRecoveryCsv(text)).toEqual([
      { line: 4, link: `${BASE}/f/${OLD_F}`, target: "s-1", kind: null },
      { line: 5, link: OLD_EP, target: "t-1", kind: "perjadin" },
    ]);
  });

  it("runs as a package script under plain Node: a dry run, then --apply", async () => {
    const { session } = await world();
    const packageDir = new URL("../../../packages/db/", import.meta.url).pathname;
    const csv = join(mkdtempSync(join(tmpdir(), "reattach-links-")), "links.csv");
    writeFileSync(csv, `${BASE}/f/${OLD_F},${session.id}\n`);
    const runScript = (...extra: string[]) =>
      execFileSync(
        process.execPath,
        [
          "scripts/reattach-feedback-links.ts",
          csv,
          "--operator",
          "rina@ditsama.itb.ac.id",
          ...extra,
        ],
        {
          cwd: packageDir,
          env: { ...process.env, DIRECT_URL: process.env.DATABASE_URL },
          encoding: "utf8",
        },
      );

    expect(runScript()).toContain("akan dilampirkan");
    expect((await allTokens()).sessionRows).toEqual([]);
    expect(runScript("--apply")).toContain("1 dilampirkan");
    expect((await resolveFeedbackToken(OLD_F)).outcome).toBe("open");
  });
});
