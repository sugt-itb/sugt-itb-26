"use client";

import { authClient } from "-/lib/auth-client";
import { SIGN_IN_PATH } from "-/lib/sign-in-destination";
import { Button } from "@sugt/ui/components/button";
import { cn } from "@sugt/ui/lib/utils";
import { type ReactNode, useEffect, useState } from "react";

type Provider = "microsoft" | "google";

/**
 * **The two ways in** (#565, ADR-0062), stacked, the same size and full width, neither primary:
 * **Masuk dengan akun ITB** (ITB's Microsoft tenant) first, then **Masuk dengan Google**. Both
 * prove an email; the invite list decides, the same way for either.
 *
 * **Each wears its provider's own sign-in style**, as classes here and not as tokens in
 * `@sugt/ui`'s theme: they follow Microsoft's and Google's brand rules, not ours, and must not
 * become colours anything else can reach for. `@sugt/ui`'s `Button` is used as it is.
 *
 * **`errorCallbackURL` is not optional.** It is what sends a rejected visitor back to this page
 * instead of Better Auth's built-in error page, and that one decision solves three problems at
 * once: the built-in page validates the error code against `/^['A-Za-z0-9_-]+$/` and renders
 * `UNKNOWN` on anything else, so the Indonesian sentence — which has two full stops — would never
 * reach a reader; a thrown message arrives with its spaces turned into underscores, which is not
 * prose anybody should be shown; and the copy belongs in the app, in Indonesian, beside the rest
 * of it. It stays a bare `/masuk` — a rejected visitor is not handed back the destination they were
 * going to. Every refusal of either provider, an address that is not ITB's included, lands there.
 *
 * `destination` is a path `safeDestination` already accepted on the server, or `null`.
 */
export function SignInButtons({ destination }: { destination: string | null }) {
  /** Which sign-in is under way. While either is, both buttons are disabled. */
  const [pending, setPending] = useState<Provider | null>(null);

  /**
   * **`pending` never resets itself — this is what stops it sticking.** The click below sets it
   * and nothing here clears it, which was safe only while the call always navigated away. Both
   * providers reopen their account chooser on every sign-in, so a visitor can open it and press
   * browser-back; the page then comes back from bfcache with this React state restored, and both
   * buttons would sit `disabled`, one reading "Menghubungkan…", with no way out.
   *
   * `pageshow` with `event.persisted` is the one signal that names exactly that restore — a fresh
   * load fires it with `persisted: false` and needs no reset. Resetting there keeps the "stop
   * clicking" affordance on the outbound click while making the stuck state unreachable.
   */
  useEffect(() => {
    function reset(event: PageTransitionEvent) {
      if (event.persisted) setPending(null);
    }
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function signIn(provider: Provider) {
    setPending(provider);
    await authClient.signIn.social({
      provider,
      // The page the visitor was sent here from (#502), else role-aware landing (#265): everyone
      // returns to `/pendamping`. A Staff Person's home is the Pendamping; a non-Staff Pimpinan
      // is bounced from there to the Dashboard at `/` by the `/pendamping` guard — the role is
      // not known here on the client, so that server guard sorts it.
      callbackURL: destination ?? "/pendamping",
      errorCallbackURL: SIGN_IN_PATH,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ProviderButton
        label="Masuk dengan akun ITB"
        logo={<MicrosoftLogo />}
        pending={pending === "microsoft"}
        disabled={pending !== null}
        onClick={() => signIn("microsoft")}
        // Microsoft's dark sign-in button.
        className="border-[#2F2F2F] bg-[#2F2F2F] text-white hover:bg-[#2F2F2F]/90"
      />
      <ProviderButton
        label="Masuk dengan Google"
        logo={<GoogleLogo />}
        pending={pending === "google"}
        disabled={pending !== null}
        onClick={() => signIn("google")}
        // Google's light sign-in button.
        className="border-[#747775] bg-[#FFFFFF] text-[#1F1F1F] hover:bg-[#F2F2F2]"
      />
    </div>
  );
}

/**
 * One provider's button: `@sugt/ui`'s `Button` on its **default** variant, whose plain `bg-*`,
 * `text-*`, `hover:bg-*` and transparent border the brand classes replace one for one. Not
 * `outline`: its `dark:bg-transparent` and `hover:text-foreground` survive the merge (they carry
 * other modifiers), so in dark mode the fill would vanish and Google's dark label would sit on a
 * dark page.
 */
function ProviderButton({
  label,
  logo,
  pending,
  disabled,
  onClick,
  className,
}: {
  label: string;
  logo: ReactNode;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <Button
      size="lg"
      disabled={disabled}
      onClick={onClick}
      className={cn("w-full gap-3", className)}
    >
      {logo}
      {pending ? "Menghubungkan…" : label}
    </Button>
  );
}

/** Microsoft's four squares. Decorative: the label is the button's name. */
function MicrosoftLogo() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 21 21"
      className="size-5 shrink-0"
    >
      <rect
        x="1"
        y="1"
        width="9"
        height="9"
        fill="#F25022"
      />
      <rect
        x="11"
        y="1"
        width="9"
        height="9"
        fill="#7FBA00"
      />
      <rect
        x="1"
        y="11"
        width="9"
        height="9"
        fill="#00A4EF"
      />
      <rect
        x="11"
        y="11"
        width="9"
        height="9"
        fill="#FFB900"
      />
    </svg>
  );
}

/** Google's multicolour "G". Decorative: the label is the button's name. */
function GoogleLogo() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 48 48"
      className="size-5 shrink-0"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
