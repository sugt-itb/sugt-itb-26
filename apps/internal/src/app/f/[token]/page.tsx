import { resolveFeedbackToken } from "-/lib/feedback-token";
import type { Metadata } from "next";

import { FeedbackForm } from "./feedback-form";
import { GoneNotice } from "./gone-notice";

export const metadata: Metadata = { title: "Umpan Balik Peserta" };

/**
 * **`/f/{token}` — the Participant Feedback form.** The one page in either app served without a
 * signed-in Person: it sits outside the `(app)` route group, so `SignedInLayout` never wraps
 * it, and the proxy matcher excludes `f/`, so no cookie redirect reaches it. Both are
 * deliberate holes recorded in `proxy.ts` and ADR-0012.
 *
 * The token is resolved here only to choose what to render — a dead one shows the same message
 * a scanner can do nothing about. The **submit** re-resolves it; this render is not trusted to
 * stand in for that.
 */
export default async function Page({ params }: PageProps<"/f/[token]">) {
  const { token } = await params;
  const resolved = await resolveFeedbackToken(token);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      {resolved.outcome === "gone" ? <GoneNotice /> : <FeedbackForm token={token} />}
    </main>
  );
}
