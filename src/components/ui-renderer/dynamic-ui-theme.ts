import type { CSSProperties } from "react";
import type { UITheme } from "@/lib/ui-schema";

const hex = (value?: string) => value && /^#[\da-f]{6}$/i.test(value) ? value : undefined;

/** A small token bridge for the existing components, never arbitrary model CSS. */
export function dynamicUiThemeStyle(theme?: UITheme): CSSProperties | undefined {
  if (!theme) return undefined;
  const background = hex(theme.background);
  const surface = hex(theme.surface);
  const text = hex(theme.text);
  const muted = hex(theme.muted);
  const accent = hex(theme.accent);
  const border = hex(theme.border);
  return {
    ...(background ? { "--sk-bg": background, "--sk-bg2": background, background } : {}),
    ...(surface ? { "--sk-surface": surface, "--sk-panel": surface, "--sk-raised": surface, "--sk-glass": surface, "--sk-surface-1": surface, "--sk-surface-2": surface } : {}),
    ...(text ? { "--sk-text": text, color: text } : {}),
    ...(muted ? { "--sk-muted": muted, "--sk-text2": muted, "--sk-faint": muted } : {}),
    ...(accent ? { "--sk-accent": accent, "--sk-accent-ink": accent, "--sk-accent-soft": `color-mix(in srgb, ${accent} 11%, transparent)`, "--sk-accent-Bg": `color-mix(in srgb, ${accent} 11%, transparent)`, "--sk-accent-line": `color-mix(in srgb, ${accent} 35%, transparent)` } : {}),
    ...(border ? { "--sk-line": border, "--sk-line-strong": border, "--sk-border": border, "--sk-border-hover": border } : {}),
    ...(theme.font ? { "--ui-heading-font": theme.font === "editorial" ? "Georgia, Cambria, 'Times New Roman', serif" : theme.font === "technical" ? "ui-monospace, SFMono-Regular, Consolas, monospace" : "inherit" } : {}),
    ...(theme.font === "technical" ? { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } : {}),
  } as CSSProperties;
}
