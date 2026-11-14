/** Conversation composition, independent of interactive UI widgets. No executable styles or markup. */
export type ChatLayoutNode = {
  type: "text" | "image" | "row" | "column" | "grid";
  text?: string;
  image?: number;
  imageQuery?: string;
  alt?: string;
  caption?: string;
  aspect?: "portrait" | "video" | "square" | "natural";
  columns?: number;
  span?: number;
  weight?: number;
  gap?: number;
  align?: "start" | "center" | "end";
  children?: ChatLayoutNode[];
};

export type ChatLayoutSegment =
  | { kind: "prose"; text: string }
  | { kind: "layout"; node: ChatLayoutNode }
  | { kind: "pending" }
  | { kind: "error" };

const number = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
const string = (v: unknown) => typeof v === "string" ? v.slice(0, 24_000) : undefined;

export function validateChatLayout(value: unknown): ChatLayoutNode | null {
  let count = 0;
  function visit(value: unknown, depth: number): ChatLayoutNode | null {
    if (++count > 100 || depth > 8 || !value || typeof value !== "object" || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (!["text", "image", "row", "column", "grid"].includes(String(v.type))) return null;
    const node: ChatLayoutNode = {
      type: v.type as ChatLayoutNode["type"],
      span: number(v.span, 1, 6), weight: number(v.weight, 0.25, 4),
      gap: number(v.gap, 0, 32), columns: number(v.columns, 1, 6),
      align: ["start", "center", "end"].includes(String(v.align)) ? v.align as ChatLayoutNode["align"] : undefined,
    };
    if (node.type === "text") {
      node.text = string(v.text);
      return node.text?.trim() ? node : null;
    }
    if (node.type === "image") {
      node.image = typeof v.image === "number" && Number.isInteger(v.image) && v.image >= 0 && v.image < 120 ? v.image : undefined;
      node.imageQuery = string(v.imageQuery)?.slice(0, 300);
      node.alt = string(v.alt)?.slice(0, 500);
      node.caption = string(v.caption)?.slice(0, 1500);
      node.aspect = ["portrait", "video", "square", "natural"].includes(String(v.aspect)) ? v.aspect as ChatLayoutNode["aspect"] : "natural";
      return node.image !== undefined || node.imageQuery?.trim() ? node : null;
    }
    if (!Array.isArray(v.children) || !v.children.length || v.children.length > 100) return null;
    const children = v.children.map((child) => visit(child, depth + 1));
    if (children.some((child) => !child)) return null;
    node.children = children as ChatLayoutNode[];
    return node;
  }
  return visit(value, 0);
}

/** Scan whole fences so examples inside other code fences remain ordinary code. */
export function splitChatLayouts(text: string, streaming = false): ChatLayoutSegment[] {
  const segments: ChatLayoutSegment[] = [];
  const fence = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n/gm;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text))) {
    const marker = match[1];
    const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*\\r?$`, "gm");
    closing.lastIndex = fence.lastIndex;
    const end = closing.exec(text);
    const isLayout = match[2].trim().toLowerCase() === "chat-layout";
    if (!isLayout) {
      if (!end) break;
      fence.lastIndex = closing.lastIndex;
      continue;
    }
    if (match.index > start) segments.push({ kind: "prose", text: text.slice(start, match.index) });
    if (!end) {
      segments.push({ kind: streaming ? "pending" : "error" });
      start = text.length;
      break;
    }
    try {
      const node = validateChatLayout(JSON.parse(text.slice(fence.lastIndex, end.index)));
      segments.push(node ? { kind: "layout", node } : { kind: "error" });
    } catch {
      segments.push({ kind: "error" });
    }
    start = closing.lastIndex;
    fence.lastIndex = start;
  }
  // Hide a partially streamed opening tag before it can flash as code.
  const tail = text.slice(start);
  const partial = streaming ? /(?:^|\n) {0,3}`{3}chat(?:-layout)?[^\n]*$/.exec(tail) : null;
  if (partial) {
    if (partial.index) segments.push({ kind: "prose", text: tail.slice(0, partial.index) });
    segments.push({ kind: "pending" });
  } else if (tail) segments.push({ kind: "prose", text: tail });
  return segments;
}

export function hasChatLayoutImages(segments: ChatLayoutSegment[]): boolean {
  const hasImage = (n: ChatLayoutNode): boolean => n.type === "image" || !!n.children?.some(hasImage);
  return segments.some((s) => s.kind === "layout" && hasImage(s.node));
}
