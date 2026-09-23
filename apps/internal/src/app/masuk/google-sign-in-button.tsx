"use client";

import { authClient } from "-/lib/auth-client";
import { Button } from "@sugt/ui/components/button";
import { useEffect, useState } from "react";

/**
 * The one button.
 *
 * **`errorCallbackURL` is not optional.** It is what sends a rejected visitor back to
 * this page instead of Better Auth's built-in error page, and that one decision solves
 * three problems at once: the built-in page validates the error code against
 * `/^['A-Za-z0-9_-]+$/` and renders `UNKNOWN` on anything else, so the Indonesian
 * sentence — which has two full stops — would never reach a reader; a thrown message
 * arrives with its spaces turned into underscores, which is not prose anybody should
 * be shown; and the copy belongs in the app, in Indonesian, beside the rest of it.
 */
export function GoogleSignInButton() {
  const [pending, setPending] = useState(false);

  /**
   * **`pending` never resets itself — this is what stops it sticking.** The click below
   * sets it and nothing here clears it, which was safe only while the call always
   * navigated away. Now that `select_account consent` always reopens the chooser, a
   * visitor can open it and press browser-back; the page then comes back from bfcache
   * with this React state restored, and the button would sit `disabled` reading
   * "Menghubungkan…" with no way out.
   *
   * `pageshow` with `event.persisted` is the one signal that names exactly that restore
   * — a fresh load fires it with `persisted: false` and needs no reset. Resetting there
   * keeps the "stop clicking" affordance on the outbound click while making the stuck
   * state unreachable.
   */
  useEffect(() => {
    function reset(event: PageTransitionEvent) {
      if (event.persisted) setPending(false);
    }
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({
          provider: "google",
          // Role-aware landing (#265): everyone returns to `/pendamping`. A Staff Person's home is the
          // Pendamping; a non-Staff Pimpinan is bounced from there to the Dashboard at `/` by the
          // `/pendamping` guard — the role is not known here on the client, so that server guard sorts it.
          callbackURL: "/pendamping",
          errorCallbackURL: "/masuk",
        });
      }}
    >
      {pending ? "Menghubungkan…" : "Masuk dengan Google"}
    </Button>
  );
}
