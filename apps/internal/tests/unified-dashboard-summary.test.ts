import { deriveDashboard } from "-/app/(app)/dashboard-derive";
import { GET as scopeRoute } from "-/app/api/aggregates/scope/route";
import { GET as summaryRoute } from "-/app/api/unified-dashboard/summary/route";
import type { SummaryPayload } from "-/lib/unified-dashboard";
import { config as proxyConfig } from "-/proxy";
import { db, schema } from "@sugt/db";
import { assessmentCompletions, monitoringData, type Person } from "@sugt/db/queries";
import { SignJWT } from "jose";
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

const ORIGIN = "http://localhost:3001";
const SUMMARY = `${ORIGIN}/api/unified-dashboard/summary`;
const SECRET = process.env.UNIFIED_DASHBOARD_JWT_SECRET!;
const ISSUER = process.env.UNIFIED_DASHBOARD_JWT_ISSUER!;
const AUDIENCE = process.env.UNIFIED_DASHBOARD_JWT_AUDIENCE!;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A token the way the Unified Dashboard's backend signs one; each option breaks one thing. */
function sign({
  secret = SECRET,
  issuer = ISSUER,
  audience = AUDIENCE,
  issuedAt = nowSeconds(),
  lifetimeSeconds = 60,
  withExp = true,
}: {
  secret?: string;
  issuer?: string;
  audience?: string;
  issuedAt?: number;
  lifetimeSeconds?: number;
  withExp?: boolean;
} = {}) {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(issuedAt);
  if (withExp) jwt.setExpirationTime(issuedAt + lifetimeSeconds);
  return jwt.sign(new TextEncoder().encode(secret));
}

/** An unsigned token — `alg: none` — carrying otherwise perfect claims. */
function unsigned() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = nowSeconds();
  return `${part({ alg: "none", typ: "JWT" })}.${part({ iss: ISSUER, aud: AUDIENCE, iat, exp: iat + 60 })}.`;
}

const bearer = (token: string) =>
  new Request(SUMMARY, { headers: { authorization: `Bearer ${token}` } });

async function summary(token: string) {
  const response = await summaryRoute(bearer(token));
  expect(response.status).toBe(200);
  return (await response.json()) as SummaryPayload;
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
    ["no Authorization header", () => new Request(SUMMARY)],
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

  it("does not open the aggregates routes", async () => {
    const response = await scopeRoute(
      new Request(`${ORIGIN}/api/aggregates/scope`, {
        headers: { authorization: `Bearer ${await sign()}` },
      }),
    );

    expect(response.status).toBe(401);
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
      new Request(SUMMARY, { headers: { cookie: sessionCookie! } }),
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
