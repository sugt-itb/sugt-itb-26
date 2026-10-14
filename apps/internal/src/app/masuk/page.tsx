import { getPerson } from "-/lib/person";
import { DESTINATION_PARAM, safeDestination } from "-/lib/sign-in-destination";
import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { GoogleSignInButton } from "./google-sign-in-button";

export const metadata: Metadata = { title: "Masuk" };

/** What every rejected visitor reads. DITSAMA's copy, not a placeholder. */
const REJECTION =
  "Akun ini tidak terdaftar. Coba akun lain, atau hubungi tim DITSAMA untuk mendapat akses.";

/**
 * The sign-in screen, and the one page that genuinely branches on "signed in or not"
 * — which is why it calls `getPerson()` rather than `requirePerson()`.
 *
 * **It renders one message for every value of `?error`.** It does not map codes to
 * messages and it does not echo the parameter. That is what makes "an uninvited
 * stranger and a revoked Person see exactly the same thing" true by construction
 * rather than by two strings happening to match, and it is why it does not matter that
 * the two rejections are thrown from different hooks. Telling somebody they were
 * specifically removed is a conversation for a human; keeping the cases
 * indistinguishable is also the right property against a stranger probing the form for
 * who is on the roster.
 *
 * **`?next` is the page the visitor was sent here from (#502)**, and it is read only through
 * `safeDestination`: anything that is not a path on this app reads as no destination at all.
 * A rejected visitor's page ignores it, so the rejection screen never carries the destination —
 * Better Auth's `errorCallbackURL` is a bare `/masuk`, so a real rejection has none to carry.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; [DESTINATION_PARAM]?: string | string[] }>;
}) {
  const params = await searchParams;
  const rejected = "error" in params;
  const destination = rejected ? null : safeDestination(params[DESTINATION_PARAM]);

  // Role-aware landing (#265): a Staff Person's home is the Pendamping; everyone else — the read-only
  // Pimpinan — lands on the Dashboard at `/`, which is open to them. `/pendamping` itself bounces a
  // non-Staff caller back to `/`, so the OAuth `callbackURL` can point everyone at `/pendamping` and let
  // that guard sort them; here we already hold the Person, so we route them directly. A destination
  // wins over both, and its own page decides whether they may read it — a path that names no route
  // is that page's 404, which is why the cast to `Route` claims nothing more than "a path here".
  const existing = await getPerson();
  if (existing) {
    redirect((destination as Route | null) ?? (existing.role === "Staff" ? "/pendamping" : "/"));
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-semibold">Masuk</h1>
          <p className="text-sm text-muted-foreground">
            Alat internal Program Sekolah Unggul Garuda Transformasi.
          </p>
        </div>

        {rejected && (
          <p
            role="alert"
            className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
          >
            {REJECTION}
          </p>
        )}

        <GoogleSignInButton destination={destination} />

        <p className="text-xs text-muted-foreground">
          Gunakan akun Google yang terdaftar. Tim DITSAMA memakai akun Google apa pun yang sudah
          terdaftar.
        </p>
      </div>
    </main>
  );
}
