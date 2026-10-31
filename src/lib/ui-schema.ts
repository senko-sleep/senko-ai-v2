// Structured, validated UI schema & parser for Senko's Dynamic AI-Generated UI system.
// Never executes raw HTML or arbitrary JavaScript. Every node is validated and normalized
// into a safe, typed UINode tree with graceful fallbacks.

export type UIValue = string | number | boolean | string[];

export interface UICitation {
  label: string;
  url?: string;
  source?: string;
  count?: number;
}

export interface UIAction {
  type: "set_state" | "send_message" | "open_url" | "reset_state";
  /** For set_state: key in message-local state */
  stateKey?: string;
  /** For set_state: value to set */
  value?: UIValue;
  /** For send_message: prompt template (can interpolate {{stateKey}}) */
  prompt?: string;
  /** For open_url: target https URL */
  url?: string;
  label?: string;
}

export interface UICondition {
  stateKey: string;
  equals?: UIValue;
  notEquals?: UIValue;
  includes?: string;
  truthy?: boolean;
}

export interface UICombatant {
  name: string;
  subtitle?: string;
  imageUrl?: string;
  imageQuery?: string;
  badge?: string;
  color?: string;
  stats?: { label: string; value: string | number }[];
  description?: string;
}

export interface UIVerdict {
  eyebrow?: string;
  title: string;
  summary?: string;
  badge?: string;
  winner?: string;
  confidence?: string;
}

export interface UIScenario {
  id: string;
  label: string;
  verdictTitle?: string;
  verdictSummary?: string;
  probabilities?: { label: string; value: number; color?: string }[];
}

export interface UITableColumn {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  highlight?: boolean;
}

export interface UITableRow {
  id?: string;
  cells: Record<string, string | number>;
  winner?: string;
  detail?: string;
  badge?: string;
}

export interface UIProbabilityBar {
  label: string;
  value: number; // 0..100
  displayValue?: string;
  color?: string;
  subtitle?: string;
}

export interface UIStatItem {
  label: string;
  value: string | number;
  unit?: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
  progress?: number;
  description?: string;
  color?: string;
}

export interface UIRankingItem {
  rank: number | string;
  title: string;
  subtitle?: string;
  score?: string | number;
  progress?: number;
  badge?: string;
  category?: string;
  description?: string;
  details?: string;
  imageUrl?: string;
  imageQuery?: string;
  url?: string;
  color?: string;
}

export interface UIProfileTrait {
  name: string;
  description?: string;
  badge?: string;
  category?: string;
}

export interface UIProfileAbility {
  name: string;
  description?: string;
  badge?: string;
  level?: number;
}

export interface UIProfileRelationship {
  name: string;
  role?: string;
  description?: string;
  imageUrl?: string;
  imageQuery?: string;
}

export interface UIProfileAppearance {
  title: string;
  subtitle?: string;
  description?: string;
  badge?: string;
}

export interface UIVideoItem {
  id: string;
  videoId?: string;
  rank?: number | string;
  title: string;
  channel?: string;
  channelUrl?: string;
  views?: string | number;
  likes?: string | number;
  publishedAt?: string;
  duration?: string;
  category?: string;
  badge?: string;
  description?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  imageQuery?: string;
  url?: string;
}

export interface UITimelineEvent {
  id: string;
  date: string;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
  badge?: string;
  imageUrl?: string;
  imageQuery?: string;
  url?: string;
}

export interface UIProductItem {
  id: string;
  name: string;
  subtitle?: string;
  badge?: string;
  category?: string;
  price?: string;
  originalPrice?: string;
  rating?: string | number;
  imageUrl?: string;
  imageQuery?: string;
  summary?: string;
  specs?: { label: string; value: string }[];
  pros?: string[];
  cons?: string[];
  url?: string;
  store?: string;
}

export interface UINewsArticle {
  id: string;
  title: string;
  source?: string;
  publishedAt?: string;
  category?: string;
  badge?: string;
  summary?: string;
  details?: string;
  imageUrl?: string;
  imageQuery?: string;
  url?: string;
}

export interface UIMapMarker {
  id: string;
  label: string;
  subtitle?: string;
  lat: number;
  lng: number;
  badge?: string;
  elevation?: string;
  description?: string;
  imageUrl?: string;
  imageQuery?: string;
  url?: string;
}

export interface UIStepItem {
  id: string;
  step: number | string;
  title: string;
  subtitle?: string;
  description: string;
  badge?: string;
  code?: string;
  language?: string;
  latex?: string;
  imageUrl?: string;
  imageQuery?: string;
}

export interface UIKeyValueItem {
  label: string;
  value: string | number;
  badge?: string;
  detail?: string;
  url?: string;
}

export interface UIChartSeries {
  name: string;
  data: number[];
  color?: string;
}

