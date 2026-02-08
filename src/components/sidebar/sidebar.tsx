"use client";

import { useState } from "react";
import { History, Settings, PanelLeftClose, PanelLeft, Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HistoryPanel } from "./history-panel";
import { SettingsPanel } from "./settings-panel";
import type { Conversation, AppSettings } from "@/types/chat";

type SidebarTab = "history" | "settings";

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  settings: AppSettings;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onSettingsChange: (settings: AppSettings) => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({
  conversations,
  activeConversationId,
  settings,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onSettingsChange,
  isMobile = false,
  isOpen = true,
  onClose,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("history");
  const [collapsed, setCollapsed] = useState(false);

  const handleSelectConversation = (id: string) => {
    onSelectConversation(id);
    if (isMobile && onClose) onClose();
  };

  const handleNewConversation = () => {
    onNewConversation();
    if (isMobile && onClose) onClose();
  };

  // Mobile: full-screen overlay drawer
  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        {isOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={onClose}
          />
        )}
        {/* Drawer */}
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] flex flex-col bg-[#050505] border-r border-white/[0.06] transition-transform duration-300 ease-out",
            isOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {/* Mobile header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff9500]/15">
                <Bot className="h-4.5 w-4.5 text-[#ff9500]" />
              </div>
              <span className="text-sm font-semibold text-zinc-200">Senko AI</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 rounded-lg p-0 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            >
              <X className="h-4.5 w-4.5" />
            </Button>
          </div>

          {/* Tab Buttons */}
          <div className="flex gap-1 border-b border-white/[0.06] px-3 py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActiveTab("history")}
              className={cn(
                "h-8 flex-1 gap-1.5 rounded-lg text-xs",
                activeTab === "history"
                  ? "bg-[#ff9500]/10 text-[#ff9500]"
                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-400"
              )}
            >
              <History className="h-3.5 w-3.5" />
              History
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActiveTab("settings")}
              className={cn(
                "h-8 flex-1 gap-1.5 rounded-lg text-xs",
                activeTab === "settings"
                  ? "bg-[#ff9500]/10 text-[#ff9500]"
                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-400"
              )}
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </Button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === "history" ? (
              <HistoryPanel
                conversations={conversations}
                activeConversationId={activeConversationId}
                onSelectConversation={handleSelectConversation}
                onNewConversation={handleNewConversation}
                onDeleteConversation={onDeleteConversation}
              />
            ) : (
              <SettingsPanel
                settings={settings}
                onSettingsChange={onSettingsChange}
              />
            )}
          </div>
        </div>
      </>
    );
  }

  // Desktop: existing sidebar
  return (
    <div
      className={cn(
        "glass-panel-solid depth-shadow-lg flex h-full flex-col rounded-2xl transition-all duration-300",
        collapsed ? "w-14" : "w-72"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-3">
        {!collapsed && (
          <div className="flex flex-1 items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#ff9500]/15">
              <Bot className="h-4 w-4 text-[#ff9500]" />
            </div>
            <span className="text-sm font-semibold text-zinc-200">
              Senko AI
            </span>
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCollapsed(!collapsed)}
          className="h-7 w-7 shrink-0 rounded-lg p-0 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Tab Buttons */}
      {!collapsed && (
        <div className="flex gap-1 border-b border-white/[0.06] px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActiveTab("history")}
            className={cn(
              "h-7 flex-1 gap-1.5 rounded-lg text-xs",
              activeTab === "history"
                ? "bg-[#ff9500]/10 text-[#ff9500]"
                : "text-zinc-500 hover:bg-white/5 hover:text-zinc-400"
            )}
          >
            <History className="h-3.5 w-3.5" />
            History
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActiveTab("settings")}
            className={cn(
              "h-7 flex-1 gap-1.5 rounded-lg text-xs",
              activeTab === "settings"
                ? "bg-[#ff9500]/10 text-[#ff9500]"
                : "text-zinc-500 hover:bg-white/5 hover:text-zinc-400"
            )}
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Button>
        </div>
      )}

      {/* Collapsed Icons */}
      {collapsed && (
        <div className="flex flex-col items-center gap-1 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCollapsed(false);
              setActiveTab("history");
            }}
            className={cn(
              "h-8 w-8 rounded-lg p-0",
              activeTab === "history"
                ? "bg-[#ff9500]/10 text-[#ff9500]"
                : "text-zinc-500 hover:bg-white/5 hover:text-zinc-400"
            )}
          >
            <History className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCollapsed(false);
              setActiveTab("settings");
            }}
            className={cn(
              "h-8 w-8 rounded-lg p-0",
              activeTab === "settings"
                ? "bg-[#ff9500]/10 text-[#ff9500]"
                : "text-zinc-500 hover:bg-white/5 hover:text-zinc-400"
            )}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Panel Content */}
      {!collapsed && (
        <div className="flex-1 overflow-hidden">
          {activeTab === "history" ? (
            <HistoryPanel
              conversations={conversations}
              activeConversationId={activeConversationId}
              onSelectConversation={onSelectConversation}
              onNewConversation={onNewConversation}
              onDeleteConversation={onDeleteConversation}
            />
          ) : (
            <SettingsPanel
              settings={settings}
              onSettingsChange={onSettingsChange}
            />
          )}
        </div>
      )}
    </div>
  );
}
