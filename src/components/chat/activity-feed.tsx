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
  const color = ACTIVITY_COLORS[activity.type] || "text-zinc-400";
  const isDone = activity.status === "done";
  const isError = activity.status === "error";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-[12px] transition-all duration-300 ${
        isDone ? "opacity-60" : "opacity-100"
      }`}
    >
      {activity.status === "active" ? (
        <Loader2 className={`h-3 w-3 ${color} animate-spin shrink-0`} />
      ) : isDone ? (
        <Check className="h-3 w-3 text-zinc-500 shrink-0" />
      ) : (
        <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
      )}
      <Icon className={`h-3 w-3 ${isDone ? "text-zinc-500" : color} shrink-0`} />
      <span className={`truncate ${isDone ? "text-zinc-500" : isError ? "text-red-400" : "text-zinc-300"}`}>
        {activity.label}
      </span>
      {activity.detail && isDone && (
        <span className="text-[10px] text-zinc-500 truncate">— {activity.detail}</span>
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
  // We use useSyncExternalStore for now, so the component re-renders every 200ms
  // This lets us check which completed activities have expired
  void now;

  // Build visible list: active + recently completed (within 3s)
  const visible = activities.filter((a) => {
    if (a.status === "active") return true;
    if (a.completedAt && now - a.completedAt < 3000) return true;
    return false;
  });

  if (visible.length === 0) return null;

  return (
    <div className="border-b border-white/[0.04] bg-gradient-to-r from-white/[0.015] to-transparent">
      {visible.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}
    </div>
  );
}
