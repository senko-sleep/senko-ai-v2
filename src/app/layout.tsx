import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import "./senko.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Senko UI: Inter for reading, Bricolage Grotesque for display headings.
const skSans = Inter({ variable: "--font-sk-sans", subsets: ["latin"], display: "swap" });
const skDisplay = Bricolage_Grotesque({ variable: "--font-sk-display", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });

// Apply the saved theme before first paint, so there's no flash of the wrong one.
const THEME_SCRIPT = `try{var t=localStorage.getItem("senko.theme");document.documentElement.dataset.theme=(t==="light"||t==="system")?t:"dark"}catch(e){}`;

export const metadata: Metadata = {
  title: "Senko AI",
  description: "Agentic AI assistant with web search, browser integration, live embeds, and real-time capabilities. Search the web, open apps, take screenshots, and more — all from chat.",
  metadataBase: new URL("https://senko-ai.vercel.app"),
  openGraph: {
    title: "Senko AI",
    description: "Agentic AI assistant with web search, browser integration, live embeds, and real-time capabilities.",
    siteName: "Senko AI",
    type: "website",
    locale: "en_US",
    url: "https://senko-ai.vercel.app",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Senko AI - Agentic AI Assistant",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Senko AI",
    description: "Agentic AI assistant with web search, browser integration, live embeds, and real-time capabilities.",
    images: ["/og-image.svg"],
  },
  icons: {
    icon: [{ url: "/senko-fox.png", type: "image/png" }, { url: "/favicon.ico" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#000000" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${skSans.variable} ${skDisplay.variable} antialiased overflow-hidden`}
      >
        {children}
      </body>
    </html>
  );
}
