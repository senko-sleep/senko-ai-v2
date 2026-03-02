"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import {
  Square, ArrowDown, Search, Globe, Gamepad2,
  Smile, Frown, Angry, PartyPopper, Moon, Utensils,
  Heart, Skull, Coffee, Brain, Music,
  Sparkles, Flame, Droplets, Zap, Tv, Code,
  Palette, BookOpen, MessageCircle, Compass,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./chat-message";
import { ChatInput, type AgentMode } from "./chat-input";
import type { Message, SenkoStatus, Activity } from "@/types/chat";

// ── Suggestion Pool ──
// Each entry: what the user sees (title + desc) vs what actually gets sent (prompt).
// The prompt is detailed and specific — pushes toward high-quality interactions.
interface Suggestion {
  title: string;
  desc: string;
  prompt: string;
  Icon: LucideIcon;
  category: "research" | "browse" | "create" | "play" | "chat" | "explore";
}

const SUGGESTION_POOL: Suggestion[] = [
  // Research
  { title: "What's happening in anime right now?", desc: "Seasonal rankings, new announcements, studio news", prompt: "Search for the biggest anime news from this week. I want specific announcements — new seasons confirmed, trailers dropped, studio drama. Don't just list show names, tell me WHY each thing matters and what's actually worth being excited about", Icon: Tv, category: "research" },
  { title: "Explain a CS concept to me", desc: "Recursion, Big O, neural nets — pick your level", prompt: "Explain how neural networks actually learn, step by step. Start simple then go deeper — I want to actually understand backpropagation, not just hear that it 'adjusts weights'. Use a concrete example", Icon: Code, category: "research" },
  { title: "What's the latest in AI?", desc: "New models, breakthroughs, drama", prompt: "Search for the most important AI news from this past week. I want specific model names, benchmarks, and what actually changed — not vague 'AI is advancing' stuff. What should I actually pay attention to and why?", Icon: Brain, category: "research" },
  { title: "Deep dive into a random topic", desc: "Surprise me with something fascinating", prompt: "Pick a genuinely interesting and obscure topic I've probably never heard of and give me a deep dive. Make it fascinating — I want to learn something wild. Don't pick something basic like 'the history of pizza'", Icon: Compass, category: "research" },
  { title: "Compare two things I can't decide between", desc: "Tech, games, shows — help me choose", prompt: "I need help deciding between two things. Ask me what I'm comparing and then give me an honest, opinionated breakdown with a clear recommendation — don't sit on the fence", Icon: Search, category: "research" },
  { title: "What's worth watching right now?", desc: "Movies, shows, YouTube — curated picks", prompt: "Search for the best-reviewed movies and TV shows that came out recently. Pick your top 3 and tell me specifically what makes each one worth my time — I don't want a generic list, I want YOUR curated picks with real reasons", Icon: Tv, category: "research" },

  // Browse & Explore
  { title: "Find me something cool online", desc: "Interactive tools, obscure gems, rabbit holes", prompt: "Search for unique interactive websites or web experiments — things like neal.fun, pudding.cool, or ncase.me style projects. Find me ONE specific thing that's genuinely creative and explain exactly what it does and why it's worth checking out. Do NOT just list '10 cool websites'", Icon: Globe, category: "browse" },
  { title: "What's trending on social media?", desc: "The actual discourse, not just headlines", prompt: "Search for what's going viral on Twitter/X and Reddit right now. I want the specific posts, memes, or drama — not just 'social media is buzzing about X'. Tell me the actual story behind 2-3 trending things and why people care", Icon: Globe, category: "browse" },
  { title: "Show me today's best art", desc: "Digital art, illustrations, creative work", prompt: "Search for trending digital art or illustrations on ArtStation or Twitter. Find specific artists and pieces — I want names, styles, and links. Show me 2-3 pieces that genuinely stand out and tell me what makes each one special", Icon: Palette, category: "browse" },

  // Creative
  { title: "Help me write something", desc: "Stories, emails, bios, anything with words", prompt: "I want to write something but I'm not sure where to start. Ask me what I need — could be a story, an email, a bio, a cover letter, lyrics, anything. Help me figure out the tone and nail it", Icon: BookOpen, category: "create" },
  { title: "Roast my idea (constructively)", desc: "Pitch me something and I'll stress-test it", prompt: "I have an idea I want you to stress-test. Let me tell you about it, then give me brutally honest but constructive feedback — what's good, what's weak, and what I'm not thinking about", Icon: Flame, category: "create" },
  { title: "Build something with me", desc: "Code projects, apps, scripts, automation", prompt: "I want to build something. Ask me what I'm thinking — could be a website, a script, a bot, a game, an app. Help me plan it out and let's actually start coding it together", Icon: Code, category: "create" },

  // Games & Fun
  { title: "Let's play 20 questions", desc: "Think of something, I'll figure it out", prompt: "Let's play 20 questions! Think of something and I'll try to guess it. I'll ask yes/no questions. You go first — tell me when you've thought of something and whether it's a person, place, or thing", Icon: Gamepad2, category: "play" },
  { title: "Quiz me on something", desc: "Trivia, knowledge checks, brain teasers", prompt: "Give me a quiz! Pick a topic you think I'd find interesting — could be science, history, anime, gaming, pop culture, or something random. Give me 5 questions, getting progressively harder", Icon: Sparkles, category: "play" },
  { title: "Tell me a story", desc: "Interactive fiction — I make the choices", prompt: "Let's do interactive fiction! Set up an interesting scenario with a compelling opening scene, then give me choices. Make it atmospheric and dramatic — I want to feel like I'm actually there", Icon: BookOpen, category: "play" },
  { title: "Would you rather (hard mode)", desc: "Impossible dilemmas, philosophical twists", prompt: "Let's play Would You Rather but make the dilemmas genuinely hard and philosophical — not gross stuff, but real brain-melting choices where both options have serious tradeoffs. Give me the first one", Icon: MessageCircle, category: "play" },

  // Chat & Vibes
  { title: "Just talk to me about something", desc: "Vent, ramble, think out loud — I'm here", prompt: "I just want to talk. Ask me how I'm doing or what's on my mind — be genuine about it, not robotic. Let's just have a real conversation", Icon: MessageCircle, category: "chat" },
  { title: "Debate me on something spicy", desc: "Hot takes welcome, change my mind", prompt: "Give me your most controversial but defensible opinion about technology, gaming, or internet culture. State it boldly, then defend it. I'll argue back. Don't pick something safe — actually commit to a take that would start arguments online", Icon: Flame, category: "chat" },
  { title: "Recommend me music", desc: "Based on my vibe, not just genre", prompt: "I want music recommendations but don't just throw names at me. First ask me: what's my current mood, what have I been listening to lately, and what am I doing right now (working, chilling, driving, etc). Then give me specific songs with specific reasons for each pick", Icon: Music, category: "chat" },
];

