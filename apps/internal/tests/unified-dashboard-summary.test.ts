import { deriveDashboard } from "-/app/(app)/dashboard-derive";
import { GET as deliveryRoute } from "-/app/api/aggregates/delivery/route";
import { GET as scopeRoute } from "-/app/api/aggregates/scope/route";
import { GET as storyRoute } from "-/app/api/aggregates/stories/[slug]/route";
import { GET as storiesRoute } from "-/app/api/aggregates/stories/route";
import { GET as summaryRoute } from "-/app/api/unified-dashboard/summary/route";
import { config as proxyConfig } from "-/proxy";
import { db, schema } from "@sugt/db";
import { assessmentCompletions, monitoringData, type Person } from "@sugt/db/queries";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCluster,
  addOfflineSession,
  addPerjadin,
  addPerson,
  addProvince,
  addSchool,
  addSession,
  resetDatabase,
} from "./support/fixtures";
import { signInWithGoogle } from "./support/sign-in";
import {
  AUDIENCE,
  bearer,
  ISSUER,
  nowSeconds,
  ORIGIN,
  signUnifiedDashboardToken as sign,
  summary,
  SUMMARY_URL,
} from "./support/unified-dashboard";

/**
 * **The Unified Dashboard's summary route (#503)** — a real `Request` in, a real `Response` out, the
 * way `aggregates-routes.test.ts` drives the aggregates gate. Tokens are signed here with the
 * suite's throwaway secret and verified by the real `authorizeUnifiedDashboard`, so every 401 below
 * is `jose` refusing a token, not a stub.
 *
 * What it proves: the gate refuses each way a token can be wrong, and neither this gate nor the
 * aggregates gate opens the other's routes; and every figure is the one `/` derives from the same
 * rows, with each `x / total` reproducing its percentage.
 */

