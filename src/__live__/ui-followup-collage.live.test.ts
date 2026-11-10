// "who is anya forger us ui" then "i want images of her as a collage now":
// the follow-up must become a collage of Anya, not a search for the word "collage".
import { it, expect } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import fs from "node:fs";
import { ensureDevice } from "@/lib/server/identity";
import { createChat } from "@/lib/server/chats";
import { reply } from "@/lib/server/reply";
import { q1, toBuffer } from "@/lib/server/db";

it("pronoun follow-up builds a collage of the earlier subject", async () => {
  const { ownerId } = await ensureDevice(`dev_followup_${Date.now()}`);
  const chat = await createChat(ownerId, "Follow-up test");
  await reply({ ownerId, chatId: chat.id, content: "who is anya forger us ui" });
  const steps: string[] = [];
  const msg = await reply({ ownerId, chatId: chat.id, content: "i want images of her as a collage now", onMiniAgentStep: (s) => steps.push(`${s.status} ${s.label}`) });
  console.log(steps.join("\n"));
  const block = /```ui\n([\s\S]*?)\n```/.exec(msg.content);
  expect(block, msg.content.slice(0, 300)).toBeTruthy();
  const gallery = JSON.parse(block![1]);
  console.log("title:", gallery.title, "items:", gallery.items.length, gallery.items.map((i: { title: string }) => i.title).slice(0, 12));
  expect(gallery.type).toBe("gallery");
  expect(gallery.title).toBe("Anya Forger");
  expect(gallery.items.length).toBeGreaterThanOrEqual(6);
  // Save a few of the stored images so they can be inspected.
  fs.mkdirSync("scratch/followup", { recursive: true });
  for (const [i, item] of gallery.items.slice(0, 6).entries()) {
    const row = await q1<{ data: unknown }>("SELECT data FROM images WHERE id = $1", [item.imageUrl.split("/").pop()]);
    if (row) fs.writeFileSync(`scratch/followup/${i}.webp`, toBuffer(row.data));
  }
}, 400_000);