/** Pick N random items from an array without repeats, ensuring category variety */
function pickSuggestions(pool: Suggestion[], count: number): Suggestion[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked: Suggestion[] = [];
  const usedCategories = new Set<string>();

  // First pass: one from each category
  for (const item of shuffled) {
    if (picked.length >= count) break;
    if (!usedCategories.has(item.category)) {
      usedCategories.add(item.category);
      picked.push(item);
    }
  }

  // Second pass: fill remaining slots
  for (const item of shuffled) {
    if (picked.length >= count) break;
    if (!picked.includes(item)) {
      picked.push(item);
    }
  }

  return picked;
}

const STATUS_ICON_MAP: Record<string, LucideIcon> = {
  happy: Smile, sad: Frown, angry: Angry, excited: PartyPopper,
  sleepy: Moon, hungry: Utensils, flustered: Heart, scared: Skull,
  chill: Coffee, thinking: Brain, love: Heart, gaming: Gamepad2,
  music: Music, sparkle: Sparkles, fire: Flame, crying: Droplets, shocked: Zap,
};

function StatusPill({ status }: { status: SenkoStatus }) {
  const IconComponent = STATUS_ICON_MAP[status.icon] || Sparkles;
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 border transition-all duration-500"
      style={{
        backgroundColor: `${status.color}0a`,
        borderColor: `${status.color}22`,
      }}
    >
      <IconComponent
        className="h-4 w-4 shrink-0"
        style={{ color: status.color }}
      />
      <span
        className="text-[13px] italic font-medium"
        style={{ color: `${status.color}cc` }}
      >
        {status.text}
      </span>
    </div>
  );
}


interface ChatAreaProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
  onEditMessage: (id: string, newContent: string) => void;
  onRegenerateMessage?: (id: string) => void;
  onStopGeneration?: () => void;
  onContinueGeneration?: () => void;
  onOpenLink?: (url: string) => void;
  sendWithEnter?: boolean;
  isStreaming?: boolean;
  tokenCount?: number;
  wasCutOff?: boolean;
  status?: SenkoStatus;
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
  activities?: Activity[];
}

