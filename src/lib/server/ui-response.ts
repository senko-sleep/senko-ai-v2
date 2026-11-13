import { complete, type LlmMessage, type LlmOptions } from "@/lib/llm";
import { InferenceRequestBudget } from "@/lib/llm/request-budget";
import { compileGeneratedUI, UI_GENERATION_CONTRACT, UI_NODE_TYPES } from "@/lib/ui-generation";
import type { EntityDossier } from "./entity-dossier";
import { composeProfile } from "./profile-compose";
import { applyImageRefs, dossierUI, fillFromDossier, guardFacts, tidyUI, resolveImages, sourcesNode, type EnrichStats } from "./ui-enrich";
import { geocodeMapMarkers } from "./geocode";
import { parseAgentObject } from "@/lib/agent/action-protocol";

type Obj = Record<string, unknown>;

const RAW_UI_BLOCK = /```(?:ui|senko-ui|json-ui|json)\s*\n([\s\S]*?)```/gi;

/**
 * Map markers in model output often have names and addresses but no (or guessed) coordinates.
 * Look them up before schema validation, which drops markers without coordinates.
 */
export async function geocodeUIText(text: string, signal?: AbortSignal): Promise<string> {
  if (!/"(?:map|geo_map|location_map|locations|places)"/.test(text)) return text;
  const blocks = [...text.matchAll(RAW_UI_BLOCK)];
  const targets = blocks.length ? blocks.map((b) => ({ whole: b[0], body: b[1], fenced: true })) : [{ whole: text, body: text, fenced: false }];
  let out = text;
  for (const t of targets) {
    const root = parseAgentObject(t.body);
    if (!root) continue;
    const fixed = await geocodeMapMarkers(root, signal).catch(() => 0);
    if (!fixed) continue;
    const json = JSON.stringify(root);
    out = t.fenced ? out.replace(t.whole, "```ui\n" + json + "\n```") : json;
  }
  return out;
}

function attachSources(nodes: Obj[], dossier: EntityDossier) {
  const footer = sourcesNode(dossier);
  // A composed profile shows its sources in its own footer.
  const json = JSON.stringify(nodes);
  if (!footer || json.includes("[[cite:") || /"type":"profile"[^]*?"sources":\[\{/.test(json)) return;
  const root = nodes[nodes.length - 1];
  if (root && (root.type === "stack") && Array.isArray(root.children)) root.children.push(footer);
  else nodes.push(footer);
}

/** Research checks, page composition and verified images — shared by every path that shows UI. */
async function finishUI(nodes: Obj[], opts: {
  dossier?: EntityDossier | null; guard?: boolean | "facts"; sources?: boolean; signal?: AbortSignal;
  /** Time allowed for verifying images (unverified ones are left for the browser to find). */
  imageBudgetMs?: number;
  storeImage?: (data: Buffer) => Promise<string>;
  onEnrich?: (phase: "images" | "done", stats: EnrichStats) => void;
}, stats: EnrichStats) {
  if (opts.dossier) {
    if (opts.guard !== false) guardFacts(nodes, opts.dossier, stats, { prose: opts.guard !== "facts" });
    fillFromDossier(nodes, opts.dossier);
    composeProfile(nodes, opts.dossier);
    if (opts.sources !== false) attachSources(nodes, opts.dossier);
  }
  tidyUI(nodes);
  if (opts.storeImage) {
    opts.onEnrich?.("images", stats);
    await resolveImages(nodes, { dossier: opts.dossier, store: opts.storeImage, signal: opts.signal, budgetMs: opts.imageBudgetMs }, stats);
  }
  opts.onEnrich?.("done", stats);
}

const UI_BLOCK = /```(?:ui|senko-ui|json-ui)\s*\n([\s\S]*?)\n?```/g;

/**
 * A normal chat reply may include UI cards the chat model drew on its own ("who is X").
 * Give them the same treatment as requested UIs: research the profile's subject, check
 * facts, fill depth, and replace guessed image searches with verified, stored images.
 * Prose around the cards is kept as written.
 */
export async function enrichInlineUI(text: string, opts: {
  storeImage?: (data: Buffer) => Promise<string>;
  signal?: AbortSignal;
  research?: (name: string) => Promise<EntityDossier | null>;
  /** Research already done for this reply (e.g. the subject of an opinion question). */
  dossier?: EntityDossier | null;
  /** "facts": check facts but keep opinion prose as written. */
  guard?: boolean | "facts";
  /** Time allowed for verifying images; the rest are left for the browser to find. */
  imageBudgetMs?: number;
  onEnrich?: (phase: "images" | "done", stats: EnrichStats) => void;
}): Promise<{ text: string; stats: EnrichStats; dossier: EntityDossier | null }> {
  const stats: EnrichStats = { images: 0, droppedImages: 0, droppedFacts: [], inventedUrls: 0 };
  const blocks = [...text.matchAll(UI_BLOCK)];
  if (!blocks.length) return { text, stats, dossier: null };
  const name = /"type"\s*:\s*"(?:profile|entity_profile|character_profile|person_profile|infobox)"[^]*?"name"\s*:\s*"([^"]{2,80})"/.exec(text)?.[1];
  const dossier = opts.dossier ?? (name && opts.research ? await opts.research(name).catch(() => null) : null);
  // Every card is checked at the same time (a map's geocoding and a gallery's images don't wait on each other).
  const done = await Promise.all(blocks.map(async (block, i) => {
    const body = await geocodeUIText("```ui\n" + block[1] + "\n```", opts.signal);
    const compiled = compileGeneratedUI(body, (root) => applyImageRefs(root, dossier, stats));
    if (!compiled.ok) return null; // Leave anything we can't parse exactly as the model wrote it.
    const nodes = compiled.nodes as unknown as Obj[];
    // One sources footer per reply, under the last card.
    await finishUI(nodes, { dossier, guard: opts.guard, sources: i === blocks.length - 1, storeImage: opts.storeImage, signal: opts.signal, onEnrich: opts.onEnrich, imageBudgetMs: opts.imageBudgetMs }, stats);
    return { whole: block[0], replacement: nodes.map((node) => "```ui\n" + JSON.stringify(node) + "\n```").join("\n\n") };
  }));
  let out = text;
  for (const d of done) if (d) out = out.replace(d.whole, d.replacement);
  return { text: out, stats, dossier };
}

