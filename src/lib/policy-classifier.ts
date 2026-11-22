// Context-aware policy classification, SafeSearch status reporting, and neutral refusal formatting.
//
// Distinguishes:
//   - permitted_general: ordinary non-adult requests
//   - permitted_adult_discussion: lawful informational/analytical discussions mentioning adult topics
//   - permitted_non_explicit_media: image/GIF requests using benign or ambiguous terms (e.g. "cowgirl hat GIF")
//   - safesearch_restricted: adult media request filtered by the user's own SafeSearch setting (configurable)
//   - provider_may_restrict_explicit_media: explicit sexual media request where a model/search provider may enforce restrictions
//   - prohibited: requests involving minors / CSAM (always refused regardless of SafeSearch or user maturity)
//
// Never bypasses mandatory provider or platform safeguards.

import type { SafeSearch } from "./content-policy";
import { looksLikeRefusal } from "./refusal";

export type RequestPolicyCategory =
  | "permitted_general"
  | "permitted_adult_discussion"
  | "permitted_non_explicit_media"
  | "safesearch_restricted"
  | "provider_may_restrict_explicit_media"
  | "prohibited";

export type RestrictionSource = "none" | "user_safesearch" | "provider_policy" | "platform_policy";

export interface SafeSearchStateInfo {
  configured: SafeSearch;
  userConfigurable: true;
  /** Exact, truthful summary of how SafeSearch works in this app vs provider-enforced limits. */
  note: string;
}

export interface PolicyClassification {
  category: RequestPolicyCategory;
  restrictionSource: RestrictionSource;
  safeSearch: SafeSearchStateInfo;
  /** Brief, neutral explanation when a restriction applies (never moralizing). */
  briefExplanation?: string;
}

const MINOR_TERMS = /\b(?:loli|lolis|lolicon|shota|shotacon|child|children|kid|kids|minor|minors|underage|toddler|preteen|pre-teen|teen|teens|teenage|schoolgirl|schoolboy|little girl|little boy|young girl|young boy|baby|babies|1[0-7]\s*(?:yo|y\/o|years? old)|[1-9]\s*(?:yo|y\/o|years? old))\b/i;

/** Unambiguously explicit sexual/pornographic terms. */
const EXPLICIT_SEXUAL_TERMS = /\b(?:r34|rule\s*34|hentai|porn|pornography|xxx|nsfw|nude|nudes|naked|explicit|erotic|lewd|topless|sexually\s+explicit|sexual\s+(?:content|images?|gifs?|videos?)|csam)\b/i;

/** Everyday or ambiguous terms that must NOT trigger blanket refusals on their own. */
const AMBIGUOUS_BENIGN_MEDIA_TERMS = /\b(?:cowgirl|cowboy|bikini|swimwear|lingerie|sexy|beach|western|rodeo|anatomy|sculpture|renaissance|statue)\b/i;

/** Signals that the user wants media retrieval/delivery (images, GIFs, videos) rather than text discussion. */
const MEDIA_RETRIEVAL_INTENT = /\b(?:images?|pics?|pictures?|photos?|gifs?|videos?|wallpapers?|collage|gallery|send\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|them|it)\b|download|fetch|show\s+me\s+(?:pics?|images?|gifs?|photos?)|look\s+up\s+[^.?!]{0,40}\b(?:images?|pics?|gifs?|photos?))\b/i;

/** Signals informational/analytical discussion rather than explicit media retrieval. */
const DISCUSSION_INTENT = /\b(?:what\s+is|what\s+are|explain|history\s+of|define|meaning\s+of|why\s+does|how\s+does|discuss|compare|overview|article|wikipedia|policy|law|legal|culture|origin\s+of|difference\s+between)\b/i;

/** Accurate description of SafeSearch configuration for prompts and user responses. */
export function describeSafeSearchState(level: SafeSearch): SafeSearchStateInfo {
  const note =
    level === "off"
      ? "App SafeSearch is currently OFF (configurable in Settings; search URLs send safe=off / safeSearch=Off / adlt=off / kp=-2)."
      : level === "moderate"
        ? "App SafeSearch is currently MODERATE (configurable in Settings > SafeSearch; explicit images are filtered on search engines)."
        : "App SafeSearch is currently STRICT (configurable in Settings > SafeSearch; explicit results are filtered and adult sites are not opened unless explicitly named).";
  return { configured: level, userConfigurable: true, note };
}

/**
 * Context-aware policy classifier. Avoids simplistic keyword-only refusals by considering
 * both the presence of explicit vs. ambiguous terms and whether the user is asking for
 * text discussion vs. explicit media retrieval.
 */
