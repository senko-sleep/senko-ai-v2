"use client";

import React, { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * React Error Boundary
 * 
 * Wraps embed components (VideoEmbed, WebEmbed, MapEmbed) and ChatMessage
 * to catch render crashes. Shows a styled fallback instead of crashing the entire chat.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** What kind of content this wraps — used in the fallback message */
  contentType?: "video" | "web" | "map" | "message" | "content";
  /** Optional custom fallback */
  fallback?: ReactNode;
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ContentErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[ErrorBoundary] ${this.props.contentType || "content"} crashed:`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const label = this.props.contentType || "content";
      return <ErrorFallback label={label} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

/** Styled fallback for crashed content */
function ErrorFallback({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-[var(--muted-foreground)]">
      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
      <span className="flex-1">
        Something went wrong loading this {label}
      </span>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--muted)]/50 hover:bg-[var(--muted)] transition-colors cursor-pointer"
      >
        <RefreshCw className="w-3 h-3" />
        Retry
      </button>
    </div>
  );
}

/**
 * Hook-friendly wrapper for showing stream errors in the conversation.
 * Appends a visible error message instead of silently failing.
 */
export function formatStreamError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Response was stopped";
    if (error.message.includes("rate limit")) return "Rate limited — trying again in a moment~";
    if (error.message.includes("timeout")) return "Request timed out — the server took too long ;w;";
    if (error.message.includes("network")) return "Network error — check your connection~";
    return `Something went wrong: ${error.message}`;
  }
  return "Something unexpected happened ;w;";
}
