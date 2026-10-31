"use client";

import React, { useMemo, useState } from "react";
import type { UINode } from "@/lib/ui-schema";
import { extractYouTubeVideoId } from "@/lib/ui-schema";
import { SmartImage } from "./smart-image";
import { MathView } from "./charts-and-diagrams";

function parseMetricNumber(val: string | number | undefined): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (!val) return 0;
  const s = String(val).trim().toUpperCase();
  const match = /^[$€£¥]?\s*(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*([KMBT])?/i.exec(s);
  if (match) {
    const base = parseFloat(match[1].replace(/,/g, ""));
    const mult = match[2] === "B" ? 1e9 : match[2] === "M" ? 1e6 : match[2] === "K" ? 1e3 : match[2] === "T" ? 1e12 : 1;
    return base * mult;
  }
  const fallback = parseFloat(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(fallback) ? fallback : 0;
}

function getSafeDomain(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ============================================================================
 * 1. PROFILE WIDGET (Characters, Real-World People, Entities)
 * ========================================================================== */

export function ProfileWidget({
  node,
  onSendMessage,
}: {
  node: Extract<UINode, { type: "profile" }>;
  onSendMessage?: (prompt: string) => void;
}) {
  const [selectedGalleryIdx, setSelectedGalleryIdx] = useState<number>(-1);
  const [triviaOpen, setTriviaOpen] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<"all" | "traits" | "abilities" | "relationships" | "appearances">("all");

  const galleryItems = useMemo(() => {
    const base = [{ title: node.name, subtitle: node.subtitle || node.series, imageUrl: node.imageUrl, imageQuery: node.imageQuery }];
    if (node.gallery?.length) {
      return [...base, ...node.gallery];
    }
    return base;
  }, [node.name, node.subtitle, node.series, node.imageUrl, node.imageQuery, node.gallery]);

  const activeMedia = galleryItems[selectedGalleryIdx >= 0 && selectedGalleryIdx < galleryItems.length ? selectedGalleryIdx : 0];

  const availableTabs = useMemo(() => {
    const list: { key: typeof activeSection; label: string; count?: number }[] = [{ key: "all", label: "Overview" }];
    if (node.traits?.length) list.push({ key: "traits", label: "Personality & Traits", count: node.traits.length });
    if (node.abilities?.length) list.push({ key: "abilities", label: "Abilities & Achievements", count: node.abilities.length });
    if (node.relationships?.length) list.push({ key: "relationships", label: "Relationships", count: node.relationships.length });
    if (node.appearances?.length) list.push({ key: "appearances", label: "Story & Milestones", count: node.appearances.length });
    return list;
  }, [node.traits, node.abilities, node.relationships, node.appearances]);

  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid var(--sk-border)",
        background: "var(--sk-panel)",
        overflow: "hidden",
        boxShadow: "0 12px 34px rgba(0,0,0,0.12)",
      }}
    >
      {/* Top Hero Banner */}
      <div
        style={{
          padding: "20px 20px 18px",
          background:
            "radial-gradient(circle at 12% 15%, rgba(167, 139, 250, 0.16), transparent 52%), radial-gradient(circle at 88% 20%, rgba(56, 189, 248, 0.12), transparent 50%), var(--sk-surface)",
          borderBottom: "1px solid var(--sk-border)",
          display: "grid",
          gridTemplateColumns: "minmax(140px, 195px) 1fr",
          gap: 20,
          alignItems: "start",
        }}
        className="max-sm:!grid-cols-1"
      >
        {/* Portrait + Mini Gallery Switcher */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              borderRadius: 14,
              overflow: "hidden",
              border: "1px solid var(--sk-border-hover)",
              background: "var(--sk-bg2)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            }}
          >
            <SmartImage
              imageUrl={activeMedia?.imageUrl}
              imageQuery={activeMedia?.imageQuery || `${node.name} ${node.series || ""}`.trim()}
              alt={activeMedia?.title || node.name}
              aspect="portrait"
            />
          </div>

          {galleryItems.length > 1 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center" }}>
              {galleryItems.map((g, idx) => {
                const isSelected = (selectedGalleryIdx === -1 ? 0 : selectedGalleryIdx) === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedGalleryIdx(idx)}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 999,
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      border: `1px solid ${isSelected ? "var(--sk-accent)" : "var(--sk-border)"}`,
                      background: isSelected ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                      color: isSelected ? "var(--sk-accent)" : "var(--sk-muted)",
                    }}
                  >
                    {idx === 0 ? "Portrait" : g.title || `#${idx + 1}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Identity, Bio & Quick Attributes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              {(node.category || node.series) && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "var(--sk-accent-Bg)",
                    color: "var(--sk-accent)",
                    border: "1px solid var(--sk-border-hover)",
                  }}
                >
                  {node.series || node.category}
                </span>
              )}
              {node.badges?.map((b, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--sk-panel)",
                    color: "var(--sk-text2)",
                    border: "1px solid var(--sk-border)",
                  }}
                >
                  {b}
                </span>
              ))}
            </div>

            <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--sk-text)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {node.name}
            </h3>
            {node.subtitle && (
              <div style={{ fontSize: 13.5, color: "var(--sk-text2)", marginTop: 3, fontWeight: 500 }}>{node.subtitle}</div>
            )}
          </div>

          {node.quote && (
            <blockquote
              style={{
                margin: 0,
                padding: "9px 13px",
                borderRadius: 10,
                borderLeft: "3px solid var(--sk-accent)",
                background: "var(--sk-panel)",
                fontSize: 12.5,
                fontStyle: "italic",
                color: "var(--sk-text2)",
                lineHeight: 1.5,
              }}
            >
              &ldquo;{node.quote}&rdquo;
            </blockquote>
          )}

          {node.bio && (
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--sk-text)", lineHeight: 1.65 }}>{node.bio}</p>
          )}

          {/* Key Attributes Infobox Grid */}
          {node.attributes && node.attributes.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
                gap: 8,
                marginTop: 2,
              }}
            >
              {node.attributes.map((attr, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "8px 11px",
                    borderRadius: 10,
                    background: "var(--sk-panel)",
                    border: "1px solid var(--sk-border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--sk-muted)",
                    }}
                  >
                    {attr.label}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sk-text)", marginTop: 2 }}>{attr.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section Filter Bar if multiple rich sections exist */}
      {availableTabs.length > 2 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "10px 18px",
            background: "var(--sk-bg2)",
            borderBottom: "1px solid var(--sk-border)",
            overflowX: "auto",
          }}
        >
          {availableTabs.map((t) => {
            const active = activeSection === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveSection(t.key)}
                style={{
                  padding: "5px 11px",
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  border: `1px solid ${active ? "var(--sk-accent)" : "var(--sk-border)"}`,
                  background: active ? "var(--sk-accent-Bg)" : "var(--sk-panel)",
                  color: active ? "var(--sk-accent)" : "var(--sk-text2)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{t.label}</span>
                {t.count !== undefined && (
                  <span style={{ fontSize: 10, opacity: 0.8 }}>{t.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Body Sections */}
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Personality & Characteristics */}
        {(activeSection === "all" || activeSection === "traits") && node.traits && node.traits.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--sk-muted)",
                marginBottom: 10,
              }}
            >
              Personality & Notable Characteristics
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
              {node.traits.map((trait, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "11px 13px",
                    borderRadius: 12,
                    border: "1px solid var(--sk-border)",
                    background: "var(--sk-surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--sk-text)" }}>{trait.name}</span>
                    {trait.badge && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 999,
                          background: "var(--sk-accent-Bg)",
                          color: "var(--sk-accent)",
                        }}
                      >
                        {trait.badge}
                      </span>
                    )}
                  </div>
                  {trait.description && (
                    <div style={{ fontSize: 12, color: "var(--sk-text2)", marginTop: 5, lineHeight: 1.5 }}>{trait.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Abilities, Powers, or Key Achievements */}
        {(activeSection === "all" || activeSection === "abilities") && node.abilities && node.abilities.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--sk-muted)",
                marginBottom: 10,
              }}
            >
              Abilities, Skills & Signature Highlights
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              {node.abilities.map((ab, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid var(--sk-border)",
                    background: "var(--sk-surface)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sk-text)" }}>{ab.name}</span>
                    {ab.badge && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "var(--sk-panel)",
                          color: "var(--sk-accent)",
                          border: "1px solid var(--sk-border)",
                        }}
                      >
                        {ab.badge}
                      </span>
                    )}
                  </div>
                  {ab.description && (
                    <div style={{ fontSize: 12, color: "var(--sk-text2)", lineHeight: 1.5 }}>{ab.description}</div>
                  )}
                  {ab.level !== undefined && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ height: 6, borderRadius: 999, background: "var(--sk-bg2)", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${ab.level}%`,
                            height: "100%",
                            borderRadius: 999,
                            background: "linear-gradient(90deg, var(--sk-accent), #38bdf8)",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Relationships & Connections */}
        {(activeSection === "all" || activeSection === "relationships") && node.relationships && node.relationships.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--sk-muted)",
                marginBottom: 10,
              }}
            >
              Family, Connections & Related Figures
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {node.relationships.map((rel, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "11px 13px",
                    borderRadius: 12,
                    border: "1px solid var(--sk-border)",
                    background: "var(--sk-surface)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sk-text)" }}>{rel.name}</span>
                      {rel.role && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "var(--sk-accent-Bg)",
                            color: "var(--sk-accent)",
                          }}
                        >
                          {rel.role}
                        </span>
                      )}
                    </div>
                    {rel.description && (
                      <div style={{ fontSize: 12, color: "var(--sk-text2)", marginTop: 5, lineHeight: 1.45 }}>{rel.description}</div>
                    )}
                  </div>
                  {onSendMessage && (
                    <button
                      type="button"
                      onClick={() => onSendMessage(`Tell me about ${rel.name}${node.series ? ` from ${node.series}` : ""} and their relationship with ${node.name}.`)}
                      style={{
                        alignSelf: "flex-start",
                        padding: "4px 9px",
                        borderRadius: 7,
                        border: "1px solid var(--sk-border)",
                        background: "var(--sk-panel)",
                        color: "var(--sk-text2)",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Explore {rel.name} →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Important Appearances / Key Milestones */}
        {(activeSection === "all" || activeSection === "appearances") && node.appearances && node.appearances.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--sk-muted)",
                marginBottom: 10,
              }}
            >
              Notable Appearances & Key Milestones
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {node.appearances.map((ap, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "10px 13px",
                    borderRadius: 11,
                    border: "1px solid var(--sk-border)",
                    background: "var(--sk-surface)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--sk-text)" }}>{ap.title}</span>
                      {ap.subtitle && <span style={{ fontSize: 11.5, color: "var(--sk-muted)" }}>• {ap.subtitle}</span>}
                    </div>
                    {ap.badge && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "var(--sk-panel)",
                          color: "var(--sk-text2)",
                          border: "1px solid var(--sk-border)",
                        }}
                      >
                        {ap.badge}
                      </span>
                    )}
                  </div>
                  {ap.description && (
                    <div style={{ fontSize: 12, color: "var(--sk-text2)", lineHeight: 1.5 }}>{ap.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expandable Trivia Section */}
        {node.trivia && node.trivia.length > 0 && (
          <div
            style={{
              borderRadius: 12,
              border: "1px solid var(--sk-border)",
              background: "var(--sk-surface)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setTriviaOpen((prev) => !prev)}
              style={{
                width: "100%",
                padding: "11px 14px",
                background: "transparent",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                color: "var(--sk-text)",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                Trivia & Behind-the-Scenes Facts ({node.trivia.length})
              </span>
              <span style={{ fontSize: 11, color: "var(--sk-accent)", fontWeight: 700 }}>
                {triviaOpen ? "Hide ▲" : "Expand ▼"}
              </span>
            </button>
            {triviaOpen && (
              <ul
                style={{
                  margin: 0,
                  padding: "0 18px 14px 32px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 12.5,
                  color: "var(--sk-text2)",
                  lineHeight: 1.55,
                }}
              >
                {node.trivia.map((fact, idx) => (
                  <li key={idx}>{fact}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * 2. VIDEO GRID WIDGET (YouTube Videos, Creators, Rankings & Playable Embeds)
 * ========================================================================== */

export function VideoGridWidget({
  node,
}: {
  node: Extract<UINode, { type: "video_grid" }>;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"default" | "views" | "title">("default");
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const v of node.videos) {
      if (v.category) set.add(v.category);
    }
    return [...set];
  }, [node.videos]);

  const displayedVideos = useMemo(() => {
    let list = [...node.videos];
    if (selectedCategory !== "ALL") {
      list = list.filter((v) => v.category === selectedCategory);
    }
    if (sortBy === "views") {
      list.sort((a, b) => parseMetricNumber(b.views) - parseMetricNumber(a.views));
    } else if (sortBy === "title") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [node.videos, selectedCategory, sortBy]);

  const statusBadgeColor =
    node.dataStatus === "live"
      ? "#34d399"
      : node.dataStatus === "historical"
      ? "#38bdf8"
      : node.dataStatus === "unavailable"
      ? "#f59e0b"
      : "var(--sk-accent)";

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--sk-border)",
        background: "var(--sk-panel)",
        overflow: "hidden",
      }}
    >
      {/* Header & Controls */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--sk-border)",
          background: "var(--sk-bg2)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {node.title && (
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--sk-text)" }}>{node.title}</div>
              )}
              {node.interpretation && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "2px 9px",
                    borderRadius: 999,
                    background: "var(--sk-accent-Bg)",
                    color: "var(--sk-accent)",
                    border: "1px solid var(--sk-border-hover)",
                  }}
                >
                  {node.interpretation}
                </span>
              )}
              {node.dataStatus && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "2px 8px",
                    borderRadius: 999,
                    color: statusBadgeColor,
                    border: `1px solid ${statusBadgeColor}55`,
                    background: `${statusBadgeColor}14`,
                  }}
                >
                  {node.dataStatus === "live"
                    ? "● Live Retrieved"
                    : node.dataStatus === "historical"
                    ? "Verified All-Time / Archive"
                    : node.dataStatus === "unavailable"
                    ? "Live Feed Unavailable"
                    : "Verified Reference"}
                </span>
              )}
            </div>
            {node.subtitle && (
              <div style={{ fontSize: 12, color: "var(--sk-muted)", marginTop: 2 }}>{node.subtitle}</div>
            )}
          </div>

          {node.sortable && node.videos.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 11, color: "var(--sk-muted)" }}>Sort:</span>
              {(
                [
                  { id: "default", label: "Ranked" },
                  { id: "views", label: "Most Views" },
                  { id: "title", label: "A–Z" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSortBy(opt.id)}
                  style={{
                    padding: "3px 9px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${sortBy === opt.id ? "var(--sk-accent)" : "var(--sk-border)"}`,
                    background: sortBy === opt.id ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                    color: sortBy === opt.id ? "var(--sk-accent)" : "var(--sk-muted)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {node.statusNote && (
          <div
            style={{
              padding: "8px 11px",
              borderRadius: 9,
              background: "var(--sk-surface)",
              border: "1px solid var(--sk-border)",
              fontSize: 11.5,
              color: "var(--sk-text2)",
              lineHeight: 1.45,
            }}
          >
            {node.statusNote}
          </div>
        )}

        {node.filterable && categories.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setSelectedCategory("ALL")}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${selectedCategory === "ALL" ? "var(--sk-accent)" : "var(--sk-border)"}`,
                background: selectedCategory === "ALL" ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                color: selectedCategory === "ALL" ? "var(--sk-accent)" : "var(--sk-muted)",
              }}
            >
              All ({node.videos.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${selectedCategory === cat ? "var(--sk-accent)" : "var(--sk-border)"}`,
                  background: selectedCategory === cat ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                  color: selectedCategory === cat ? "var(--sk-accent)" : "var(--sk-muted)",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Video Cards Grid */}
      <div
        style={{
          padding: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(265px, 1fr))",
          gap: 14,
        }}
      >
        {displayedVideos.map((vid) => {
          const ytId = vid.videoId || extractYouTubeVideoId(vid.url);
          const isPlaying = Boolean(ytId && playingVideoId === vid.id);
          const isExpanded = Boolean(expandedIds[vid.id]);

          return (
            <div
              key={vid.id}
              style={{
                borderRadius: 13,
                border: "1px solid var(--sk-border)",
                background: "var(--sk-surface)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                {/* Thumbnail or Inline YouTube Player */}
                <div style={{ position: "relative", background: "#090a10", aspectRatio: "16 / 9", overflow: "hidden" }}>
                  {isPlaying && ytId ? (
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0`}
                      title={vid.title}
                      style={{ width: "100%", height: "100%", border: 0 }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <>
                      <SmartImage
                        imageUrl={vid.thumbnailUrl || vid.imageUrl}
                        imageQuery={vid.imageQuery || `${vid.title} ${vid.channel || ""} youtube`.trim()}
                        alt={vid.title}
                        aspect="video"
                      />
                      {/* Rank Pill */}
                      {vid.rank !== undefined && (
                        <span
                          style={{
                            position: "absolute",
                            top: 8,
                            left: 8,
                            padding: "3px 9px",
                            borderRadius: 999,
                            background: "rgba(10, 12, 18, 0.84)",
                            backdropFilter: "blur(6px)",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 800,
                            border: "1px solid rgba(255,255,255,0.16)",
                          }}
                        >
                          #{String(vid.rank).replace(/^#/, "")}
                        </span>
                      )}
                      {/* Duration Pill */}
                      {vid.duration && (
                        <span
                          style={{
                            position: "absolute",
                            bottom: 8,
                            right: 8,
                            padding: "2px 7px",
                            borderRadius: 6,
                            background: "rgba(0, 0, 0, 0.82)",
                            color: "#fff",
                            fontSize: 10.5,
                            fontWeight: 700,
                          }}
                        >
                          {vid.duration}
                        </span>
                      )}
                      {/* Play Overlay Button if valid YouTube videoId */}
                      {ytId && (
                        <button
                          type="button"
                          onClick={() => setPlayingVideoId(vid.id)}
                          aria-label={`Play ${vid.title}`}
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(0,0,0,0.22)",
                            border: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span
                            style={{
                              width: 48,
                              height: 34,
                              borderRadius: 10,
                              background: "rgba(239, 68, 68, 0.92)",
                              color: "#fff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 15,
                              boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
                            }}
                          >
                            ▶
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Video Metadata */}
                <div style={{ padding: "12px 13px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {vid.category && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 999,
                          background: "var(--sk-accent-Bg)",
                          color: "var(--sk-accent)",
                        }}
                      >
                        {vid.category}
                      </span>
                    )}
                    {vid.badge && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 999,
                          background: "var(--sk-panel)",
                          color: "var(--sk-text2)",
                          border: "1px solid var(--sk-border)",
                        }}
                      >
                        {vid.badge}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sk-text)", lineHeight: 1.35 }}>
                    {vid.title}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "var(--sk-muted)" }}>
                    {vid.channel && <span style={{ fontWeight: 600, color: "var(--sk-text2)" }}>{vid.channel}</span>}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {vid.views !== undefined && <span>{vid.views} views</span>}
                      {vid.likes !== undefined && <span>• {vid.likes} likes</span>}
                      {vid.publishedAt && <span>• {vid.publishedAt}</span>}
                    </div>
                  </div>

                  {vid.description && (
                    <div style={{ marginTop: 2 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--sk-text2)",
                          lineHeight: 1.5,
                          display: isExpanded ? "block" : "-webkit-box",
                          WebkitLineClamp: isExpanded ? undefined : 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {vid.description}
                      </div>
                      {vid.description.length > 100 && (
                        <button
                          type="button"
                          onClick={() => setExpandedIds((prev) => ({ ...prev, [vid.id]: !prev[vid.id] }))}
                          style={{
                            marginTop: 4,
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "var(--sk-accent)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {isExpanded ? "Show less" : "Read more"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer Links */}
              <div
                style={{
                  padding: "9px 13px",
                  borderTop: "1px solid var(--sk-border)",
                  background: "var(--sk-panel)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                {ytId ? (
                  <button
                    type="button"
                    onClick={() => setPlayingVideoId(isPlaying ? null : vid.id)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 7,
                      border: "1px solid var(--sk-border-hover)",
                      background: isPlaying ? "var(--sk-surface)" : "var(--sk-accent-Bg)",
                      color: "var(--sk-accent)",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {isPlaying ? "Close Player" : "▶ Play Inline"}
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--sk-muted)" }}>YouTube Video</span>
                )}

                {vid.url && (
                  <a
                    href={vid.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: "var(--sk-text2)",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Watch on YouTube ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
 * 3. TIMELINE WIDGET (Biographies, History, Discoveries, Chronologies)
 * ========================================================================== */

export function TimelineWidget({
  node,
}: {
  node: Extract<UINode, { type: "timeline" }>;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const ev of node.events) {
      if (ev.category) set.add(ev.category);
    }
    return [...set];
  }, [node.events]);

  const filteredEvents = useMemo(() => {
    if (selectedCategory === "ALL") return node.events;
    return node.events.filter((ev) => ev.category === selectedCategory);
  }, [node.events, selectedCategory]);

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--sk-border)",
        background: "var(--sk-panel)",
        overflow: "hidden",
      }}
    >
      {(node.title || node.subtitle || categories.length > 1) && (
        <div
          style={{
            padding: "13px 16px",
            borderBottom: "1px solid var(--sk-border)",
            background: "var(--sk-bg2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            {node.title && <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--sk-text)" }}>{node.title}</div>}
            {node.subtitle && <div style={{ fontSize: 12, color: "var(--sk-muted)", marginTop: 2 }}>{node.subtitle}</div>}
          </div>

          {categories.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setSelectedCategory("ALL")}
                style={{
                  padding: "3px 9px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${selectedCategory === "ALL" ? "var(--sk-accent)" : "var(--sk-border)"}`,
                  background: selectedCategory === "ALL" ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                  color: selectedCategory === "ALL" ? "var(--sk-accent)" : "var(--sk-muted)",
                }}
              >
                All Eras
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: "3px 9px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${selectedCategory === cat ? "var(--sk-accent)" : "var(--sk-border)"}`,
                    background: selectedCategory === cat ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                    color: selectedCategory === cat ? "var(--sk-accent)" : "var(--sk-muted)",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {filteredEvents.map((ev, idx) => {
          const isOpen = expandedId === ev.id;
          return (
            <div
              key={ev.id}
              style={{
                display: "grid",
                gridTemplateColumns: "96px 20px 1fr",
                gap: 10,
                alignItems: "stretch",
              }}
              className="max-sm:!grid-cols-[72px_16px_1fr]"
            >
              {/* Date column */}
              <div style={{ textAlign: "right", paddingTop: 2 }}>
                <span
                  style={{
                    display: "inline-block",
                    fontSize: 11.5,
                    fontWeight: 800,
                    color: "var(--sk-accent)",
                    padding: "2px 8px",
                    borderRadius: 8,
                    background: "var(--sk-accent-Bg)",
                  }}
                >
                  {ev.date}
                </span>
              </div>

              {/* Timeline Spine & Dot */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: "var(--sk-accent)",
                    border: "2px solid var(--sk-panel)",
                    boxShadow: "0 0 0 2px var(--sk-accent)",
                    marginTop: 5,
                    flexShrink: 0,
                  }}
                />
                {idx < filteredEvents.length - 1 && (
                  <div style={{ width: 2, flex: 1, background: "var(--sk-border)", marginTop: 4 }} />
                )}
              </div>

              {/* Event Card */}
              <div
                onClick={() => setExpandedId(isOpen ? null : ev.id)}
                style={{
                  padding: "11px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--sk-border)",
                  background: "var(--sk-surface)",
                  cursor: ev.description ? "pointer" : "default",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sk-text)" }}>{ev.title}</div>
                    {ev.subtitle && <div style={{ fontSize: 11.5, color: "var(--sk-muted)", marginTop: 1 }}>{ev.subtitle}</div>}
                  </div>
                  {ev.badge && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--sk-panel)",
                        color: "var(--sk-text2)",
                        border: "1px solid var(--sk-border)",
                      }}
                    >
                      {ev.badge}
                    </span>
                  )}
                </div>

                {ev.description && (
                  <div style={{ fontSize: 12.5, color: "var(--sk-text2)", marginTop: 6, lineHeight: 1.55 }}>
                    {ev.description}
                  </div>
                )}

                {ev.url && (
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: "inline-block",
                      marginTop: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--sk-accent)",
                      textDecoration: "none",
                    }}
                  >
                    Source reference ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
 * 4. PRODUCT GRID WIDGET (Laptops, Gear, Shopping & Recommendations)
 * ========================================================================== */

export function ProductGridWidget({
  node,
  onSendMessage,
}: {
  node: Extract<UINode, { type: "product_grid" }>;
  onSendMessage?: (prompt: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"featured" | "price_asc" | "price_desc" | "rating">("featured");

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of node.products) {
      if (p.category) set.add(p.category);
    }
    return [...set];
  }, [node.products]);

  const displayedProducts = useMemo(() => {
    let list = [...node.products];
    if (selectedCategory !== "ALL") {
      list = list.filter((p) => p.category === selectedCategory);
    }
    if (sortBy === "price_asc") {
      list.sort((a, b) => parseMetricNumber(a.price) - parseMetricNumber(b.price));
    } else if (sortBy === "price_desc") {
      list.sort((a, b) => parseMetricNumber(b.price) - parseMetricNumber(a.price));
    } else if (sortBy === "rating") {
      list.sort((a, b) => parseMetricNumber(b.rating) - parseMetricNumber(a.rating));
    }
    return list;
  }, [node.products, selectedCategory, sortBy]);

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--sk-border)",
        background: "var(--sk-panel)",
        overflow: "hidden",
      }}
    >
      {/* Header & Controls */}
      <div
        style={{
          padding: "13px 16px",
          borderBottom: "1px solid var(--sk-border)",
          background: "var(--sk-bg2)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            {node.title && <div style={{ fontSize: 15, fontWeight: 700, color: "var(--sk-text)" }}>{node.title}</div>}
            {node.subtitle && <div style={{ fontSize: 12, color: "var(--sk-muted)", marginTop: 2 }}>{node.subtitle}</div>}
          </div>

          {node.sortable && node.products.length > 1 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {(
                [
                  { id: "featured", label: "Top Picks" },
                  { id: "rating", label: "Highest Rated" },
                  { id: "price_asc", label: "Price: Low–High" },
                  { id: "price_desc", label: "Price: High–Low" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSortBy(opt.id)}
                  style={{
                    padding: "3px 9px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${sortBy === opt.id ? "var(--sk-accent)" : "var(--sk-border)"}`,
                    background: sortBy === opt.id ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                    color: sortBy === opt.id ? "var(--sk-accent)" : "var(--sk-muted)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {node.filterable && categories.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setSelectedCategory("ALL")}
              style={{
                padding: "3px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${selectedCategory === "ALL" ? "var(--sk-accent)" : "var(--sk-border)"}`,
                background: selectedCategory === "ALL" ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                color: selectedCategory === "ALL" ? "var(--sk-accent)" : "var(--sk-muted)",
              }}
            >
              All ({node.products.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${selectedCategory === cat ? "var(--sk-accent)" : "var(--sk-border)"}`,
                  background: selectedCategory === cat ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                  color: selectedCategory === cat ? "var(--sk-accent)" : "var(--sk-muted)",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Product Cards */}
      <div
        style={{
          padding: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(265px, 1fr))",
          gap: 14,
        }}
      >
        {displayedProducts.map((prod) => (
          <div
            key={prod.id}
            style={{
              borderRadius: 14,
              border: "1px solid var(--sk-border)",
              background: "var(--sk-surface)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ position: "relative" }}>
                <SmartImage
                  imageUrl={prod.imageUrl}
                  imageQuery={prod.imageQuery || prod.name}
                  alt={prod.name}
                  aspect="video"
                />
                {prod.badge && (
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      left: 10,
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: "rgba(15, 17, 26, 0.86)",
                      backdropFilter: "blur(6px)",
                      color: "var(--sk-accent)",
                      fontSize: 10.5,
                      fontWeight: 800,
                      border: "1px solid var(--sk-border-hover)",
                    }}
                  >
                    {prod.badge}
                  </span>
                )}
              </div>

              <div style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--sk-text)" }}>{prod.name}</div>
                    {prod.subtitle && <div style={{ fontSize: 11.5, color: "var(--sk-muted)", marginTop: 2 }}>{prod.subtitle}</div>}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {prod.price && (
                      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--sk-accent)" }}>{prod.price}</div>
                    )}
                    {prod.rating !== undefined && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>★ {prod.rating}</div>
                    )}
                  </div>
                </div>

                {prod.summary && (
                  <div style={{ fontSize: 12.5, color: "var(--sk-text2)", lineHeight: 1.5 }}>{prod.summary}</div>
                )}

                {prod.specs && prod.specs.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 6,
                      padding: 8,
                      borderRadius: 10,
                      background: "var(--sk-panel)",
                      border: "1px solid var(--sk-border)",
                    }}
                  >
                    {prod.specs.map((s, idx) => (
                      <div key={idx} style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--sk-muted)", textTransform: "uppercase" }}>
                          {s.label}
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: "var(--sk-text)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={s.value}
                        >
                          {s.value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {((prod.pros && prod.pros.length > 0) || (prod.cons && prod.cons.length > 0)) && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11.5 }}>
                    {prod.pros && prod.pros.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 700, color: "#34d399", marginBottom: 3 }}>Pros</div>
                        {prod.pros.map((pr, i) => (
                          <div key={i} style={{ color: "var(--sk-text2)", lineHeight: 1.4 }}>
                            + {pr}
                          </div>
                        ))}
                      </div>
                    )}
                    {prod.cons && prod.cons.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 700, color: "#f87171", marginBottom: 3 }}>Cons</div>
                        {prod.cons.map((cn, i) => (
                          <div key={i} style={{ color: "var(--sk-text2)", lineHeight: 1.4 }}>
                            − {cn}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                padding: "9px 14px",
                borderTop: "1px solid var(--sk-border)",
                background: "var(--sk-panel)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              {onSendMessage ? (
                <button
                  type="button"
                  onClick={() => onSendMessage(`Tell me more about the ${prod.name}, including benchmarks and real-world pros/cons.`)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--sk-border)",
                    background: "var(--sk-surface)",
                    color: "var(--sk-text2)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Deep Dive
                </button>
              ) : (
                <span />
              )}

              {prod.url && (
                <a
                  href={prod.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: "var(--sk-accent)",
                    textDecoration: "none",
                  }}
                >
                  {prod.store ? `View on ${prod.store} ↗` : "Check Details ↗"}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
 * 5. NEWS FEED WIDGET (Headlines, Current Events, Developing Stories)
 * ========================================================================== */

export function NewsFeedWidget({
  node,
}: {
  node: Extract<UINode, { type: "news_feed" }>;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const a of node.articles) {
      if (a.category) set.add(a.category);
    }
    return [...set];
  }, [node.articles]);

  const filteredArticles = useMemo(() => {
    if (selectedCategory === "ALL") return node.articles;
    return node.articles.filter((a) => a.category === selectedCategory);
  }, [node.articles, selectedCategory]);

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--sk-border)",
        background: "var(--sk-panel)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "13px 16px",
          borderBottom: "1px solid var(--sk-border)",
          background: "var(--sk-bg2)",
          display: "flex",
          flexDirection: "column",
          gap: 9,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {node.title && <div style={{ fontSize: 15, fontWeight: 700, color: "var(--sk-text)" }}>{node.title}</div>}
              {node.dataStatus && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: node.dataStatus === "live" ? "rgba(52, 211, 153, 0.14)" : "var(--sk-accent-Bg)",
                    color: node.dataStatus === "live" ? "#34d399" : "var(--sk-accent)",
                    border: "1px solid var(--sk-border-hover)",
                  }}
                >
                  {node.dataStatus === "live" ? "● Live Headlines" : "Curated Briefing"}
                </span>
              )}
            </div>
            {node.subtitle && <div style={{ fontSize: 12, color: "var(--sk-muted)", marginTop: 2 }}>{node.subtitle}</div>}
          </div>

          {node.filterable && categories.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setSelectedCategory("ALL")}
                style={{
                  padding: "3px 9px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${selectedCategory === "ALL" ? "var(--sk-accent)" : "var(--sk-border)"}`,
                  background: selectedCategory === "ALL" ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                  color: selectedCategory === "ALL" ? "var(--sk-accent)" : "var(--sk-muted)",
                }}
              >
                All Stories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: "3px 9px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    border: `1px solid ${selectedCategory === cat ? "var(--sk-accent)" : "var(--sk-border)"}`,
                    background: selectedCategory === cat ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                    color: selectedCategory === cat ? "var(--sk-accent)" : "var(--sk-muted)",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {node.statusNote && (
          <div
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              background: "var(--sk-surface)",
              border: "1px solid var(--sk-border)",
              fontSize: 11.5,
              color: "var(--sk-text2)",
            }}
          >
            {node.statusNote}
          </div>
        )}
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {filteredArticles.map((art) => {
          const domain = getSafeDomain(art.url);
          const isExpanded = Boolean(expandedIds[art.id]);
          return (
            <div
              key={art.id}
              style={{
                padding: "13px 15px",
                borderRadius: 12,
                border: "1px solid var(--sk-border)",
                background: "var(--sk-surface)",
                display: "flex",
                flexDirection: "column",
                gap: 7,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sk-muted)" }}>
                  {domain && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
                      alt=""
                      width={14}
                      height={14}
                      style={{ borderRadius: 3 }}
                    />
                  )}
                  {art.source && <span style={{ fontWeight: 700, color: "var(--sk-text2)" }}>{art.source}</span>}
                  {art.publishedAt && <span>• {art.publishedAt}</span>}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {art.category && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--sk-accent-Bg)",
                        color: "var(--sk-accent)",
                      }}
                    >
                      {art.category}
                    </span>
                  )}
                  {art.badge && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--sk-panel)",
                        color: "var(--sk-text2)",
                        border: "1px solid var(--sk-border)",
                      }}
                    >
                      {art.badge}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--sk-text)", lineHeight: 1.35 }}>
                {art.title}
              </div>

              {art.summary && (
                <div style={{ fontSize: 12.5, color: "var(--sk-text2)", lineHeight: 1.55 }}>{art.summary}</div>
              )}

              {art.details && isExpanded && (
                <div
                  style={{
                    marginTop: 4,
                    padding: "9px 12px",
                    borderRadius: 9,
                    background: "var(--sk-panel)",
                    borderLeft: "3px solid var(--sk-accent)",
                    fontSize: 12,
                    color: "var(--sk-text2)",
                    lineHeight: 1.55,
                  }}
                >
                  {art.details}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                {art.details ? (
                  <button
                    type="button"
                    onClick={() => setExpandedIds((prev) => ({ ...prev, [art.id]: !prev[art.id] }))}
                    style={{
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      color: "var(--sk-accent)",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {isExpanded ? "Hide context ▲" : "Expand summary ▼"}
                  </button>
                ) : (
                  <span />
                )}

                {art.url && (
                  <a
                    href={art.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: "var(--sk-accent)",
                      textDecoration: "none",
                    }}
                  >
                    Read Full Story ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
 * 6. GEO MAP WIDGET (Geography, Mountains, Landmarks, World Locations)
 * ========================================================================== */

export function GeoMapWidget({
  node,
}: {
  node: Extract<UINode, { type: "map" }>;
}) {
  const [activeMarkerId, setActiveMarkerId] = useState<string>(node.markers[0]?.id || "");
  const activeMarker = useMemo(
    () => node.markers.find((m) => m.id === activeMarkerId) || node.markers[0],
    [node.markers, activeMarkerId]
  );

  // Project lat/lng onto an 800x380 equirectangular world canvas
  const project = (lat: number, lng: number) => {
    const x = ((lng + 180) / 360) * 800;
    const y = ((90 - lat) / 180) * 380;
    return { x, y };
  };

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--sk-border)",
        background: "var(--sk-panel)",
        overflow: "hidden",
      }}
    >
      {(node.title || node.subtitle) && (
        <div
          style={{
            padding: "13px 16px",
            borderBottom: "1px solid var(--sk-border)",
            background: "var(--sk-bg2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            {node.title && <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--sk-text)" }}>{node.title}</div>}
            {node.subtitle && <div style={{ fontSize: 12, color: "var(--sk-muted)", marginTop: 2 }}>{node.subtitle}</div>}
          </div>
          {node.region && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                padding: "2px 9px",
                borderRadius: 999,
                background: "var(--sk-accent-Bg)",
                color: "var(--sk-accent)",
              }}
            >
              {node.region}
            </span>
          )}
        </div>
      )}

      {/* Interactive Coordinate Map Canvas */}
      <div
        style={{
          position: "relative",
          background: "radial-gradient(circle at 50% 45%, #131c31 0%, #090d18 100%)",
          borderBottom: "1px solid var(--sk-border)",
          padding: 12,
        }}
      >
        <svg viewBox="0 0 800 380" style={{ width: "100%", height: "auto", maxHeight: 280, display: "block" }}>
          {/* Subtle latitude / longitude grid */}
          {[0.2, 0.35, 0.5, 0.65, 0.8].map((r, i) => (
            <line
              key={`lat_${i}`}
              x1={0}
              y1={380 * r}
              x2={800}
              y2={380 * r}
              stroke="rgba(148, 163, 184, 0.14)"
              strokeDasharray="4 4"
            />
          ))}
          {[0.16, 0.33, 0.5, 0.66, 0.83].map((r, i) => (
            <line
              key={`lng_${i}`}
              x1={800 * r}
              y1={0}
              x2={800 * r}
              y2={380}
              stroke="rgba(148, 163, 184, 0.14)"
              strokeDasharray="4 4"
            />
          ))}

          {/* Simplified Stylized Continental Silhouettes for Geographic Context */}
          <g fill="rgba(148, 163, 184, 0.14)" stroke="rgba(148, 163, 184, 0.25)" strokeWidth="1">
            {/* North America */}
            <path d="M 75 55 L 210 50 L 245 125 L 185 175 L 120 150 Z" />
            {/* South America */}
            <path d="M 205 190 L 275 210 L 255 335 L 215 320 Z" />
            {/* Europe */}
            <path d="M 365 55 L 465 50 L 475 115 L 375 120 Z" />
            {/* Africa */}
            <path d="M 370 135 L 475 140 L 460 295 L 405 290 Z" />
            {/* Asia */}
            <path d="M 475 50 L 710 60 L 685 195 L 545 190 L 480 130 Z" />
            {/* Oceania */}
            <path d="M 615 245 L 715 245 L 705 315 L 615 305 Z" />
          </g>

          {/* Plot Markers */}
          {node.markers.map((m, idx) => {
            const { x, y } = project(m.lat, m.lng);
            const isSelected = activeMarker?.id === m.id;
            return (
              <g
                key={m.id}
                onClick={() => setActiveMarkerId(m.id)}
                style={{ cursor: "pointer" }}
              >
                {isSelected && (
                  <circle cx={x} cy={y} r={16} fill="rgba(167, 139, 250, 0.25)" />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 7.5 : 5.5}
                  fill={isSelected ? "#a78bfa" : "#38bdf8"}
                  stroke="#090d18"
                  strokeWidth={2}
                />
                <text
                  x={x}
                  y={y - 11}
                  textAnchor="middle"
                  fill={isSelected ? "#f8fafc" : "#cbd5e1"}
                  fontSize={isSelected ? 11.5 : 10}
                  fontWeight={700}
                >
                  {m.badge ? `${m.badge} ${m.label}` : `${idx + 1}. ${m.label}`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Marker Detail + Marker Pills */}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {node.markers.map((m, idx) => {
            const isSelected = activeMarker?.id === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setActiveMarkerId(m.id)}
                style={{
                  padding: "5px 11px",
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  border: `1px solid ${isSelected ? "var(--sk-accent)" : "var(--sk-border)"}`,
                  background: isSelected ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                  color: isSelected ? "var(--sk-accent)" : "var(--sk-text2)",
                }}
              >
                {m.badge || `#${idx + 1}`} {m.label}
                {m.elevation ? ` (${m.elevation})` : ""}
              </button>
            );
          })}
        </div>

        {activeMarker && (
          <div
            style={{
              padding: "13px 15px",
              borderRadius: 12,
              border: "1px solid var(--sk-border-hover)",
              background: "var(--sk-surface)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--sk-text)" }}>{activeMarker.label}</div>
                {activeMarker.subtitle && (
                  <div style={{ fontSize: 12, color: "var(--sk-muted)" }}>{activeMarker.subtitle}</div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {activeMarker.elevation && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: "var(--sk-accent-Bg)",
                      color: "var(--sk-accent)",
                    }}
                  >
                    {activeMarker.elevation}
                  </span>
                )}
                <a
                  href={
                    activeMarker.url ||
                    `https://www.google.com/maps/search/?api=1&query=${activeMarker.lat},${activeMarker.lng}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--sk-text2)",
                    textDecoration: "none",
                    padding: "4px 9px",
                    borderRadius: 8,
                    border: "1px solid var(--sk-border)",
                    background: "var(--sk-panel)",
                  }}
                >
                  {activeMarker.lat.toFixed(2)}°, {activeMarker.lng.toFixed(2)}° ↗
                </a>
              </div>
            </div>
            {activeMarker.description && (
              <div style={{ fontSize: 12.5, color: "var(--sk-text2)", lineHeight: 1.55 }}>{activeMarker.description}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * 7. STEPS WIDGET (Execution Flow, Tutorials, Scientific Processes)
 * ========================================================================== */

export function StepsWidget({
  node,
}: {
  node: Extract<UINode, { type: "steps" }>;
}) {
  const [viewMode, setViewMode] = useState<"all" | "stepper">("all");
  const [activeIdx, setActiveIdx] = useState<number>(0);

  const visibleSteps = viewMode === "all" ? node.steps : [node.steps[activeIdx] || node.steps[0]];

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--sk-border)",
        background: "var(--sk-panel)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "13px 16px",
          borderBottom: "1px solid var(--sk-border)",
          background: "var(--sk-bg2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          {node.title && <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--sk-text)" }}>{node.title}</div>}
          {node.subtitle && <div style={{ fontSize: 12, color: "var(--sk-muted)", marginTop: 2 }}>{node.subtitle}</div>}
        </div>

        {node.interactive && node.steps.length > 1 && (
          <div style={{ display: "flex", gap: 5 }}>
            <button
              type="button"
              onClick={() => setViewMode("all")}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${viewMode === "all" ? "var(--sk-accent)" : "var(--sk-border)"}`,
                background: viewMode === "all" ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                color: viewMode === "all" ? "var(--sk-accent)" : "var(--sk-muted)",
              }}
            >
              All Steps ({node.steps.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode("stepper")}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${viewMode === "stepper" ? "var(--sk-accent)" : "var(--sk-border)"}`,
                background: viewMode === "stepper" ? "var(--sk-accent-Bg)" : "var(--sk-surface)",
                color: viewMode === "stepper" ? "var(--sk-accent)" : "var(--sk-muted)",
              }}
            >
              Interactive Walkthrough
            </button>
          </div>
        )}
      </div>

      {viewMode === "stepper" && node.steps.length > 1 && (
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--sk-border)",
            background: "var(--sk-surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {node.steps.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveIdx(idx)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  border: `1px solid ${activeIdx === idx ? "var(--sk-accent)" : "var(--sk-border)"}`,
                  background: activeIdx === idx ? "var(--sk-accent-Bg)" : "var(--sk-panel)",
                  color: activeIdx === idx ? "var(--sk-accent)" : "var(--sk-muted)",
                }}
              >
                {idx + 1}. {s.title}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={activeIdx === 0}
              onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
              style={{
                padding: "4px 10px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                cursor: activeIdx === 0 ? "not-allowed" : "pointer",
                opacity: activeIdx === 0 ? 0.45 : 1,
                border: "1px solid var(--sk-border)",
                background: "var(--sk-panel)",
                color: "var(--sk-text)",
              }}
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={activeIdx >= node.steps.length - 1}
              onClick={() => setActiveIdx((i) => Math.min(node.steps.length - 1, i + 1))}
              style={{
                padding: "4px 10px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                cursor: activeIdx >= node.steps.length - 1 ? "not-allowed" : "pointer",
                opacity: activeIdx >= node.steps.length - 1 ? 0.45 : 1,
                border: "1px solid var(--sk-border)",
                background: "var(--sk-panel)",
                color: "var(--sk-text)",
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {visibleSteps.map((s) => (
          <div
            key={s.id}
            style={{
              padding: "13px 15px",
              borderRadius: 12,
              border: "1px solid var(--sk-border)",
              background: "var(--sk-surface)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: "var(--sk-accent-Bg)",
                    color: "var(--sk-accent)",
                    fontSize: 12,
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {s.step}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--sk-text)" }}>{s.title}</div>
                  {s.subtitle && <div style={{ fontSize: 11.5, color: "var(--sk-muted)" }}>{s.subtitle}</div>}
                </div>
              </div>
              {s.badge && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--sk-panel)",
                    color: "var(--sk-text2)",
                    border: "1px solid var(--sk-border)",
                  }}
                >
                  {s.badge}
                </span>
              )}
            </div>

            {s.description && (
              <div style={{ fontSize: 12.5, color: "var(--sk-text2)", lineHeight: 1.6 }}>{s.description}</div>
            )}

            {s.code && (
              <pre
                style={{
                  margin: 0,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "#0d0f17",
                  border: "1px solid var(--sk-border)",
                  color: "#e2e8f0",
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                  overflowX: "auto",
                  lineHeight: 1.55,
                }}
              >
                <code>{s.code}</code>
              </pre>
            )}

            {s.latex && <MathView latex={s.latex} block />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
 * 8. KEY-VALUE WIDGET (Fact Sheets, Technical Specifications, Quick Attributes)
 * ========================================================================== */

export function KeyValueWidget({
  node,
}: {
  node: Extract<UINode, { type: "key_value" }>;
}) {
  const cols = node.cols || 2;
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--sk-border)",
        background: "var(--sk-panel)",
        overflow: "hidden",
      }}
    >
      {(node.title || node.subtitle) && (
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--sk-border)",
            background: "var(--sk-bg2)",
          }}
        >
          {node.title && <div style={{ fontSize: 14, fontWeight: 700, color: "var(--sk-text)" }}>{node.title}</div>}
          {node.subtitle && <div style={{ fontSize: 12, color: "var(--sk-muted)", marginTop: 2 }}>{node.subtitle}</div>}
        </div>
      )}

      <div
        style={{
          padding: 14,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: 10,
        }}
        className="max-sm:!grid-cols-1"
      >
        {node.items.map((item, idx) => (
          <div
            key={idx}
            style={{
              padding: "10px 13px",
              borderRadius: 11,
              border: "1px solid var(--sk-border)",
              background: "var(--sk-surface)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--sk-muted)",
                }}
              >
                {item.label}
              </span>
              {item.badge && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: "var(--sk-accent-Bg)",
                    color: "var(--sk-accent)",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sk-text)" }}>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--sk-accent)", textDecoration: "none" }}
                >
                  {item.value} ↗
                </a>
              ) : (
                item.value
              )}
            </div>
            {item.detail && <div style={{ fontSize: 11.5, color: "var(--sk-text2)" }}>{item.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
