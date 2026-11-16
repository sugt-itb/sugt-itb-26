import type { CronCaller } from "@sugt/db/queries";

import { presentsBearer } from "./bearer";
import { requireEnv } from "./env";

/**
 * **Is this Vercel Cron?** (#562) — a `CronCaller` when the request presents exactly `CRON_SECRET`,
 * which Vercel sends as a bearer token with every cron request, and `null` otherwise: the route's 401.
 */
export function authorizeCron(request: Request): CronCaller | null {
  return presentsBearer(request, requireEnv("CRON_SECRET")) ? { kind: "cron" } : null;
}
