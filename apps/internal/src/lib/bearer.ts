import { timingSafeEqual } from "node:crypto";

/**
 * **Does the request present exactly `secret` as `Authorization: Bearer …`?** The one check behind
 * every secret-guarded route — the aggregates' `AGGREGATES_SECRET` and the cron's `CRON_SECRET`.
 * Compared in constant time, length first: `timingSafeEqual` throws on unequal-length buffers, so a
 * wrong-length token would otherwise be a 500 rather than a 401.
 */
export function presentsBearer(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;

  const presented = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
