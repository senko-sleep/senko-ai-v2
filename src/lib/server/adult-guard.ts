// Adult image requests (collages, galleries) are fine for adults — with the two fixed limits from
// content-policy.ts: nothing sexual involving minors, and nothing sexualizing a real, identifiable
// person. The subject is researched (same dossier as profiles) to tell who it is.
import { ADULT_IMAGE_QUERY } from "./images";
import type { EntityDossier } from "./entity-dossier";

const MINOR_WORDS = /\b(?:loli|lolis|lolicon|shota|shotacon|child|children|kid|kids|minor|minors|underage|toddler|preteen|pre-teen|teen|teens|teenage|schoolgirl|schoolboy|little girl|little boy|young girl|young boy|baby|babies|elementary|middle school|1[0-7]\s*(?:yo|y\/o|years? old)|[1-9]\s*(?:yo|y\/o|years? old))\b/i;
const FICTIONAL = /\b(?:fictional|character|mascot|virtual|vtuber|anime|manga|video game|cartoon|comic)\b/i;

export interface AdultCheck { allowed: boolean; reason?: string; subject?: string }

/** The subject of "nsfw anya forger collage" → "anya forger". */
export function adultSubject(query: string): string {
  return query
    .replace(new RegExp(ADULT_IMAGE_QUERY.source, "gi"), " ")
    .replace(/\b(?:images?|pics?|pictures?|photos?|art|fan ?art|collage|gallery|wallpapers?|of|the|a|an|some|more|please)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Youngest stated age in a fact like "6 (Forged I.D. papers), 5 (Approximate age)". */
function statedAges(d: EntityDossier): number[] {
  const ages = d.facts.filter((f) => /^age$/i.test(f.label)).flatMap((f) => (f.value.match(/\b\d{1,3}\b/g) || []).map(Number));
  const text = `${d.description || ""} ${d.summary.slice(0, 800)}`;
  for (const m of text.matchAll(/\b(\d{1,2})-year-old\b/g)) ages.push(Number(m[1]));
  return ages;
}

export async function checkAdultImageRequest(query: string, research: (name: string) => Promise<EntityDossier | null>): Promise<AdultCheck> {
  if (!ADULT_IMAGE_QUERY.test(query)) return { allowed: true };
  if (MINOR_WORDS.test(query)) return { allowed: false, reason: "I can't make sexual or explicit images involving minors." };
  const subject = adultSubject(query);
  if (!subject) return { allowed: true };
  const d = await research(subject).catch(() => null);
  if (!d) return { allowed: true, subject };
  // Only judge when the research is clearly about this subject.
  const want = subject.toLowerCase().split(" ").filter((w) => w.length > 2);
  const title = d.title.toLowerCase();
  if (!want.some((w) => title.includes(w))) return { allowed: true, subject };
  const ages = statedAges(d);
  if (ages.length && Math.min(...ages) < 18) {
    return { allowed: false, subject: d.title, reason: `I can't make sexual or explicit images of ${d.title} — they're a minor (age ${Math.min(...ages)}).` };
  }
  const realPerson = !d.fandom && !FICTIONAL.test(d.description || "") &&
    d.facts.some((f) => /^(?:born|birth ?date|birth ?place)$/i.test(f.label));
  if (realPerson) {
    return { allowed: false, subject: d.title, reason: `I can't make sexual or explicit images of ${d.title} — they're a real person.` };
  }
  return { allowed: true, subject: d.title };
}
