import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,
  experimental: {
    // TS7's native compiler doesn't expose the programmatic API Next uses for
    // type-checking (targeted for 7.1); shell out to the tsc CLI instead.
    useTypeScriptCli: true,
    // For more information about `typedEnv`, visit this:
    // https://nextjs.org/docs/app/api-reference/config/typescript#type-intellisense-for-environment-variables
    typedEnv: true,
    // `forbidden()` and its `forbidden.tsx` convention are still behind this flag in
    // 16.2.12 — the function checks it at runtime and throws a different error
    // entirely when it is off, so this is not optional decoration. It is what lets
    // `@sugt/db`'s Staff-only refusal render as a **403** rather than as a crash
    // page. See `src/lib/staff-surface.ts`.
    authInterrupts: true,
    // Belt-and-suspenders for the Milkdown editor stack (#271). It is already imported by
    // submodule (`@milkdown/kit/core`, …) and code-split off `/cerita/[id]`'s first load via
    // `next/dynamic` (#268), so the win here is near-zero — this only tree-shakes `@milkdown/react`'s
    // small barrel. Verified not to pull the stack back onto the route's first load: the ProseMirror
    // chunk stays lazy.
    optimizePackageImports: ["@milkdown/react", "@milkdown/kit"],
  },
};

export default nextConfig;
