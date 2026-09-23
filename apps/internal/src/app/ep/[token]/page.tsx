import { shortenKabupaten } from "-/lib/format-destination";
import { resolvePerjadinFeedbackToken } from "-/lib/perjadin-feedback-token";

import { EpForm } from "./ep-form";
import { GoneNotice } from "./gone-notice";

/**
 * **`/ep/{token}` — the Perjadin Evaluation form.** The second page in either app served without a
 * signed-in Person, beside `/f/{token}`: it sits outside the `(app)` route group, so
 * `SignedInLayout` never wraps it, and the proxy matcher excludes `ep/`, so no cookie redirect
 * reaches it. Both are deliberate holes recorded in `proxy.ts` and ADR-0024.
 *
 * The token is resolved here only to choose what to render, and to name which trip is being rated —
 * a dead one shows the same message whoever opened it can do nothing about. The **submit**
 * re-resolves it; this render is not trusted to stand in for that.
 */
export default async function Page({ params }: PageProps<"/ep/[token]">) {
  const { token } = await params;
  const resolved = await resolvePerjadinFeedbackToken(token);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      {resolved.outcome === "gone" ? (
        <GoneNotice />
      ) : (
        <EpForm
          token={token}
          destination={shortenKabupaten(resolved.perjadin.destination)}
          startsOn={resolved.perjadin.startsOn}
          endsOn={resolved.perjadin.endsOn}
        />
      )}
    </main>
  );
}
