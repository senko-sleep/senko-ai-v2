/**
 * Live Grounding Helper for Universal AI-Generated UI
 *
 * Retrieves real-time or verified grounding context for:
 * 1. YouTube queries (distinguishing currently trending, all-time most viewed,
 *    recent popular, most liked, and category-specific queries).
 * 2. Current news / breaking headlines via Google News RSS.
 *
 * Never fabricates live statistics; if live retrieval is blocked or offline,
 * returns an explicit limitation note so the AI communicates it transparently.
 */

import { searchYouTube, verifyYouTubeVideo } from "./youtube";

export type YouTubeQueryIntent =
  | "trending_now"
  | "all_time_most_viewed"
  | "recent_popular"
  | "most_liked"
  | "category_specific";

export interface GroundedYouTubeVideo {
  videoId: string;
  title: string;
  channel: string;
  views?: string;
  likes?: string;
  publishedAt?: string;
  duration?: string;
  category?: string;
  url: string;
  thumbnailUrl: string;
}

const VERIFIED_ALL_TIME_YOUTUBE: GroundedYouTubeVideo[] = [
  {
    videoId: "XqZsoesa55w",
    title: "Baby Shark Dance",
    channel: "Pinkfong Baby Shark - Kids' Songs & Stories",
    views: "15.4B+",
    likes: "45M+",
    publishedAt: "Jun 17, 2016",
    duration: "2:17",
    category: "Kids & Music",
    url: "https://www.youtube.com/watch?v=XqZsoesa55w",
    thumbnailUrl: "https://i.ytimg.com/vi/XqZsoesa55w/hqdefault.jpg",
  },
  {
    videoId: "kJQP7kiw5Fk",
    title: "Despacito",
    channel: "Luis Fonsi ft. Daddy Yankee",
    views: "8.6B+",
    likes: "54M+",
    publishedAt: "Jan 12, 2017",
    duration: "4:42",
    category: "Music",
    url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
    thumbnailUrl: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
  },
  {
    videoId: "F4tHL8reNCs",
    title: "Johny Johny Yes Papa",
    channel: "LooLoo Kids",
    views: "7.0B+",
    likes: "21M+",
    publishedAt: "Oct 8, 2016",
    duration: "1:40",
    category: "Kids",
    url: "https://www.youtube.com/watch?v=F4tHL8reNCs",
    thumbnailUrl: "https://i.ytimg.com/vi/F4tHL8reNCs/hqdefault.jpg",
  },
  {
    videoId: "WRVsOCh907o",
    title: "Bath Song",
    channel: "Cocomelon - Nursery Rhymes",
    views: "6.9B+",
    likes: "18M+",
    publishedAt: "May 2, 2018",
    duration: "1:52",
    category: "Kids",
    url: "https://www.youtube.com/watch?v=WRVsOCh907o",
    thumbnailUrl: "https://i.ytimg.com/vi/WRVsOCh907o/hqdefault.jpg",
  },
  {
    videoId: "RgKAFK5djSk",
    title: "See You Again",
    channel: "Wiz Khalifa ft. Charlie Puth",
    views: "6.5B+",
    likes: "44M+",
    publishedAt: "Apr 6, 2015",
    duration: "3:58",
    category: "Music",
    url: "https://www.youtube.com/watch?v=RgKAFK5djSk",
    thumbnailUrl: "https://i.ytimg.com/vi/RgKAFK5djSk/hqdefault.jpg",
  },
  {
    videoId: "JGwWNGJdvx8",
    title: "Shape of You",
    channel: "Ed Sheeran",
    views: "6.4B+",
    likes: "34M+",
    publishedAt: "Jan 30, 2017",
    duration: "4:24",
    category: "Music",
    url: "https://www.youtube.com/watch?v=JGwWNGJdvx8",
    thumbnailUrl: "https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg",
  },
];

