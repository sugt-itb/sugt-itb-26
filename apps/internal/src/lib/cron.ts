import { timingSafeEqual } from "node:crypto";

import type { CronCaller } from "@sugt/db/queries";

import { requireEnv } from "./env";

/**
 * **Is this Vercel Cron?** (#562) — a `CronCaller` when the `Authorization: Bearer …` header is
 * exactly `CRON_SECRET`, which Vercel sends with every cron request, and `null` otherwise: the route's
 * 401. Compared in constant time, length first, as `authorizeServiceCaller` does.
 */
export function authorizeCron(request: Request): CronCaller | null {
  const header = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return null;

  const presented = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(requireEnv("CRON_SECRET"));
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;

  return { kind: "cron" };
}
