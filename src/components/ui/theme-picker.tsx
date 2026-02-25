"use client";

import { useState } from "react";
import { Check, Palette, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { themes, type Theme } from "@/lib/themes";

interface ThemePickerProps {
  currentTheme: string;
  onThemeChange: (themeId: string) => void;
}

export function ThemePicker({ currentTheme, onThemeChange }: ThemePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = themes.find((t) => t.id === currentTheme) || themes[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all",
          "bg-[var(--glass)] border border-[var(--glass-border)] hover:bg-[var(--glass-hover)]",
          "text-[var(--foreground)]"
        )}
      >
        <div className="flex gap-0.5">
          {selected.preview.slice(0, 3).map((color, i) => (
            <div
              key={i}
              className="h-3 w-3 rounded-full border border-white/10"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <span className="font-medium">{selected.name}</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-[var(--glass-border)] bg-[var(--card)] shadow-2xl animate-scale-in overflow-hidden">
            <div className="p-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                <Palette className="h-4 w-4" />
                Choose Theme
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto p-2 scrollbar-thin">
              {themes.map((theme) => (
                <ThemeOption
                  key={theme.id}
                  theme={theme}
                  isSelected={theme.id === currentTheme}
                  onSelect={() => {
                    onThemeChange(theme.id);
                    setIsOpen(false);
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ThemeOption({
  theme,
  isSelected,
  onSelect,
}: {
  theme: Theme;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all text-left",
        isSelected
          ? "bg-[var(--accent)]"
          : "hover:bg-[var(--glass-hover)]"
      )}
    >
      {/* Color preview squares */}
      <div className="grid grid-cols-2 gap-0.5 shrink-0">
        {theme.preview.map((color, i) => (
          <div
            key={i}
            className="h-4 w-4 rounded-sm border border-black/10"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--foreground)] truncate">
          {theme.name}
        </div>
        <div className="text-xs text-[var(--muted-foreground)] truncate">
          {theme.description}
        </div>
      </div>

      {isSelected && (
        <Check className="h-4 w-4 text-[var(--primary)] shrink-0" />
      )}
    </button>
  );
}

export function ThemePreviewCard({
  theme,
  isSelected,
  onSelect,
}: {
  theme: Theme;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "relative group rounded-2xl p-4 transition-all border-2",
        isSelected
          ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/20"
          : "border-transparent hover:border-[var(--border)]"
      )}
      style={{ backgroundColor: theme.colors.background }}
    >
      {/* Mini UI preview */}
      <div className="space-y-2">
        {/* Header bar */}
        <div
          className="h-2 w-12 rounded-full"
          style={{ backgroundColor: theme.colors.mutedForeground }}
        />
        
        {/* Chat bubbles */}
        <div className="space-y-1.5">
          <div
            className="h-3 w-20 rounded-lg ml-auto"
            style={{ backgroundColor: theme.colors.primary + "30" }}
          />
          <div
            className="h-3 w-16 rounded-lg"
            style={{ backgroundColor: theme.colors.card }}
          />
        </div>

        {/* Input bar */}
        <div
          className="h-4 w-full rounded-lg"
          style={{ backgroundColor: theme.colors.card }}
        />
      </div>

      {/* Theme name */}
      <div
        className="mt-3 text-xs font-medium text-center"
        style={{ color: theme.colors.foreground }}
      >
        {theme.name}
      </div>

      {/* Selected indicator */}
      {isSelected && (
        <div
          className="absolute top-2 right-2 h-5 w-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: theme.colors.primary }}
        >
          <Check className="h-3 w-3" style={{ color: theme.colors.primaryForeground }} />
        </div>
      )}
    </button>
  );
}
