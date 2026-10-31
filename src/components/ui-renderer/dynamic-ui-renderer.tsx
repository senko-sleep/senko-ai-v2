"use client";

import React, { Component, memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  AlertTriangle,
  ArrowUpDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
  Lightbulb,
  Quote,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import {
  evaluateCondition,
  parseMessageSegments,
  type UIAction,
  type UICitation,
  type UICombatant,
  type UINode,
  type UIProbabilityBar,
  type UIRankingItem,
  type UIScenario,
  type UIStatItem,
  type UITableColumn,
  type UITableRow,
  type UIValue,
  type UIVerdict,
} from "@/lib/ui-schema";
import { SmartImage, seedUIImageCache } from "./smart-image";
import { ChartView, DiagramView, MathView, formatLatexToReadable, resolveColor } from "./charts-and-diagrams";
import { DocumentPreviewCard, ModelViewer3D } from "./model-and-doc-viewer";
import { InteractiveControlsWidget, QuestionnaireWidget, QuizWidget } from "./interactive-widgets";
import {
  GeoMapWidget,
  KeyValueWidget,
  NewsFeedWidget,
  ProductGridWidget,
  ProfileWidget,
  StepsWidget,
  TimelineWidget,
  VideoGridWidget,
} from "./universal-widgets";

// ── Per-Node Error Boundary for Fault-Tolerant Rendering ─────────────────────
class UINodeBoundary extends Component<{ children: ReactNode; fallbackText?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return this.props.fallbackText ? (
        <div className="my-2 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-raised)] p-3 text-[12.5px] text-[var(--sk-muted)]">
          {this.props.fallbackText}
        </div>
      ) : null;
    }
    return this.props.children;
  }
}

function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Inline citation pill matching the ChatGPT reference screenshots (e.g. `Fandom`, `TVアニメ「T... +1`).
 */
export function CitationPill({ citation }: { citation: UICitation }) {
  const domain = citation.source || hostOf(citation.url);
  const content = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-0.5 align-middle text-[11px] font-medium text-[var(--sk-muted)] transition hover:bg-white/[0.14] hover:text-[var(--sk-text)]">
      {domain && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
          alt=""
          className="h-3 w-3 shrink-0 rounded-full"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <span className="max-w-[140px] truncate">{citation.label}</span>
      {citation.count && citation.count > 1 && <span className="opacity-70">+{citation.count - 1}</span>}
    </span>
  );

  if (citation.url) {
    return (
      <a href={citation.url} target="_blank" rel="noopener noreferrer" className="mx-1 inline-block no-underline">
        {content}
      </a>
    );
  }
  return <span className="mx-1 inline-block">{content}</span>;
}

/**
 * Transforms inline `[[cite: Label | https://url]]` and `$...$` math inside markdown strings
 * into link/code tokens that ReactMarkdown renders cleanly as CitationPills and InlineMath.
 */
function preprocessInlineTokens(markdown: string): string {
  let out = markdown;
  // Convert [[cite: Label | url]] or [[cite: Label]] into special anchor syntax
  out = out.replace(/\[\[\s*cite\s*:\s*([^\]|]+?)(?:\s*\|\s*([^\]]+?))?\s*\]\]/gi, (_, label: string, url?: string) => {
    const cleanLabel = label.trim();
    const cleanUrl = url?.trim() || `https://citation.local/${encodeURIComponent(cleanLabel)}`;
    return `[cite:${cleanLabel}](${cleanUrl})`;
  });
  // Convert display math $$ ... $$ into ```math code fence
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => `\n\`\`\`math\n${expr.trim()}\n\`\`\`\n`);
  return out;
}

