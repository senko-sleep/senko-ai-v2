"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Maximize2, Minimize2 } from "lucide-react";
import type { UIChartSeries, UIDiagramEdge, UIDiagramNode } from "@/lib/ui-schema";

const PALETTE = [
  "#f26a0e", // Fox ember orange
  "#eab308", // Warm gold / amber
  "#38bdf8", // Sky blue
  "#34d399", // Emerald
  "#a78bfa", // Purple
  "#fb7185", // Rose
];

export function resolveColor(color?: string, index = 0): string {
  if (!color) return PALETTE[index % PALETTE.length];
  const map: Record<string, string> = {
    orange: "#f26a0e",
    amber: "#eab308",
    yellow: "#eab308",
    gold: "#eab308",
    blue: "#38bdf8",
    slate: "#64748b",
    gray: "#64748b",
    green: "#34d399",
    emerald: "#34d399",
    purple: "#a78bfa",
    violet: "#a78bfa",
    red: "#f87171",
    rose: "#fb7185",
    cyan: "#22d3ee",
  };
  return map[color.toLowerCase()] || color;
}

export function ChartView({
  chartType: initialChartType,
  title,
  subtitle,
  labels,
  series,
  unit = "",
  caption,
  height = 240,
}: {
  chartType: "bar" | "horizontal_bar" | "line" | "area" | "radar" | "donut";
  title?: string;
  subtitle?: string;
  labels: string[];
  series: UIChartSeries[];
  unit?: string;
  caption?: string;
  height?: number;
}) {
  const [chartType, setChartType] = useState(initialChartType);
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const visibleSeries = useMemo(
    () => series.map((s, idx) => ({ ...s, idx, color: resolveColor(s.color, idx) })).filter((s) => !hiddenSeries.has(s.idx)),
    [series, hiddenSeries]
  );

  const toggleSeries = (idx: number) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else if (next.size < series.length - 1) {
        next.add(idx);
      }
      return next;
    });
  };

  const allValues = visibleSeries.flatMap((s) => s.data);
  const maxVal = Math.max(1, ...allValues, 0);

  return (
    <div className="my-3 rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          {title && <h4 className="text-[14.5px] font-semibold text-[var(--sk-text)]">{title}</h4>}
          {subtitle && <p className="mt-0.5 text-[12px] text-[var(--sk-muted)]">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {series.length > 1 &&
            series.map((s, idx) => {
              const col = resolveColor(s.color, idx);
              const hidden = hiddenSeries.has(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleSeries(idx)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                    hidden
                      ? "border-[var(--sk-line)] opacity-40"
                      : "border-[var(--sk-line)] bg-[var(--sk-hover)] text-[var(--sk-text)]"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col }} />
                  <span>{s.name}</span>
                </button>
              );
            })}

          {labels.length >= 2 && (
            <div className="flex items-center gap-1 rounded-full border border-[var(--sk-line)] bg-white/[0.02] p-0.5">
              {(
                [
                  { id: "bar", label: "Bar" },
                  { id: "horizontal_bar", label: "H-Bar" },
                  { id: "line", label: "Line" },
                  { id: "radar", label: "Radar" },
                  { id: "donut", label: "Donut" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setChartType(t.id)}
                  className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium transition ${
                    chartType === t.id
                      ? "bg-[var(--sk-accent-soft)] text-[var(--sk-accent-ink)]"
                      : "text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Horizontal Bar Chart */}
      {chartType === "horizontal_bar" && (
        <div className="space-y-3 py-1">
          {labels.map((label, lIdx) => (
            <div key={lIdx} className="space-y-1">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-medium text-[var(--sk-text)]">{label}</span>
                <span className="font-mono text-[12px] text-[var(--sk-muted)]">
                  {visibleSeries
                    .map((s) => `${s.data[lIdx] ?? 0}${unit}`)
                    .join(" / ")}
                </span>
              </div>
              <div className="space-y-1">
                {visibleSeries.map((s) => {
                  const v = s.data[lIdx] ?? 0;
                  const pct = Math.max(2, Math.min(100, (v / maxVal) * 100));
                  return (
                    <div key={s.idx} className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: s.color }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vertical Bar Chart */}
      {chartType === "bar" && (
        <div className="w-full overflow-x-auto">
          <div className="flex items-end gap-3 pt-4 pb-1" style={{ minHeight: `${height}px` }}>
            {labels.map((label, lIdx) => {
              const isHovered = hoveredIdx === lIdx;
              return (
                <div
                  key={lIdx}
                  onMouseEnter={() => setHoveredIdx(lIdx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="group/bar flex min-w-[44px] flex-1 flex-col items-center gap-1.5"
                >
                  <div className="flex h-[165px] w-full items-end justify-center gap-1 border-b border-[var(--sk-line)] px-1">
                    {visibleSeries.map((s) => {
                      const val = s.data[lIdx] ?? 0;
                      const hPct = Math.max(3, Math.min(100, (val / maxVal) * 100));
                      return (
                        <div key={s.idx} className="relative flex h-full flex-1 flex-col justify-end">
                          <div
                            className={`mb-1 text-center font-mono text-[10px] transition-opacity ${
                              isHovered ? " text-[var(--sk-text)] opacity-100" : "text-[var(--sk-muted)] opacity-75"
                            }`}
                          >
                            {val}
                            {unit}
                          </div>
                          <div
                            className="w-full rounded-t-md transition-all duration-300"
                            style={{
                              height: `${hPct}%`,
                              backgroundColor: s.color,
                              opacity: hoveredIdx === null || isHovered ? 0.92 : 0.5,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <span className="max-w-[90px] truncate text-center text-[11px] text-[var(--sk-muted)]" title={label}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Line & Area Chart */}
      {(chartType === "line" || chartType === "area") && (
        <div className="w-full">
          <svg viewBox="0 0 560 210" className="w-full overflow-visible">
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
              const y = 20 + (1 - t) * 150;
              const v = Math.round(t * maxVal * 10) / 10;
              return (
                <g key={i}>
                  <line x1={44} y1={y} x2={545} y2={y} stroke="currentColor" className="text-white/[0.06]" strokeDasharray="3 3" />
                  <text x={38} y={y + 3} textAnchor="end" className="fill-[var(--sk-faint)] font-mono text-[9.5px]">
                    {v}
                    {unit}
                  </text>
                </g>
              );
            })}
            {/* Series paths */}
            {visibleSeries.map((s) => {
              const count = Math.max(1, labels.length);
              const pts = labels.map((_, i) => {
                const x = count === 1 ? 290 : 48 + (i / (count - 1)) * 490;
                const val = s.data[i] ?? 0;
                const y = 170 - (val / maxVal) * 150;
                return { x, y, val };
              });
              const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
              const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} 170 L ${pts[0].x.toFixed(1)} 170 Z`;

              return (
                <g key={s.idx}>
                  {chartType === "area" && <path d={areaPath} fill={s.color} fillOpacity={0.14} />}
                  <path d={linePath} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                  {pts.map((p, i) => (
                    <g
                      key={i}
                      onMouseEnter={() => setHoveredIdx(i)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className="cursor-pointer"
                    >
                      <circle cx={p.x} cy={p.y} r={hoveredIdx === i ? 5 : 3.5} fill={s.color} stroke="#0a0705" strokeWidth={1.5} />
                      {hoveredIdx === i && (
                        <text
                          x={p.x}
                          y={p.y - 9}
                          textAnchor="middle"
                          className="fill-[var(--sk-text)] font-mono text-[10px] font-semibold"
                        >
                          {p.val}
                          {unit}
                        </text>
                      )}
                    </g>
                  ))}
                </g>
              );
            })}
            {/* X-axis labels */}
            {labels.map((label, i) => {
              const count = Math.max(1, labels.length);
              const x = count === 1 ? 290 : 48 + (i / (count - 1)) * 490;
              return (
                <text key={i} x={x} y={192} textAnchor="middle" className="fill-[var(--sk-muted)] text-[10px]">
                  {label.length > 12 ? `${label.slice(0, 11)}…` : label}
                </text>
              );
            })}
          </svg>
        </div>
      )}

      {/* Radar / Spider Chart */}
      {chartType === "radar" && (
        <div className="flex flex-col items-center justify-center py-2">
          <svg viewBox="0 0 300 250" className="max-h-[250px] w-full max-w-[320px] overflow-visible">
            {(() => {
              const cx = 150;
              const cy = 125;
              const r = 85;
              const n = Math.max(3, labels.length);
              const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

              return (
                <>
                  {/* Concentric rings */}
                  {[0.25, 0.5, 0.75, 1].map((ring, rIdx) => {
                    const poly = Array.from({ length: n }, (_, i) => {
                      const a = angleFor(i);
                      return `${(cx + Math.cos(a) * r * ring).toFixed(1)},${(cy + Math.sin(a) * r * ring).toFixed(1)}`;
                    }).join(" ");
                    return <polygon key={rIdx} points={poly} fill="none" stroke="currentColor" className="text-white/[0.08]" />;
                  })}
                  {/* Axes & Labels */}
                  {labels.map((label, i) => {
                    const a = angleFor(i);
                    const x2 = cx + Math.cos(a) * r;
                    const y2 = cy + Math.sin(a) * r;
                    const lx = cx + Math.cos(a) * (r + 20);
                    const ly = cy + Math.sin(a) * (r + 16);
                    return (
                      <g key={i}>
                        <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="currentColor" className="text-white/[0.08]" />
                        <text
                          x={lx}
                          y={ly + 3}
                          textAnchor="middle"
                          className="fill-[var(--sk-muted)] text-[9.5px] font-medium"
                        >
                          {label.length > 16 ? `${label.slice(0, 15)}…` : label}
                        </text>
                      </g>
                    );
                  })}
                  {/* Series polygons */}
                  {visibleSeries.map((s) => {
                    const pts = Array.from({ length: n }, (_, i) => {
                      const val = Math.max(0, s.data[i] ?? 0);
                      const ratio = Math.min(1, val / maxVal);
                      const a = angleFor(i);
                      return `${(cx + Math.cos(a) * r * ratio).toFixed(1)},${(cy + Math.sin(a) * r * ratio).toFixed(1)}`;
                    }).join(" ");
                    return (
                      <polygon
                        key={s.idx}
                        points={pts}
                        fill={s.color}
                        fillOpacity={0.22}
                        stroke={s.color}
                        strokeWidth={2}
                      />
                    );
                  })}
                </>
              );
            })()}
          </svg>
        </div>
      )}

      {/* Donut / Pie Chart */}
      {chartType === "donut" && (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-around">
          {(() => {
            const data = visibleSeries[0]?.data || [];
            const total = Math.max(
              0.0001,
              data.reduce((acc, v) => acc + Math.max(0, v), 0)
            );
            const radius = 58;
            const circum = 2 * Math.PI * radius;
            let offsetAcc = 0;

            return (
              <>
                <svg viewBox="0 0 160 160" className="h-36 w-36 shrink-0">
                  {data.map((val, i) => {
                    const frac = Math.max(0, val) / total;
                    const dash = frac * circum;
                    const strokeOffset = -offsetAcc;
                    offsetAcc += dash;
                    const col = resolveColor(undefined, i);
                    return (
                      <circle
                        key={i}
                        cx={80}
                        cy={80}
                        r={radius}
                        fill="transparent"
                        stroke={col}
                        strokeWidth={hoveredIdx === i ? 20 : 16}
                        strokeDasharray={`${dash} ${circum - dash}`}
                        strokeDashoffset={strokeOffset}
                        transform="rotate(-90 80 80)"
                        className="cursor-pointer transition-all"
                        onMouseEnter={() => setHoveredIdx(i)}
                        onMouseLeave={() => setHoveredIdx(null)}
                      />
                    );
                  })}
                  <text x={80} y={77} textAnchor="middle" className="fill-[var(--sk-text)] font-mono text-[14px] font-semibold">
                    {hoveredIdx !== null && data[hoveredIdx] !== undefined
                      ? `${data[hoveredIdx]}${unit}`
                      : `${Math.round(total)}${unit}`}
                  </text>
                  <text x={80} y={93} textAnchor="middle" className="fill-[var(--sk-muted)] text-[9.5px]">
                    {hoveredIdx !== null && labels[hoveredIdx] ? labels[hoveredIdx].slice(0, 12) : "Total"}
                  </text>
                </svg>

                <div className="grid flex-1 grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {labels.map((label, i) => {
                    const val = data[i] ?? 0;
                    const pct = Math.round((Math.max(0, val) / total) * 100);
                    return (
                      <div
                        key={i}
                        onMouseEnter={() => setHoveredIdx(i)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition ${
                          hoveredIdx === i ? "bg-[var(--sk-hover)]" : ""
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: resolveColor(undefined, i) }} />
                          <span className="truncate text-[var(--sk-text)]">{label}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[11.5px] text-[var(--sk-muted)]">
                          {val}
                          {unit} ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {caption && <p className="mt-2.5 text-[11.5px] text-[var(--sk-muted)]">{caption}</p>}
    </div>
  );
}

/**
 * Parses basic Mermaid flowchart / sequence diagrams into nodes and edges so we can render
 * crisp, interactive native SVG diagrams with zero external runtime failures.
 */
function parseMermaidToGraph(code: string): {
  direction: "LR" | "TD";
  nodes: UIDiagramNode[];
  edges: UIDiagramEdge[];
} {
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%%"));

  let direction: "LR" | "TD" = "LR";
  const header = lines[0] || "";
  if (/\b(TD|TB)\b/i.test(header)) direction = "TD";

  const nodeMap = new Map<string, UIDiagramNode>();
  const edges: UIDiagramEdge[] = [];

  const ensureNode = (rawToken: string): string => {
    const clean = rawToken.trim();
    const m = /^([A-Za-z0-9_.-]+)\s*(?:\["?([^"\]]+)"?\]|\("?([^"\)]+)"?\)|\{+"?([^"\}]+)"?\}+)?$/.exec(clean);
    if (m) {
      const id = m[1];
      const label = (m[2] || m[3] || m[4] || id).trim();
      if (!nodeMap.has(id) || (nodeMap.get(id)?.label === id && label !== id)) {
        nodeMap.set(id, { id, label });
      }
      return id;
    }
    const fallbackId = clean.replace(/[^A-Za-z0-9_]/g, "_") || "node";
    if (!nodeMap.has(fallbackId)) {
      nodeMap.set(fallbackId, { id: fallbackId, label: clean });
    }
    return fallbackId;
  };

  for (const line of lines.slice(1)) {
    if (/^(subgraph|end|style|classDef|class|click)\b/i.test(line)) continue;
    // Match edge patterns: A[Label] -->|edgeLabel| B[Label] or A ->> B: message
    const seqMatch = /^([A-Za-z0-9_]+)\s*(--?>?>?)\s*([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(line);
    if (seqMatch) {
      const from = ensureNode(seqMatch[1]);
      const to = ensureNode(seqMatch[3]);
      edges.push({ from, to, label: seqMatch[4].trim(), dashed: seqMatch[2].includes("--") });
      continue;
    }

    const edgeMatch = /^(.+?)\s*(-\.->|==>|--+>|---+)\s*(?:\|([^|]+)\|\s*)?(.+)$/.exec(line);
    if (edgeMatch) {
      const from = ensureNode(edgeMatch[1]);
      const to = ensureNode(edgeMatch[4]);
      edges.push({
        from,
        to,
        label: edgeMatch[3]?.trim(),
        dashed: edgeMatch[2].includes("."),
      });
      continue;
    }

    // Standalone node definition
    if (/^[A-Za-z0-9_]+\s*[\[\(\{]/.test(line)) {
      ensureNode(line);
    }
  }

  return {
    direction,
    nodes: [...nodeMap.values()],
    edges,
  };
}

export function DiagramView({
  title,
  subtitle,
  mermaid,
  direction: propDirection,
  nodes: propNodes,
  edges: propEdges,
  caption,
}: {
  title?: string;
  subtitle?: string;
  mermaid?: string;
  direction?: "LR" | "TD";
  nodes?: UIDiagramNode[];
  edges?: UIDiagramEdge[];
  caption?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const parsed = useMemo(() => {
    if (propNodes?.length) {
      return {
        direction: propDirection || "LR",
        nodes: propNodes,
        edges: propEdges || [],
      };
    }
    if (mermaid) {
      return parseMermaidToGraph(mermaid);
    }
    return { direction: "LR" as const, nodes: [], edges: [] };
  }, [mermaid, propDirection, propNodes, propEdges]);

  const { direction, nodes, edges } = parsed;

  if (!nodes.length) {
    return mermaid ? (
      <pre className="my-2 overflow-x-auto rounded-xl border border-[var(--sk-line)] bg-[var(--sk-code-bg)] p-3 font-mono text-xs text-[var(--sk-muted)]">
        {mermaid}
      </pre>
    ) : null;
  }

  // Assign layered coordinates (BFS topological levels)
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }

  const levels = new Map<string, number>();
  const queue = nodes.filter((n) => (inDegree.get(n.id) || 0) === 0).map((n) => n.id);
  if (!queue.length && nodes[0]) queue.push(nodes[0].id);

  for (const id of queue) levels.set(id, 0);
  while (queue.length) {
    const cur = queue.shift()!;
    const curLvl = levels.get(cur) || 0;
    for (const e of edges) {
      if (e.from === cur && !levels.has(e.to)) {
        levels.set(e.to, curLvl + 1);
        queue.push(e.to);
      }
    }
  }
  for (const n of nodes) {
    if (!levels.has(n.id)) levels.set(n.id, 0);
  }

  const groupsByLevel = new Map<number, UIDiagramNode[]>();
  for (const n of nodes) {
    const l = levels.get(n.id) || 0;
    const arr = groupsByLevel.get(l) || [];
    arr.push(n);
    groupsByLevel.set(l, arr);
  }

  const maxLevel = Math.max(0, ...groupsByLevel.keys());
  const maxPerLevel = Math.max(1, ...[...groupsByLevel.values()].map((g) => g.length));

  const isTD = direction === "TD";
  const nodeW = 148;
  const nodeH = 48;
  const gapMain = isTD ? 92 : 196;
  const gapCross = isTD ? 172 : 74;

  const svgW = isTD ? Math.max(420, maxPerLevel * gapCross + 80) : Math.max(420, (maxLevel + 1) * gapMain + 60);
  const svgH = isTD ? Math.max(180, (maxLevel + 1) * gapMain + 40) : Math.max(160, maxPerLevel * gapCross + 50);

  const positions = new Map<string, { x: number; y: number }>();
  for (const [lvl, group] of groupsByLevel.entries()) {
    group.forEach((n, idx) => {
      const offset = idx - (group.length - 1) / 2;
      if (isTD) {
        positions.set(n.id, {
          x: svgW / 2 + offset * gapCross,
          y: 44 + lvl * gapMain,
        });
      } else {
        positions.set(n.id, {
          x: 96 + lvl * gapMain,
          y: svgH / 2 + offset * gapCross,
        });
      }
    });
  }

  return (
    <div className="my-3 rounded-2xl border border-[var(--sk-line)] bg-[var(--sk-glass)] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          {title && <h4 className="text-[14px] font-semibold text-[var(--sk-text)]">{title}</h4>}
          {subtitle && <p className="text-[12px] text-[var(--sk-muted)]">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="sk-btn h-7 w-7 rounded-lg text-[var(--sk-muted)] hover:text-[var(--sk-text)]"
          title={expanded ? "Compact view" : "Expand diagram"}
          aria-label={expanded ? "Compact view" : "Expand diagram"}
        >
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      <div className="sk-scroll overflow-x-auto rounded-xl bg-black/25 p-2">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className={`mx-auto w-full ${expanded ? "min-w-[640px]" : "max-h-[340px]"}`}
        >
          <defs>
            <marker id="sk-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#ab9b8d" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((e, idx) => {
            const p1 = positions.get(e.from);
            const p2 = positions.get(e.to);
            if (!p1 || !p2) return null;
            const highlighted = selectedId === e.from || selectedId === e.to;
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            return (
              <g key={idx}>
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={highlighted ? "#f26a0e" : "rgba(255,200,150,0.28)"}
                  strokeWidth={highlighted ? 2.2 : 1.5}
                  strokeDasharray={e.dashed ? "4 4" : undefined}
                  markerEnd="url(#sk-arrow)"
                />
                {e.label && (
                  <g transform={`translate(${midX}, ${midY})`}>
                    <rect x={-36} y={-9} width={72} height={18} rx={6} fill="#130d09" stroke="rgba(255,200,150,0.18)" />
                    <text x={0} y={3} textAnchor="middle" className="fill-[var(--sk-muted)] text-[9px]">
                      {e.label.slice(0, 14)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((n, idx) => {
            const pos = positions.get(n.id);
            if (!pos) return null;
            const isSelected = selectedId === n.id;
            const col = n.color ? resolveColor(n.color, idx) : "#f26a0e";
            return (
              <g
                key={n.id}
                transform={`translate(${pos.x - nodeW / 2}, ${pos.y - nodeH / 2})`}
                onClick={() => setSelectedId(isSelected ? null : n.id)}
                className="cursor-pointer"
              >
                <rect
                  width={nodeW}
                  height={nodeH}
                  rx={12}
                  fill="#150e0a"
                  stroke={isSelected ? col : "rgba(255,200,150,0.22)"}
                  strokeWidth={isSelected ? 2 : 1.2}
                />
                <text
                  x={nodeW / 2}
                  y={n.subtitle ? 20 : 28}
                  textAnchor="middle"
                  className="fill-[var(--sk-text)] text-[11px] font-semibold"
                >
                  {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
                </text>
                {n.subtitle && (
                  <text x={nodeW / 2} y={35} textAnchor="middle" className="fill-[var(--sk-muted)] text-[9px]">
                    {n.subtitle.length > 22 ? `${n.subtitle.slice(0, 21)}…` : n.subtitle}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {caption && <p className="mt-2 text-[11.5px] text-[var(--sk-muted)]">{caption}</p>}
    </div>
  );
}

/**
 * Formats LaTeX mathematical strings into clean unicode + styled HTML symbols for fast,
 * zero-layout-shift equation rendering.
 */
export function formatLatexToReadable(latex: string): string {
  const greek: Record<string, string> = {
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\epsilon": "ϵ",
    "\\varepsilon": "ε",
    "\\zeta": "ζ",
    "\\eta": "η",
    "\\theta": "θ",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\pi": "π",
    "\\rho": "ρ",
    "\\sigma": "σ",
    "\\tau": "τ",
    "\\phi": "φ",
    "\\omega": "ω",
    "\\Delta": "Δ",
    "\\Sigma": "Σ",
    "\\Omega": "Ω",
    "\\Pi": "Π",
    "\\infty": "∞",
    "\\partial": "∂",
    "\\nabla": "∇",
    "\\pm": "±",
    "\\times": "×",
    "\\cdot": "·",
    "\\div": "÷",
    "\\neq": "≠",
    "\\leq": "≤",
    "\\geq": "≥",
    "\\approx": "≈",
    "\\equiv": "≡",
    "\\rightarrow": "→",
    "\\leftarrow": "←",
    "\\Rightarrow": "⇒",
    "\\int": "∫",
    "\\sum": "∑",
    "\\prod": "∏",
    "\\in": "∈",
    "\\forall": "∀",
    "\\exists": "∃",
  };

  let out = latex
    .trim()
    .replace(/^\$\$+|\$\$+$/g, "")
    .replace(/^\\\[|\\\]$/g, "")
    .trim();

  // Replace \frac{a}{b} -> (a) / (b)
  out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1) / ($2)");
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  out = out.replace(/\\text\{([^{}]+)\}/g, "$1");
  out = out.replace(/\\mathbf\{([^{}]+)\}/g, "$1");

  for (const [cmd, sym] of Object.entries(greek)) {
    out = out.split(cmd).join(sym);
  }

  out = out.replace(/\\left|\\right/g, "");
  return out;
}

export function MathView({
  latex,
  label,
  explanation,
  block = true,
}: {
  latex: string;
  label?: string;
  explanation?: string;
  block?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const formatted = useMemo(() => formatLatexToReadable(latex), [latex]);

  if (!block) {
    return (
      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[13px] text-[var(--sk-accent-2)]">
        {formatted}
      </code>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[var(--sk-line)] bg-[var(--sk-code-bg)]">
      <div className="flex items-center justify-between border-b border-white/[0.05] bg-white/[0.02] px-3.5 py-1.5 text-[11px] text-[var(--sk-muted)]">
        <span className="font-medium">{label || "Equation"}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(latex);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied LaTeX" : "Copy LaTeX"}
        </button>
      </div>
      <div className="overflow-x-auto px-4 py-3.5 text-center font-serif text-[16px] tracking-wide text-[var(--sk-text)]">
        {formatted}
      </div>
      {explanation && (
        <div className="border-t border-white/[0.05] bg-white/[0.015] px-3.5 py-2 text-[12px] text-[var(--sk-muted)]">
          {explanation}
        </div>
      )}
    </div>
  );
}
