/** Accept common structured model envelopes; never evaluate text or guess a missing action. */
export function parseAgentObject(text: string): Record<string, unknown> | null {
  const decode = (source: string): unknown => { let value: unknown = JSON.parse(source); if (typeof value === "string") value = JSON.parse(value); return value; };
  const candidates = [text.trim(), ...Array.from(text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi), (match) => match[1].trim())];
  // Extract exactly one balanced object, respecting braces inside JSON strings.
  let start = -1, depth = 0, quoted = false, escaped = false;
  const objects: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") { if (!depth) start = i; depth++; }
    if (char === "}" && depth && --depth === 0) objects.push(text.slice(start, i + 1));
  }
  if (objects.length === 1) candidates.push(objects[0]);
  if (objects.length > 1) return null;
  for (const source of candidates) {
    try { const value = decode(source); if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; } catch { /* Try another complete representation, not guessed syntax repairs. */ }
  }
  return null;
}

export type BrowserAction =
  | { action: "search" | "image_search"; query: string; engine?: "google" | "bing" }
  | { action: "goto"; url: string }
  | { action: "click"; id?: number; x?: number; y?: number }
  | { action: "hover"; id: number }
  | { action: "type"; id?: number; text: string; submit?: boolean }
  | { action: "press"; key: string }
  | { action: "key_chord"; keys: string[] }
  | { action: "select_option"; id: number; value: string }
  | { action: "drag"; fromId?: number; toId?: number; fromX?: number; fromY?: number; toX?: number; toY?: number }
  | { action: "extract"; label: string; selector?: string; fields?: string[] }
  | { action: "scroll"; direction?: "up" | "down" }
  | { action: "back" | "dismiss" | "clear_stash" }
  | { action: "wait"; seconds?: number }
  | { action: "new_tab"; url?: string }
  | { action: "switch_tab" | "close_tab"; index: number }
  | { action: "media"; op: "play" | "pause" | "toggle" | "fullscreen" | "exit_fullscreen" | "mute" | "unmute" | "seek" | "skip"; seconds?: number }
  | { action: "desmos"; op: "set" | "add" | "clear"; expressions?: string[] }
  | { action: "screenshot"; label?: string }
  | { action: "fetch_image"; url: string; alt?: string }
  | { action: "send_images"; ids?: string[] }
  | { action: "send_video"; index?: number }
  | { action: "make_collage"; ids?: string[]; label?: string }
  | { action: "examine_images"; description: string; click?: boolean }
  | { action: "done"; answer: string; url?: string };
export type BrowserDecision = BrowserAction & { thought?: string; check?: { ok?: boolean; note?: string }; requirements?: unknown };