export async function generateComposedUI(messages: LlmMessage[], opts: {
  provider?: string; signal?: AbortSignal; simulateFail?: string[];
  onPhase?: (repair: boolean, issues?: string[]) => void;
  /** Labelled deterministic adapters only in tests; live callers use real inference. */
  modelCall?: (messages: LlmMessage[], options: LlmOptions) => ReturnType<typeof complete>;
  /** Live research for the subject; facts and images are checked against it. */
  dossier?: EntityDossier | null;
  /** Saves verified image bytes and returns their app URL. Without it images are left to the browser. */
  storeImage?: (data: Buffer) => Promise<string>;
  onEnrich?: (phase: "images" | "done", stats: EnrichStats) => void;
  onThought?: (text: string) => void;
  thinking?: "off" | "low" | "medium" | "high";
}) {
  // Increase budget from 4 → 12 so weak models with provider fallbacks don't exhaust before repair.
  const requestBudget = new InferenceRequestBudget(12);
  const generate = opts.modelCall || complete;
  const context = messages.map((message, index) =>
    index === 0 ? { ...message, content: message.content + "\n\n" + UI_GENERATION_CONTRACT } : message,
  );
  const options: LlmOptions = {
    provider: opts.provider,
    signal: opts.signal,
    simulateFail: opts.simulateFail,
    json: true,
    requestBudget,
    maxTokens: 8000,
    maxWaitMs: 30_000,
    // Fastest working model, with a backup if it stalls. (Pinning "pro" models made every UI
    // wait on rate-limited ones; flash models write valid UI JSON, and the repair pass below
    // catches the rest.)
    eager: true,
    onThought: opts.onThought,
    thinking: opts.thinking,
  };

  const stats: EnrichStats = { images: 0, droppedImages: 0, droppedFacts: [], inventedUrls: 0 };
  const compile = (text: string) => compileGeneratedUI(text, (root) => applyImageRefs(root, opts.dossier, stats));
  opts.onPhase?.(false);
  let response: Awaited<ReturnType<typeof complete>> | null = null;
  let compiled: ReturnType<typeof compileGeneratedUI> = { ok: false, content: "", nodes: [], issues: ["No model response."] };
  let repaired = false;
  try {
    response = await generate(context, options);
    compiled = compile(await geocodeUIText(response.text, opts.signal));
  } catch (error) {
    if (opts.signal?.aborted || !opts.dossier) throw error;
    compiled.issues = [error instanceof Error ? error.message : String(error)];
  }

  // Up to 2 repair attempts (was 1). Each attempt uses a progressively simpler prompt.
  for (let attempt = 0; response && !compiled.ok && attempt < 2 && requestBudget.remaining >= 2; attempt++) {
    repaired = true;
    opts.onPhase?.(true, compiled.issues);

    const repairPrompt = `The renderer rejected the response: ${compiled.issues.join(" ")}. ` +
      `Output ONLY the corrected JSON object (no prose, no markdown fences, no explanation). ` +
      `Supported types: ${[...UI_NODE_TYPES].join(", ")}. ` +
      (attempt === 0 ? "Preserve all content, imagery and order." : "Use fewer sections if needed, but keep every fact and every imageRef.");
    try {
      response = await generate(
        [...context, { role: "assistant", content: response!.text }, { role: "user", content: repairPrompt }],
        { ...options, maxWaitMs: 20_000 },
      );
      compiled = compile(await geocodeUIText(response.text, opts.signal));
    } catch (error) {
      if (opts.signal?.aborted || !opts.dossier) throw error;
      break;
    }
  }

  // Every model failed: lay out the research itself rather than an empty card.
  let fromResearch = false;
  if (!compiled.ok && opts.dossier) {
    compiled = compileGeneratedUI(JSON.stringify(dossierUI(opts.dossier)));
    fromResearch = compiled.ok;
  }
  if (!compiled.ok) throw new Error(`The interactive UI failed schema validation after repair: ${compiled.issues.join(" ")}`);

  const nodes = compiled.nodes as unknown as Obj[];
  await finishUI(nodes, { ...opts, guard: !fromResearch }, stats);
  const text = nodes.map((node) => "```ui\n" + JSON.stringify(node) + "\n```").join("\n\n");
  return {
    text,
    provider: response?.provider ?? "research",
    providerLabel: response?.providerLabel ?? "Research layout",
    model: response?.model ?? "dossier",
    nodeCount: nodes.length,
    repaired,
    fromResearch,
    stats,
    inferenceRequests: requestBudget.attempts.length,
  };
}
