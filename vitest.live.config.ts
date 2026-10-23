import { defineConfig } from "vitest/config";
import path from "node:path";

// Live tests hit real AI providers and a real browser. Not part of `npm test`.
//   npm run test:e2e                      (everything except the 30-minute idle test)
//   TEST_IDS=agent-wikipedia,chat-simple npm run test:e2e
export default defineConfig({
  plugins: [
    {
      // Prompt files (e.g. src/app/prompts/core.txt) are imported as plain strings, like in Next.
      name: "raw-txt",
      transform(code, id) {
        if (id.endsWith(".txt")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/__live__/**/*.live.test.ts"],
    testTimeout: 45 * 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
