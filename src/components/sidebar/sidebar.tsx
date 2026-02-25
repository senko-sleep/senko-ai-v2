"use client";

import { useState } from "react";
import { History, Settings, PanelLeftClose, PanelLeft, Bot, X, Plus } from "lucide-react";
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
            "fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] flex flex-col bg-[var(--background)] border-r border-[var(--border)] transition-transform duration-300 ease-out",
            isOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {/* Mobile header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]">
                <Bot className="h-5 w-5 text-[var(--foreground)]" />
              </div>
              <span className="text-[15px] font-bold text-[var(--foreground)]">Senko AI</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-9 w-9 rounded-xl p-0 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* New Chat - clean, prominent */}
          <div className="px-4 py-3">
            <Button
              onClick={handleNewConversation}
              className="w-full h-10 gap-2 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 text-[13px] font-medium transition-all"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </div>

          {/* Tab Buttons */}
          <div className="flex gap-1.5 px-4 py-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActiveTab("history")}
              className={cn(
                "h-9 flex-1 gap-2 rounded-xl text-[13px] font-medium",
                activeTab === "history"
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              )}
            >
              <History className="h-4 w-4" />
              History
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActiveTab("settings")}
              className={cn(
                "h-9 flex-1 gap-2 rounded-xl text-[13px] font-medium",
                activeTab === "settings"
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              )}
            >
              <Settings className="h-4 w-4" />
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

  // Desktop: sidebar flows with the page
  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-[var(--border)] bg-[var(--background)] transition-all duration-300",
        collapsed ? "w-16" : "w-72"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        {!collapsed && (
          <div className="flex flex-1 items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]">
              <Bot className="h-5 w-5 text-[var(--foreground)]" />
            </div>
            <span className="text-[15px] font-bold text-[var(--foreground)]">
              Senko AI
            </span>
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCollapsed(!collapsed)}
          className="h-8 w-8 shrink-0 rounded-xl p-0 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          {collapsed ? (
            <PanelLeft className="h-4.5 w-4.5" />
          ) : (
            <PanelLeftClose className="h-4.5 w-4.5" />
          )}
        </Button>
      </div>

      {/* New Chat - clean, prominent */}
      {!collapsed && (
        <div className="px-4 pb-3">
          <Button
            onClick={onNewConversation}
            className="w-full h-10 gap-2 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 text-[13px] font-medium transition-all"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>
      )}

      {/* Tab Buttons */}
      {!collapsed && (
        <div className="flex gap-1.5 px-4 py-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActiveTab("history")}
            className={cn(
              "h-8 flex-1 gap-2 rounded-xl text-[13px] font-medium",
              activeTab === "history"
                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            )}
          >
            <History className="h-4 w-4" />
            History
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActiveTab("settings")}
            className={cn(
              "h-8 flex-1 gap-2 rounded-xl text-[13px] font-medium",
              activeTab === "settings"
                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            )}
          >
            <Settings className="h-4 w-4" />
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
                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
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
                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
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
