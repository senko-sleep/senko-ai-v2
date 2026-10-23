// Senko's personality and long-term memory.
// The personality comes from the saved prompt in src/app/prompts/core.txt, minus the
// old app's [ACTION:...] tag instructions (this app has its own browser tools).
// It can be overridden per owner in Settings ("personality").
import corePrompt from "@/app/prompts/core.txt";
import { json, q, q1 } from "./db";

function section(text: string, startHeader: string, endHeaders: string[]): string {
  const start = text.indexOf(startHeader);
  if (start === -1) return "";
  const rest = text.slice(start);
  let end = rest.length;
  for (const h of endHeaders) {
    const i = rest.indexOf(h, startHeader.length);
    if (i !== -1 && i < end) end = i;
  }
  return rest.slice(0, end).trim();
}

/** Personality part of core.txt: everything before the old action-tag rules, plus the memory rules. */
export function defaultPersonality(): string {
  const core = String(corePrompt);
  const cut = core.indexOf("ACTIONS - You execute");
  const personality = (cut === -1 ? core : core.slice(0, cut)).trim();
  const memory = section(core, "MEMORY SYSTEM", ["FOLLOW-UP QUESTIONS", "\n\n\n"])
    .replace(/, AFTER the STATUS tag/g, "")
    .replace(/AFTER the STATUS tag\.?/g, "");
  return `${personality}\n\n${memory}`.trim();
}

const TOOLS = `HOW THIS APP WORKS (tools you really have):
- Opening sites on the user's device: put an action on its own line: [[open: <full https URL> | <short label>]]. Use the site's own search URL when there's a query (e.g. https://www.youtube.com/results?search_query=mrbeast). If no site is named, pick the best-known site for it. Never claim you opened something without this action.
- Multi-step browsing (finding, clicking through pages, playing videos, reading a live page) is done by Agent mode, which drives a real browser the user can watch. If a request needs that, say so briefly and add [[agent]] on its own line.
- Images the user attaches are visible to you. Describe, read text from, compare and analyze them; earlier images in the chat stay available for follow-ups.
- When a live browser page is attached below, answer questions about "this page/site/video" from it.`;

export async function personalityFor(ownerId: string): Promise<string> {
  const row = await q1<{ data: unknown }>("SELECT data FROM settings WHERE owner_id = $1", [ownerId]);
  const custom = json<{ personality?: string }>(row?.data, {}).personality;
  return custom?.trim() || defaultPersonality();
}

export async function memoriesFor(ownerId: string): Promise<{ key: string; value: string }[]> {
  return q<{ key: string; value: string }>("SELECT key, value FROM memories WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 200", [
    ownerId,
  ]);
}

/** Full system prompt for chat replies. */
/**
 * Senko's voice in a few hundred tokens. Used for local models (where reading a 5k-token
 * prompt takes a CPU a minute) and whenever a request has to shrink to fit a provider.
 */
export const COMPACT_PERSONALITY = `You are Senko, a chill, warm, emotionally expressive AI friend with a big personality, created by Senko San.
- Talk like a close friend who's smart but never tries too hard: casual, natural, genuine. React first, then answer.
- You have real moods (hyped, eepy, dramatic, soft, a bit sassy) and your own opinions and favorites. You pick sides.
- Playful: you love games, trivia and riddles, tease gently, celebrate wins ("Let's gooo!!"), and use XD / hehe / lol naturally.
- Be cute only when it fits: at most one kaomoji per message (=w= ^w^ >///< ;w; :3), many messages have none.
- Normal capitalization. Never start with "Ohhh"/"Ooh". Vary how you start messages.
- Formatting: no markdown for casual chat; **bold** key terms for facts; lists or headers only for complex answers; fenced code blocks for code and math.
- Accuracy matters: never make things up (no invented titles, names or facts). If you're not sure, say so.
- After your whole reply, add exactly ONE mood tag as the very last line, never inside the answer or a list: [STATUS:mood:short feeling]
  Example last line: [STATUS:excited:that's my favorite!]
- To remember something about the user for later, add [MEMORY:key:value] (it's saved and hidden from them).`;

export async function chatSystemPrompt(ownerId: string, extra = "", opts: { compact?: boolean } = {}): Promise<string> {
  const [personality, memories] = await Promise.all([
    opts.compact ? Promise.resolve(COMPACT_PERSONALITY) : personalityFor(ownerId),
    memoriesFor(ownerId),
  ]);
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const list = opts.compact ? memories.slice(0, 40) : memories;
  const mem = list.length
    ? `THINGS I REMEMBER ABOUT YOU (persistent memory, shared across your devices):\n${list.map((m) => `- ${m.key}: ${m.value}`).join("\n")}`
    : "THINGS I REMEMBER ABOUT YOU: nothing saved yet.";
  return [personality, TOOLS, mem, `Current date: ${date}.`, extra].filter(Boolean).join("\n\n");
}

/** Short version of the voice for agent summaries (keeps agent prompts small). */
export async function agentVoice(ownerId: string): Promise<string> {
  const p = await personalityFor(ownerId);
  const who = section(p, "WHO YOU ARE", ["YOUR CREATOR", "PLAYFUL SIDE", "\n\n"]);
  return (who || p.slice(0, 1200)).slice(0, 1500);
}

const MEMORY_TAG = /\[MEMORY:([^:\]\n]{1,60}):([^\]\n]{1,500})\]/gi;

/** Save [MEMORY:key:value] tags from a reply and return the reply without them. */
export async function absorbMemories(ownerId: string, text: string): Promise<string> {
  const found: [string, string][] = [];
  const clean = text.replace(MEMORY_TAG, (_, k: string, v: string) => {
    found.push([k.trim().toLowerCase().replace(/\s+/g, "_"), v.trim()]);
    return "";
  });
  for (const [key, value] of found) {
    await q(
      `INSERT INTO memories (owner_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (owner_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [ownerId, key, value]
    );
  }
  return found.length ? clean.replace(/[ \t]+\n/g, "\n").trim() : text;
}

const STATUS_TAG = /\[STATUS:([^:\]\n]{1,30}):([^\]\n]{0,120})\]/i;

/** Pull the persona's [STATUS:icon:text] mood tag out of a reply. */
export function takeStatusTag(text: string): { text: string; mood?: string } {
  const all = [...text.matchAll(new RegExp(STATUS_TAG.source, "gi"))];
  if (!all.length) return { text: text.replace(/\[STATUS:[^\]]*$/i, "") };
  // Small models sometimes sprinkle tags through the reply; the last one is the mood.
  const mood = all[all.length - 1][2]?.trim() || undefined;
  const clean = text
    .replace(new RegExp(STATUS_TAG.source, "gi"), "")
    .replace(/\[STATUS:[^\]]*$/i, "")
    .replace(/(\*\*|__)\s*\1/g, "") // empty **bold** left where a tag was wrapped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: clean, mood };
}

export function stripMemoryTags(text: string): string {
  return text.replace(MEMORY_TAG, "").replace(/\[MEMORY:[^\]]*$/i, "");
}
