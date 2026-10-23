// Serverless hosts (Vercel) can't run a real browser. Set AGENT_BACKEND_URL to a server
// that can (the Render/Docker deploy) and every browser-agent call is forwarded there.
// Both deploys must share the same DATABASE_URL (and APP_ACCESS_KEY, if used).
const agentBackend = (process.env.AGENT_BACKEND_URL || "").trim().replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  async rewrites() {
    if (!agentBackend) return [];
    return {
      beforeFiles: [
        { source: "/api/chats/:id/agent", destination: `${agentBackend}/api/chats/:id/agent` },
        { source: "/api/chats/:id/agent/:rest*", destination: `${agentBackend}/api/chats/:id/agent/:rest*` },
        { source: "/api/sessions/:path*", destination: `${agentBackend}/api/sessions/:path*` },
      ],
    };
  },
  // Playwright ships native binaries; load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["playwright", "playwright-core", "pg", "@electric-sql/pglite"],
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
