import { db, schema } from "@sugt/db";
import type { PerjadinToken } from "@sugt/db/queries";
import { eq } from "drizzle-orm";

/**
 * Turning a Perjadin feedback token into the caller a Perjadin Evaluation write is checked against
 * — the sibling of `feedback-token.ts`, one table over (ADR-0024).
 *
 * **Why this lives in the app rather than in `@sugt/db`.** The same deliberate exception the
 * Participant resolver is: `@sugt/db`'s query layer takes a caller it is given and never resolves
 * one, because resolving is what *produces* the caller its queries are checked against — so it
 * cannot itself be one of them. `caller.ts` says as much about the `PerjadinToken` arm: the token
 * has to be checked before there is a caller to check it as. See ADR-0012 and ADR-0024.
 */

/**
 * A resolved token — carrying the Perjadin's display info the public form shows — or `gone`.
 *
 * **`gone` is one outcome and carries no reason**, deliberately, exactly as the Participant
 * resolver's is. An unknown token, an expired one, and one replaced by a reissue are all the same
 * to whoever opened the link: nothing they can do differently, and the same remedy — ask for a
 * fresh link. There is no cancelled-trip case: a Perjadin is a real trip once it exists.
 *
 * The `open` arm carries the destination, start and end so the form can name which trip is being
 * rated without a second query. The `destination` is the stored snapshot; the page shortens it with
 * `shortenKabupaten` at render, the same read-side transform every other Perjadin surface uses.
 */
export type ResolvedPerjadinFeedbackToken =
  | {
      outcome: "open";
      caller: PerjadinToken;
      perjadin: { destination: string; startsOn: string; endsOn: string };
    }
  | { outcome: "gone" };

/**
 * Resolve the token in an `/ep/{token}` URL.
 *
 * **The expiry is enforced here, in the handler.** `expires_at` is a column and not a gate —
 * nothing in the database refuses an expired token — so this reads it and compares it to now.
 *
 * A replaced token needs no special case: the row is keyed on `perjadin_id`, so a reissue overwrites
 * the `token` column and the old string matches nothing here.
 */
export async function resolvePerjadinFeedbackToken(
  token: string,
): Promise<ResolvedPerjadinFeedbackToken> {
  const [row] = await db
    .select({
      perjadinId: schema.perjadinFeedbackToken.perjadinId,
      expiresAt: schema.perjadinFeedbackToken.expiresAt,
      destination: schema.perjadin.destination,
      startsOn: schema.perjadin.startsOn,
      endsOn: schema.perjadin.endsOn,
    })
    .from(schema.perjadinFeedbackToken)
    .innerJoin(schema.perjadin, eq(schema.perjadin.id, schema.perjadinFeedbackToken.perjadinId))
    .where(eq(schema.perjadinFeedbackToken.token, token))
    .limit(1);

  if (!row) return { outcome: "gone" };
  if (row.expiresAt.getTime() <= Date.now()) return { outcome: "gone" };

  return {
    outcome: "open",
    caller: { kind: "perjadin", perjadinId: row.perjadinId },
    perjadin: { destination: row.destination, startsOn: row.startsOn, endsOn: row.endsOn },
  };
}
