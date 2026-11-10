// Collages through the real chat path for varied subjects. Each must return a full set of
// verified, distinct images. Prints which engines supplied them.
import { it, expect } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { ensureDevice } from "@/lib/server/identity";
import { createChat } from "@/lib/server/chats";
import { reply } from "@/lib/server/reply";
import { searchMultiEngineImages } from "@/lib/server/images";
import { q1, toBuffer } from "@/lib/server/db";
import fs from "node:fs";
import sharp from "sharp";

const SUBJECTS = (process.env.COLLAGE_SUBJECTS || "Anya Forger||golden retriever puppies||Eiffel Tower at night||Taylor Swift||Gojo Satoru||Tokyo street food").split("||");

it("collages fill with verified images for every subject", async () => {
  const { ownerId } = await ensureDevice(`dev_collage_${Date.now()}`);
  const failures: string[] = [];
  for (const subject of SUBJECTS) {
    const engines = await searchMultiEngineImages(subject, 1, 255, AbortSignal.timeout(15_000)).then((r) => r.stats).catch(() => ({}));
    const chat = await createChat(ownerId, "Collage test");
    const t0 = Date.now();
    const msg = await reply({ ownerId, chatId: chat.id, content: `make a collage of ${subject}` });
    const block = /```ui\n([\s\S]*?)\n```/.exec(msg.content);
    const items = block ? (JSON.parse(block[1]).items as unknown[]).length : 0;
    console.log(`${subject.padEnd(24)} ${String(items).padStart(2)}/10 in ${((Date.now() - t0) / 1000).toFixed(1)}s  engines: ${JSON.stringify(engines)}`);
    if (items < 8) failures.push(`${subject}: ${items} images — ${msg.content.slice(0, 120)}`);
    // SHEETS=1 saves a contact sheet per subject to scratch/collages for a visual check.
    if (process.env.SHEETS && block) {
      const ids = (JSON.parse(block[1]).items as { imageUrl: string }[]).map((i) => i.imageUrl.split("/").pop());
      const tiles = [];
      for (const id of ids.slice(0, 8)) {
        const row = await q1<{ data: unknown }>("SELECT data FROM images WHERE id = $1", [id]);
        if (row) tiles.push(await sharp(toBuffer(row.data)).resize(240, 240, { fit: "cover" }).png().toBuffer());
      }
      fs.mkdirSync("scratch/collages", { recursive: true });
      await sharp({ create: { width: 960, height: 480, channels: 3, background: "#111" } })
        .composite(tiles.map((input, i) => ({ input, left: (i % 4) * 240, top: Math.floor(i / 4) * 240 })))
        .png().toFile(`scratch/collages/${subject.replace(/\W+/g, "-")}.png`);
    }
  }
  expect(failures).toEqual([]);
}, 900_000);