export function parseBrowserDecision(text: string): BrowserDecision | null {
  let raw = parseAgentObject(text);
  if (!raw) return null;
  if (Array.isArray(raw.tool_calls)) {
    if (raw.tool_calls.length !== 1) return null;
    raw = raw.tool_calls[0]?.function;
  }
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.actions)) { if (raw.actions.length !== 1) return null; raw = raw.actions[0]; }
  if (!raw || typeof raw !== "object") return null;
  if (raw.action && typeof raw.action === "object" && !Array.isArray(raw.action)) { const inner = raw.action as Record<string, unknown>; raw = { ...raw, ...inner, action: inner.action || inner.type }; }
  if (!raw) return null;
  if (!raw.action && typeof (raw.tool || raw.name) === "string") {
    const args = typeof raw.arguments === "string" ? parseAgentObject(raw.arguments) : raw.arguments || raw.parameters || {};
    if (!args || typeof args !== "object" || Array.isArray(args)) return null;
    raw = { ...(args as object), action: raw.tool || raw.name };
  }
  const aliases: Record<string, string> = { navigate: "goto", click_element: "click", input_text: "type", press_key: "press" };
  const action = aliases[String(raw.action)] || raw.action;
  raw = { ...raw, action };
  if (raw.id === undefined && raw.elementId !== undefined) raw.id = raw.elementId;
  for (const key of ["id", "index", "fromId", "toId", "x", "y", "fromX", "fromY", "toX", "toY", "seconds"]) {
    if (typeof raw[key] === "string" && /^-?\d+(\.\d+)?$/.test(raw[key] as string)) raw[key] = Number(raw[key]);
  }
  const str = (key: string) => typeof raw![key] === "string" && (raw![key] as string).trim().length > 0 && (raw![key] as string).length <= 32_000;
  const number = (key: string) => typeof raw![key] === "number" && Number.isFinite(raw![key]);
  const id = (key = "id") => number(key) && Number.isInteger(raw![key]) && Number(raw![key]) > 0;
  const optional = (key: string, valid: () => boolean) => raw![key] === undefined || valid();
  const strings = (key: string) => Array.isArray(raw![key]) && (raw![key] as unknown[]).length <= 50 && (raw![key] as unknown[]).every((value) => typeof value === "string" && value.length <= 4096);
  let valid = false;
  switch (action) {
    case "search": case "image_search": valid = str("query") && optional("engine", () => ["google", "bing"].includes(String(raw!.engine))); break;
    case "goto": case "fetch_image": valid = str("url"); break;
    case "click": valid = optional("id", () => id()) && (id() || (number("x") && number("y") && Number(raw.x) >= 0 && Number(raw.y) >= 0)); break;
    case "hover": valid = id(); break;
    case "type": valid = typeof raw.text === "string" && raw.text.length <= 32_000 && optional("id", () => id()) && optional("submit", () => typeof raw!.submit === "boolean"); break;
    case "press": valid = str("key"); break;
    case "key_chord": valid = strings("keys") && (raw.keys as unknown[]).length > 0; break;
    case "select_option": valid = id() && str("value"); break;
    case "drag": valid = (id("fromId") && id("toId")) || ["fromX", "fromY", "toX", "toY"].every(number); break;
    case "extract": valid = str("label") && optional("selector", () => str("selector")) && optional("fields", () => strings("fields")); break;
    case "scroll": valid = optional("direction", () => ["up", "down"].includes(String(raw!.direction))); break;
    case "wait": valid = optional("seconds", () => number("seconds") && Number(raw!.seconds) >= 0 && Number(raw!.seconds) <= 60); break;
    case "new_tab": valid = optional("url", () => str("url")); break;
    case "switch_tab": case "close_tab": valid = id("index"); break;
    case "media": valid = ["play", "pause", "toggle", "fullscreen", "exit_fullscreen", "mute", "unmute", "seek", "skip"].includes(String(raw.op)) && optional("seconds", () => number("seconds")); break;
    case "desmos": valid = ["set", "add", "clear"].includes(String(raw.op)) && optional("expressions", () => strings("expressions")); break;
    case "screenshot": valid = optional("label", () => str("label")); break;
    case "send_images": case "make_collage": valid = optional("ids", () => strings("ids")); break;
    case "send_video": valid = optional("index", () => id("index")); break;
    case "examine_images": valid = str("description") && optional("click", () => typeof raw!.click === "boolean"); break;
    case "done": valid = str("answer"); break;
    case "back": case "dismiss": case "clear_stash": valid = true; break;
  }
  return valid ? raw as BrowserDecision : null;
}

export class BrowserFormatRecovery {
  readonly excludedModels: string[] = [];
  private failures = new Map<string, number>();
  reject(model: string): { switchModel: boolean; exhausted: boolean } {
    const count = (this.failures.get(model) || 0) + 1; this.failures.set(model, count);
    if (count >= 2 && !this.excludedModels.includes(model)) this.excludedModels.push(model);
    return { switchModel: count === 2, exhausted: [...this.failures.values()].reduce((a, b) => a + b, 0) >= 6 };
  }
}
