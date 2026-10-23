// Icon names the suggestion generator may pick from (kebab-case, shared by server and client).
// Keeping the set closed means every icon renders, and they all share one style.
export const SUGGESTION_ICONS = [
  "sparkles", "lightbulb", "book-open", "graduation-cap", "code", "terminal", "bug", "palette",
  "pen-line", "music", "headphones", "film", "tv", "gamepad", "camera", "image", "map", "plane",
  "compass", "mountain", "utensils", "chef-hat", "coffee", "dumbbell", "heart-pulse", "leaf",
  "sprout", "sun", "moon", "cloud-sun", "rocket", "atom", "flask", "telescope", "brain",
  "calculator", "chart", "wallet", "briefcase", "calendar", "list-checks", "clock", "mail",
  "message", "languages", "globe", "newspaper", "shopping-bag", "gift", "house", "car", "bike",
  "dog", "cat", "paw-print", "trophy", "puzzle", "wand", "feather", "scroll", "mic", "play",
  "search", "clapperboard", "swords", "shirt", "flower", "star", "zap", "cpu", "smartphone",
  "landmark", "pizza", "ghost", "popcorn", "drama",
] as const;

export type SuggestionIcon = (typeof SUGGESTION_ICONS)[number];

const SET = new Set<string>(SUGGESTION_ICONS);
export function isSuggestionIcon(name: unknown): name is SuggestionIcon {
  return typeof name === "string" && SET.has(name);
}

// Keyword hints used when the model picks an icon we don't have (or none at all).
const HINTS: [RegExp, SuggestionIcon][] = [
  [/\b(anime|manga|episode|series|show|watch|stream)\b/i, "tv"],
  [/\b(movie|film|trailer|cinema)\b/i, "clapperboard"],
  [/\b(song|music|playlist|album|band|lyrics)\b/i, "music"],
  [/\b(game|gaming|minecraft|zelda|steam|xbox|playstation)\b/i, "gamepad"],
  [/\b(code|coding|program|script|javascript|typescript|python|react|bug|api)\b/i, "code"],
  [/\b(recipe|cook|dinner|lunch|breakfast|meal|bake)\b/i, "chef-hat"],
  [/\b(travel|trip|vacation|flight|itinerary)\b/i, "plane"],
  [/\b(workout|exercise|gym|run|fitness)\b/i, "dumbbell"],
  [/\b(health|sleep|stress|wellness)\b/i, "heart-pulse"],
  [/\b(money|budget|save|invest|finance)\b/i, "wallet"],
  [/\b(job|career|resume|interview|work)\b/i, "briefcase"],
  [/\b(learn|teach|explain|how does|why do|study|science)\b/i, "lightbulb"],
  [/\b(space|planet|star|galaxy|universe)\b/i, "telescope"],
  [/\b(write|story|poem|essay|draft)\b/i, "pen-line"],
  [/\b(draw|art|design|color|paint)\b/i, "palette"],
  [/\b(news|latest|headlines?)\b/i, "newspaper"],
  [/\b(plan|schedule|routine|week|habit)\b/i, "calendar"],
  [/\b(gift|birthday|present)\b/i, "gift"],
  [/\b(shop|buy|deal|price)\b/i, "shopping-bag"],
  [/\b(fox|dog|cat|pet|animal)\b/i, "paw-print"],
  [/\b(find|search|look up|browse|open)\b/i, "search"],
];

export function guessIcon(text: string): SuggestionIcon {
  for (const [re, icon] of HINTS) if (re.test(text)) return icon;
  return "sparkles";
}