function CodeFence({
  language,
  filename,
  code,
  caption,
  onRunPrompt,
}: {
  language?: string;
  filename?: string;
  code: string;
  caption?: string;
  onRunPrompt?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const lang = (language || "text").toLowerCase();
  const canRun = Boolean(onRunPrompt && ["text", "txt", "plaintext", "prompt"].includes(lang));

  return (
    <div className="sk-code my-2.5">
      <div className="sk-code-head">
        <span>{filename ? `${filename} · ${lang}` : lang}</span>
        {canRun && onRunPrompt && (
          <button
            type="button"
            onClick={() => onRunPrompt(code.trim())}
            className="ml-auto mr-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] transition hover:bg-white/10 hover:text-white"
          >
            <Bot size={11} />
            Run in Agent
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] transition hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
      {caption && <div className="border-t border-white/[0.05] px-3 py-1.5 text-[11px] text-[var(--sk-muted)]">{caption}</div>}
    </div>
  );
}

export const EnhancedMarkdown = memo(function EnhancedMarkdown({
  text,
  onRunPrompt,
}: {
  text: string;
  onRunPrompt?: (text: string) => void;
}) {
  const processed = useMemo(() => preprocessInlineTokens(text), [text]);

  return (
    <div className="sk-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          img: ({ src, alt }) =>
            typeof src === "string" ? (
              <span className="my-2 block max-w-sm">
                <SmartImage imageUrl={src} alt={alt || "Image"} aspect="auto" />
              </span>
            ) : null,
          a: ({ href, children }) => {
            const childText = String(children);
            if (childText.startsWith("cite:")) {
              const label = childText.slice(5).trim();
              const isPlaceholder = href?.startsWith("https://citation.local/");
              return <CitationPill citation={{ label, url: isPlaceholder ? undefined : href }} />;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          code: ({ className, children }) => {
            const raw = String(children).replace(/\n$/, "");
            const langMatch = /language-([\w+-]+)/.exec(className || "");
            const lang = langMatch?.[1]?.toLowerCase();
            if (lang === "math" || lang === "latex") {
              return <MathView latex={raw} block />;
            }
            if (lang === "mermaid") {
              return <DiagramView mermaid={raw} />;
            }
            const isInline = !className && !raw.includes("\n");
            if (isInline) {
              if (raw.startsWith("$") && raw.endsWith("$") && raw.length > 2) {
                return <MathView latex={raw.slice(1, -1)} block={false} />;
              }
              return <code>{children}</code>;
            }
            return <code className={className}>{children}</code>;
          },
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children;
            const cls = (child as { props?: { className?: string; children?: ReactNode } })?.props?.className || "";
            const lang = /language-([\w+-]+)/.exec(cls)?.[1]?.toLowerCase() || "text";
            if (lang === "math" || lang === "latex" || lang === "mermaid") {
              return <>{children}</>;
            }
            const rawText = extractTextFromReactNode(children);
            return <CodeFence language={lang} code={rawText} onRunPrompt={onRunPrompt} />;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});

function extractTextFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromReactNode).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractTextFromReactNode(props.children);
  }
  return "";
}

// ── 1. VS Card / Character Battle Widget (Matches Screenshot 3 & 2) ──────────
function VsCardWidget({
  title,
  subtitle,
  combatants,
  verdict,
  scenarios,
  onSendMessage,
}: {
  title?: string;
  subtitle?: string;
  combatants: UICombatant[];
  verdict?: UIVerdict;
  scenarios?: UIScenario[];
  onSendMessage?: (text: string) => void;
}) {
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(scenarios?.[0]?.id || null);
  const activeScenario = scenarios?.find((s) => s.id === activeScenarioId);

  const displayedVerdictTitle = activeScenario?.verdictTitle || verdict?.title;
  const displayedVerdictSummary = activeScenario?.verdictSummary || verdict?.summary;

  return (
    <div className="my-3 space-y-4">
      {/* Header matching Screenshot 3: bold title with subtle dotted underline */}
      {title && (
        <div>
          <h3 className="inline-block border-b border-dotted border-white/35 pb-0.5 text-[16px] font-bold tracking-tight text-[var(--sk-text)]">
            {title}
          </h3>
          {subtitle && <p className="mt-1 text-[12px] text-[var(--sk-muted)]">{subtitle}</p>}
        </div>
      )}

      {/* Side-by-side portrait cards */}
      <div
        className={`grid gap-3 ${
          combatants.length === 1
            ? "grid-cols-1 max-w-xs"
            : combatants.length === 3
            ? "grid-cols-1 sm:grid-cols-3"
            : "grid-cols-2"
        }`}
      >
        {combatants.map((c, idx) => (
          <div key={idx} className="flex flex-col items-center">
            <SmartImage
              imageUrl={c.imageUrl}
              imageQuery={c.imageQuery || `${c.name} ${c.subtitle || ""}`.trim()}
              alt={c.name}
              aspect="portrait"
              showBookmark
            />
            <div className="mt-2.5 text-center">
              <div className="text-[14px] font-bold text-[var(--sk-text)]">{c.name}</div>
              {c.subtitle && <div className="mt-0.5 text-[11.5px] text-[var(--sk-muted)]">{c.subtitle}</div>}
              {c.badge && (
                <span className="mt-1 inline-block rounded-full bg-white/[0.07] px-2 py-0.5 text-[10.5px] font-medium text-[var(--sk-accent-ink)]">
                  {c.badge}
                </span>
              )}
            </div>
            {c.stats && c.stats.length > 0 && (
              <div className="mt-2 w-full space-y-1 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-raised)] p-2.5 text-[11.5px]">
                {c.stats.map((st, sIdx) => (
                  <div key={sIdx} className="flex items-center justify-between gap-2">
                    <span className="text-[var(--sk-muted)]">{st.label}</span>
                    <span className="font-mono font-medium text-[var(--sk-text)]">{st.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Optional Interactive Scenario Switcher */}
      {scenarios && scenarios.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-[var(--sk-muted)]">
            <SlidersHorizontal size={11} /> Condition:
          </span>
          {scenarios.map((sc) => {
            const active = sc.id === activeScenarioId;
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => setActiveScenarioId(sc.id)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition ${
                  active
                    ? "border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                    : "border-[var(--sk-line)] bg-white/[0.02] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                }`}
              >
                {sc.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Verdict / Summary block */}
      {displayedVerdictTitle && (
        <div className="pt-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sk-muted)]">
            {verdict?.eyebrow || (verdict?.winner ? "PREDICTED WINNER" : "COMPARISON VERDICT")}
          </div>
          <div className="mt-0.5 text-[18px] font-bold tracking-tight text-[var(--sk-text)]">
            {displayedVerdictTitle}
          </div>
          {displayedVerdictSummary && (
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--sk-text)]/90">
              {displayedVerdictSummary}
            </p>
          )}
        </div>
      )}

      {/* Scenario probabilities if activeScenario overrides them */}
      {activeScenario?.probabilities && activeScenario.probabilities.length > 0 && (
        <ProbabilityBarsWidget
          bars={activeScenario.probabilities.map((p) => ({
            label: p.label,
            value: p.value,
            displayValue: `${Math.round(p.value)}%`,
            color: p.color,
          }))}
        />
      )}

      {/* Follow-up trigger */}
      {onSendMessage && combatants.length >= 2 && (
        <div className="hidden group-hover:flex flex-wrap gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() =>
              onSendMessage(
                `Compare ${combatants[0].name} and ${combatants[1].name} in greater depth with additional criteria and edge cases.`
              )
            }
            className="inline-flex items-center gap-1 rounded-full border border-[var(--sk-line)] bg-white/[0.02] px-2.5 py-1 text-[11px] text-[var(--sk-muted)] transition hover:border-[var(--sk-accent-line)] hover:text-[var(--sk-text)]"
          >
            <Sparkles size={10.5} className="text-[var(--sk-accent-ink)]" /> Explore deeper comparison
          </button>
        </div>
      )}
    </div>
  );
}

function parseComparableNumber(v: string | number): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const match = /^[$€£¥#]?\s*(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|m|km|ft|mi|kg|g|lb|gb|tb|mb|ghz|mhz|w|hrs|h|s|ms|k|b)?\b/i.exec(s);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const unit = (match[2] || "").toLowerCase();
  if (unit === "b") return num * 1e9;
  if (unit === "k" || unit === "km" || unit === "kg" || unit === "tb") return num * 1e3;
  return num;
}

// ── 2. Comparison Table Widget (Matches Screenshot 2) ────────────────────────
function ComparisonTableWidget({
  title,
  subtitle,
  columns,
  rows,
  filterable = false,
  sortable = true,
  caption,
}: {
  title?: string;
  subtitle?: string;
  columns: UITableColumn[];
  rows: UITableRow[];
  filterable?: boolean;
  sortable?: boolean;
  caption?: string;
}) {
  const [winnerFilter, setWinnerFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Distinct values in the second column (or badge) for quick interactive filtering when recurring values exist
  const winnerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const secondColKey = columns[1]?.key;
    for (const r of rows) {
      const w = String(r.winner ?? r.badge ?? (secondColKey ? r.cells[secondColKey] : "") ?? "").trim();
      if (w && w !== "—" && w.length <= 28 && !/^\d/.test(w)) {
        counts.set(w, (counts.get(w) || 0) + 1);
      }
    }
    const entries = [...counts.entries()];
    // Only show quick-filter pills if at least one category repeats or it's an explicit winner column
    const hasRepeats = entries.some(([, c]) => c > 1) || columns[1]?.key === "winner";
    return hasRepeats ? entries : [];
  }, [rows, columns]);

  const displayedRows = useMemo(() => {
    const secondColKey = columns[1]?.key;
    const q = searchQuery.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (winnerFilter !== "all") {
        const w = String(r.winner ?? r.badge ?? (secondColKey ? r.cells[secondColKey] : "") ?? "").trim();
        if (w.toLowerCase() !== winnerFilter.toLowerCase()) return false;
      }
      if (q) {
        const text = [
          ...Object.values(r.cells).map((v) => String(v)),
          r.detail || "",
          r.badge || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    if (sortCol) {
      list = [...list].sort((a, b) => {
        const va = a.cells[sortCol] ?? "";
        const vb = b.cells[sortCol] ?? "";
        const na = parseComparableNumber(va);
        const nb = parseComparableNumber(vb);
        if (na !== null && nb !== null) {
          return sortAsc ? na - nb : nb - na;
        }
        return sortAsc
          ? String(va).localeCompare(String(vb))
          : String(vb).localeCompare(String(va));
      });
    }
    return list;
  }, [rows, columns, winnerFilter, searchQuery, sortCol, sortAsc]);

  return (
    <div className="my-4">
      {(title || subtitle || filterable) && (
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            {title && <h4 className="text-[15.5px] font-bold text-[var(--sk-text)]">{title}</h4>}
            {subtitle && <p className="mt-0.5 text-[12px] text-[var(--sk-muted)]">{subtitle}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {filterable && winnerCounts.length > 1 && rows.length >= 4 && (
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setWinnerFilter("all")}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                    winnerFilter === "all"
                      ? "bg-white/[0.12] text-[var(--sk-text)]"
                      : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                  }`}
                >
                  All ({rows.length})
                </button>
                {winnerCounts.slice(0, 4).map(([w, count]) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWinnerFilter(winnerFilter === w ? "all" : w)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                      winnerFilter === w
                        ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                        : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                    }`}
                  >
                    {w} ({count})
                  </button>
                ))}
              </div>
            )}

            {filterable && rows.length >= 5 && (
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter rows…"
                className="h-7 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-raised)] px-2.5 text-[11.5px] text-[var(--sk-text)] placeholder:text-[var(--sk-muted)] focus:border-[var(--sk-accent)] focus:outline-none"
              />
            )}
          </div>
        </div>
      )}

      {/* Clean, minimalist horizontal-divider table matching Screenshot 2 */}
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-white/[0.1]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => {
                    if (!sortable) return;
                    if (sortCol === col.key) setSortAsc((a) => !a);
                    else {
                      setSortCol(col.key);
                      setSortAsc(true);
                    }
                  }}
                  className={`py-2.5 pr-4 font-semibold text-[var(--sk-text)] ${
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                  } ${sortable ? "cursor-pointer select-none hover:text-[var(--sk-accent-ink)]" : ""}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortable && sortCol === col.key && <ArrowUpDown size={11} className="opacity-70" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {displayedRows.map((row, rIdx) => {
              const rowKey = row.id || `r_${rIdx}`;
              const isExpanded = expandedRow === rowKey;
              return (
                <React.Fragment key={rowKey}>
                  <tr
                    onClick={() => row.detail && setExpandedRow(isExpanded ? null : rowKey)}
                    className={`transition-colors ${
                      row.detail ? "cursor-pointer hover:bg-white/[0.03]" : "hover:bg-white/[0.015]"
                    }`}
                  >
                    {columns.map((col, cIdx) => {
                      const val = row.cells[col.key] ?? "—";
                      return (
                        <td
                          key={col.key}
                          className={`py-2.5 pr-4 leading-snug ${
                            cIdx === 0 ? "text-[var(--sk-text)]/90" : "font-medium text-[var(--sk-text)]"
                          } ${
                            col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                          }`}
                        >
                          <div className="inline-flex items-center gap-1.5">
                            <span>{val}</span>
                            {cIdx === columns.length - 1 && row.detail && (
                              <ChevronRight
                                size={12}
                                className={`text-[var(--sk-muted)] transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && row.detail && (
                    <tr className="bg-white/[0.02]">
                      <td colSpan={columns.length} className="px-3 py-2 text-[12px] text-[var(--sk-muted)]">
                        {row.detail}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {caption && <p className="mt-2 text-[11.5px] text-[var(--sk-muted)]">{caption}</p>}
    </div>
  );
}

// ── 3. Probability Bars / Final Verdict Widget (Matches Screenshot 1) ────────
function ProbabilityBarsWidget({
  title,
  subtitle,
  bars: initialBars,
  caption,
  summary,
  interactive = false,
  scenarios,
}: {
  title?: string;
  subtitle?: string;
  bars: UIProbabilityBar[];
  caption?: string;
  summary?: string;
  interactive?: boolean;
  scenarios?: UIScenario[];
}) {
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(scenarios?.[0]?.id || null);
  const [customValues, setCustomValues] = useState<number[] | null>(null);

  const activeScenario = scenarios?.find((s) => s.id === activeScenarioId);
  const bars = useMemo<UIProbabilityBar[]>(() => {
    if (activeScenario?.probabilities?.length) {
      return activeScenario.probabilities.map((p) => ({
        label: p.label,
        value: p.value,
        displayValue: `${Math.round(p.value)}%`,
        color: p.color,
      }));
    }
    if (customValues && customValues.length === initialBars.length) {
      return initialBars.map((b, i) => ({
        ...b,
        value: customValues[i],
        displayValue: `${Math.round(customValues[i])}%`,
      }));
    }
    return initialBars;
  }, [initialBars, activeScenario, customValues]);

  // Default colors matching Screenshot 1:
  // First bar: warm gold/amber (#d4a017), Second bar: slate blue-gray (#6e7f99)
  const barColors = ["#d4a017", "#6e7f99", "#34d399", "#a78bfa", "#fb7185"];

  return (
    <div className="my-4 space-y-3">
      {(title || subtitle || (scenarios && scenarios.length > 1)) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {title && <h4 className="text-[15.5px] font-bold text-[var(--sk-text)]">{title}</h4>}
            {subtitle && <p className="text-[12px] text-[var(--sk-muted)]">{subtitle}</p>}
          </div>
          {scenarios && scenarios.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {scenarios.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => {
                    setActiveScenarioId(sc.id);
                    setCustomValues(null);
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                    sc.id === activeScenarioId
                      ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                      : "bg-white/[0.04] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                  }`}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {bars.map((bar, idx) => {
          const pct = Math.max(0, Math.min(100, bar.value));
          const fill = bar.color ? resolveColor(bar.color, idx) : barColors[idx % barColors.length];
          return (
            <div key={idx} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-[13.5px] font-bold text-[var(--sk-text)]">
                <span>{bar.label}</span>
                <span className="font-mono">{bar.displayValue || `${Math.round(pct)}%`}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.12]">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(2, pct)}%`, backgroundColor: fill }}
                />
              </div>
              {interactive && bars.length === 2 && idx === 0 && (
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(pct)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setCustomValues([v, 100 - v]);
                  }}
                  aria-label={`Adjust ${bar.label} probability`}
                  className="mt-1 h-1 w-full cursor-pointer opacity-60 accent-amber-400 hover:opacity-100"
                />
              )}
              {bar.subtitle && <div className="text-[11px] text-[var(--sk-muted)]">{bar.subtitle}</div>}
            </div>
          );
        })}
      </div>

      {caption && <p className="text-[11.5px] text-[var(--sk-muted)]">{caption}</p>}

      {summary && (
        <div className="pt-1 text-[13.5px] leading-relaxed text-[var(--sk-text)]">
          <EnhancedMarkdown text={summary} />
        </div>
      )}
    </div>
  );
}

// ── 4. Stat Grid / Metrics Widget ────────────────────────────────────────────
function StatGridWidget({
  title,
  cols = 3,
  stats,
}: {
  title?: string;
  cols?: 2 | 3 | 4;
  stats: UIStatItem[];
}) {
  const gridCls =
    cols === 2
      ? "grid-cols-1 sm:grid-cols-2"
      : cols === 4
      ? "grid-cols-2 sm:grid-cols-4"
      : "grid-cols-1 sm:grid-cols-3";

  return (
    <div className="my-3">
      {title && <h4 className="mb-2.5 text-[14.5px] font-semibold text-[var(--sk-text)]">{title}</h4>}
      <div className={`grid gap-2.5 ${gridCls}`}>
        {stats.map((s, idx) => (
          <div
            key={idx}
            className="flex flex-col justify-between rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)] p-3.5"
          >
            <div>
              <div className="flex items-center justify-between gap-1 text-[11.5px] text-[var(--sk-muted)]">
                <span className="truncate">{s.label}</span>
                {s.change && (
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${
                      s.trend === "up"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : s.trend === "down"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-white/[0.06] text-[var(--sk-muted)]"
                    }`}
                  >
                    {s.trend === "up" && <TrendingUp size={10} />}
                    {s.trend === "down" && <TrendingDown size={10} />}
                    {s.change}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-[20px] font-bold tracking-tight text-[var(--sk-text)]">{s.value}</span>
                {s.unit && <span className="text-[12px] text-[var(--sk-muted)]">{s.unit}</span>}
              </div>
            </div>

            {s.progress !== undefined && (
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, s.progress))}%`,
                    backgroundColor: resolveColor(s.color, idx),
                  }}
                />
              </div>
            )}
            {s.description && <p className="mt-1.5 text-[11px] text-[var(--sk-muted)]">{s.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 5. Ranking / Tier List Widget ────────────────────────────────────────────
function RankingWidget({
  title,
  subtitle,
  sortable = true,
  filterable = false,
  items,
}: {
  title?: string;
  subtitle?: string;
  sortable?: boolean;
  filterable?: boolean;
  items: UIRankingItem[];
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [sortMode, setSortMode] = useState<"rank" | "score" | "title">("rank");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const cat = item.category || item.badge;
      if (cat && cat.length <= 24) set.add(cat);
    }
    return [...set];
  }, [items]);

  const displayedItems = useMemo(() => {
    let list = items.filter((item) => {
      if (selectedCategory === "ALL") return true;
      return item.category === selectedCategory || item.badge === selectedCategory;
    });
    if (sortMode === "score") {
      list = [...list].sort((a, b) => {
        const na = parseComparableNumber(a.score ?? a.progress ?? 0) ?? 0;
        const nb = parseComparableNumber(b.score ?? b.progress ?? 0) ?? 0;
        return nb - na;
      });
    } else if (sortMode === "title") {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [items, selectedCategory, sortMode]);

  return (
    <div className="my-3 space-y-2.5">
      {(title || subtitle || sortable || (filterable && categories.length > 1)) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {title && (
              <h4 className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--sk-text)]">
                <Trophy size={15} className="text-amber-400" />
                {title}
              </h4>
            )}
            {subtitle && <p className="text-[12px] text-[var(--sk-muted)]">{subtitle}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {filterable && categories.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedCategory("ALL")}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                    selectedCategory === "ALL"
                      ? "bg-white/[0.12] text-[var(--sk-text)]"
                      : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                  }`}
                >
                  All
                </button>
                {categories.slice(0, 5).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(selectedCategory === cat ? "ALL" : cat)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                      selectedCategory === cat
                        ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                        : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </>
            )}

            {sortable && items.length >= 3 && (
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: "rank", label: "Rank" },
                    { id: "score", label: "Score" },
                    { id: "title", label: "A–Z" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSortMode(opt.id)}
                    className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition ${
                      sortMode === opt.id
                        ? "border-[var(--sk-accent)] bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                        : "border-[var(--sk-line)] text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {displayedItems.map((item, idx) => {
          const isTop = String(item.rank) === "1" || String(item.rank).toUpperCase() === "S" || (sortMode === "rank" && idx === 0);
          const isExpanded = expandedIdx === idx;
          return (
            <div
              key={idx}
              onClick={() => item.details && setExpandedIdx(isExpanded ? null : idx)}
              className={`flex items-start gap-3 rounded-2xl border p-3 transition ${
                item.details ? "cursor-pointer" : ""
              } ${
                isTop
                  ? "border-amber-500/35 bg-amber-500/[0.05]"
                  : "border-[var(--sk-line)] bg-[var(--sk-glass)]"
              }`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl font-mono text-[12px] font-bold ${
                  isTop
                    ? "bg-amber-400 text-black"
                    : "border border-[var(--sk-line)] bg-[var(--sk-raised)] text-[var(--sk-muted)]"
                }`}
              >
                {item.rank}
              </div>

              {(item.imageUrl || item.imageQuery) && (
                <div className="w-14 shrink-0">
                  <SmartImage
                    imageUrl={item.imageUrl}
                    imageQuery={item.imageQuery}
                    alt={item.title}
                    aspect="square"
                    showBookmark={false}
                  />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[13.5px] font-semibold text-[var(--sk-text)]">{item.title}</span>
                    {item.subtitle && <span className="ml-2 text-[11.5px] text-[var(--sk-muted)]">{item.subtitle}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {item.category && item.category !== item.badge && (
                      <span className="rounded-full border border-[var(--sk-line)] px-2 py-0.5 text-[10px] text-[var(--sk-muted)]">
                        {item.category}
                      </span>
                    )}
                    {item.badge && (
                      <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10.5px] text-[var(--sk-accent-ink)]">
                        {item.badge}
                      </span>
                    )}
                    {item.score !== undefined && (
                      <span className="font-mono text-[12.5px] font-bold text-[var(--sk-text)]">{item.score}</span>
                    )}
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] text-[var(--sk-accent-ink)] hover:underline"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                </div>

                {item.progress !== undefined && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, Math.min(100, item.progress))}%`,
                        backgroundColor: item.color ? resolveColor(item.color, idx) : isTop ? "#eab308" : "#f26a0e",
                      }}
                    />
                  </div>
                )}

                {item.description && (
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--sk-muted)]">{item.description}</p>
                )}

                {item.details && isExpanded && (
                  <div className="mt-2 rounded-xl border border-[var(--sk-line)] bg-[var(--sk-raised)] p-2.5 text-[12px] text-[var(--sk-text)]/90">
                    {item.details}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Gallery: captioned image grid with optional category filter ──────────────
function GalleryWidget({ node }: { node: Extract<UINode, { type: "gallery" }> }) {
  const [cat, setCat] = useState("ALL");
  const cats = useMemo(
    () => [...new Set(node.items.map((i) => i.category).filter((c): c is string => Boolean(c)))],
    [node.items]
  );
  const items = cat === "ALL" ? node.items : node.items.filter((i) => i.category === cat);
  const gCols =
    node.cols === 2 ? "grid-cols-2" : node.cols === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3";
  return (
    <div className="my-3">
      {(node.title || node.subtitle || (node.filterable && cats.length > 1)) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            {node.title && <h4 className="text-[14.5px] font-semibold text-[var(--sk-text)]">{node.title}</h4>}
            {node.subtitle && <p className="text-[12px] text-[var(--sk-muted)]">{node.subtitle}</p>}
          </div>
          {node.filterable && cats.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {["ALL", ...cats].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCat(c)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                    cat === c
                      ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                      : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                  }`}
                >
                  {c === "ALL" ? "All" : c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className={`grid gap-3 ${gCols}`}>
        {items.map((item, i) => (
          <div key={i} className="flex flex-col">
            <SmartImage
              imageUrl={item.imageUrl}
              imageQuery={item.imageQuery}
              alt={item.title || "Gallery image"}
              aspect="video"
            />
            {(item.title || item.subtitle || item.description) && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5">
                  {item.title && <div className="text-[13px] font-semibold text-[var(--sk-text)]">{item.title}</div>}
                  {item.badge && (
                    <span className="rounded-full bg-white/[0.07] px-1.5 text-[10px] text-[var(--sk-accent-ink)]">
                      {item.badge}
                    </span>
                  )}
                </div>
                {item.subtitle && <div className="text-[11px] text-[var(--sk-muted)]">{item.subtitle}</div>}
                {item.description && (
                  <p className="mt-0.5 text-[12px] leading-snug text-[var(--sk-text)]/80">{item.description}</p>
                )}
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--sk-accent-ink)] hover:underline"
                  >
                    Source ↗
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 6. Tabs & Accordion Widgets ──────────────────────────────────────────────
function TabsWidget({
  defaultTab,
  tabs,
  renderNode,
  onRunPrompt,
}: {
  defaultTab?: string;
  tabs: { id: string; label: string; badge?: string; content?: string; children?: UINode[] }[];
  renderNode: (n: UINode, idx: number) => ReactNode;
  onRunPrompt?: (text: string) => void;
}) {
  const [activeId, setActiveId] = useState(defaultTab || tabs[0]?.id);
  const current = tabs.find((t) => t.id === activeId) || tabs[0];

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)]">
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto border-b border-[var(--sk-line)] bg-white/[0.02] p-1.5"
      >
        {tabs.map((t) => {
          const active = t.id === current?.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveId(t.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition ${
                active
                  ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                  : "text-[var(--sk-muted)] hover:bg-[var(--sk-hover)] hover:text-[var(--sk-text)]"
              }`}
            >
              <span>{t.label}</span>
              {t.badge && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.2 text-[10px]">{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>
      {current && (
        <div role="tabpanel" className="p-4">
          {current.content && <EnhancedMarkdown text={current.content} onRunPrompt={onRunPrompt} />}
          {current.children && (
            <div className="space-y-3">{current.children.map((c, i) => renderNode(c, i))}</div>
          )}
        </div>
      )}
    </div>
  );
}

function AccordionWidget({
  title,
  allowMultiple = true,
  items,
  renderNode,
  onRunPrompt,
}: {
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
  renderNode: (n: UINode, idx: number) => ReactNode;
  onRunPrompt?: (text: string) => void;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.defaultOpen).map((i) => i.id))
  );

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(allowMultiple ? prev : []);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="my-3 space-y-2">
      {title && <h4 className="text-[14.5px] font-semibold text-[var(--sk-text)]">{title}</h4>}
      <div className="divide-y divide-[var(--sk-line)] overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)]">
        {items.map((item) => {
          const isOpen = openIds.has(item.id);
          return (
            <div key={item.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(item.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[var(--sk-hover)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-[var(--sk-text)]">{item.title}</span>
                    {item.badge && (
                      <span className="rounded-full bg-[var(--sk-accent-soft)] px-2 py-0.5 text-[10.5px] text-[var(--sk-accent-ink)]">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  {item.subtitle && <div className="mt-0.5 text-[11.5px] text-[var(--sk-muted)]">{item.subtitle}</div>}
                </div>
                <ChevronDown
                  size={15}
                  className={`shrink-0 text-[var(--sk-muted)] transition-transform duration-200 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isOpen && (
                <div className="border-t border-[var(--sk-line)] bg-white/[0.01] px-4 py-3">
                  {item.content && <EnhancedMarkdown text={item.content} onRunPrompt={onRunPrompt} />}
                  {item.children && (
                    <div className="space-y-3">{item.children.map((c, i) => renderNode(c, i))}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 7. Callout / Contextual Panel Widget ─────────────────────────────────────
function CalloutWidget({
  variant = "info",
  title,
  content,
  children,
  citations,
  renderNode,
  onRunPrompt,
}: {
  variant?: "info" | "tip" | "warning" | "danger" | "verdict" | "quote";
  title?: string;
  content?: string;
  children?: UINode[];
  citations?: UICitation[];
  renderNode: (n: UINode, idx: number) => ReactNode;
  onRunPrompt?: (text: string) => void;
}) {
  const styles: Record<string, { border: string; bg: string; icon: ReactNode }> = {
    info: {
      border: "border-sky-500/30",
      bg: "bg-sky-500/[0.06]",
      icon: <Info size={15} className="text-sky-400" />,
    },
    tip: {
      border: "border-emerald-500/30",
      bg: "bg-emerald-500/[0.06]",
      icon: <Lightbulb size={15} className="text-emerald-400" />,
    },
    warning: {
      border: "border-amber-500/35",
      bg: "bg-amber-500/[0.07]",
      icon: <AlertTriangle size={15} className="text-amber-400" />,
    },
    danger: {
      border: "border-red-500/35",
      bg: "bg-red-500/[0.07]",
      icon: <ShieldAlert size={15} className="text-red-400" />,
    },
    verdict: {
      border: "border-[var(--sk-accent-line)]",
      bg: "bg-[var(--sk-accent-soft)]",
      icon: <Trophy size={15} className="text-[var(--sk-accent-ink)]" />,
    },
    quote: {
      border: "border-[var(--sk-line)]",
      bg: "bg-[var(--sk-raised)]",
      icon: <Quote size={15} className="text-[var(--sk-muted)]" />,
    },
  };

  const st = styles[variant] || styles.info;

  return (
    <div className={`my-3 rounded-2xl border p-3.5 ${st.border} ${st.bg}`}>
      {title && (
        <div className="mb-1.5 flex items-center gap-2 text-[13.5px] font-semibold text-[var(--sk-text)]">
          {st.icon}
          <span>{title}</span>
        </div>
      )}
      {content && <EnhancedMarkdown text={content} onRunPrompt={onRunPrompt} />}
      {children && <div className="mt-2 space-y-2.5">{children.map((c, i) => renderNode(c, i))}</div>}
      {citations && citations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {citations.map((c, i) => (
            <CitationPill key={i} citation={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 8. Pending Streaming UI Skeleton ─────────────────────────────────────────
export function UIPendingSkeleton({
  previewTitle,
  previewType,
}: {
  previewTitle?: string;
  previewType?: string;
}) {
  const label = previewTitle
    ? `Building ${previewTitle}…`
    : previewType
    ? `Composing ${previewType.replace(/_/g, " ")}…`
    : "Composing interactive view…";

  return (
    <div
      className="my-3 overflow-hidden rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)] p-4"
      role="status"
      aria-label={label}
    >
      <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[var(--sk-accent-ink)]">
        <Sparkles size={13} className="sk-pulse" />
        <span>{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="sk-skel h-32 rounded-xl" />
        <div className="sk-skel h-32 rounded-xl" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="sk-skel h-3.5 w-2/3 rounded-md" />
        <div className="sk-skel h-3 w-1/2 rounded-md" />
      </div>
    </div>
  );
}

// ── 9. Recursive DynamicUIRenderer ───────────────────────────────────────────
export function DynamicUIRenderer({
  node,
  messageId,
  state,
  onStateChange,
  onSendMessage,
  onRunPrompt,
}: {
  node: UINode;
  messageId?: string;
  state: Record<string, UIValue>;
  onStateChange: (key: string, val: UIValue) => void;
  onSendMessage?: (text: string) => void;
  onRunPrompt?: (text: string) => void;
}) {
  const triggerAction = useCallback(
    (action: UIAction) => {
      if (action.type === "set_state" && action.stateKey) {
        onStateChange(action.stateKey, action.value ?? "");
      } else if (action.type === "reset_state") {
        onStateChange("__reset__", "");
      } else if (action.type === "open_url" && action.url) {
        window.open(action.url, "_blank", "noopener,noreferrer");
      } else if (action.type === "send_message" && action.prompt && onSendMessage) {
        const interpolated = action.prompt.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(state[k] ?? ""));
        onSendMessage(interpolated);
      }
    },
    [onStateChange, onSendMessage, state]
  );

  const renderNode = useCallback(
    (n: UINode, keyIdx: number): ReactNode => {
      if (!evaluateCondition(n.when, state)) return null;

      return (
        <UINodeBoundary key={keyIdx}>
          {(() => {
            switch (n.type) {
              case "stack": {
                const isRow = n.direction === "horizontal";
                const gapCls =
                  n.gap === "xs"
                    ? "gap-1.5"
                    : n.gap === "sm"
                    ? "gap-2.5"
                    : n.gap === "lg"
                    ? "gap-5"
                    : "gap-3.5";
                return (
                  <div
                    className={`flex ${isRow ? "flex-row flex-wrap items-start" : "flex-col"} ${gapCls}`}
                  >
                    {n.children.map((c, i) => renderNode(c, i))}
                  </div>
                );
              }

              case "grid": {
                const colsCls =
                  n.cols === 1
                    ? "grid-cols-1"
                    : n.cols === 3
                    ? "grid-cols-1 sm:grid-cols-3"
                    : n.cols === 4
                    ? "grid-cols-2 sm:grid-cols-4"
                    : "grid-cols-1 sm:grid-cols-2";
                const gapCls =
                  n.gap === "xs" ? "gap-2" : n.gap === "sm" ? "gap-2.5" : n.gap === "lg" ? "gap-4" : "gap-3";
                return <div className={`my-2.5 grid ${colsCls} ${gapCls}`}>{n.children.map((c, i) => renderNode(c, i))}</div>;
              }

              case "card": {
                const borderMap: Record<string, string> = {
                  default: "border-[var(--sk-line)] bg-[var(--sk-glass)]",
                  glass: "border-[var(--sk-line)] bg-[var(--sk-glass)]",
                  highlight: "border-[var(--sk-accent-line)] bg-[var(--sk-accent-soft)]",
                  warning: "border-amber-500/35 bg-amber-500/[0.05]",
                  success: "border-emerald-500/35 bg-emerald-500/[0.05]",
                  danger: "border-red-500/35 bg-red-500/[0.05]",
                  subtle: "border-transparent bg-[var(--sk-raised)]",
                };
                return (
                  <div
                    className={`my-2 flex flex-col justify-between rounded-2xl border p-4 ${
                      borderMap[n.variant || "default"] || borderMap.default
                    }`}
                  >
                    <div>
                      {(n.eyebrow || n.title || n.badge || n.subtitle) && (
                        <div className="mb-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              {n.eyebrow && (
                                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sk-muted)]">
                                  {n.eyebrow}
                                </div>
                              )}
                              {n.title && <h4 className="text-[15px] font-bold text-[var(--sk-text)]">{n.title}</h4>}
                            </div>
                            {n.badge && (
                              <span className="shrink-0 rounded-full border border-[var(--sk-line)] bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-[var(--sk-accent-ink)]">
                                {n.badge}
                              </span>
                            )}
                          </div>
                          {n.subtitle && <p className="mt-0.5 text-[12px] text-[var(--sk-muted)]">{n.subtitle}</p>}
                        </div>
                      )}
                      <div className="space-y-3">{n.children.map((c, i) => renderNode(c, i))}</div>
                    </div>

                    {(n.footer || (n.actions && n.actions.length > 0)) && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sk-line)] pt-2.5">
                        {n.footer ? <span className="text-[11.5px] text-[var(--sk-muted)]">{n.footer}</span> : <span />}
                        {n.actions && (
                          <div className="flex flex-wrap gap-1.5">
                            {n.actions.map((act, aIdx) => (
                              <button
                                key={aIdx}
                                type="button"
                                onClick={() => triggerAction(act)}
                                className="sk-btn h-7 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-raised)] px-2.5 text-[11.5px] hover:border-[var(--sk-accent-line)]"
                              >
                                {act.label || "Select"}
                                {act.type === "open_url" && <ExternalLink size={11} />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              case "vs_card":
                return (
                  <VsCardWidget
                    title={n.title}
                    subtitle={n.subtitle}
                    combatants={n.combatants}
                    verdict={n.verdict}
                    scenarios={n.scenarios}
                    onSendMessage={onSendMessage}
                  />
                );

              case "verdict":
                return (
                  <div className="my-3">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sk-muted)]">
                      {n.eyebrow || "OVERVIEW"}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="text-[18px] font-bold tracking-tight text-[var(--sk-text)]">{n.title}</span>
                      {n.badge && (
                        <span className="rounded-full bg-[var(--sk-accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--sk-accent-ink)]">
                          {n.badge}
                        </span>
                      )}
                    </div>
                    {n.summary && (
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--sk-text)]/90">{n.summary}</p>
                    )}
                  </div>
                );

              case "comparison_table":
                return (
                  <ComparisonTableWidget
                    title={n.title}
                    subtitle={n.subtitle}
                    columns={n.columns}
                    rows={n.rows}
                    filterable={n.filterable}
                    sortable={n.sortable}
                    caption={n.caption}
                  />
                );

              case "probability_bars":
                return (
                  <ProbabilityBarsWidget
                    title={n.title}
                    subtitle={n.subtitle}
                    bars={n.bars}
                    caption={n.caption}
                    summary={n.summary}
                    interactive={n.interactive}
                    scenarios={n.scenarios}
                  />
                );

              case "stat_grid":
                return <StatGridWidget title={n.title} cols={n.cols} stats={n.stats} />;

              case "ranking":
                return (
                  <RankingWidget
                    title={n.title}
                    subtitle={n.subtitle}
                    sortable={n.sortable}
                    filterable={n.filterable}
                    items={n.items}
                  />
                );

              case "profile":
                return <ProfileWidget node={n} onSendMessage={onSendMessage} />;

              case "video_grid":
                return <VideoGridWidget node={n} />;

              case "timeline":
                return <TimelineWidget node={n} />;

              case "product_grid":
                return <ProductGridWidget node={n} onSendMessage={onSendMessage} />;

              case "news_feed":
                return <NewsFeedWidget node={n} />;

              case "map":
                return <GeoMapWidget node={n} />;

              case "steps":
                return <StepsWidget node={n} />;

              case "key_value":
                return <KeyValueWidget node={n} />;

              case "chart":
                return (
                  <ChartView
                    chartType={n.chartType}
                    title={n.title}
                    subtitle={n.subtitle}
                    labels={n.labels}
                    series={n.series}
                    unit={n.unit}
                    caption={n.caption}
                    height={n.height}
                  />
                );

              case "media_card":
                return (
                  <div className="my-2.5 flex flex-col">
                    <SmartImage
                      imageUrl={n.imageUrl}
                      imageQuery={n.imageQuery}
                      alt={n.title || n.caption || "Media"}
                      aspect={n.aspect || "auto"}
                    />
                    {(n.title || n.subtitle || n.caption) && (
                      <div className="mt-2">
                        {n.title && <div className="text-[13.5px] font-bold text-[var(--sk-text)]">{n.title}</div>}
                        {n.subtitle && <div className="text-[11.5px] text-[var(--sk-muted)]">{n.subtitle}</div>}
                        {n.caption && <p className="mt-1 text-[12px] text-[var(--sk-muted)]">{n.caption}</p>}
                      </div>
                    )}
                  </div>
                );

              case "gallery":
                return <GalleryWidget node={n} />;

              case "questionnaire":
                return (
                  <QuestionnaireWidget
                    id={n.id}
                    messageId={messageId}
                    title={n.title}
                    description={n.description}
                    badge={n.badge}
                    fields={n.fields}
                    submitLabel={n.submitLabel}
                    promptPrefix={n.promptPrefix}
                    onSendMessage={onSendMessage}
                    onStateChange={onStateChange}
                  />
                );

              case "quiz":
                return (
                  <QuizWidget
                    title={n.title}
                    subtitle={n.subtitle}
                    questions={n.questions}
                    onSendMessage={onSendMessage}
                  />
                );

              case "controls":
                return (
                  <InteractiveControlsWidget
                    title={n.title}
                    description={n.description}
                    stateKey={n.stateKey}
                    controlType={n.controlType}
                    options={n.options}
                    min={n.min}
                    max={n.max}
                    step={n.step}
                    unit={n.unit}
                    defaultValue={n.defaultValue}
                    actions={n.actions}
                    state={state}
                    onStateChange={onStateChange}
                    onTriggerAction={triggerAction}
                  />
                );

              case "tabs":
                return (
                  <TabsWidget
                    defaultTab={n.defaultTab}
                    tabs={n.tabs}
                    renderNode={renderNode}
                    onRunPrompt={onRunPrompt}
                  />
                );

              case "accordion":
                return (
                  <AccordionWidget
                    title={n.title}
                    allowMultiple={n.allowMultiple}
                    items={n.items}
                    renderNode={renderNode}
                    onRunPrompt={onRunPrompt}
                  />
                );

              case "callout":
                return (
                  <CalloutWidget
                    variant={n.variant}
                    title={n.title}
                    content={n.content}
                    children={n.children}
                    citations={n.citations}
                    renderNode={renderNode}
                    onRunPrompt={onRunPrompt}
                  />
                );

              case "text":
                return (
                  <div
                    className={
                      n.variant === "lead"
                        ? "text-[15px] font-medium leading-relaxed text-[var(--sk-text)]"
                        : n.variant === "caption" || n.variant === "muted"
                        ? "text-[12px] text-[var(--sk-muted)]"
                        : n.variant === "heading"
                        ? "text-[16px] font-bold text-[var(--sk-text)]"
                        : ""
                    }
                  >
                    <EnhancedMarkdown text={n.content} onRunPrompt={onRunPrompt} />
                    {n.citations && n.citations.length > 0 && (
                      <span className="mt-1 inline-flex flex-wrap gap-1">
                        {n.citations.map((c, i) => (
                          <CitationPill key={i} citation={c} />
                        ))}
                      </span>
                    )}
                  </div>
                );

              case "citations":
                return (
                  <div className="my-2 flex flex-wrap items-center gap-1.5">
                    {n.items.map((c, i) => (
                      <CitationPill key={i} citation={c} />
                    ))}
                  </div>
                );

              case "math":
                return <MathView latex={n.latex} label={n.label} explanation={n.explanation} block={n.block} />;

              case "diagram":
                return (
                  <DiagramView
                    title={n.title}
                    subtitle={n.subtitle}
                    mermaid={n.mermaid}
                    direction={n.direction}
                    nodes={n.nodes}
                    edges={n.edges}
                    caption={n.caption}
                  />
                );

              case "document_preview":
                return (
                  <DocumentPreviewCard
                    title={n.title}
                    fileName={n.fileName}
                    fileType={n.fileType}
                    pageCount={n.pageCount}
                    summary={n.summary}
                    keyPoints={n.keyPoints}
                    metadata={n.metadata}
                    sections={n.sections}
                    onAskSection={onSendMessage}
                  />
                );

              case "model_viewer":
                return (
                  <ModelViewer3D
                    title={n.title}
                    subtitle={n.subtitle}
                    preset={n.preset}
                    modelUrl={n.modelUrl}
                    objData={n.objData}
                    vertices={n.vertices}
                    faces={n.faces}
                    color={n.color}
                    wireframe={n.wireframe}
                    autoRotate={n.autoRotate}
                    annotations={n.annotations}
                  />
                );

              case "code":
                return (
                  <CodeFence
                    language={n.language}
                    filename={n.filename}
                    code={n.code}
                    caption={n.caption}
                    onRunPrompt={onRunPrompt}
                  />
                );

              case "divider":
                return n.label ? (
                  <div className="my-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-[var(--sk-line)]" />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--sk-muted)]">
                      {n.label}
                    </span>
                    <div className="h-px flex-1 bg-[var(--sk-line)]" />
                  </div>
                ) : (
                  <hr className="my-4 border-0 border-t border-[var(--sk-line)]" />
                );
            }
          })()}
        </UINodeBoundary>
      );
    },
    [messageId, onRunPrompt, onSendMessage, onStateChange, state, triggerAction]
  );

  return <div className="sk-ui-root">{renderNode(node, 0)}</div>;
}

/**
 * Top-level rich message renderer that splits an AI reply into markdown, dynamic UI blocks,
 * math formulas, and mermaid diagrams, and wires up interactive state & conversation callbacks.
 */
export const RichMessageContent = memo(function RichMessageContent({
  messageId,
  text,
  streaming = false,
  uiImages,
  onSendMessage,
  onRunPrompt,
}: {
  messageId?: string;
  text: string;
  streaming?: boolean;
  uiImages?: Record<string, string[]>;
  onSendMessage?: (text: string) => void;
  onRunPrompt?: (text: string) => void;
}) {
  const [uiState, setUiState] = useState<Record<string, UIValue>>({});

  useEffect(() => {
    if (uiImages) seedUIImageCache(uiImages);
  }, [uiImages]);

  const handleStateChange = useCallback((key: string, val: UIValue) => {
    if (key === "__reset__") {
      setUiState({});
    } else {
      setUiState((prev) => ({ ...prev, [key]: val }));
    }
  }, []);

  const segments = useMemo(() => parseMessageSegments(text, streaming), [text, streaming]);

  return (
    <div className="space-y-3">
      {segments.map((seg, idx) => {
        if (seg.kind === "markdown") {
          return <EnhancedMarkdown key={idx} text={seg.text} onRunPrompt={onRunPrompt} />;
        }
        if (seg.kind === "ui") {
          return (
            <DynamicUIRenderer
              key={idx}
              node={seg.node}
              messageId={messageId}
              state={uiState}
              onStateChange={handleStateChange}
              onSendMessage={onSendMessage}
              onRunPrompt={onRunPrompt}
            />
          );
        }
        if (seg.kind === "ui_pending") {
          return <UIPendingSkeleton key={idx} previewTitle={seg.previewTitle} previewType={seg.previewType} />;
        }
        if (seg.kind === "mermaid") {
          return <DiagramView key={idx} mermaid={seg.code} />;
        }
        if (seg.kind === "math") {
          return <MathView key={idx} latex={seg.latex} block />;
        }
        return null;
      })}
    </div>
  );
});
