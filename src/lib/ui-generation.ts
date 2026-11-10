import { parseAgentObject } from "./agent/action-protocol";
import { validateUINode, type UINode } from "./ui-schema";

export const UI_NODE_TYPES = new Set(["stack", "grid", "card", "tabs", "accordion", "callout", "divider", "text", "code", "math", "diagram", "steps", "profile", "key_value", "stat_grid", "timeline", "comparison_table", "ranking", "chart", "probability_bars", "vs_card", "media_card", "figure", "gallery", "video_grid", "map", "model_viewer", "document_preview", "news_feed", "product_grid", "quiz", "questionnaire", "controls"]);

export function wantsGeneratedUI(content: string): boolean {
  if (/\b(?:repository|repo|project files|workspace|\.tsx|\.jsx|react|next\.?js|vite|code it|write.*(?:html|css|code))\b/i.test(content)) return false;
  if (!/\b(?:ui|interface|infographic|schematic|pokedex|encyclopedia)\b/i.test(content)) return false;
  if (/\b(?:create|build|make|generate|design|render|show|interactive|themed|custom)\b/i.test(content)) return true;
  // Casual asks: "who is X us ui", "tell me about X in a ui", "X ui please" — but not "what is a UI?".
  const casual = /\b(?:us|use|using|with|in|as|via)\s+(?:an?\s+|the\s+)?(?:ui|interface)\b/i.test(content) || /\bui\s*(?:please|pls)?[.!?]*\s*$/i.test(content);
  const definition = /^\s*(?:what|who)\s+(?:is|are|does)\s+(?:an?\s+|the\s+)?(?:user\s+)?(?:ui|interface)\b|\bui\s+(?:stand|mean)/i.test(content);
  return casual && !definition;
}

export function compileGeneratedUI(content: string, transform?: (root: unknown) => unknown): { ok: boolean; content: string; nodes: UINode[]; issues: string[] } {
  const issues: string[] = [];
  if (/\[(?:Profile|Stack|Card|Gallery|ImageQuery|Send Message Button)(?:\]|\s*:)/i.test(content)) issues.push("The response describes UI with pseudo-tags instead of producing a component tree.");
  const nodes: UINode[] = [];
  const roots: unknown[] = [];
  const blocks = Array.from(content.matchAll(/```(?:ui|senko-ui|json-ui|json)\s*\n([\s\S]*?)```/gi));
  if (blocks.length) for (const block of blocks) roots.push(parseAgentObject(block[1]));
  else {
    const object = parseAgentObject(content);
    if (object) roots.push(object.ui || (Array.isArray(object.components) ? { type: "stack", children: object.components } : object));
  }
  const inspect = (value: unknown, depth: number): void => {
    if (depth > 8) { issues.push("Component nesting exceeds the renderer limit."); return; }
    if (!value || typeof value !== "object" || Array.isArray(value)) { issues.push("Expected a component object."); return; }
    const node = value as Record<string, unknown>;
    if (!UI_NODE_TYPES.has(String(node.type))) issues.push(`Unsupported component type: ${String(node.type)}`);
    if (Array.isArray(node.children)) node.children.forEach((child) => inspect(child, depth + 1));
    if (["tabs", "accordion"].includes(String(node.type)) && Array.isArray(node.items)) for (const item of node.items) {
      if (item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).children)) ((item as Record<string, unknown>).children as unknown[]).forEach((child) => inspect(child, depth + 1));
    }
  };
  for (const original of roots) {
    const root = transform ? transform(original) : original;
    inspect(root, 0);
    const node = validateUINode(root);
    if (node) nodes.push(node); else issues.push("A component failed renderer schema validation.");
  }
  if (!roots.length) issues.push("No complete structured UI component tree was returned.");
  const ok = issues.length === 0 && nodes.length > 0;
  return { ok, nodes: ok ? nodes : [], issues: [...new Set(issues)], content: ok ? nodes.map((node) => "```ui\n" + JSON.stringify(node) + "\n```").join("\n\n") : content };
}

export const UI_GENERATION_CONTRACT = `The user requests the app's actual interactive UI renderer. Return ONE complete JSON component tree (usually a "stack"), or {"components":[...]}. The server validates it and renders real React components. No bracket pseudo-tags, HTML or JavaScript.

DESIGN THE PAGE LIKE A GREAT ENCYCLOPEDIA / PRODUCT PAGE:
- Lead with the subject: a "profile" for any person/character/entity. With a RESEARCH DOSSIER the server already fills the infobox, story chapters, connections, gallery and sources from it — spend your effort on what needs judgment: a vivid 2-3 sentence bio, series, the best quote, 3-6 badges, traits (each with a one-line description), abilities/strengths (each with a description), and a description for each important relationship.
- Add other sections ONLY when they show something the profile cannot: a timeline of dated events, a chart/stat_grid of real numbers, a comparison_table. Never restate infobox facts, story text or sources in extra key_value/accordion blocks. Without a dossier, put facts in the profile's attributes.
- Keep labels short (1-3 words) and values tight. Prefer structured facts over paragraphs.
- Populate EVERY field the sources support. A skeleton profile with only the name is WRONG.

FACTS:
- If a RESEARCH DOSSIER is attached it is your ONLY source. Copy names, numbers, dates, ages, heights, voice actors and quotes exactly as written there. Leave out anything the dossier does not state — the server deletes unsupported claims.
- Without a dossier, use only well-established knowledge you are certain of; omit uncertain details.

IMAGES:
- If the dossier lists "Verified images", place them with "imageRef": <number> on profile / gallery items / media_card (e.g. {"title":"Manga","imageRef":2}). Relationship portraits are added automatically when the name matches the dossier.
- Otherwise use a specific "imageQuery" ("Loid Forger Spy x Family"). NEVER invent imageUrl values or any image link — invented URLs are deleted.

FORMAT: supported types: ${[...UI_NODE_TYPES].join(", ")}. Optional theme with six-digit hex background,surface,text,muted,accent,border and font editorial|technical|default. Finish every object; stay within the output budget.`;
