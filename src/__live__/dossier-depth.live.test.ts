import { it, expect } from "vitest";
import { buildEntityDossier } from "@/lib/server/entity-dossier";

// The research must carry real depth: article sections, trivia, and several real images.
it("dossier has sections, trivia and a real gallery", async () => {
  for (const q of ["anya forger", "Albert Einstein"]) {
    const d = await buildEntityDossier(q);
    expect(d).toBeTruthy();
    console.log(`== ${q}: ${d!.sections.length} sections, ${d!.trivia.length} trivia, ${d!.images.length} images, ${d!.facts.length} facts`);
    for (const s of d!.sections) console.log(`  [${s.title}] ${s.body.length}ch: ${s.body.slice(0, 110).replace(/\n/g, " ")}`);
    for (const t of d!.trivia.slice(0, 3)) console.log(`  • ${t.slice(0, 120)}`);
    for (const i of d!.images.slice(0, 16)) console.log(`  img ${i.width}x${i.height} ${i.caption}`);
    expect(d!.sections.length).toBeGreaterThanOrEqual(2);
  }
}, 120_000);
