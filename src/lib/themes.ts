export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: {
    background: string;
    foreground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    card: string;
    cardForeground: string;
    border: string;
    input: string;
    ring: string;
    glass: string;
    glassBorder: string;
    glassHover: string;
  };
  preview: string[]; // Array of 4 preview colors for theme picker
}

export const themes: Theme[] = [
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep black with orange accents",
    colors: {
      background: "#000000",
      foreground: "#ffffff",
      primary: "#e08a30",
      primaryForeground: "#000000",
      secondary: "rgba(255, 255, 255, 0.06)",
      secondaryForeground: "#ffffff",
      muted: "rgba(255, 255, 255, 0.05)",
      mutedForeground: "#999999",
      accent: "rgba(224, 138, 48, 0.10)",
      accentForeground: "#e08a30",
      card: "rgba(8, 8, 8, 0.92)",
      cardForeground: "#ffffff",
      border: "rgba(255, 255, 255, 0.10)",
      input: "rgba(255, 255, 255, 0.06)",
      ring: "rgba(224, 138, 48, 0.3)",
      glass: "rgba(255, 255, 255, 0.025)",
      glassBorder: "rgba(255, 255, 255, 0.07)",
      glassHover: "rgba(255, 255, 255, 0.06)",
    },
    preview: ["#000000", "#e08a30", "#1a1a1a", "#ffffff"],
  },
  {
    id: "snow",
    name: "Snow",
    description: "Clean white with subtle shadows",
    colors: {
      background: "#fafafa",
      foreground: "#171717",
      primary: "#171717",
      primaryForeground: "#fafafa",
      secondary: "rgba(0, 0, 0, 0.04)",
      secondaryForeground: "#171717",
      muted: "rgba(0, 0, 0, 0.03)",
      mutedForeground: "#737373",
      accent: "rgba(0, 0, 0, 0.05)",
      accentForeground: "#171717",
      card: "rgba(255, 255, 255, 0.9)",
      cardForeground: "#171717",
      border: "rgba(0, 0, 0, 0.08)",
      input: "rgba(0, 0, 0, 0.04)",
      ring: "rgba(0, 0, 0, 0.15)",
      glass: "rgba(255, 255, 255, 0.7)",
      glassBorder: "rgba(0, 0, 0, 0.06)",
      glassHover: "rgba(0, 0, 0, 0.03)",
    },
    preview: ["#fafafa", "#171717", "#ffffff", "#737373"],
  },
  {
    id: "forest",
    name: "Forest",
    description: "Deep greens and earth tones",
    colors: {
      background: "#0a0f0a",
      foreground: "#e8f0e8",
      primary: "#4ade80",
      primaryForeground: "#052e16",
      secondary: "rgba(74, 222, 128, 0.06)",
      secondaryForeground: "#e8f0e8",
      muted: "rgba(74, 222, 128, 0.04)",
      mutedForeground: "#86a086",
      accent: "rgba(74, 222, 128, 0.10)",
      accentForeground: "#4ade80",
      card: "rgba(10, 20, 10, 0.92)",
      cardForeground: "#e8f0e8",
      border: "rgba(74, 222, 128, 0.12)",
      input: "rgba(74, 222, 128, 0.06)",
      ring: "rgba(74, 222, 128, 0.3)",
      glass: "rgba(74, 222, 128, 0.025)",
      glassBorder: "rgba(74, 222, 128, 0.08)",
      glassHover: "rgba(74, 222, 128, 0.06)",
    },
    preview: ["#0a0f0a", "#4ade80", "#142014", "#e8f0e8"],
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep blue with cyan highlights",
    colors: {
      background: "#030712",
      foreground: "#f0f9ff",
      primary: "#38bdf8",
      primaryForeground: "#0c4a6e",
      secondary: "rgba(56, 189, 248, 0.06)",
      secondaryForeground: "#f0f9ff",
      muted: "rgba(56, 189, 248, 0.04)",
      mutedForeground: "#7dd3fc",
      accent: "rgba(56, 189, 248, 0.10)",
      accentForeground: "#38bdf8",
      card: "rgba(8, 14, 28, 0.92)",
      cardForeground: "#f0f9ff",
      border: "rgba(56, 189, 248, 0.12)",
      input: "rgba(56, 189, 248, 0.06)",
      ring: "rgba(56, 189, 248, 0.3)",
      glass: "rgba(56, 189, 248, 0.025)",
      glassBorder: "rgba(56, 189, 248, 0.08)",
      glassHover: "rgba(56, 189, 248, 0.06)",
    },
    preview: ["#030712", "#38bdf8", "#0e1a2e", "#f0f9ff"],
  },
  {
    id: "lavender",
    name: "Lavender",
    description: "Soft purples and violets",
    colors: {
      background: "#0d0912",
      foreground: "#f5f3ff",
      primary: "#a78bfa",
      primaryForeground: "#1e1b4b",
      secondary: "rgba(167, 139, 250, 0.06)",
      secondaryForeground: "#f5f3ff",
      muted: "rgba(167, 139, 250, 0.04)",
      mutedForeground: "#c4b5fd",
      accent: "rgba(167, 139, 250, 0.10)",
      accentForeground: "#a78bfa",
      card: "rgba(13, 9, 18, 0.92)",
      cardForeground: "#f5f3ff",
      border: "rgba(167, 139, 250, 0.12)",
      input: "rgba(167, 139, 250, 0.06)",
      ring: "rgba(167, 139, 250, 0.3)",
      glass: "rgba(167, 139, 250, 0.025)",
      glassBorder: "rgba(167, 139, 250, 0.08)",
      glassHover: "rgba(167, 139, 250, 0.06)",
    },
    preview: ["#0d0912", "#a78bfa", "#1a1225", "#f5f3ff"],
  },
  {
    id: "rose",
    name: "Rose",
    description: "Warm pinks and coral",
    colors: {
      background: "#0f0a0a",
      foreground: "#fff1f2",
      primary: "#fb7185",
      primaryForeground: "#4c0519",
      secondary: "rgba(251, 113, 133, 0.06)",
      secondaryForeground: "#fff1f2",
      muted: "rgba(251, 113, 133, 0.04)",
      mutedForeground: "#fda4af",
      accent: "rgba(251, 113, 133, 0.10)",
      accentForeground: "#fb7185",
      card: "rgba(15, 10, 10, 0.92)",
      cardForeground: "#fff1f2",
      border: "rgba(251, 113, 133, 0.12)",
      input: "rgba(251, 113, 133, 0.06)",
      ring: "rgba(251, 113, 133, 0.3)",
      glass: "rgba(251, 113, 133, 0.025)",
      glassBorder: "rgba(251, 113, 133, 0.08)",
      glassHover: "rgba(251, 113, 133, 0.06)",
    },
    preview: ["#0f0a0a", "#fb7185", "#1f1418", "#fff1f2"],
  },
  {
    id: "mint",
    name: "Mint",
    description: "Light sage on cream",
    colors: {
      background: "#f8faf8",
      foreground: "#1a2e1a",
      primary: "#22c55e",
      primaryForeground: "#f0fdf4",
      secondary: "rgba(34, 197, 94, 0.06)",
      secondaryForeground: "#1a2e1a",
      muted: "rgba(34, 197, 94, 0.04)",
      mutedForeground: "#4d7c4d",
      accent: "rgba(34, 197, 94, 0.08)",
      accentForeground: "#16a34a",
      card: "rgba(255, 255, 255, 0.9)",
      cardForeground: "#1a2e1a",
      border: "rgba(34, 197, 94, 0.12)",
      input: "rgba(34, 197, 94, 0.06)",
      ring: "rgba(34, 197, 94, 0.2)",
      glass: "rgba(34, 197, 94, 0.03)",
      glassBorder: "rgba(34, 197, 94, 0.08)",
      glassHover: "rgba(34, 197, 94, 0.06)",
    },
    preview: ["#f8faf8", "#22c55e", "#ffffff", "#1a2e1a"],
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm gradients of amber and red",
    colors: {
      background: "#0c0806",
      foreground: "#fef3e2",
      primary: "#f97316",
      primaryForeground: "#431407",
      secondary: "rgba(249, 115, 22, 0.06)",
      secondaryForeground: "#fef3e2",
      muted: "rgba(249, 115, 22, 0.04)",
      mutedForeground: "#fdba74",
      accent: "rgba(249, 115, 22, 0.10)",
      accentForeground: "#f97316",
      card: "rgba(12, 8, 6, 0.92)",
      cardForeground: "#fef3e2",
      border: "rgba(249, 115, 22, 0.12)",
      input: "rgba(249, 115, 22, 0.06)",
      ring: "rgba(249, 115, 22, 0.3)",
      glass: "rgba(249, 115, 22, 0.025)",
      glassBorder: "rgba(249, 115, 22, 0.08)",
      glassHover: "rgba(249, 115, 22, 0.06)",
    },
    preview: ["#0c0806", "#f97316", "#1a120d", "#fef3e2"],
  },
];

