"use client";

import { useSyncExternalStore } from "react";
import { Search, Globe, BookOpen, Film, PenTool, Images, Brain, Check, AlertCircle, Loader2 } from "lucide-react";
import type { Activity } from "@/types/chat";

const ACTIVITY_ICONS: Record<Activity["type"], React.ElementType> = {
  search: Search,
  browse: Globe,
  read: BookOpen,
  extract: Film,
  write: PenTool,
  scrape: Images,
  think: Brain,
};

const ACTIVITY_COLORS: Record<Activity["type"], string> = {
  search: "text-zinc-400",
  browse: "text-zinc-400",
  read: "text-zinc-400",
  extract: "text-zinc-400",
  write: "text-zinc-400",
  scrape: "text-zinc-400",
  think: "text-zinc-400",
};

// Tiny external clock store so we avoid impure Date.now() in render
let clockListeners: Array<() => void> = [];
let clockValue = 0;
if (typeof window !== "undefined") {
  clockValue = Date.now();
  setInterval(() => {
    clockValue = Date.now();
    for (const fn of clockListeners) fn();
  }, 200);
}
function subscribeClock(cb: () => void) {
  clockListeners.push(cb);
  return () => { clockListeners = clockListeners.filter((f) => f !== cb); };
}
function getClockSnapshot() { return clockValue; }
function getServerSnapshot() { return 0; }

function ElapsedTime({ startedAt, completedAt }: { startedAt: number; completedAt?: number }) {
  const now = useSyncExternalStore(subscribeClock, getClockSnapshot, getServerSnapshot);
  const elapsed = ((completedAt || now) - startedAt) / 1000;
  if (elapsed < 0) return null;
  return (
    <span className="text-[10px] text-zinc-600 tabular-nums ml-auto shrink-0">
      {elapsed.toFixed(1)}s
    </span>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const Icon = ACTIVITY_ICONS[activity.type] || Brain;
  const isDone = activity.status === "done";
  const isError = activity.status === "error";
  const isActive = activity.status === "active";

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 text-[13px] transition-all duration-300 ${
        isDone ? "opacity-50" : "opacity-100"
      }`}
    >
      {/* Animated dots for active state, icon for completed */}
      {isActive ? (
        <div className="flex gap-1 shrink-0">
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-zinc-500" style={{ animationDelay: "0ms" }} />
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-zinc-500" style={{ animationDelay: "150ms" }} />
          <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-zinc-500" style={{ animationDelay: "300ms" }} />
        </div>
      ) : isDone ? (
        <Check className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
      )}
      {/* Activity type icon */}
      <Icon className={`h-3.5 w-3.5 shrink-0 ${isDone ? "text-zinc-600" : isError ? "text-red-400" : "text-zinc-400"}`} />
      {/* Label */}
      <span className={`${isDone ? "text-zinc-600" : isError ? "text-red-400" : "text-zinc-300"}`}>
        {activity.label}
      </span>
      {activity.detail && isDone && (
        <span className="text-[11px] text-zinc-600 truncate">— {activity.detail}</span>
      )}
      <ElapsedTime startedAt={activity.startedAt} completedAt={activity.completedAt} />
    </div>
  );
}

interface ActivityFeedProps {
  activities: Activity[];
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const now = useSyncExternalStore(subscribeClock, getClockSnapshot, getServerSnapshot);
  void now;

  // Build visible list: active + recently completed (within 2s)
  const visible = activities.filter((a) => {
    if (a.status === "active") return true;
    if (a.completedAt && now - a.completedAt < 2000) return true;
    return false;
  });

  if (visible.length === 0) return null;

  return (
    <div className="border-b border-white/[0.04]">
      {visible.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}
    </div>
  );
}