export interface UIQuestionField {
  id: string;
  label: string;
  description?: string;
  type: "single_choice" | "multi_choice" | "slider" | "select" | "text" | "textarea" | "toggle" | "rating";
  options?: { value: string; label: string; description?: string; icon?: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  defaultValue?: UIValue;
  placeholder?: string;
  required?: boolean;
}

export interface UIQuizQuestion {
  id: string;
  question: string;
  codeOrMath?: string;
  options: { id: string; label: string; explanation?: string }[];
  correctOptionId: string;
  explanation?: string;
  hint?: string;
  difficulty?: "easy" | "medium" | "hard";
}

export interface UIDocumentSection {
  id: string;
  title: string;
  page?: number;
  content: string;
  summary?: string;
  tags?: string[];
}

export interface UIDiagramNode {
  id: string;
  label: string;
  subtitle?: string;
  group?: string;
  color?: string;
}

export interface UIDiagramEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export type UINode =
  | {
      type: "stack";
      direction?: "vertical" | "horizontal";
      gap?: "xs" | "sm" | "md" | "lg";
      align?: "start" | "center" | "end" | "stretch" | "between";
      wrap?: boolean;
      children: UINode[];
      when?: UICondition;
    }
  | {
      type: "grid";
      cols?: 1 | 2 | 3 | 4;
      gap?: "xs" | "sm" | "md" | "lg";
      children: UINode[];
      when?: UICondition;
    }
  | {
      type: "card";
      title?: string;
      subtitle?: string;
      eyebrow?: string;
      badge?: string;
      variant?: "default" | "glass" | "highlight" | "warning" | "success" | "danger" | "subtle";
      footer?: string;
      children: UINode[];
      actions?: UIAction[];
      when?: UICondition;
    }
  | {
      type: "vs_card";
      title?: string;
      subtitle?: string;
      combatants: UICombatant[];
      verdict?: UIVerdict;
      scenarios?: UIScenario[];
      stateKey?: string;
      when?: UICondition;
    }
  | {
      type: "verdict";
      eyebrow?: string;
      title: string;
      summary?: string;
      badge?: string;
      color?: string;
      when?: UICondition;
    }
  | {
      type: "comparison_table";
      title?: string;
      subtitle?: string;
      columns: UITableColumn[];
      rows: UITableRow[];
      filterable?: boolean;
      sortable?: boolean;
      caption?: string;
      when?: UICondition;
    }
  | {
      type: "probability_bars";
      title?: string;
      subtitle?: string;
      bars: UIProbabilityBar[];
      caption?: string;
      summary?: string;
      interactive?: boolean;
      scenarios?: UIScenario[];
      when?: UICondition;
    }
  | {
      type: "stat_grid";
      title?: string;
      cols?: 2 | 3 | 4;
      stats: UIStatItem[];
      when?: UICondition;
    }
  | {
      type: "ranking";
      title?: string;
      subtitle?: string;
      sortable?: boolean;
      filterable?: boolean;
      items: UIRankingItem[];
      when?: UICondition;
    }
  | {
      type: "profile";
      name: string;
      subtitle?: string;
      series?: string;
      category?: string;
      badges?: string[];
      quote?: string;
      bio?: string;
      imageUrl?: string;
      imageQuery?: string;
      gallery?: { title?: string; subtitle?: string; imageUrl?: string; imageQuery?: string }[];
      attributes?: { label: string; value: string | number }[];
      traits?: UIProfileTrait[];
      abilities?: UIProfileAbility[];
      relationships?: UIProfileRelationship[];
      appearances?: UIProfileAppearance[];
      trivia?: string[];
      when?: UICondition;
    }
  | {
      type: "video_grid";
      title?: string;
      subtitle?: string;
      interpretation?: string;
      dataStatus?: "live" | "historical" | "curated" | "unavailable";
      statusNote?: string;
      filterable?: boolean;
      sortable?: boolean;
      videos: UIVideoItem[];
      when?: UICondition;
    }
  | {
      type: "timeline";
      title?: string;
      subtitle?: string;
      events: UITimelineEvent[];
      when?: UICondition;
    }
  | {
      type: "product_grid";
      title?: string;
      subtitle?: string;
      filterable?: boolean;
      sortable?: boolean;
      products: UIProductItem[];
      when?: UICondition;
    }
  | {
      type: "news_feed";
      title?: string;
      subtitle?: string;
      dataStatus?: "live" | "curated" | "unavailable";
      statusNote?: string;
      filterable?: boolean;
      articles: UINewsArticle[];
      when?: UICondition;
    }
  | {
      type: "map";
      title?: string;
      subtitle?: string;
      region?: string;
      markers: UIMapMarker[];
      when?: UICondition;
    }
  | {
      type: "steps";
      title?: string;
      subtitle?: string;
      interactive?: boolean;
      steps: UIStepItem[];
      when?: UICondition;
    }
  | {
      type: "key_value";
      title?: string;
      subtitle?: string;
      cols?: 1 | 2 | 3;
      items: UIKeyValueItem[];
      when?: UICondition;
    }
  | {
      type: "chart";
      chartType: "bar" | "horizontal_bar" | "line" | "area" | "radar" | "donut";
      title?: string;
      subtitle?: string;
      labels: string[];
      series: UIChartSeries[];
      unit?: string;
      caption?: string;
      height?: number;
      when?: UICondition;
    }
  | {
      type: "media_card";
      title?: string;
      subtitle?: string;
      caption?: string;
      imageUrl?: string;
      imageQuery?: string;
      aspect?: "portrait" | "video" | "square" | "auto";
      badge?: string;
      sourceUrl?: string;
      when?: UICondition;
    }
  | {
      type: "gallery";
      title?: string;
      subtitle?: string;
      cols?: 2 | 3 | 4;
      filterable?: boolean;
      items: {
        title?: string;
        subtitle?: string;
        category?: string;
        badge?: string;
        description?: string;
        imageUrl?: string;
        imageQuery?: string;
        sourceUrl?: string;
      }[];
      when?: UICondition;
    }
  | {
      type: "questionnaire";
      id?: string;
      title: string;
      description?: string;
      badge?: string;
      fields: UIQuestionField[];
      submitLabel?: string;
      promptPrefix?: string;
      when?: UICondition;
    }
  | {
      type: "quiz";
      title?: string;
      subtitle?: string;
      questions: UIQuizQuestion[];
      when?: UICondition;
    }
  | {
      type: "controls";
      title?: string;
      description?: string;
      stateKey?: string;
      controlType: "buttons" | "segmented" | "slider" | "select";
      options?: { label: string; value: string; description?: string; action?: UIAction }[];
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      defaultValue?: UIValue;
      actions?: UIAction[];
      when?: UICondition;
    }
  | {
      type: "tabs";
      defaultTab?: string;
      stateKey?: string;
      tabs: {
        id: string;
        label: string;
        badge?: string;
        content?: string;
        children?: UINode[];
      }[];
      when?: UICondition;
    }
  | {
      type: "accordion";
      title?: string;
      allowMultiple?: boolean;
      items: {
        id: string;
        title: string;
        subtitle?: string;
        badge?: string;
        defaultOpen?: boolean;
        content?: string;
        children?: UINode[];
      }[];
      when?: UICondition;
    }
  | {
      type: "callout";
      variant?: "info" | "tip" | "warning" | "danger" | "verdict" | "quote";
      title?: string;
      content?: string;
      children?: UINode[];
      citations?: UICitation[];
      when?: UICondition;
    }
  | {
      type: "text";
      content: string;
      variant?: "lead" | "body" | "caption" | "muted" | "heading";
      citations?: UICitation[];
      when?: UICondition;
    }
  | {
      type: "citations";
      items: UICitation[];
      when?: UICondition;
    }
  | {
      type: "math";
      latex: string;
      label?: string;
      explanation?: string;
      block?: boolean;
      when?: UICondition;
    }
  | {
      type: "diagram";
      title?: string;
      subtitle?: string;
      mermaid?: string;
      direction?: "LR" | "TD";
      nodes?: UIDiagramNode[];
      edges?: UIDiagramEdge[];
      caption?: string;
      when?: UICondition;
    }
  | {
      type: "document_preview";
      title: string;
      fileName?: string;
      fileType?: string;
      pageCount?: number;
      summary?: string;
      keyPoints?: string[];
      metadata?: { label: string; value: string }[];
      sections: UIDocumentSection[];
      when?: UICondition;
    }
  | {
      type: "model_viewer";
      title?: string;
      subtitle?: string;
      preset?: "icosahedron" | "torus" | "sphere" | "cube" | "dna_helix" | "atom" | "pyramid" | "cylinder" | "wave_surface" | "solar_system";
      modelUrl?: string;
      modelFormat?: "obj" | "stl" | "gltf" | "glb";
      objData?: string;
      vertices?: [number, number, number][];
      faces?: number[][];
      color?: string;
      wireframe?: boolean;
      autoRotate?: boolean;
      annotations?: { label: string; description?: string; position?: [number, number, number] }[];
      when?: UICondition;
    }
  | {
      type: "code";
      language?: string;
      filename?: string;
      code: string;
      caption?: string;
      when?: UICondition;
    }
  | {
      type: "divider";
      label?: string;
      when?: UICondition;
    };

const MAX_DEPTH = 8;
const MAX_CHILDREN = 40;

function asStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

function asOptStr(v: unknown): string | undefined {
  const s = asStr(v).trim();
  return s ? s : undefined;
}

function asNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = parseFloat(v.replace(/[%$,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitizeUrl(v: unknown): string | undefined {
  const s = asOptStr(v);
  if (!s) return undefined;
  if (s.startsWith("/api/uploads/") || s.startsWith("https://") || s.startsWith("http://")) {
    return s;
  }
  return undefined;
}

/**
 * Extracts an 11-character YouTube video ID from a URL or ID string if valid.
 */
export function extractYouTubeVideoId(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if ((parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") && parts[1]) {
        if (/^[a-zA-Z0-9_-]{11}$/.test(parts[1])) return parts[1];
      }
    }
  } catch {
    // Not a full URL
  }
  return undefined;
}

function parseCondition(raw: unknown): UICondition | undefined {
  if (!isObj(raw)) return undefined;
  const stateKey = asOptStr(raw.stateKey || raw.key || raw.field);
  if (!stateKey) return undefined;
  const op = asStr(raw.operator, "").toLowerCase();
  return {
    stateKey,
    equals: (raw.equals ?? (op === "eq" ? raw.value : undefined)) as UIValue | undefined,
    notEquals: (raw.notEquals ?? (op === "neq" ? raw.value : undefined)) as UIValue | undefined,
    includes: asOptStr(raw.includes ?? (op === "in" ? raw.value : undefined)),
    truthy: typeof raw.truthy === "boolean" ? raw.truthy : undefined,
  };
}

function parseAction(raw: unknown): UIAction | undefined {
  if (!isObj(raw)) return undefined;
  const rawType = asStr(raw.type || raw.action, "send_message").toLowerCase();
  if (rawType === "set_state" || rawType === "state") {
    const stateKey = asOptStr(raw.stateKey || raw.key);
    if (!stateKey) return undefined;
    return {
      type: "set_state",
      stateKey,
      value: (raw.value ?? "") as UIValue,
      label: asOptStr(raw.label),
    };
  }
  if (rawType === "open_url" || rawType === "url" || rawType === "link") {
    const url = sanitizeUrl(raw.url || raw.href);
    if (!url) return undefined;
    return { type: "open_url", url, label: asOptStr(raw.label || raw.title) };
  }
  if (rawType === "reset_state" || rawType === "reset") {
    return { type: "reset_state", label: asOptStr(raw.label) };
  }
  const prompt = asOptStr(raw.prompt || raw.message || raw.value || raw.label);
  if (!prompt) return undefined;
  return {
    type: "send_message",
    prompt,
    label: asOptStr(raw.label || raw.title) || prompt,
  };
}

function parseCitations(raw: unknown): UICitation[] | undefined {
  const arr = asArr(raw);
  if (!arr.length) return undefined;
  const out: UICitation[] = [];
  for (const item of arr.slice(0, 16)) {
    if (typeof item === "string") {
      out.push({ label: item });
    } else if (isObj(item)) {
      const label = asOptStr(item.label || item.title || item.source || item.name);
      if (label) {
        out.push({
          label,
          url: sanitizeUrl(item.url || item.href),
          source: asOptStr(item.source || item.domain),
          count: typeof item.count === "number" ? item.count : undefined,
        });
      }
    }
  }
  return out.length ? out : undefined;
}

function parseScenarios(raw: unknown): UIScenario[] | undefined {
  const arr = asArr(raw);
  if (!arr.length) return undefined;
  const out: UIScenario[] = [];
  for (const [idx, s] of arr.slice(0, 8).entries()) {
    if (!isObj(s)) continue;
    const label = asOptStr(s.label || s.title || s.name);
    if (!label) continue;
    const probs = asArr(s.probabilities || s.bars)
      .filter(isObj)
      .map((b) => ({
        label: asStr(b.label || b.name, "Option"),
        value: Math.max(0, Math.min(100, asNum(b.value ?? b.percentage ?? b.percent, 50))),
        color: asOptStr(b.color),
      }));
    out.push({
      id: asOptStr(s.id) || `scenario_${idx}`,
      label,
      verdictTitle: asOptStr(s.verdictTitle || s.winner || s.verdict),
      verdictSummary: asOptStr(s.verdictSummary || s.summary || s.description),
      probabilities: probs.length ? probs : undefined,
    });
  }
  return out.length ? out : undefined;
}

/**
 * Validate and normalize an untrusted JSON value into a safe UINode (or null if unusable).
 */
export function validateUINode(raw: unknown, depth = 0): UINode | null {
  if (depth > MAX_DEPTH || raw == null) return null;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? { type: "text", content: trimmed } : null;
  }

  if (Array.isArray(raw)) {
    const children = raw
      .slice(0, MAX_CHILDREN)
      .map((item) => validateUINode(item, depth + 1))
      .filter((x): x is UINode => x !== null);
    return children.length ? { type: "stack", direction: "vertical", gap: "md", children } : null;
  }

  if (!isObj(raw)) return null;

  // If root object has `layout` or `components` or `blocks` or `sections` without `type`
  const rawType = asStr(raw.type || raw.component || raw.kind, "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  const when = parseCondition(raw.when || raw.condition || raw.visibleWhen);

  if (!rawType) {
    const list = raw.children || raw.components || raw.blocks || raw.items || raw.layout;
    if (Array.isArray(list)) {
      const children = list
        .slice(0, MAX_CHILDREN)
        .map((c) => validateUINode(c, depth + 1))
        .filter((x): x is UINode => x !== null);
      if (children.length) {
        return { type: "stack", direction: "vertical", gap: "md", children, when };
      }
    }
    if (raw.combatants || raw.fighters || raw.characters) {
      return validateUINode({ ...raw, type: "vs_card" }, depth);
    }
    if (raw.videos) {
      return validateUINode({ ...raw, type: "video_grid" }, depth);
    }
    if (raw.events) {
      return validateUINode({ ...raw, type: "timeline" }, depth);
    }
    if (raw.products) {
      return validateUINode({ ...raw, type: "product_grid" }, depth);
    }
    if (raw.articles || raw.headlines) {
      return validateUINode({ ...raw, type: "news_feed" }, depth);
    }
    if (raw.markers || raw.locations) {
      return validateUINode({ ...raw, type: "map" }, depth);
    }
    if (raw.steps) {
      return validateUINode({ ...raw, type: "steps" }, depth);
    }
    if (raw.name && (raw.bio || raw.traits || raw.abilities || raw.relationships || raw.trivia || raw.appearances)) {
      return validateUINode({ ...raw, type: "profile" }, depth);
    }
    if (raw.bars || raw.probabilities) {
      return validateUINode({ ...raw, type: "probability_bars" }, depth);
    }
    if (raw.rows && raw.columns) {
      return validateUINode({ ...raw, type: "comparison_table" }, depth);
    }
    if (raw.fields) {
      return validateUINode({ ...raw, type: "questionnaire" }, depth);
    }
    if (raw.questions) {
      return validateUINode({ ...raw, type: "quiz" }, depth);
    }
    if (raw.series && raw.labels) {
      return validateUINode({ ...raw, type: "chart" }, depth);
    }
    return null;
  }

  switch (rawType) {
    case "stack":
    case "column":
    case "row":
    case "flex":
    case "container":
    case "layout":
    case "conditional": {
      const dir =
        rawType === "row" || raw.direction === "horizontal" || raw.direction === "row"
          ? "horizontal"
          : "vertical";
      const rawChildren = asArr(raw.children || raw.components || raw.items || raw.blocks);
      const children = rawChildren
        .slice(0, MAX_CHILDREN)
        .map((c) => validateUINode(c, depth + 1))
        .filter((x): x is UINode => x !== null);
      if (!children.length && typeof raw.content === "string") {
        children.push({ type: "text", content: raw.content });
      }
      if (!children.length) return null;
      const gap = (["xs", "sm", "md", "lg"].includes(asStr(raw.gap)) ? raw.gap : "md") as "xs" | "sm" | "md" | "lg";
      return {
        type: "stack",
        direction: dir,
        gap,
        wrap: Boolean(raw.wrap),
        children,
        when,
      };
    }

    case "grid":
    case "columns":
    case "multi_column": {
      const colsNum = Math.min(4, Math.max(1, Math.round(asNum(raw.cols || raw.columns, 2)))) as 1 | 2 | 3 | 4;
      const rawChildren = asArr(raw.children || raw.items || raw.cards || raw.columns);
      const children = rawChildren
        .slice(0, MAX_CHILDREN)
        .map((c) => validateUINode(c, depth + 1))
        .filter((x): x is UINode => x !== null);
      if (!children.length) return null;
      const gap = (["xs", "sm", "md", "lg"].includes(asStr(raw.gap)) ? raw.gap : "md") as "xs" | "sm" | "md" | "lg";
      return { type: "grid", cols: colsNum, gap, children, when };
    }

    case "card":
    case "panel":
    case "box":
    case "section": {
      const rawChildren = asArr(raw.children || raw.items || raw.blocks);
      const children = rawChildren
        .slice(0, MAX_CHILDREN)
        .map((c) => validateUINode(c, depth + 1))
        .filter((x): x is UINode => x !== null);
      if (typeof raw.content === "string" && raw.content.trim()) {
        children.unshift({ type: "text", content: raw.content.trim() });
      }
      if (typeof raw.body === "string" && raw.body.trim()) {
        children.push({ type: "text", content: raw.body.trim() });
      }
      const title = asOptStr(raw.title || raw.heading || raw.header);
      if (!children.length && !title) return null;
      const variantRaw = asStr(raw.variant, "default");
      const variant = (["default", "glass", "highlight", "warning", "success", "danger", "subtle"].includes(variantRaw)
        ? variantRaw
        : "default") as "default" | "glass" | "highlight" | "warning" | "success" | "danger" | "subtle";
      const actions = asArr(raw.actions).map(parseAction).filter((a): a is UIAction => !!a);
      return {
        type: "card",
        title,
        subtitle: asOptStr(raw.subtitle || raw.description),
        eyebrow: asOptStr(raw.eyebrow || raw.category || raw.kicker),
        badge: asOptStr(raw.badge || raw.tag || raw.status),
        variant,
        footer: asOptStr(raw.footer),
        children,
        actions: actions.length ? actions : undefined,
        when,
      };
    }

    case "vs_card":
    case "character_battle":
    case "matchup":
    case "versus":
    case "battle":
    case "comparison_cards": {
      let rawCombatants = asArr(raw.combatants || raw.fighters || raw.characters || raw.items || raw.subjects || raw.sides);
      if (!rawCombatants.length && (isObj(raw.left) || isObj(raw.right))) {
        rawCombatants = [raw.left, raw.right].filter(Boolean);
      }
      const combatants: UICombatant[] = [];
      for (const c of rawCombatants.slice(0, 4)) {
        if (!isObj(c)) continue;
        const name = asOptStr(c.name || c.title || c.label);
        if (!name) continue;
        const stats = asArr(c.stats)
          .filter(isObj)
          .map((s) => ({
            label: asStr(s.label || s.name, ""),
            value: (typeof s.value === "number" ? s.value : asStr(s.value, "")) as string | number,
          }))
          .filter((s) => s.label);
        const queryFallback = `${name} ${asStr(c.subtitle || c.universe || c.origin || c.series, "")}`.trim();
        combatants.push({
          name,
          subtitle: asOptStr(c.subtitle || c.universe || c.origin || c.series || c.source || c.role),
          imageUrl: sanitizeUrl(c.imageUrl || c.image || c.img || c.avatar),
          imageQuery: asOptStr(c.imageQuery || c.query || c.searchQuery) || queryFallback,
          badge: asOptStr(c.badge || c.tag || c.rank),
          color: asOptStr(c.color),
          stats: stats.length ? stats : undefined,
          description: asOptStr(c.description || c.summary),
        });
      }
      if (!combatants.length) return null;

      let verdict: UIVerdict | undefined;
      if (isObj(raw.verdict || raw.prediction || raw.winner)) {
        const v = (raw.verdict || raw.prediction || raw.winner) as Record<string, unknown>;
        const vTitle = asOptStr(v.title || v.winner || v.headline || v.label);
        if (vTitle) {
          const defaultEyebrow = v.winner || raw.winner || raw.predictedWinner ? "PREDICTED WINNER" : "COMPARISON VERDICT";
          verdict = {
            eyebrow: asOptStr(v.eyebrow || v.label_top) || defaultEyebrow,
            title: vTitle,
            summary: asOptStr(v.summary || v.description || v.reason || v.explanation),
            badge: asOptStr(v.badge || v.difficulty),
            winner: asOptStr(v.winner),
            confidence: asOptStr(v.confidence || v.score || v.ratio),
          };
        }
      } else if (typeof raw.predictedWinner === "string" || typeof raw.winner === "string" || typeof raw.verdictTitle === "string") {
        const defaultEyebrow = raw.predictedWinner || raw.winner ? "PREDICTED WINNER" : "COMPARISON VERDICT";
        verdict = {
          eyebrow: asOptStr(raw.verdictEyebrow || raw.verdictLabel) || defaultEyebrow,
          title: asStr(raw.predictedWinner || raw.winner || raw.verdictTitle),
          summary: asOptStr(raw.verdictSummary || raw.summary),
        };
      }

      return {
        type: "vs_card",
        title: asOptStr(raw.title || raw.heading) || combatants.map((c) => c.name).join(" vs. "),
        subtitle: asOptStr(raw.subtitle),
        combatants,
        verdict,
        scenarios: parseScenarios(raw.scenarios || raw.forms || raw.conditions),
        stateKey: asOptStr(raw.stateKey),
        when,
      };
    }

    case "verdict":
    case "headline":
    case "hero_stat":
    case "predicted_winner":
    case "summary_banner": {
      const title = asOptStr(raw.title || raw.winner || raw.headline || raw.value);
      if (!title) return null;
      const defaultEyebrow =
        rawType === "predicted_winner" || raw.winner
          ? "PREDICTED WINNER"
          : rawType === "headline" || rawType === "summary_banner"
          ? "KEY TAKEAWAY"
          : "OVERVIEW";
      return {
        type: "verdict",
        eyebrow: asOptStr(raw.eyebrow || raw.kicker || raw.label) || defaultEyebrow,
        title,
        summary: asOptStr(raw.summary || raw.description || raw.content || raw.subtitle),
        badge: asOptStr(raw.badge || raw.difficulty),
        color: asOptStr(raw.color),
        when,
      };
    }

    case "comparison_table":
    case "table":
    case "data_table":
    case "power_comparison": {
      const rawCols = asArr(raw.columns || raw.headers);
      let columns: UITableColumn[] = [];
      for (const [idx, col] of rawCols.slice(0, 10).entries()) {
        if (typeof col === "string") {
          columns.push({
            key: col.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `col_${idx}`,
            label: col,
          });
        } else if (isObj(col)) {
          const label = asStr(col.label || col.title || col.header || col.key, `Column ${idx + 1}`);
          const key = asStr(col.key || col.id, label.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
          columns.push({
            key,
            label,
            align: (["left", "center", "right"].includes(asStr(col.align)) ? col.align : "left") as "left" | "center" | "right",
            highlight: Boolean(col.highlight),
          });
        }
      }

      const rawRows = asArr(raw.rows || raw.items || raw.data || raw.categories);
      const rows: UITableRow[] = [];

      // If no explicit columns were provided, infer from rows (defaulting to Category | Winner)
      if (!columns.length && rawRows.length > 0) {
        const first = rawRows[0];
        if (isObj(first) && !Array.isArray(first.cells)) {
          const keys = Object.keys(first).filter((k) => !["id", "detail", "notes", "explanation", "badge"].includes(k));
          if (keys.length >= 2) {
            columns = keys.slice(0, 6).map((k) => ({
              key: k,
              label: k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " "),
            }));
          }
        }
        if (!columns.length) {
          columns = [
            { key: "category", label: "Category" },
            { key: "winner", label: "Winner" },
          ];
        }
      }

      for (const [idx, r] of rawRows.slice(0, 60).entries()) {
        if (Array.isArray(r)) {
          const cells: Record<string, string | number> = {};
          columns.forEach((col, cIdx) => {
            cells[col.key] = (typeof r[cIdx] === "number" ? r[cIdx] : asStr(r[cIdx], "—")) as string | number;
          });
          rows.push({
            id: `row_${idx}`,
            cells,
            winner: r[1] !== undefined ? asStr(r[1]) : undefined,
          });
        } else if (isObj(r)) {
          const cells: Record<string, string | number> = {};
          if (Array.isArray(r.cells)) {
            columns.forEach((col, cIdx) => {
              const cellVal = (r.cells as unknown[])[cIdx];
              cells[col.key] = (typeof cellVal === "number" ? cellVal : asStr(cellVal, "—")) as string | number;
            });
          } else {
            const sourceObj = isObj(r.cells) ? r.cells : r;
            columns.forEach((col, cIdx) => {
              let val = sourceObj[col.key] ?? sourceObj[col.label];
              if (val === undefined && cIdx === 0) val = sourceObj.category ?? sourceObj.attribute ?? sourceObj.feature ?? sourceObj.metric ?? sourceObj.name;
              if (val === undefined && cIdx === 1) val = sourceObj.winner ?? sourceObj.result ?? sourceObj.value ?? sourceObj.advantage;
              cells[col.key] = (typeof val === "number" ? val : asStr(val, "—")) as string | number;
            });
          }
          rows.push({
            id: asOptStr(r.id) || `row_${idx}`,
            cells,
            winner: asOptStr(r.winner || cells.winner),
            detail: asOptStr(r.detail || r.explanation || r.notes || r.reason),
            badge: asOptStr(r.badge),
          });
        }
      }

      if (!rows.length) return null;
      return {
        type: "comparison_table",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        columns,
        rows,
        filterable: typeof raw.filterable === "boolean" ? raw.filterable : rows.length >= 4,
        sortable: typeof raw.sortable === "boolean" ? raw.sortable : true,
        caption: asOptStr(raw.caption || raw.footnote),
        when,
      };
    }

    case "probability_bars":
    case "verdict_bars":
    case "progress_group":
    case "progress_bars":
    case "progress":
    case "win_probabilities":
    case "final_verdict": {
      const rawBars = asArr(raw.bars || raw.items || raw.probabilities || raw.outcomes || raw.options);
      const bars: UIProbabilityBar[] = [];
      for (const b of rawBars.slice(0, 12)) {
        if (!isObj(b)) continue;
        const label = asOptStr(b.label || b.name || b.title || b.character);
        if (!label) continue;
        const val = Math.max(0, Math.min(100, asNum(b.value ?? b.percentage ?? b.percent ?? b.probability ?? b.score, 0)));
        bars.push({
          label,
          value: val,
          displayValue: asOptStr(b.displayValue || b. formatted) || `${Math.round(val)}%`,
          color: asOptStr(b.color),
          subtitle: asOptStr(b.subtitle || b.note),
        });
      }
      if (!bars.length && typeof raw.label === "string") {
        const val = Math.max(0, Math.min(100, asNum(raw.value ?? raw.percentage ?? 50)));
        bars.push({
          label: raw.label,
          value: val,
          displayValue: `${Math.round(val)}%`,
          color: asOptStr(raw.color),
        });
      }
      if (!bars.length) return null;
      return {
        type: "probability_bars",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle),
        bars,
        caption: asOptStr(raw.caption || raw.disclaimer || raw.footnote),
        summary: asOptStr(raw.summary || raw.verdict || raw.conclusion),
        interactive: Boolean(raw.interactive),
        scenarios: parseScenarios(raw.scenarios),
        when,
      };
    }

    case "stat_grid":
    case "metrics":
    case "stats":
    case "kpi":
    case "kpi_cards": {
      const rawStats = asArr(raw.stats || raw.items || raw.metrics || raw.cards);
      const stats: UIStatItem[] = [];
      for (const s of rawStats.slice(0, 16)) {
        if (!isObj(s)) continue;
        const label = asOptStr(s.label || s.title || s.name);
        const value = s.value ?? s.stat ?? s.metric;
        if (!label || value === undefined) continue;
        const trendRaw = asStr(s.trend, "").toLowerCase();
        stats.push({
          label,
          value: typeof value === "number" ? value : asStr(value),
          unit: asOptStr(s.unit),
          change: asOptStr(s.change || s.delta),
          trend: trendRaw === "up" || trendRaw === "down" || trendRaw === "neutral" ? trendRaw : undefined,
          progress: s.progress !== undefined ? Math.max(0, Math.min(100, asNum(s.progress))) : undefined,
          description: asOptStr(s.description || s.subtitle || s.note),
          color: asOptStr(s.color),
        });
      }
      if (!stats.length) return null;
      const cols = Math.min(4, Math.max(2, Math.round(asNum(raw.cols || raw.columns, Math.min(stats.length, 3))))) as 2 | 3 | 4;
      return {
        type: "stat_grid",
        title: asOptStr(raw.title || raw.heading),
        cols,
        stats,
        when,
      };
    }

    case "ranking":
    case "leaderboard":
    case "tier_list":
    case "rankings": {
      const rawItems = asArr(raw.items || raw.rankings || raw.entries || raw.list);
      const items: UIRankingItem[] = [];
      for (const [idx, item] of rawItems.slice(0, 20).entries()) {
        if (!isObj(item)) continue;
        const title = asOptStr(item.title || item.name || item.label);
        if (!title) continue;
        items.push({
          rank: (item.rank ?? item.tier ?? idx + 1) as number | string,
          title,
          subtitle: asOptStr(item.subtitle || item.origin),
          score: item.score !== undefined ? (typeof item.score === "number" ? item.score : asStr(item.score)) : undefined,
          progress: item.progress !== undefined ? Math.max(0, Math.min(100, asNum(item.progress))) : undefined,
          badge: asOptStr(item.badge || item.tier),
          category: asOptStr(item.category || item.group || item.tag),
          description: asOptStr(item.description || item.summary || item.reason),
          details: asOptStr(item.details || item.explanation || item.notes),
          imageUrl: sanitizeUrl(item.imageUrl || item.image),
          imageQuery: asOptStr(item.imageQuery || item.query),
          url: sanitizeUrl(item.url || item.link || item.sourceUrl),
          color: asOptStr(item.color),
        });
      }
      if (!items.length) return null;
      return {
        type: "ranking",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        sortable: typeof raw.sortable === "boolean" ? raw.sortable : items.length >= 3,
        filterable: typeof raw.filterable === "boolean" ? raw.filterable : items.some((i) => Boolean(i.category || i.badge)),
        items,
        when,
      };
    }

    case "profile":
    case "entity_profile":
    case "character_profile":
    case "person_profile":
    case "bio_card":
    case "infobox": {
      const name = asOptStr(raw.name || raw.title || raw.subject);
      if (!name) return null;
      const series = asOptStr(raw.series || raw.universe || raw.origin || raw.affiliation || raw.domain);
      const badges = asArr(raw.badges || raw.tags || (raw.badge ? [raw.badge] : []))
        .map((b) => asStr(b).trim())
        .filter(Boolean)
        .slice(0, 8);
      const attributes = asArr(raw.attributes || raw.stats || raw.info || raw.facts || raw.details)
        .filter(isObj)
        .slice(0, 16)
        .map((a) => ({
          label: asStr(a.label || a.key || a.name, ""),
          value: (typeof a.value === "number" ? a.value : asStr(a.value, "")) as string | number,
        }))
        .filter((a) => a.label && a.value !== "");
      const traits: UIProfileTrait[] = asArr(raw.traits || raw.personality || raw.characteristics)
        .slice(0, 12)
        .map((t) => {
          if (typeof t === "string") return { name: t };
          if (!isObj(t)) return null;
          const tName = asOptStr(t.name || t.title || t.trait || t.label);
          if (!tName) return null;
          return {
            name: tName,
            description: asOptStr(t.description || t.detail || t.summary),
            badge: asOptStr(t.badge || t.tag),
            category: asOptStr(t.category),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const abilities: UIProfileAbility[] = asArr(raw.abilities || raw.powers || raw.skills || raw.achievements || raw.discoveries)
        .slice(0, 12)
        .map((ab) => {
          if (typeof ab === "string") return { name: ab };
          if (!isObj(ab)) return null;
          const abName = asOptStr(ab.name || ab.title || ab.ability || ab.label);
          if (!abName) return null;
          return {
            name: abName,
            description: asOptStr(ab.description || ab.detail || ab.summary),
            badge: asOptStr(ab.badge || ab.type || ab.category),
            level: ab.level !== undefined || ab.progress !== undefined ? Math.max(0, Math.min(100, asNum(ab.level ?? ab.progress))) : undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const relationships: UIProfileRelationship[] = asArr(raw.relationships || raw.family || raw.related || raw.connections || raw.relatedCharacters)
        .slice(0, 12)
        .map((r) => {
          if (typeof r === "string") return { name: r };
          if (!isObj(r)) return null;
          const rName = asOptStr(r.name || r.character || r.person || r.title);
          if (!rName) return null;
          return {
            name: rName,
            role: asOptStr(r.role || r.relation || r.relationship || r.badge),
            description: asOptStr(r.description || r.detail || r.summary),
            imageUrl: sanitizeUrl(r.imageUrl || r.image),
            imageQuery: asOptStr(r.imageQuery || r.query) || `${rName} ${series || ""}`.trim(),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const appearances: UIProfileAppearance[] = asArr(raw.appearances || raw.arcs || raw.milestones || raw.keyMoments || raw.works)
        .slice(0, 12)
        .map((ap) => {
          if (typeof ap === "string") return { title: ap };
          if (!isObj(ap)) return null;
          const apTitle = asOptStr(ap.title || ap.name || ap.arc || ap.event);
          if (!apTitle) return null;
          return {
            title: apTitle,
            subtitle: asOptStr(ap.subtitle || ap.episode || ap.chapter || ap.year || ap.date),
            description: asOptStr(ap.description || ap.summary || ap.detail),
            badge: asOptStr(ap.badge || ap.tag),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const trivia = asArr(raw.trivia || raw.funFacts || raw.facts_list || raw.notes)
        .slice(0, 15)
        .map((tr) => (typeof tr === "string" ? tr.trim() : isObj(tr) ? asStr(tr.fact || tr.text || tr.content || tr.title).trim() : ""))
        .filter(Boolean);
      const gallery = asArr(raw.gallery || raw.images)
        .slice(0, 8)
        .map((g) => {
          if (typeof g === "string") {
            return g.startsWith("http") ? { imageUrl: g } : { title: g, imageQuery: g };
          }
          if (!isObj(g)) return null;
          const imgUrl = sanitizeUrl(g.imageUrl || g.url || g.src);
          const gTitle = asOptStr(g.title || g.caption || g.label);
          const imgQ = asOptStr(g.imageQuery || g.query) || (!imgUrl ? gTitle : undefined);
          if (!imgUrl && !imgQ) return null;
          return {
            title: gTitle,
            subtitle: asOptStr(g.subtitle),
            imageUrl: imgUrl,
            imageQuery: imgQ,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const imageUrl = sanitizeUrl(raw.imageUrl || raw.image || raw.portrait || raw.avatar);
      const imageQuery = asOptStr(raw.imageQuery || raw.query) || (!imageUrl ? `${name} ${series || ""}`.trim() : undefined);

      return {
        type: "profile",
        name,
        subtitle: asOptStr(raw.subtitle || raw.role || raw.alias || raw.occupation),
        series,
        category: asOptStr(raw.category || raw.eyebrow),
        badges: badges.length ? badges : undefined,
        quote: asOptStr(raw.quote || raw.catchphrase || raw.motto),
        bio: asOptStr(raw.bio || raw.biography || raw.summary || raw.description || raw.overview),
        imageUrl,
        imageQuery,
        gallery: gallery.length ? gallery : undefined,
        attributes: attributes.length ? attributes : undefined,
        traits: traits.length ? traits : undefined,
        abilities: abilities.length ? abilities : undefined,
        relationships: relationships.length ? relationships : undefined,
        appearances: appearances.length ? appearances : undefined,
        trivia: trivia.length ? trivia : undefined,
        when,
      };
    }

    case "video_grid":
    case "video_list":
    case "youtube_grid":
    case "youtube_feed":
    case "video_cards":
    case "video_card":
    case "youtube_videos":
    case "media_feed": {
      const rawVideos = asArr(raw.videos || raw.items || raw.entries || (raw.title && (raw.videoId || raw.url || raw.channel) ? [raw] : []));
      const videos: UIVideoItem[] = [];
      for (const [idx, v] of rawVideos.slice(0, 20).entries()) {
        if (!isObj(v)) continue;
        const title = asOptStr(v.title || v.name || v.label);
        if (!title) continue;
        const rawUrl = sanitizeUrl(v.url || v.videoUrl || v.link || v.href);
        const extractedId = extractYouTubeVideoId(asOptStr(v.videoId || v.youtubeId) || rawUrl);
        const channel = asOptStr(v.channel || v.creator || v.author || v.uploader);
        const url =
          rawUrl ||
          (extractedId
            ? `https://www.youtube.com/watch?v=${extractedId}`
            : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${channel || ""}`.trim())}`);
        const thumbnailUrl =
          sanitizeUrl(v.thumbnailUrl || v.thumbnail || v.imageUrl || v.image) ||
          (extractedId ? `https://i.ytimg.com/vi/${extractedId}/hqdefault.jpg` : undefined);
        const imageQuery =
          asOptStr(v.imageQuery || v.query) || (!thumbnailUrl ? `${title} ${channel || ""} youtube`.trim() : undefined);

        videos.push({
          id: asOptStr(v.id) || `vid_${idx}`,
          videoId: extractedId,
          rank: v.rank !== undefined ? (typeof v.rank === "number" ? v.rank : asStr(v.rank)) : undefined,
          title,
          channel,
          channelUrl: sanitizeUrl(v.channelUrl),
          views: v.views !== undefined ? (typeof v.views === "number" ? v.views : asStr(v.views)) : undefined,
          likes: v.likes !== undefined ? (typeof v.likes === "number" ? v.likes : asStr(v.likes)) : undefined,
          publishedAt: asOptStr(v.publishedAt || v.date || v.uploadedAt || v.year),
          duration: asOptStr(v.duration || v.length),
          category: asOptStr(v.category || v.genre || v.topic),
          badge: asOptStr(v.badge || v.tag),
          description: asOptStr(v.description || v.summary || v.details),
          thumbnailUrl,
          imageUrl: thumbnailUrl,
          imageQuery,
          url,
        });
      }
      if (!videos.length) return null;
      const statusRaw = asStr(raw.dataStatus || raw.status, "").toLowerCase();
      const dataStatus = (["live", "historical", "curated", "unavailable"].includes(statusRaw)
        ? statusRaw
        : undefined) as "live" | "historical" | "curated" | "unavailable" | undefined;
      return {
        type: "video_grid",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        interpretation: asOptStr(raw.interpretation || raw.mode || raw.scope || raw.category),
        dataStatus,
        statusNote: asOptStr(raw.statusNote || raw.disclaimer || raw.note),
        filterable: typeof raw.filterable === "boolean" ? raw.filterable : videos.some((v) => Boolean(v.category)),
        sortable: typeof raw.sortable === "boolean" ? raw.sortable : videos.length >= 2,
        videos,
        when,
      };
    }

    case "timeline":
    case "chronology":
    case "history_timeline":
    case "events":
    case "milestones": {
      const rawEvents = asArr(raw.events || raw.items || raw.milestones || raw.entries || raw.steps);
      const events: UITimelineEvent[] = [];
      for (const [idx, ev] of rawEvents.slice(0, 24).entries()) {
        if (!isObj(ev)) continue;
        const title = asOptStr(ev.title || ev.name || ev.event || ev.label);
        const date = asOptStr(ev.date || ev.year || ev.time || ev.era || ev.period) || `#${idx + 1}`;
        if (!title) continue;
        events.push({
          id: asOptStr(ev.id) || `ev_${idx}`,
          date,
          title,
          subtitle: asOptStr(ev.subtitle || ev.location || ev.role),
          description: asOptStr(ev.description || ev.summary || ev.detail || ev.content),
          category: asOptStr(ev.category || ev.era_group || ev.tag),
          badge: asOptStr(ev.badge || ev.impact),
          imageUrl: sanitizeUrl(ev.imageUrl || ev.image),
          imageQuery: asOptStr(ev.imageQuery || ev.query),
          url: sanitizeUrl(ev.url || ev.link),
        });
      }
      if (!events.length) return null;
      return {
        type: "timeline",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        events,
        when,
      };
    }

    case "product_grid":
    case "product_cards":
    case "product_card":
    case "shopping":
    case "recommendations": {
      const rawProducts = asArr(raw.products || raw.items || raw.recommendations || (raw.name && (raw.price || raw.specs) ? [raw] : []));
      const products: UIProductItem[] = [];
      for (const [idx, p] of rawProducts.slice(0, 16).entries()) {
        if (!isObj(p)) continue;
        const name = asOptStr(p.name || p.title || p.product || p.model);
        if (!name) continue;
        const specs = asArr(p.specs || p.specifications || p.attributes)
          .slice(0, 10)
          .map((s) => {
            if (typeof s === "string") {
              const [k, ...rest] = s.split(":");
              return rest.length ? { label: k.trim(), value: rest.join(":").trim() } : { label: "Spec", value: s.trim() };
            }
            if (!isObj(s)) return null;
            const l = asOptStr(s.label || s.key || s.name);
            const v = asOptStr(s.value);
            return l && v ? { label: l, value: v } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        const pros = asArr(p.pros || p.strengths || p.highlights).map((x) => asStr(x).trim()).filter(Boolean).slice(0, 6);
        const cons = asArr(p.cons || p.weaknesses || p.drawbacks).map((x) => asStr(x).trim()).filter(Boolean).slice(0, 6);
        const imageUrl = sanitizeUrl(p.imageUrl || p.image);
        products.push({
          id: asOptStr(p.id) || `prod_${idx}`,
          name,
          subtitle: asOptStr(p.subtitle || p.tagline || p.brand),
          badge: asOptStr(p.badge || p.award || p.pick || p.tag),
          category: asOptStr(p.category || p.tier || p.useCase),
          price: asOptStr(p.price || p.cost),
          originalPrice: asOptStr(p.originalPrice || p.msrp),
          rating: p.rating !== undefined ? (typeof p.rating === "number" ? p.rating : asStr(p.rating)) : undefined,
          imageUrl,
          imageQuery: asOptStr(p.imageQuery || p.query) || (!imageUrl ? name : undefined),
          summary: asOptStr(p.summary || p.description || p.verdict || p.reason),
          specs: specs.length ? specs : undefined,
          pros: pros.length ? pros : undefined,
          cons: cons.length ? cons : undefined,
          url: sanitizeUrl(p.url || p.link || p.buyUrl),
          store: asOptStr(p.store || p.merchant || p.retailer),
        });
      }
      if (!products.length) return null;
      return {
        type: "product_grid",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        filterable: typeof raw.filterable === "boolean" ? raw.filterable : products.some((p) => Boolean(p.category || p.badge)),
        sortable: typeof raw.sortable === "boolean" ? raw.sortable : products.length >= 2,
        products,
        when,
      };
    }

    case "news_feed":
    case "news":
    case "news_cards":
    case "articles":
    case "article_list":
    case "current_events":
    case "headlines": {
      const rawArticles = asArr(raw.articles || raw.items || raw.headlines || raw.stories || raw.news);
      const articles: UINewsArticle[] = [];
      for (const [idx, a] of rawArticles.slice(0, 16).entries()) {
        if (!isObj(a)) continue;
        const title = asOptStr(a.title || a.headline || a.name);
        if (!title) continue;
        articles.push({
          id: asOptStr(a.id) || `news_${idx}`,
          title,
          source: asOptStr(a.source || a.publisher || a.outlet || a.domain),
          publishedAt: asOptStr(a.publishedAt || a.date || a.time || a.timestamp),
          category: asOptStr(a.category || a.topic || a.section),
          badge: asOptStr(a.badge || a.tag || a.status),
          summary: asOptStr(a.summary || a.description || a.excerpt || a.lead),
          details: asOptStr(a.details || a.body || a.analysis || a.context),
          imageUrl: sanitizeUrl(a.imageUrl || a.image || a.thumbnail),
          imageQuery: asOptStr(a.imageQuery || a.query),
          url: sanitizeUrl(a.url || a.link || a.sourceUrl),
        });
      }
      if (!articles.length) return null;
      const statusRaw = asStr(raw.dataStatus || raw.status, "").toLowerCase();
      const dataStatus = (["live", "curated", "unavailable"].includes(statusRaw)
        ? statusRaw
        : undefined) as "live" | "curated" | "unavailable" | undefined;
      return {
        type: "news_feed",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        dataStatus,
        statusNote: asOptStr(raw.statusNote || raw.disclaimer || raw.note),
        filterable: typeof raw.filterable === "boolean" ? raw.filterable : articles.some((a) => Boolean(a.category)),
        articles,
        when,
      };
    }

    case "map":
    case "geo_map":
    case "location_map":
    case "locations":
    case "places": {
      const rawMarkers = asArr(raw.markers || raw.locations || raw.places || raw.points || raw.items);
      const markers: UIMapMarker[] = [];
      for (const [idx, m] of rawMarkers.slice(0, 24).entries()) {
        if (!isObj(m)) continue;
        const label = asOptStr(m.label || m.name || m.title || m.place);
        if (!label) continue;
        const lat = asNum(m.lat ?? m.latitude, NaN);
        const lng = asNum(m.lng ?? m.lon ?? m.longitude, NaN);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        markers.push({
          id: asOptStr(m.id) || `loc_${idx}`,
          label,
          subtitle: asOptStr(m.subtitle || m.country || m.region || m.range),
          lat: Math.max(-90, Math.min(90, lat)),
          lng: Math.max(-180, Math.min(180, lng)),
          badge: asOptStr(m.badge || m.rank || m.tag),
          elevation: asOptStr(m.elevation || m.height || m.altitude || m.value),
          description: asOptStr(m.description || m.summary || m.notes),
          imageUrl: sanitizeUrl(m.imageUrl || m.image),
          imageQuery: asOptStr(m.imageQuery || m.query),
          url: sanitizeUrl(m.url || m.link),
        });
      }
      if (!markers.length) return null;
      return {
        type: "map",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        region: asOptStr(raw.region || raw.scope),
        markers,
        when,
      };
    }

    case "steps":
    case "walkthrough":
    case "process":
    case "how_it_works":
    case "step_by_step":
    case "execution_flow": {
      const rawSteps = asArr(raw.steps || raw.items || raw.stages || raw.phases);
      const steps: UIStepItem[] = [];
      for (const [idx, s] of rawSteps.slice(0, 16).entries()) {
        if (typeof s === "string") {
          steps.push({
            id: `step_${idx}`,
            step: idx + 1,
            title: `Step ${idx + 1}`,
            description: s,
          });
          continue;
        }
        if (!isObj(s)) continue;
        const title = asOptStr(s.title || s.name || s.heading || s.label) || `Step ${idx + 1}`;
        const description = asOptStr(s.description || s.content || s.text || s.summary || s.explanation) || "";
        if (!title && !description) continue;
        steps.push({
          id: asOptStr(s.id) || `step_${idx}`,
          step: (s.step ?? s.number ?? idx + 1) as number | string,
          title,
          subtitle: asOptStr(s.subtitle || s.phase),
          description,
          badge: asOptStr(s.badge || s.duration || s.complexity),
          code: asOptStr(s.code || s.snippet),
          language: asOptStr(s.language || s.lang),
          latex: asOptStr(s.latex || s.formula || s.math),
          imageUrl: sanitizeUrl(s.imageUrl || s.image),
          imageQuery: asOptStr(s.imageQuery || s.query),
        });
      }
      if (!steps.length) return null;
      return {
        type: "steps",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        interactive: raw.interactive !== false,
        steps,
        when,
      };
    }

    case "key_value":
    case "fact_list":
    case "specs":
    case "attributes":
    case "info_grid":
    case "facts":
    case "metadata": {
      const rawItems = asArr(raw.items || raw.facts || raw.attributes || raw.specs || raw.entries);
      const items: UIKeyValueItem[] = [];
      for (const item of rawItems.slice(0, 24)) {
        if (!isObj(item)) continue;
        const label = asOptStr(item.label || item.key || item.name || item.title);
        const val = item.value ?? item.text ?? item.content;
        if (!label || val === undefined) continue;
        items.push({
          label,
          value: typeof val === "number" ? val : asStr(val),
          badge: asOptStr(item.badge || item.tag),
          detail: asOptStr(item.detail || item.description || item.note),
          url: sanitizeUrl(item.url || item.link),
        });
      }
      if (!items.length) return null;
      const cols = Math.min(3, Math.max(1, Math.round(asNum(raw.cols || raw.columns, 2)))) as 1 | 2 | 3;
      return {
        type: "key_value",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        cols,
        items,
        when,
      };
    }

    case "chart":
    case "graph":
    case "bar_chart":
    case "line_chart":
    case "radar_chart":
    case "pie_chart":
    case "donut_chart": {
      const rawChartType = asStr(raw.chartType || raw.variant || rawType.replace("_chart", ""), "bar").toLowerCase();
      const chartType = (
        ["bar", "horizontal_bar", "line", "area", "radar", "donut"].includes(rawChartType)
          ? rawChartType
          : rawChartType === "pie"
          ? "donut"
          : "bar"
      ) as "bar" | "horizontal_bar" | "line" | "area" | "radar" | "donut";

      let labels = asArr(raw.labels || raw.categories || raw.xAxis).map((l) => asStr(l));
      const rawSeries = asArr(raw.series || raw.datasets);
      const series: UIChartSeries[] = [];

      // Support shorthand `data: [{ label: "A", value: 10 }, ...]`
      if (!rawSeries.length && Array.isArray(raw.data)) {
        const dataArr = raw.data as unknown[];
        if (dataArr.length > 0 && isObj(dataArr[0])) {
          labels = dataArr.map((d, i) => (isObj(d) ? asStr(d.label || d.name || d.category, `Item ${i + 1}`) : `Item ${i + 1}`));
          series.push({
            name: asStr(raw.seriesName || raw.title, "Value"),
            data: dataArr.map((d) => (isObj(d) ? asNum(d.value ?? d.y ?? d.score ?? d.count, 0) : 0)),
            color: asOptStr(raw.color),
          });
        } else {
          series.push({
            name: asStr(raw.seriesName || raw.title, "Value"),
            data: dataArr.map((v) => asNum(v, 0)),
            color: asOptStr(raw.color),
          });
        }
      } else {
        for (const [idx, s] of rawSeries.slice(0, 6).entries()) {
          if (!isObj(s)) continue;
          const data = asArr(s.data || s.values).map((v) => asNum(v, 0));
          if (!data.length) continue;
          series.push({
            name: asStr(s.name || s.label, `Series ${idx + 1}`),
            data,
            color: asOptStr(s.color),
          });
        }
      }

      if (!series.length) return null;
      const maxLen = Math.max(...series.map((s) => s.data.length));
      if (!labels.length) {
        labels = Array.from({ length: maxLen }, (_, i) => `#${i + 1}`);
      }

      return {
        type: "chart",
        chartType,
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        labels,
        series,
        unit: asOptStr(raw.unit),
        caption: asOptStr(raw.caption || raw.footnote),
        height: raw.height ? Math.max(160, Math.min(420, asNum(raw.height, 240))) : undefined,
        when,
      };
    }

    case "media_card":
    case "image_card":
    case "image": {
      const imageUrl = sanitizeUrl(raw.imageUrl || raw.url || raw.src || raw.image);
      const imageQuery = asOptStr(raw.imageQuery || raw.query || raw.search || raw.title);
      if (!imageUrl && !imageQuery) return null;
      const aspectRaw = asStr(raw.aspect || raw.aspectRatio, "auto");
      const aspect = (["portrait", "video", "square", "auto"].includes(aspectRaw) ? aspectRaw : "auto") as
        | "portrait"
        | "video"
        | "square"
        | "auto";
      return {
        type: "media_card",
        title: asOptStr(raw.title || raw.name),
        subtitle: asOptStr(raw.subtitle || raw.origin || raw.category),
        caption: asOptStr(raw.caption || raw.description || raw.alt),
        imageUrl,
        imageQuery,
        aspect,
        badge: asOptStr(raw.badge),
        sourceUrl: sanitizeUrl(raw.sourceUrl || raw.link),
        when,
      };
    }

    case "gallery":
    case "media_gallery":
    case "image_gallery": {
      const rawItems = asArr(raw.items || raw.images || raw.cards);
      const items = rawItems
        .slice(0, 12)
        .map((item) => {
          if (typeof item === "string") {
            return item.startsWith("http") ? { imageUrl: item } : { title: item, imageQuery: item };
          }
          if (!isObj(item)) return null;
          const imageUrl = sanitizeUrl(item.imageUrl || item.url || item.src);
          const title = asOptStr(item.title || item.name || item.alt);
          const imageQuery = asOptStr(item.imageQuery || item.query) || (!imageUrl ? title : undefined);
          if (!imageUrl && !imageQuery) return null;
          return {
            title,
            subtitle: asOptStr(item.subtitle || item.caption || item.origin),
            category: asOptStr(item.category || item.group || item.tag),
            badge: asOptStr(item.badge),
            description: asOptStr(item.description || item.summary),
            imageUrl,
            imageQuery,
            sourceUrl: sanitizeUrl(item.sourceUrl || item.link),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (!items.length && typeof raw.query === "string") {
        items.push({ title: raw.query, imageQuery: raw.query });
      }
      if (!items.length) return null;
      const cols = Math.min(4, Math.max(2, Math.round(asNum(raw.cols || raw.columns, Math.min(items.length, 3))))) as 2 | 3 | 4;
      return {
        type: "gallery",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle),
        cols,
        filterable: typeof raw.filterable === "boolean" ? raw.filterable : items.some((i) => Boolean(i.category)),
        items,
        when,
      };
    }

    case "questionnaire":
    case "form":
    case "survey":
    case "preferences": {
      const rawFields = asArr(raw.fields || raw.questions || raw.inputs);
      const fields: UIQuestionField[] = [];
      for (const [idx, f] of rawFields.slice(0, 15).entries()) {
        if (!isObj(f)) continue;
        const label = asOptStr(f.label || f.question || f.title || f.name);
        if (!label) continue;
        const fTypeRaw = asStr(f.type || f.inputType || f.kind, "single_choice").toLowerCase();
        let fType: UIQuestionField["type"] = "single_choice";
        if (["single_choice", "radio", "pills", "choice", "buttons"].includes(fTypeRaw)) fType = "single_choice";
        else if (["multi_choice", "checkbox", "checkboxes", "multi", "tags"].includes(fTypeRaw)) fType = "multi_choice";
        else if (["slider", "range", "number"].includes(fTypeRaw)) fType = "slider";
        else if (["select", "dropdown", "menu"].includes(fTypeRaw)) fType = "select";
        else if (["textarea", "long_text", "paragraph"].includes(fTypeRaw)) fType = "textarea";
        else if (["text", "input", "short_text"].includes(fTypeRaw)) fType = "text";
        else if (["toggle", "switch", "boolean"].includes(fTypeRaw)) fType = "toggle";
        else if (["rating", "scale", "stars"].includes(fTypeRaw)) fType = "rating";

        const options = asArr(f.options || f.choices || f.values)
          .slice(0, 12)
          .map((opt) => {
            if (typeof opt === "string" || typeof opt === "number") {
              return { value: String(opt), label: String(opt) };
            }
            if (isObj(opt)) {
              const l = asStr(opt.label || opt.title || opt.value || opt.name, "");
              const v = asStr(opt.value ?? l, l);
              if (!l) return null;
              return {
                value: v,
                label: l,
                description: asOptStr(opt.description || opt.subtitle),
              };
            }
            return null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        fields.push({
          id: asOptStr(f.id || f.key || f.name) || `field_${idx}`,
          label,
          description: asOptStr(f.description || f.help || f.subtitle),
          type: fType,
          options: options.length ? options : undefined,
          min: f.min !== undefined ? asNum(f.min, 0) : undefined,
          max: f.max !== undefined ? asNum(f.max, 100) : undefined,
          step: f.step !== undefined ? asNum(f.step, 1) : undefined,
          unit: asOptStr(f.unit),
          defaultValue: f.defaultValue as UIValue | undefined,
          placeholder: asOptStr(f.placeholder),
          required: Boolean(f.required),
        });
      }
      if (!fields.length) return null;
      return {
        type: "questionnaire",
        id: asOptStr(raw.id),
        title: asStr(raw.title || raw.heading, "Quick Preferences"),
        description: asOptStr(raw.description || raw.subtitle),
        badge: asOptStr(raw.badge),
        fields,
        submitLabel: asOptStr(raw.submitLabel || raw.buttonLabel) || "Submit to Senko",
        promptPrefix: asOptStr(raw.promptPrefix),
        when,
      };
    }

    case "quiz":
    case "practice":
    case "practice_question":
    case "practice_questions":
    case "flashcards": {
      const rawQuestions = asArr(raw.questions || raw.items || (raw.question ? [raw] : []));
      const questions: UIQuizQuestion[] = [];
      for (const [idx, q] of rawQuestions.slice(0, 12).entries()) {
        if (!isObj(q)) continue;
        const questionText = asOptStr(q.question || q.prompt || q.title);
        if (!questionText) continue;
        const rawOpts = asArr(q.options || q.choices || q.answers);
        const options: UIQuizQuestion["options"] = [];
        let inferredCorrectId = "";
        for (const [oIdx, o] of rawOpts.slice(0, 8).entries()) {
          const optId = `opt_${oIdx}`;
          if (typeof o === "string") {
            options.push({ id: optId, label: o });
          } else if (isObj(o)) {
            const id = asOptStr(o.id || o.value) || optId;
            const label = asStr(o.label || o.text || o.answer || o.value, `Option ${oIdx + 1}`);
            options.push({ id, label, explanation: asOptStr(o.explanation || o.reason) });
            if (o.correct === true || o.isCorrect === true) inferredCorrectId = id;
          }
        }
        if (options.length < 2) continue;
        let correctOptionId = asOptStr(q.correctOptionId || q.correctAnswer || q.answer || q.correct) || inferredCorrectId;
        // Match by index or by label if needed
        if (typeof q.correctIndex === "number" && options[q.correctIndex]) {
          correctOptionId = options[q.correctIndex].id;
        } else if (correctOptionId && !options.some((o) => o.id === correctOptionId)) {
          const byLabel = options.find((o) => o.label.toLowerCase() === correctOptionId.toLowerCase());
          if (byLabel) correctOptionId = byLabel.id;
          else {
            const idxNum = parseInt(correctOptionId, 10);
            if (!isNaN(idxNum) && options[idxNum]) correctOptionId = options[idxNum].id;
          }
        }
        if (!correctOptionId) correctOptionId = options[0].id;
        const diffRaw = asStr(q.difficulty, "").toLowerCase();
        questions.push({
          id: asOptStr(q.id) || `q_${idx}`,
          question: questionText,
          codeOrMath: asOptStr(q.codeOrMath || q.code || q.math || q.formula),
          options,
          correctOptionId,
          explanation: asOptStr(q.explanation || q.solution || q.rationale),
          hint: asOptStr(q.hint),
          difficulty: diffRaw === "easy" || diffRaw === "medium" || diffRaw === "hard" ? diffRaw : undefined,
        });
      }
      if (!questions.length) return null;
      return {
        type: "quiz",
        title: asOptStr(raw.title || raw.heading) || "Practice Check",
        subtitle: asOptStr(raw.subtitle || raw.description),
        questions,
        when,
      };
    }

    case "controls":
    case "interactive_control":
    case "button_group":
    case "segmented_control": {
      const src = Array.isArray(raw.controls) && isObj(raw.controls[0]) ? { ...raw, ...raw.controls[0] } : raw;
      const cTypeRaw = asStr(src.controlType || (src.type !== "controls" ? src.type : undefined) || src.variant || "buttons").toLowerCase();
      const controlType = (["buttons", "segmented", "slider", "select"].includes(cTypeRaw) ? cTypeRaw : "buttons") as
        | "buttons"
        | "segmented"
        | "slider"
        | "select";
      const options = asArr(src.options || src.buttons || src.items)
        .slice(0, 12)
        .map((o) => {
          if (typeof o === "string") return { label: o, value: o };
          if (!isObj(o)) return null;
          const label = asOptStr(o.label || o.title || o.name);
          if (!label) return null;
          return {
            label,
            value: asStr(o.value ?? label, label),
            description: asOptStr(o.description),
            action: parseAction(o.action || (o.prompt ? { type: "send_message", prompt: o.prompt } : undefined)),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const actions = asArr(src.actions).map(parseAction).filter((a): a is UIAction => !!a);
      if (!options.length && !actions.length && controlType !== "slider") return null;
      return {
        type: "controls",
        title: asOptStr(src.title || src.label),
        description: asOptStr(src.description || src.subtitle),
        stateKey: asOptStr(src.stateKey || src.id || src.key) || "control",
        controlType,
        options: options.length ? options : undefined,
        min: src.min !== undefined ? asNum(src.min, 0) : undefined,
        max: src.max !== undefined ? asNum(src.max, 100) : undefined,
        step: src.step !== undefined ? asNum(src.step, 1) : undefined,
        unit: asOptStr(src.unit),
        defaultValue: src.defaultValue as UIValue | undefined,
        actions: actions.length ? actions : undefined,
        when,
      };
    }

    case "tabs": {
      const rawTabs = asArr(raw.tabs || raw.items);
      const tabs = rawTabs
        .slice(0, 10)
        .map((t, idx) => {
          if (!isObj(t)) return null;
          const label = asOptStr(t.label || t.title || t.name);
          if (!label) return null;
          const children = asArr(t.children || t.blocks || t.components)
            .slice(0, MAX_CHILDREN)
            .map((c) => validateUINode(c, depth + 1))
            .filter((x): x is UINode => x !== null);
          return {
            id: asOptStr(t.id || t.key) || `tab_${idx}`,
            label,
            badge: asOptStr(t.badge),
            content: asOptStr(t.content || t.body || t.markdown),
            children: children.length ? children : undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (!tabs.length) return null;
      return {
        type: "tabs",
        defaultTab: asOptStr(raw.defaultTab) || tabs[0].id,
        stateKey: asOptStr(raw.stateKey),
        tabs,
        when,
      };
    }

    case "accordion":
    case "expandable":
    case "collapsible":
    case "disclosure": {
      const rawItems = asArr(raw.items || raw.sections || (raw.title && (raw.content || raw.children) ? [raw] : []));
      const items = rawItems
        .slice(0, 15)
        .map((item, idx) => {
          if (!isObj(item)) return null;
          const title = asOptStr(item.title || item.heading || item.label);
          if (!title) return null;
          const children = asArr(item.children || item.blocks)
            .slice(0, MAX_CHILDREN)
            .map((c) => validateUINode(c, depth + 1))
            .filter((x): x is UINode => x !== null);
          return {
            id: asOptStr(item.id) || `acc_${idx}`,
            title,
            subtitle: asOptStr(item.subtitle || item.summary),
            badge: asOptStr(item.badge),
            defaultOpen: Boolean(item.defaultOpen ?? item.open),
            content: asOptStr(item.content || item.body || item.text),
            children: children.length ? children : undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (!items.length) return null;
      return {
        type: "accordion",
        title: raw.items ? asOptStr(raw.title || raw.heading) : undefined,
        allowMultiple: typeof raw.allowMultiple === "boolean" ? raw.allowMultiple : true,
        items,
        when,
      };
    }

    case "callout":
    case "alert":
    case "info_panel":
    case "note": {
      const vRaw = asStr(raw.variant || raw.severity || "info").toLowerCase();
      const variant = (["info", "tip", "warning", "danger", "verdict", "quote"].includes(vRaw) ? vRaw : "info") as
        | "info"
        | "tip"
        | "warning"
        | "danger"
        | "verdict"
        | "quote";
      const children = asArr(raw.children)
        .slice(0, MAX_CHILDREN)
        .map((c) => validateUINode(c, depth + 1))
        .filter((x): x is UINode => x !== null);
      const content = asOptStr(raw.content || raw.text || raw.body || raw.message);
      const title = asOptStr(raw.title || raw.heading);
      if (!content && !title && !children.length) return null;
      return {
        type: "callout",
        variant,
        title,
        content,
        children: children.length ? children : undefined,
        citations: parseCitations(raw.citations || raw.sources),
        when,
      };
    }

    case "text":
    case "markdown":
    case "prose": {
      const content = asOptStr(raw.content || raw.text || raw.markdown || raw.value);
      if (!content) return null;
      const vRaw = asStr(raw.variant || "body").toLowerCase();
      const variant = (["lead", "body", "caption", "muted", "heading"].includes(vRaw) ? vRaw : "body") as
        | "lead"
        | "body"
        | "caption"
        | "muted"
        | "heading";
      return {
        type: "text",
        content,
        variant,
        citations: parseCitations(raw.citations || raw.sources),
        when,
      };
    }

    case "citations":
    case "sources": {
      const items = parseCitations(raw.items || raw.citations || raw.sources);
      if (!items?.length) return null;
      return { type: "citations", items, when };
    }

    case "math":
    case "equation":
    case "formula":
    case "latex": {
      const latex = asOptStr(raw.latex || raw.formula || raw.equation || raw.expression || raw.content);
      if (!latex) return null;
      return {
        type: "math",
        latex,
        label: asOptStr(raw.label || raw.title || raw.name),
        explanation: asOptStr(raw.explanation || raw.description || raw.caption),
        block: raw.block !== false,
        when,
      };
    }

    case "diagram":
    case "flowchart":
    case "architecture":
    case "graph_diagram": {
      const mermaid = asOptStr(raw.mermaid || raw.code || raw.definition);
      const nodes: UIDiagramNode[] = asArr(raw.nodes)
        .slice(0, 30)
        .filter(isObj)
        .map((n, idx) => ({
          id: asOptStr(n.id) || `n_${idx}`,
          label: asStr(n.label || n.title || n.name || n.id, `Node ${idx + 1}`),
          subtitle: asOptStr(n.subtitle || n.role || n.type),
          group: asOptStr(n.group),
          color: asOptStr(n.color),
        }));
      const edges: UIDiagramEdge[] = asArr(raw.edges || raw.links || raw.connections)
        .slice(0, 50)
        .filter(isObj)
        .map((e) => ({
          from: asStr(e.from || e.source),
          to: asStr(e.to || e.target),
          label: asOptStr(e.label || e.relation),
          dashed: Boolean(e.dashed),
        }))
        .filter((e) => e.from && e.to);
      if (!mermaid && !nodes.length) return null;
      return {
        type: "diagram",
        title: asOptStr(raw.title || raw.heading),
        subtitle: asOptStr(raw.subtitle || raw.description),
        mermaid,
        direction: raw.direction === "TD" ? "TD" : "LR",
        nodes: nodes.length ? nodes : undefined,
        edges: edges.length ? edges : undefined,
        caption: asOptStr(raw.caption),
        when,
      };
    }

    case "document_preview":
    case "document":
    case "pdf_preview":
    case "pdf_viewer": {
      const rawSections = asArr(raw.sections || raw.pages || raw.chapters);
      const sections: UIDocumentSection[] = rawSections
        .slice(0, 30)
        .filter(isObj)
        .map((s, idx) => ({
          id: asOptStr(s.id) || `sec_${idx}`,
          title: asStr(s.title || s.heading || s.name, `Section ${idx + 1}`),
          page: typeof s.page === "number" ? s.page : undefined,
          content: asStr(s.content || s.text || s.excerpt || s.body, ""),
          summary: asOptStr(s.summary),
          tags: asArr(s.tags).map((t) => asStr(t)).filter(Boolean),
        }))
        .filter((s) => s.title || s.content);

      if (!sections.length && typeof raw.content === "string") {
        sections.push({
          id: "sec_0",
          title: "Overview",
          page: 1,
          content: raw.content,
        });
      }
      if (!sections.length && !raw.summary) return null;
      const metadata = asArr(raw.metadata)
        .filter(isObj)
        .map((m) => ({ label: asStr(m.label || m.key), value: asStr(m.value) }))
        .filter((m) => m.label && m.value);

      return {
        type: "document_preview",
        title: asStr(raw.title || raw.fileName || raw.name, "Document Preview"),
        fileName: asOptStr(raw.fileName || raw.filename),
        fileType: asOptStr(raw.fileType || raw.format) || "PDF / Document",
        pageCount: typeof raw.pageCount === "number" ? raw.pageCount : sections.length || 1,
        summary: asOptStr(raw.summary || raw.abstract || raw.overview),
        keyPoints: asArr(raw.keyPoints || raw.highlights || raw.takeaways).map((k) => asStr(k)).filter(Boolean),
        metadata: metadata.length ? metadata : undefined,
        sections,
        when,
      };
    }

    case "model_viewer":
    case "viewer_3d":
    case "3d_model":
    case "3d_viewer":
    case "model_3d": {
      const presetRaw = asStr(raw.preset || raw.shape || raw.geometry || "icosahedron").toLowerCase().replace(/[\s-]+/g, "_");
      const allowedPresets = [
        "icosahedron",
        "torus",
        "sphere",
        "cube",
        "dna_helix",
        "atom",
        "pyramid",
        "cylinder",
        "wave_surface",
        "solar_system",
      ] as const;
      const preset = (allowedPresets.includes(presetRaw as (typeof allowedPresets)[number])
        ? presetRaw
        : "icosahedron") as (typeof allowedPresets)[number];

      const vertices = Array.isArray(raw.vertices)
        ? (raw.vertices as unknown[])
            .slice(0, 2000)
            .filter((v): v is [number, number, number] => Array.isArray(v) && v.length >= 3)
            .map((v): [number, number, number] => [asNum(v[0]), asNum(v[1]), asNum(v[2])])
        : undefined;
      const faces = Array.isArray(raw.faces)
        ? (raw.faces as unknown[])
            .slice(0, 4000)
            .filter((f): f is number[] => Array.isArray(f) && f.length >= 3)
            .map((f) => f.map((idx) => Math.max(0, Math.round(asNum(idx)))))
        : undefined;

      const annotations = asArr(raw.annotations || raw.labels)
        .slice(0, 12)
        .filter(isObj)
        .map((a) => ({
          label: asStr(a.label || a.title),
          description: asOptStr(a.description || a.detail),
          position:
            Array.isArray(a.position) && a.position.length >= 3
              ? ([asNum(a.position[0]), asNum(a.position[1]), asNum(a.position[2])] as [number, number, number])
              : undefined,
        }))
        .filter((a) => a.label);

      return {
        type: "model_viewer",
        title: asOptStr(raw.title || raw.name) || "Interactive 3D Model",
        subtitle: asOptStr(raw.subtitle || raw.description),
        preset,
        modelUrl: sanitizeUrl(raw.modelUrl || raw.url || raw.src),
        modelFormat: (["obj", "stl", "gltf", "glb"].includes(asStr(raw.modelFormat).toLowerCase())
          ? asStr(raw.modelFormat).toLowerCase()
          : undefined) as "obj" | "stl" | "gltf" | "glb" | undefined,
        objData: asOptStr(raw.objData),
        vertices: vertices?.length ? vertices : undefined,
        faces: faces?.length ? faces : undefined,
        color: asOptStr(raw.color),
        wireframe: Boolean(raw.wireframe),
        autoRotate: raw.autoRotate !== false,
        annotations: annotations.length ? annotations : undefined,
        when,
      };
    }

    case "code":
    case "code_block": {
      const code = asOptStr(raw.code || raw.content || raw.snippet);
      if (!code) return null;
      return {
        type: "code",
        language: asOptStr(raw.language || raw.lang) || "text",
        filename: asOptStr(raw.filename || raw.title || raw.file),
        code,
        caption: asOptStr(raw.caption || raw.description),
        when,
      };
    }

    case "divider":
    case "separator":
    case "hr": {
      return {
        type: "divider",
        label: asOptStr(raw.label || raw.title),
        when,
      };
    }

    default: {
      // Unknown component type: safely degrade if it has children or text content
      const fallbackChildren = asArr(raw.children || raw.items)
        .slice(0, MAX_CHILDREN)
        .map((c) => validateUINode(c, depth + 1))
        .filter((x): x is UINode => x !== null);
      if (fallbackChildren.length) {
        return {
          type: "card",
          title: asOptStr(raw.title || raw.heading),
          subtitle: asOptStr(raw.subtitle),
          children: fallbackChildren,
          when,
        };
      }
      const fallbackText = asOptStr(raw.content || raw.text || raw.summary || raw.description);
      if (fallbackText) {
        return {
          type: "callout",
          title: asOptStr(raw.title || raw.heading),
          content: fallbackText,
          when,
        };
      }
      return null;
    }
  }
}

/**
 * Tolerant JSON parser that handles trailing commas, smart quotes, or minor formatting quirks from LLMs.
 */
export function parseTolerantJSON(input: string): unknown | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip trailing commas before } or ], smart quotes, and comments
    try {
      const cleaned = trimmed
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/^\s*\/\/.*$/gm, "");
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

export type MessageSegment =
  | { kind: "markdown"; text: string }
  | { kind: "ui"; node: UINode; raw: string }
  | { kind: "ui_pending"; previewTitle?: string; previewType?: string }
  | { kind: "mermaid"; code: string }
  | { kind: "math"; latex: string };

const FENCED_BLOCK_RE = /```(ui|senko-ui|json-ui|mermaid|math|latex)[ \t]*\r?\n([\s\S]*?)```/gi;
const OPEN_UI_FENCE_RE = /```(ui|senko-ui|json-ui)[ \t]*\r?\n([\s\S]*)$/i;

/**
 * Splits a message string into ordered segments of markdown, validated UI blocks,
 * mermaid diagrams, math blocks, and (while streaming) pending UI blocks so raw JSON
 * is never flashed to the user mid-stream.
 */
export function parseMessageSegments(content: string, streaming = false): MessageSegment[] {
  if (!content) return [];

  let working = content;
  let pendingSegment: MessageSegment | null = null;

  // Check if there is an unclosed ```ui fence at the end of the text
  const closedCount = (working.match(/```/g) || []).length;
  if (closedCount % 2 === 1) {
    const openMatch = OPEN_UI_FENCE_RE.exec(working);
    if (openMatch && openMatch.index !== undefined) {
      const partialJson = openMatch[2] || "";
      working = working.slice(0, openMatch.index);

      // Try tolerant parse in case the JSON inside is already complete
      const parsedPartial = parseTolerantJSON(partialJson);
      const validNode = parsedPartial ? validateUINode(parsedPartial) : null;
      if (validNode && !streaming) {
        pendingSegment = { kind: "ui", node: validNode, raw: partialJson };
      } else {
        const titleM = /"title"\s*:\s*"([^"]{1,80})"/i.exec(partialJson);
        const typeM = /"type"\s*:\s*"([^"]{1,40})"/i.exec(partialJson);
        pendingSegment = {
          kind: "ui_pending",
          previewTitle: titleM?.[1],
          previewType: typeM?.[1],
        };
      }
    }
  }

  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  FENCED_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FENCED_BLOCK_RE.exec(working)) !== null) {
    if (match.index > lastIndex) {
      const before = working.slice(lastIndex, match.index).trim();
      if (before) segments.push({ kind: "markdown", text: before });
    }

    const lang = match[1].toLowerCase();
    const body = match[2].trim();

    if (lang === "mermaid") {
      if (body) segments.push({ kind: "mermaid", code: body });
    } else if (lang === "math" || lang === "latex") {
      if (body) segments.push({ kind: "math", latex: body });
    } else {
      const parsed = parseTolerantJSON(body);
      const node = parsed ? validateUINode(parsed) : null;
      if (node) {
        segments.push({ kind: "ui", node, raw: body });
      }
      // If a UI block is completely invalid JSON even after closing, we degrade gracefully
      // by omitting the broken raw JSON or extracting its text fields if possible.
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < working.length) {
    const tail = working.slice(lastIndex).trim();
    if (tail) segments.push({ kind: "markdown", text: tail });
  }

  if (pendingSegment) {
    segments.push(pendingSegment);
  }

  return segments;
}

/**
 * Collects all `imageQuery` strings from any UI blocks inside an AI message so the server
 * can pre-resolve and cache image URLs in parallel.
 */
export function extractUIImageQueries(content: string): string[] {
  const queries = new Set<string>();
  const segments = parseMessageSegments(content, false);

  const walk = (node: UINode) => {
    switch (node.type) {
      case "vs_card":
        for (const c of node.combatants) {
          if (!c.imageUrl && c.imageQuery) queries.add(c.imageQuery);
        }
        break;
      case "media_card":
        if (!node.imageUrl && node.imageQuery) queries.add(node.imageQuery);
        break;
      case "gallery":
        for (const item of node.items) {
          if (!item.imageUrl && item.imageQuery) queries.add(item.imageQuery);
        }
        break;
      case "ranking":
        for (const item of node.items) {
          if (!item.imageUrl && item.imageQuery) queries.add(item.imageQuery);
        }
        break;
      case "profile":
        if (!node.imageUrl && node.imageQuery) queries.add(node.imageQuery);
        if (node.gallery) {
          for (const g of node.gallery) {
            if (!g.imageUrl && g.imageQuery) queries.add(g.imageQuery);
          }
        }
        if (node.relationships) {
          for (const r of node.relationships) {
            if (!r.imageUrl && r.imageQuery) queries.add(r.imageQuery);
          }
        }
        break;
      case "video_grid":
        for (const v of node.videos) {
          if (!v.thumbnailUrl && !v.imageUrl && v.imageQuery) queries.add(v.imageQuery);
        }
        break;
      case "timeline":
        for (const ev of node.events) {
          if (!ev.imageUrl && ev.imageQuery) queries.add(ev.imageQuery);
        }
        break;
      case "product_grid":
        for (const p of node.products) {
          if (!p.imageUrl && p.imageQuery) queries.add(p.imageQuery);
        }
        break;
      case "news_feed":
        for (const a of node.articles) {
          if (!a.imageUrl && a.imageQuery) queries.add(a.imageQuery);
        }
        break;
      case "map":
        for (const m of node.markers) {
          if (!m.imageUrl && m.imageQuery) queries.add(m.imageQuery);
        }
        break;
      case "steps":
        for (const s of node.steps) {
          if (!s.imageUrl && s.imageQuery) queries.add(s.imageQuery);
        }
        break;
      case "stack":
      case "grid":
      case "card":
        for (const child of node.children) walk(child);
        break;
      case "tabs":
        for (const tab of node.tabs) {
          if (tab.children) for (const child of tab.children) walk(child);
        }
        break;
      case "accordion":
        for (const item of node.items) {
          if (item.children) for (const child of item.children) walk(child);
        }
        break;
      case "callout":
        if (node.children) for (const child of node.children) walk(child);
        break;
    }
  };

  for (const seg of segments) {
    if (seg.kind === "ui") walk(seg.node);
  }
  return [...queries].slice(0, 8);
}

/**
 * Evaluates a UICondition against the message's local UI state.
 */
export function evaluateCondition(cond: UICondition | undefined, state: Record<string, UIValue>): boolean {
  if (!cond) return true;
  const actual = state[cond.stateKey];
  if (cond.equals !== undefined) {
    return String(actual ?? "") === String(cond.equals);
  }
  if (cond.notEquals !== undefined) {
    return String(actual ?? "") !== String(cond.notEquals);
  }
  if (cond.includes !== undefined) {
    if (Array.isArray(actual)) return actual.includes(cond.includes);
    return String(actual ?? "").includes(cond.includes);
  }
  if (cond.truthy !== undefined) {
    const isTruthy = Boolean(actual && (!Array.isArray(actual) || actual.length > 0));
    return cond.truthy ? isTruthy : !isTruthy;
  }
  return true;
}
