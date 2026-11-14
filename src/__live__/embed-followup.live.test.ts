// The real pipeline (real search engines, real site probes) on the conversation where
// follow-ups used to lose the embed action:
//   1. "send me an embedded anime website"   -> an embed card
//   2. "now a random hentai website"         -> another embed card (not a search card, never Wikipedia)
//   3. "no i want a manga website embedded so i can read, pick one" -> an embed card for a manga site
// Needs SafeSearch off for the device (the default).
import { it, expect } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { ensureDevice } from "@/lib/server/identity";
import { createChat } from "@/lib/server/chats";
import { reply } from "@/lib/server/reply";

it("follow-ups keep the embed action and pick real sites", async () => {
  const { ownerId } = await ensureDevice(`dev_embedfollow_${Date.now()}`);
  const chat = await createChat(ownerId, "Embed follow-up test");
  const turns = [
    "send me an embedded anime website",
    "now a random hentai website",
    "no i want a manga website embedded so i can read, pick one",
  ];
  const hosts: string[] = [];
  for (const content of turns) {
    const steps: string[] = [];
    const t = Date.now();
    const msg = await reply({ ownerId, chatId: chat.id, content, onMiniAgentStep: (s) => steps.push(`${s.status} ${s.label}${s.detail ? ` (${s.detail})` : ""}`) });
    console.log(`\n> ${content}  [${Date.now() - t}ms]\n${steps.join("\n")}\n< ${msg.content}\n  embed: ${JSON.stringify(msg.meta.embed)}`);
    expect(msg.meta.search, "follow-up became a search card").toBeUndefined();
    expect(msg.meta.embed, msg.content).toBeTruthy();
    expect(msg.meta.embed!.host).not.toMatch(/wikipedia|reddit|fandom/);
    hosts.push(msg.meta.embed!.host);
  }
  // "random" after an embed doesn't repeat the site already shown.
  expect(new Set(hosts).size).toBe(hosts.length);
}, 300_000);