export function classifyYouTubeIntent(userText: string): {
  isYouTubeQuery: boolean;
  intent: YouTubeQueryIntent;
  label: string;
  searchQuery?: string;
} {
  const lower = userText.toLowerCase();
  if (!/\b(youtube|yt\s+video|trending\s+video|most\s+viewed\s+video|popular\s+video)\b/i.test(lower)) {
    return { isYouTubeQuery: false, intent: "trending_now", label: "" };
  }

  if (/\b(all[- ]time|ever|in\s+history|most[- ]viewed\s+of\s+all)\b/i.test(lower)) {
    return {
      isYouTubeQuery: true,
      intent: "all_time_most_viewed",
      label: "Most-Viewed YouTube Videos of All Time",
    };
  }
  if (/\b(most[- ]liked)\b/i.test(lower)) {
    return {
      isYouTubeQuery: true,
      intent: "most_liked",
      label: "Most-Liked YouTube Videos",
    };
  }
  const catMatch = /\b(gaming|music|tech|technology|science|anime|coding|programming|sports|movies|news)\b/i.exec(lower);
  if (catMatch) {
    const cat = catMatch[1];
    return {
      isYouTubeQuery: true,
      intent: "category_specific",
      label: `Popular YouTube Videos — ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
      searchQuery: `${cat} trending popular videos`,
    };
  }
  if (/\b(this\s+week|this\s+month|this\s+year|recently|recent)\b/i.test(lower)) {
    return {
      isYouTubeQuery: true,
      intent: "recent_popular",
      label: "Most-Viewed Recent YouTube Videos",
      searchQuery: "trending videos this week",
    };
  }
  return {
    isYouTubeQuery: true,
    intent: "trending_now",
    label: "Currently Trending / Popular YouTube Videos",
    searchQuery: "trending videos right now",
  };
}

export interface GroundedNewsItem {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  category?: string;
}

async function fetchGoogleNewsRss(topicQuery: string, signal?: AbortSignal): Promise<GroundedNewsItem[]> {
  const rssUrl = topicQuery
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(topicQuery)}&hl=en-US&gl=US&ceid=US:en`
    : "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(rssUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SenkoBot/1.0)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: GroundedNewsItem[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) !== null && items.length < 8) {
      const block = m[1];
      const rawTitle = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block)?.[1]?.trim() || "";
      const link = /<link>([\s\S]*?)<\/link>/i.exec(block)?.[1]?.trim() || "";
      const pubDate = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1]?.trim() || "";
      const source = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(block)?.[1]?.trim() || "";
      if (!rawTitle) continue;
      const cleanTitle = rawTitle
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/ - [^-]+$/, "")
        .trim();
      items.push({
        title: cleanTitle || rawTitle,
        source: source || "News Wire",
        publishedAt: pubDate ? pubDate.replace(/\s+\d{2}:\d{2}:\d{2}\s+GMT$/, "") : "Recent",
        url: link,
      });
    }
    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function gatherLiveGroundingNote(
  userText: string,
  signal?: AbortSignal,
  onStep?: (step: { id: number; label: string; status: "running" | "done" | "error"; detail?: string }) => void
): Promise<string> {
  if (!userText || process.env.SENKO_DISABLE_WEB_GROUNDING === "1") return "";

  let stepId = 0;
  const step = (label: string, status: "running" | "done" | "error", detail?: string) => {
    onStep?.({ id: stepId++, label, status, detail });
  };

  // 1. Check YouTube intent
  const yt = classifyYouTubeIntent(userText);
  if (yt.isYouTubeQuery) {
    if (yt.intent === "all_time_most_viewed" || yt.intent === "most_liked") {
      step("Loading verified all-time YouTube records", "done");
      return (
        `\n\n[GROUNDED YOUTUBE DATA — ${yt.label}]\n` +
        `Interpretation detected: "${yt.label}". Use \`video_grid\` with \`dataStatus: "historical"\` and \`interpretation: "${yt.label}"\`.\n` +
        `Verified all-time records (DO NOT invent fake live view counts):\n` +
        JSON.stringify(VERIFIED_ALL_TIME_YOUTUBE, null, 2)
      );
    }

    // Use searchYouTube() — results verified via oEmbed before presenting.
    step(`Searching YouTube for "${yt.searchQuery ?? "trending videos"}"`, "running");
    const outcome = await searchYouTube(
      {
        query: yt.searchQuery ?? "trending videos right now",
        sort: "relevance",
        limit: 8,
      },
      { signal, verify: verifyYouTubeVideo }
    ).catch(() => null);

    if (outcome?.ok && outcome.results.length >= 3) {
      step(`Found ${outcome.results.length} verified videos`, "done", outcome.source);
      return (
        `\n\n[LIVE YOUTUBE DATA RETRIEVED — ${yt.label}]\n` +
        `Interpretation detected: "${yt.label}". Source: ${outcome.source}. Render a \`video_grid\` component with \`dataStatus: "live"\` and \`interpretation: "${yt.label}"\` using these real retrieved videos (preserve their exact videoId, title, channel, and url; never invent statistics):\n` +
        JSON.stringify(outcome.results, null, 2)
      );
    }

    return (
      `\n\n[YOUTUBE DATA LIMITATION NOTICE — ${yt.label}]\n` +
      `Live YouTube trending telemetry could not be retrieved in this environment. ` +
      `CRITICAL RULE: NEVER invent live view counts, current #1 trending rankings, or fake popularity statistics. ` +
      `Instead, render a \`video_grid\` with \`dataStatus: "historical"\`, \`interpretation: "${yt.label} (Verified All-Time Reference — Live Feed Unavailable)"\`, and \`statusNote: "Live YouTube trending feed could not be reached right now; showing verified all-time most-viewed YouTube videos for reference."\` using these real verified videos:\n` +
      JSON.stringify(VERIFIED_ALL_TIME_YOUTUBE, null, 2)
    );
  }

  // 2. Check News / Current Events intent
  const isNewsQuery = /\b(latest\s+.*news|news\s+today|breaking\s+news|current\s+events|what\s+happened\s+in\s+the\s+news|headlines\s+today|tech(?:nology)?\s+news|science\s+news|world\s+news)\b/i.test(
    userText
  );
  if (isNewsQuery) {
    const topicMatch = /\b(technology|tech|science|ai|business|gaming|world|sports|entertainment|space)\b/i.exec(userText);
    const topic = topicMatch ? `${topicMatch[1]} news` : "";
    const articles = await fetchGoogleNewsRss(topic, signal);
    if (articles.length >= 2) {
      return (
        `\n\n[LIVE NEWS HEADLINES RETRIEVED]\n` +
        `Use a \`news_feed\` component with \`dataStatus: "live"\` and populate it ONLY with these real retrieved headlines, sources, timestamps, and URLs (never fabricate headlines or URLs):\n` +
        JSON.stringify(articles, null, 2)
      );
    }
    return (
      `\n\n[LIVE NEWS LIMITATION NOTICE]\n` +
      `Live news RSS feed could not be reached right now. CRITICAL RULE: Do NOT fabricate breaking headlines, timestamps, or fake news URLs. Clearly state that live news retrieval is currently unavailable and offer to discuss major recent themes or analyze a specific article/link provided by the user.`
    );
  }

  return "";
}
