import { it } from "vitest";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
process.env.DATA_DIR = ":memory:";

it("speed per provider with the full personality prompt", async () => {
  const { openStream } = await import("@/lib/llm");
  const { chatSystemPrompt } = await import("@/lib/server/persona");
  const system = await chatSystemPrompt("o_speed");
  console.log(`system prompt: ${system.length} chars (~${Math.round(system.length / 4)} tokens)`);
  for (const provider of ["groq", "openrouter", "ollama"]) {
    for (const run of [1, 2]) {
      const t0 = Date.now();
      let first = 0, text = "";
      try {
        const s = await openStream([{ role: "system", content: system }, { role: "user", content: "hey whats up" }], { provider, maxTokens: 300 });
        for await (const c of s.stream) { if (!first) first = Date.now() - t0; text += c; }
        console.log(`${provider} run${run} via ${s.providerLabel}/${s.model}: first word ${first}ms, total ${Date.now() - t0}ms, ${text.length} chars`);
      } catch (e) { console.log(`${provider}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
    }
  }
}, 600_000);
