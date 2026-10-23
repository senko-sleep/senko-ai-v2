// Hosts that can't run a browser forward agent calls at runtime: AGENT_BACKEND_URL or
// AGENT_HOST=sandbox, both handled in src/proxy.ts.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  // Prisma Compute deploys the standalone server; the deploy workflow sets this.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1" ? { output: "standalone" } : {}),
  // Playwright ships native binaries; load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["playwright", "playwright-core", "pg", "@electric-sql/pglite", "@vercel/sandbox"],
  turbopack: {
    rules: {
      "*.txt": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.txt$/,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;