const DEFAULT_STATUS: SenkoStatus = { icon: "chill", text: "Ready", color: "#00d4ff" };

export function ChatArea({
  messages,
  onSendMessage,
  onEditMessage,
  onRegenerateMessage,
  onStopGeneration,
  onContinueGeneration,
  onOpenLink,
  sendWithEnter = true,
  isStreaming = false,
  wasCutOff = false,
  status,
  agentMode,
  onAgentModeChange,
  activities: _activities = [],
}: ChatAreaProps) {
  void _activities; // Reserved for Phase 1 status system integration

  // Pick 6 random suggestions on mount — stable until the user navigates away
  const suggestions = useMemo(() => pickSuggestions(SUGGESTION_POOL, 6), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    if (scrollRef.current && !showScrollBtn) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, showScrollBtn]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 80);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setShowScrollBtn(false);
    }
  };

  const showContinue = !isStreaming && wasCutOff;
  const currentStatus = status || DEFAULT_STATUS;

  return (
    <div className="flex h-full flex-col">
      {/* Status pill — always visible when messages exist */}
      {messages.length > 0 && (
        <div className="shrink-0 flex justify-center py-2.5 status-crossfade">
          <StatusPill status={currentStatus} />
        </div>
      )}

      {/* Chat area: scrollable messages */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-thin h-full overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6">
              {/* Greeting */}
              <div className="text-center max-w-lg">
                <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-[var(--foreground)] mb-3">
                  Hey~ what&apos;s up?
                </h1>
                <p className="text-[15px] text-[var(--muted-foreground)] leading-relaxed">
                  Ask me anything, or pick something below to get started
                </p>
              </div>

              {/* Suggestion cards — randomized from pool */}
              <div className="mt-10 w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {suggestions.map((item) => (
                  <button
                    key={item.prompt}
                    onClick={() => onSendMessage(item.prompt)}
                    className="group flex items-start gap-3.5 rounded-2xl px-5 py-4 text-left transition-all hover:bg-[var(--accent)] border border-transparent hover:border-[var(--border)]"
                  >
                    <item.Icon className="h-5 w-5 mt-0.5 text-[var(--muted-foreground)] group-hover:text-[var(--primary)] transition-colors shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[14px] text-[var(--foreground)] font-medium leading-snug">
                        {item.title}
                      </p>
                      <p className="text-[12px] text-[var(--muted-foreground)] mt-0.5 leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
              {messages.map((message, idx) => {
                const isLastAssistant = message.role === "assistant" && idx === messages.length - 1;
                return (
                  <div key={message.id} className="animate-message-appear">
                    <ChatMessage
                      message={message}
                      onEdit={onEditMessage}
                      onRegenerate={
                        message.role === "assistant"
                          ? onRegenerateMessage
                          : undefined
                      }
                      onOpenLink={onOpenLink}
                      isStreaming={isLastAssistant && isStreaming && !message.isThinking}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && messages.length > 0 && (
          <Button
            size="sm"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 h-8 gap-1.5 rounded-full bg-[var(--card)] px-4 text-[12px] text-[var(--muted-foreground)] hover:bg-[var(--accent)] border border-[var(--border)]"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Scroll down
          </Button>
        )}
      </div>

      {/* Stop / Continue bar */}
      {(isStreaming || showContinue) && (
        <div className="shrink-0 flex justify-center gap-3 py-3">
          {isStreaming && onStopGeneration && (
            <Button
              size="sm"
              onClick={onStopGeneration}
              className="h-9 gap-2 rounded-xl bg-red-500/10 px-4 text-[13px] text-red-400 hover:bg-red-500/20 border border-red-500/20 font-medium transition-all"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          {showContinue && onContinueGeneration && (
            <Button
              size="sm"
              onClick={onContinueGeneration}
              className="h-9 gap-2 rounded-xl bg-[var(--primary)]/10 px-4 text-[13px] text-[var(--primary)] hover:bg-[var(--primary)]/20 border border-[var(--primary)]/20 font-medium transition-all"
            >
              Continue
            </Button>
          )}
        </div>
      )}

      {/* ── INPUT BAR ── */}
      <ChatInput
        onSend={onSendMessage}
        sendWithEnter={sendWithEnter}
        disabled={isStreaming}
        agentMode={agentMode}
        onAgentModeChange={onAgentModeChange}
      />
    </div>
  );
}
