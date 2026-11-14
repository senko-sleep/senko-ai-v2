import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    maxWorkers: 2,
    execArgv: ["--no-wasm-tier-up"],
    // Tests drive Chrome headless (on a Windows/Mac desktop the app opens a real window).
    env: { BROWSER_HEADLESS: "1" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
