import { it, expect } from "vitest";
import fs from "node:fs";
import { complete } from "@/lib/llm";
import { buildEntityDossier, dossierPrompt } from "@/lib/server/entity-dossier";
import { defaultPersonality } from "@/lib/server/persona";
import { DYNAMIC_UI_SYSTEM } from "@/lib/ui-prompt";
import { discussionSubject, subjectSearchQuery, visualAnswerNote } from "@/lib/server/visual-intent";
import { enrichInlineUI } from "@/lib/server/ui-response";

// "do you like chara from undertale" should come back as Senko's take in a visual layout.
it("opinion question gets an immersive layout", async () => {
  try { process.loadEnvFile(".env.local"); } catch { /* env from shell */ }
  const ask = process.env.VISUAL_ASK || "do you like chara from undertale";
  const subject = discussionSubject(ask)!;
  expect(subject).toBeTruthy();
  const dossier = await buildEntityDossier(subjectSearchQuery(subject));
  const system = [defaultPersonality(), DYNAMIC_UI_SYSTEM, visualAnswerNote(subject), dossier ? dossierPrompt(dossier) : ""].join("\n\n");
  const res = await complete([{ role: "system", content: system }, { role: "user", content: ask }], { maxTokens: 6000 });
  const enriched = await enrichInlineUI(res.text, { dossier, guard: "facts" });
  const text = enriched.text.replace(/\[STATUS:[^\]]*\]\s*$/, "").trim();
  console.log(`provider ${res.providerLabel} ${res.model}; dossier ${dossier?.title}; dropped ${enriched.stats.droppedFacts.length}`);
  console.log(text.slice(0, 4000));
  fs.writeFileSync("public/test-fixtures/ui-generation/visual-answer-live.json", JSON.stringify({ scope: `Live: "${ask}"`, content: text }));
  expect(text).toMatch(/```ui/);
}, 180_000);
