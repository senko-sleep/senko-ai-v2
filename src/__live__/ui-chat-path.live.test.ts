// Real chat path for "who is X ... make the ui": research → model → fact guard → verified,
// stored images. Renders the saved reply through the real message renderer for screenshots.
import { it, expect } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import fs from "node:fs";
import { ensureDevice } from "@/lib/server/identity";
import { createChat } from "@/lib/server/chats";
import { reply } from "@/lib/server/reply";
import { accessKey, signDevice, AUTH_COOKIE, DEVICE_COOKIE } from "@/lib/auth-token";

it("who is X ... make the ui produces a researched UI with real images", async () => {
  const prompt = process.env.UI_PROMPT || "who is anya forger look it up as well and make the ui";
  const deviceId = `dev_uitest_${Date.now()}`;
  const { ownerId } = await ensureDevice(deviceId);
  const chat = await createChat(ownerId, "UI test");
  const steps: string[] = [];
  const msg = await reply({ ownerId, chatId: (chat as { id: string }).id, content: prompt, onMiniAgentStep: (s) => steps.push(`${s.status} ${s.label}${s.detail ? ` — ${s.detail}` : ""}`) });
  console.log(steps.join("\n"));
  expect(msg.meta.error).toBeUndefined();
  const urls = [...msg.content.matchAll(/"imageUrl":"([^"]+)"/g)].map((m) => m[1]);
  // Every picture is one the app downloaded, verified and stored itself.
  expect(urls.length).toBeGreaterThan(3);
  for (const u of urls) expect(u).toMatch(/^\/api\/uploads\/i_/);
  // Sources show either as citation pills or in the profile footer.
  expect(msg.content).toMatch(/\[\[cite:|"sources":\[\{/);
  const pub = "public/test-fixtures/ui-generation";
  fs.writeFileSync(`${pub}/chat-path.json`, JSON.stringify({ scope: prompt, content: msg.content }));
  // Cookie for the screenshot browser so it can load this owner's stored images.
  fs.mkdirSync("scratch", { recursive: true });
  fs.writeFileSync("scratch/ui-cookie.json", JSON.stringify(accessKey() ? { name: AUTH_COOKIE, value: await signDevice(deviceId) } : { name: DEVICE_COOKIE, value: deviceId }));
}, 300_000);