export function getTheme(id: string): Theme {
  return themes.find((t) => t.id === id) || themes[0];
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const c = theme.colors;
  
  root.style.setProperty("--background", c.background);
  root.style.setProperty("--foreground", c.foreground);
  root.style.setProperty("--primary", c.primary);
  root.style.setProperty("--primary-foreground", c.primaryForeground);
  root.style.setProperty("--secondary", c.secondary);
  root.style.setProperty("--secondary-foreground", c.secondaryForeground);
  root.style.setProperty("--muted", c.muted);
  root.style.setProperty("--muted-foreground", c.mutedForeground);
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--accent-foreground", c.accentForeground);
  root.style.setProperty("--card", c.card);
  root.style.setProperty("--card-foreground", c.cardForeground);
  root.style.setProperty("--border", c.border);
  root.style.setProperty("--input", c.input);
  root.style.setProperty("--ring", c.ring);
  root.style.setProperty("--glass", c.glass);
  root.style.setProperty("--glass-border", c.glassBorder);
  root.style.setProperty("--glass-hover", c.glassHover);
  
  // Also update senko-accent to match primary
  root.style.setProperty("--senko-accent", c.primary);
  root.style.setProperty("--senko-accent-dim", c.accent);
  
  // Sidebar colors
  root.style.setProperty("--sidebar", c.card);
  root.style.setProperty("--sidebar-foreground", c.foreground);
  root.style.setProperty("--sidebar-primary", c.primary);
  root.style.setProperty("--sidebar-primary-foreground", c.primaryForeground);
  root.style.setProperty("--sidebar-accent", c.accent);
  root.style.setProperty("--sidebar-accent-foreground", c.accentForeground);
  root.style.setProperty("--sidebar-border", c.border);
  root.style.setProperty("--sidebar-ring", c.ring);

  // Determine if this is a light or dark theme
  const isLight = isLightTheme(theme);
  if (isLight) {
    root.classList.remove("dark");
    root.classList.add("light");
  } else {
    root.classList.remove("light");
    root.classList.add("dark");
  }
}

export function isLightTheme(theme: Theme): boolean {
  // Parse the background color and check luminance
  const bg = theme.colors.background;
  if (bg.startsWith("#")) {
    const hex = bg.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }
  return false;
}
