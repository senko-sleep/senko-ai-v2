// Hosts that can't run a browser forward agent calls at runtime: AGENT_BACKEND_URL or
// AGENT_HOST=sandbox, both handled in src/proxy.ts.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  devIndicators: false,
  // Lets a second dev server (e.g. for screenshot tests) run beside the main one.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Prisma Compute deploys the standalone server; the deploy workflow sets this.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1" ? { output: "standalone" } : {}),
  // Playwright and esbuild ship native binaries; load them from node_modules at runtime instead of bundling them.
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "esbuild",
    "jiti",
    "pg",
    "@electric-sql/pglite",
    "@vercel/sandbox",
  ],
  // Node.js runs in the browser (WebContainers) only on cross-origin-isolated pages. Just the
  // workspace route gets these headers: on the main app they would break YouTube embeds and
  // the live browser view.
  // Dev only: drop compiled pages that haven't been opened for a while, so a long dev
  // session doesn't keep every route in memory.
  onDemandEntries: { maxInactiveAge: 5 * 60_000, pagesBufferLength: 3 },
  async headers() {
    return [
      {
        source: "/code/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  experimental: {
    // Keep build/page workers within the memory budget of the local 8 GB machine.
    // Larger hosts can opt into additional workers without changing source.
    cpus: Math.max(1, Number.parseInt(process.env.NEXT_BUILD_CPUS || "2", 10) || 2),
    // Turbopack frees its in-memory cache past this target instead of growing until the
    // machine runs out (low-RAM dev PCs crashed with "Insufficient system resources").
    turbopackMemoryLimit: Number(process.env.TURBOPACK_MEMORY_LIMIT_MB || 1536) * 1024 * 1024,
    // Dev uses webpack: trade a little compile speed for a much smaller peak heap, and only
    // compile routes when they're first opened.
    webpackMemoryOptimizations: true,
    preloadEntriesOnStart: false,
  },
};

export default nextConfig;