export function classifyContentRequest(rawText: string, safeSearch: SafeSearch = "off"): PolicyClassification {
  const text = (rawText || "").trim();
  const ss = describeSafeSearchState(safeSearch);
  if (!text) {
    return { category: "permitted_general", restrictionSource: "none", safeSearch: ss };
  }

  const hasExplicit = EXPLICIT_SEXUAL_TERMS.test(text);
  const hasMinor = MINOR_TERMS.test(text);
  const wantsMedia = MEDIA_RETRIEVAL_INTENT.test(text);
  const wantsDiscussion = DISCUSSION_INTENT.test(text) && !wantsMedia;

  // 1. Fixed platform boundary: sexual/explicit content involving minors is always prohibited.
  if (hasExplicit && hasMinor) {
    return {
      category: "prohibited",
      restrictionSource: "platform_policy",
      safeSearch: ss,
      briefExplanation: "This request cannot be fulfilled because sexual content involving minors is prohibited.",
    };
  }

  // 2. Lawful informational/analytical discussion mentioning adult terms (e.g. "what is Rule 34?").
  if (hasExplicit && wantsDiscussion) {
    return {
      category: "permitted_adult_discussion",
      restrictionSource: "none",
      safeSearch: ss,
    };
  }

  // 3. Explicit sexual media retrieval request.
  if (hasExplicit && wantsMedia) {
    if (safeSearch !== "off") {
      return {
        category: "safesearch_restricted",
        restrictionSource: "user_safesearch",
        safeSearch: ss,
        briefExplanation: `App SafeSearch is currently set to ${safeSearch.toUpperCase()}, which filters explicit media. You can change SafeSearch in Settings (note that some AI model or search providers still enforce their own content restrictions).`,
      };
    }
    return {
      category: "provider_may_restrict_explicit_media",
      restrictionSource: "provider_policy",
      safeSearch: ss,
      briefExplanation: "App SafeSearch is already off, but the active AI model provider does not support retrieving or delivering explicit adult media.",
    };
  }

  // 4. Media request using ambiguous/everyday terms (e.g. "cowgirl GIF", "bikini fashion") without explicit qualifiers.
  if (wantsMedia && AMBIGUOUS_BENIGN_MEDIA_TERMS.test(text)) {
    return {
      category: "permitted_non_explicit_media",
      restrictionSource: "none",
      safeSearch: ss,
    };
  }

  // 5. General adult-topic mention without explicit media retrieval.
  if (hasExplicit) {
    return {
      category: "permitted_adult_discussion",
      restrictionSource: "none",
      safeSearch: ss,
    };
  }

  return {
    category: "permitted_general",
    restrictionSource: "none",
    safeSearch: ss,
  };
}

/** Patterns indicating unsolicited lecturing, moralizing, or unrelated SFW suggestions in a refusal. */
const LECTURE_OR_SFW_PUSH = /\b(?:instead,?\s+i\s+can\s+(?:help|find|search|show)|how\s+about\s+i|would\s+you\s+like\s+me\s+to\s+find\s+(?:safe|sfw|family[- ]friendly|cute|wholesome)|i\s+can'?t\s+disable\s+my\s+safety\s+filters|remember\s+to|it(?:'s| is)\s+important\s+to\s+keep)\b/i;

/**
 * Preserves legitimate provider/platform refusals (never bypasses them), while replacing
 * verbose moralizing lectures, inaccurate SafeSearch claims, or unsolicited SFW suggestions
 * with a brief, neutral, accurate explanation of the actual restriction source.
 */
export function normalizeProviderRefusal(
  rawAnswer: string,
  goal: string,
  safeSearch: SafeSearch,
  providerLabel?: string,
): { normalized: boolean; text: string; source: RestrictionSource } {
  const trimmed = (rawAnswer || "").trim();
  const classification = classifyContentRequest(goal, safeSearch);

  if (!looksLikeRefusal(trimmed) && !LECTURE_OR_SFW_PUSH.test(trimmed)) {
    return { normalized: false, text: trimmed, source: "none" };
  }

  const providerName = providerLabel ? `The active model provider (${providerLabel})` : "The active model provider";

  if (classification.category === "prohibited") {
    return {
      normalized: true,
      text: "This request cannot be fulfilled because sexual content involving minors is prohibited.",
      source: "platform_policy",
    };
  }

  if (classification.category === "safesearch_restricted") {
    return {
      normalized: true,
      text: `App SafeSearch is currently set to ${safeSearch.toUpperCase()}, which filters explicit media. You can change SafeSearch in Settings; note that individual model or search providers may still enforce their own restrictions.`,
      source: "user_safesearch",
    };
  }

  if (classification.category === "provider_may_restrict_explicit_media") {
    const ssNote = safeSearch === "off"
      ? "App SafeSearch is already off, but "
      : `App SafeSearch is currently ${safeSearch.toUpperCase()} (configurable in Settings), and `;
    return {
      normalized: true,
      text: `${ssNote}${providerName.toLowerCase()} declined this explicit adult media request under its provider content policy.`,
      source: "provider_policy",
    };
  }

  // If a provider refused a non-explicit/ambiguous request, report the provider refusal neutrally without lecturing.
  return {
    normalized: true,
    text: `${providerName} declined this request under its content policy. App SafeSearch is currently ${safeSearch.toUpperCase()} (configurable in Settings).`,
    source: "provider_policy",
  };
}
