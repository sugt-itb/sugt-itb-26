import { defineConfig } from "vitest/config";

/**
 * The tests run against a **real Postgres**, local to the developer and to CI, and
 * never against either Supabase project. What they prove is about a cross-schema
 * foreign key, a partial unique index and how a library behaves against real DDL;
 * none of that survives a mock.
 *
 * Point `TEST_DATABASE_URL` somewhere else if `sugt_test` on the default local
 * cluster is not what you want. **The database it names is dropped and rebuilt on
 * every run**, which is why the tests read their own variable and never `DATABASE_URL`
 * — pointing them at the development database by forgetting to set one is a mistake
 * worth making impossible.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/sugt_test";

// The global setup runs in this process and reads it back.
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  // The same `-/*` alias `tsconfig.json` declares. Vite does not read tsconfig paths.
  resolve: { alias: { "-/": new URL("./src/", import.meta.url).pathname } },
  test: {
    globalSetup: ["./tests/support/migrate-from-empty.ts"],
    /**
     * One worker. Every test file shares one Postgres database and each one truncates
     * it, so two files running at once would delete each other's fixtures.
     */
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      /**
       * Values, not secrets. The Google ones are never sent anywhere: the tests stub
       * Google's token endpoint at the network boundary, which is the only service they
       * fake over the network. The other seams are stubbed as modules, each because no test can
       * reach what is behind it: a static render of a client component stubs `next/navigation`'s
       * router, which needs a mounted app router; the Server Actions' tests stub the signed-in
       * session (`-/lib/person`), `next/cache`, and `next/headers` (cookies, the request's
       * `Origin`); and Google Drive itself is the in-memory `FakeDrive` swapped in for
       * `openDrive`. The database behind all of them stays real.
       */
      BETTER_AUTH_SECRET: "test-secret-not-used-outside-vitest",
      BETTER_AUTH_URL: "http://localhost:3001",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      /**
       * The aggregates routes build public photo URLs from `SUPABASE_URL` and check the bearer
       * against `AGGREGATES_SECRET`; the revalidation call posts to `PUBLIC_APP_URL` with
       * `REVALIDATE_SECRET`. Values, not secrets — the fetch to `PUBLIC_APP_URL` is stubbed at the
       * network boundary the same way Google's token endpoint is.
       */
      SUPABASE_URL: "https://test-project.supabase.co",
      AGGREGATES_SECRET: "test-aggregates-secret",
      REVALIDATE_SECRET: "test-revalidate-secret",
      PUBLIC_APP_URL: "http://localhost:3000",
      /**
       * The company Google Drive connection (#372). Values, not secrets: Google's token endpoint is
       * stubbed at the network boundary and Drive itself is the in-memory `fake-drive.ts`.
       * `DRIVE_TOKEN_KEY` is 32 bytes of zeros, base64 — real AES-256-GCM, a throwaway key.
       */
      GOOGLE_DRIVE_CLIENT_ID: "test-drive-client-id",
      GOOGLE_DRIVE_CLIENT_SECRET: "test-drive-client-secret",
      GOOGLE_DRIVE_ACCOUNT_EMAIL: "bukti@perusahaan.test",
      DRIVE_TOKEN_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      /**
       * The Unified Dashboard's JWT (#503). Values, not secrets: the suite signs its own tokens with
       * this throwaway key and verifies them through the real `authorizeUnifiedDashboard`.
       */
      UNIFIED_DASHBOARD_JWT_SECRET: "test-unified-dashboard-secret-at-least-32-bytes",
      UNIFIED_DASHBOARD_JWT_ISSUER: "unified-dashboard",
      UNIFIED_DASHBOARD_JWT_AUDIENCE: "sugt-internal",
    },
  },
});