/** An unsigned token — `alg: none` — carrying otherwise perfect claims. */
function unsigned() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = nowSeconds();
  return `${part({ alg: "none", typ: "JWT" })}.${part({ iss: ISSUER, aud: AUDIENCE, iat, exp: iat + 60 })}.`;
}

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the Unified Dashboard gate", () => {
  it("serves a valid token, uncached", async () => {
    const response = await summaryRoute(bearer(await sign()));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each<[string, () => Promise<Request> | Request]>([
    ["no Authorization header", () => new Request(SUMMARY_URL)],
    [
      "a token signed with the wrong secret",
      async () => bearer(await sign({ secret: "a-different-secret-of-at-least-32-bytes" })),
    ],
    [
      "an expired token",
      async () => bearer(await sign({ issuedAt: nowSeconds() - 600, lifetimeSeconds: 120 })),
    ],
    [
      "a token living more than five minutes",
      async () => bearer(await sign({ lifetimeSeconds: 6 * 60 })),
    ],
    ["a token with no exp", async () => bearer(await sign({ withExp: false }))],
    [
      "a token issued in the future",
      async () => bearer(await sign({ issuedAt: nowSeconds() + 120 })),
    ],
    ["the wrong iss", async () => bearer(await sign({ issuer: "somebody-else" }))],
    ["the wrong aud", async () => bearer(await sign({ audience: "sugt-public" }))],
    ["alg: none", () => bearer(unsigned())],
    ["a malformed token", () => bearer("not.a.jwt")],
    ["a bearer that is not a JWT at all", () => bearer("hello")],
  ])("401s %s", async (_, request) => {
    const response = await summaryRoute(await request());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  it("is not opened by the aggregates secret", async () => {
    const response = await summaryRoute(bearer(process.env.AGGREGATES_SECRET!));

    expect(response.status).toBe(401);
  });

  it("does not open any of the aggregates routes", async () => {
    const jwt = () =>
      new Request(`${ORIGIN}/api/aggregates`, { headers: { authorization: `Bearer ${token}` } });
    const token = await sign();

    expect((await scopeRoute(jwt())).status).toBe(401);
    expect((await deliveryRoute(jwt())).status).toBe(401);
    expect((await storiesRoute(jwt())).status).toBe(401);
    expect((await storyRoute(jwt(), { params: Promise.resolve({ slug: "x" }) })).status).toBe(401);
  });

  it("is not opened by a signed-in browser session", async () => {
    await addPerson({ fullName: "Ratna", email: "ratna@gmail.com", role: "Pimpinan" });
    const { sessionCookie } = await signInWithGoogle({
      googleId: "google-ratna",
      email: "ratna@gmail.com",
      name: "Ratna",
    });
    expect(sessionCookie).not.toBeNull();

    const response = await summaryRoute(
      new Request(SUMMARY_URL, { headers: { cookie: sessionCookie! } }),
    );

    expect(response.status).toBe(401);
  });

  it("is outside the sign-in redirect, so a cookie-less caller gets its 401", () => {
    // The matcher is one regular expression over the path. (Next's own matcher helper reaches for
    // request-scoped storage that does not exist outside a server, so it is read directly here.)
    const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);

    expect(matcher.test("/api/unified-dashboard/summary")).toBe(false);
    // The exclusion is this route's, not everything's.
    expect(matcher.test("/feedback")).toBe(true);
    expect(matcher.test("/api/aggregates/scope")).toBe(false);
  });
});

describe("the summary figures", () => {
  /**
   * Three Schools in two Clusters. Offline: two delivered, one arranged, one cancelled. Online: three
   * delivered. Pretest: SMAN 1 has all four boxes (one unit), SMAN 2 two of four (no unit).
   */
  async function aProgramme() {
    await addProvince("JB", "Jawa Barat");
    const alpha = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    const beta = await addCluster({ slug: "beta", name: "Cluster Beta" });
    const school = (slug: string, clusterId: string) =>
      addSchool({ slug, name: slug.toUpperCase(), clusterId, provinceCode: "JB" });
    const [s1, s2, s3] = [
      await school("sman-1", alpha.id),
      await school("sman-2", alpha.id),
      await school("sman-3", beta.id),
    ];

    const pic = await addPerson({ fullName: "Rina", email: "rina@gmail.com", role: "Staff" });
    const trip = await addPerjadin({
      picPersonId: pic.id,
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
    });
    const offline = (
      schoolId: string,
      status: "delivered" | "arranged" | "cancelled",
      startsAt: string,
    ) =>
      addOfflineSession({ perjadinId: trip.id, schoolId, heldOn: "2026-09-02", startsAt, status });
    await offline(s1!.id, "delivered", "08:00");
    await offline(s2!.id, "delivered", "10:00");
    await offline(s3!.id, "arranged", "13:00");
    await offline(s3!.id, "cancelled", "15:00");
    await addSession({
      schoolId: s1!.id,
      heldOn: "2026-08-01",
      startsAt: "09:00",
      status: "delivered",
    });
    await addSession({
      schoolId: s1!.id,
      heldOn: "2026-08-08",
      startsAt: "09:00",
      status: "delivered",
    });
    await addSession({
      schoolId: s2!.id,
      heldOn: "2026-08-01",
      startsAt: "09:00",
      status: "delivered",
    });

    const box = (
      schoolId: string,
      stream: "STEM" | "Research",
      participantType: "Siswa" | "GTK-MS",
    ) => ({
      schoolId,
      stream,
      participantType,
      kind: "pretest" as const,
    });
    await db
      .insert(schema.assessmentCompletion)
      .values([
        box(s1!.id, "STEM", "Siswa"),
        box(s1!.id, "STEM", "GTK-MS"),
        box(s1!.id, "Research", "Siswa"),
        box(s1!.id, "Research", "GTK-MS"),
        box(s2!.id, "STEM", "Siswa"),
        box(s2!.id, "Research", "GTK-MS"),
      ]);

    return { ...pic, grants: [] } as Person;
  }

  it("lays out the contract with version 1 and generatedAt", async () => {
    await aProgramme();
    const before = Date.now();

    const payload = await summary(await sign());

    expect(payload.version).toBe(1);
    expect(Date.parse(payload.generatedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(payload).toEqual({
      version: 1,
      generatedAt: payload.generatedAt,
      progress: {
        detailUrl: `${ORIGIN}/`,
        // 5 delivered Sessions + 1 Pretest unit, of 3 Schools × 10.
        kegiatanTerlaksana: { percent: 20, completed: 6, total: 30 },
        pretest: 50,
        daring: 17,
        luring: 33,
        posttest: 0,
      },
      sessions: {
        offline: { delivered: 2, total: 6, detailUrl: `${ORIGIN}/perjadin` },
        online: { delivered: 3, total: 18, detailUrl: `${ORIGIN}/sesi-daring` },
        pretest: { completed: 6, total: 12, detailUrl: `${ORIGIN}/` },
        posttest: { completed: 0, total: 12, detailUrl: `${ORIGIN}/` },
      },
      // No feedback filed yet: every average is `null`, never 0 (#504).
      participantFeedback: {
        detailUrl: `${ORIGIN}/feedback`,
        responseCount: 0,
        narasumber: null,
        materi: null,
        relevansi: null,
        handsOnRbl: null,
      },
      perjadinFeedback: {
        detailUrl: `${ORIGIN}/feedback`,
        responseCount: 0,
        penginapan: null,
        transportasi: null,
        konsumsi: null,
        ketepatanWaktu: null,
        bantuanPendamping: null,
      },
      schools: [
        { slug: "sman-1", name: "SMAN-1", province: { code: "JB", name: "Jawa Barat" } },
        { slug: "sman-2", name: "SMAN-2", province: { code: "JB", name: "Jawa Barat" } },
        { slug: "sman-3", name: "SMAN-3", province: { code: "JB", name: "Jawa Barat" } },
      ],
    });
  });

  it("equals what / derives from the same rows", async () => {
    const person = await aProgramme();

    const payload = await summary(await sign());
    const dashboard = deriveDashboard(
      await monitoringData(person),
      "2026-10-14",
      await assessmentCompletions(person),
    );

    expect(payload.progress).toEqual({
      detailUrl: payload.progress.detailUrl,
      kegiatanTerlaksana: {
        ...payload.progress.kegiatanTerlaksana,
        percent: dashboard.activitiesPercent,
      },
      ...dashboard.summary,
    });
  });

  it("reproduces every percentage from its count and total", async () => {
    await aProgramme();

    const { progress, sessions } = await summary(await sign());
    const percent = (count: number, total: number) => Math.round((count / total) * 100);

    const { kegiatanTerlaksana: kegiatan } = progress;
    expect(percent(kegiatan.completed, kegiatan.total)).toBe(kegiatan.percent);
    expect(percent(sessions.offline.delivered, sessions.offline.total)).toBe(progress.luring);
    expect(percent(sessions.online.delivered, sessions.online.total)).toBe(progress.daring);
    expect(percent(sessions.pretest.completed, sessions.pretest.total)).toBe(progress.pretest);
    expect(percent(sessions.posttest.completed, sessions.posttest.total)).toBe(progress.posttest);
  });

  it("answers an empty programme with zeros, not a division error", async () => {
    const { progress, sessions } = await summary(await sign());

    expect(progress).toMatchObject({
      kegiatanTerlaksana: { percent: 0, completed: 0, total: 0 },
      pretest: 0,
      daring: 0,
      luring: 0,
      posttest: 0,
    });
    expect(sessions.offline).toMatchObject({ delivered: 0, total: 0 });
    expect(sessions.posttest).toMatchObject({ completed: 0, total: 0 });
  });

  it("links to wherever this app is deployed", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://staging.internal.example");

    const { progress, sessions } = await summary(await sign());

    expect(progress.detailUrl).toBe("https://staging.internal.example/");
    expect(sessions.offline.detailUrl).toBe("https://staging.internal.example/perjadin");
    expect(sessions.online.detailUrl).toBe("https://staging.internal.example/sesi-daring");
    expect(sessions.pretest.detailUrl).toBe("https://staging.internal.example/");
  });
});

describe("the School list (#528)", () => {
  it("is every School, ordered by name, each with its own Province", async () => {
    await addProvince("JB", "Jawa Barat");
    await addProvince("JT", "Jawa Tengah");
    const alpha = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    // Inserted out of name order, across two Provinces, so neither insertion order nor a Province
    // grouping could pass for "ordered by name".
    await addSchool({
      slug: "smkn-3",
      name: "SMKN 3 Semarang",
      clusterId: alpha.id,
      provinceCode: "JT",
    });
    await addSchool({
      slug: "sman-1",
      name: "SMAN 1 Bandung",
      clusterId: alpha.id,
      provinceCode: "JB",
    });
    await addSchool({ slug: "man-2", name: "MAN 2 Solo", clusterId: alpha.id, provinceCode: "JT" });

    const { schools } = await summary(await sign());

    expect(schools).toEqual([
      { slug: "man-2", name: "MAN 2 Solo", province: { code: "JT", name: "Jawa Tengah" } },
      { slug: "sman-1", name: "SMAN 1 Bandung", province: { code: "JB", name: "Jawa Barat" } },
      { slug: "smkn-3", name: "SMKN 3 Semarang", province: { code: "JT", name: "Jawa Tengah" } },
    ]);
  });

  it("matches the School rows: one each, every Province the School's province_code", async () => {
    await addProvince("JB", "Jawa Barat");
    await addProvince("JT", "Jawa Tengah");
    const alpha = await addCluster({ slug: "alpha", name: "Cluster Alpha" });
    for (const [index, provinceCode] of ["JB", "JT", "JB", "JT", "JB"].entries()) {
      await addSchool({
        slug: `s-${index}`,
        name: `S ${index}`,
        clusterId: alpha.id,
        provinceCode,
      });
    }

    const { schools } = await summary(await sign());
    const rows = await db
      .select({ slug: schema.school.slug, provinceCode: schema.school.provinceCode })
      .from(schema.school);

    expect(schools).toHaveLength(rows.length);
    const provinceOf = new Map(rows.map((row) => [row.slug, row.provinceCode]));
    for (const school of schools) {
      expect(school.province.code).toBe(provinceOf.get(school.slug));
    }
  });

  it("is [] with no Schools", async () => {
    const { schools } = await summary(await sign());

    expect(schools).toEqual([]);
  });
});
