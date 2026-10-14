/**
 * Read an environment variable, or fail with a sentence that names the likely cause.
 *
 * turbo runs with `envMode: strict`: a variable missing from the consuming task's
 * `env` in `turbo.json` is invisible to that task **even when it is set in the
 * shell**. That failure otherwise surfaces as `undefined` somewhere far from the
 * cause, which is why `DATABASE_URL` in `@sugt/db` already throws the same way.
 *
 * The variables this app reads — `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
 * `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, Cerita's `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY`, the aggregates' `AGGREGATES_SECRET`, the
 * revalidation call's `REVALIDATE_SECRET` and `PUBLIC_APP_URL`, `/kalender`'s
 * `JADWAL_SHEET_CSV_URL`, and the company Drive connection's
 * `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
 * `GOOGLE_DRIVE_ACCOUNT_EMAIL` and `DRIVE_TOKEN_KEY`, and the Unified Dashboard's
 * `UNIFIED_DASHBOARD_JWT_SECRET`, `UNIFIED_DASHBOARD_JWT_ISSUER` and
 * `UNIFIED_DASHBOARD_JWT_AUDIENCE` — are declared on `build`,
 * `typecheck` and `dev` for `@sugt/internal`. Adding another means editing `turbo.json` as well as `.env`.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Note turbo runs with envMode: strict — a variable ` +
        `missing from the consuming task's \`env\` in turbo.json is invisible here ` +
        `even when it is set in the shell.`,
    );
  }
  return value;
}
