/** Reviewed procedures, not self-modifying prompts or claims of learned capability. */
export interface CodingRequirements { playback: boolean; browser: boolean; checks: string[]; procedure: string }
export function codingRequirements(goal: string): CodingRequirements {
  const playback = /\blisten(?:ing)?\b|\b(?:music|audio|video)\s+player\b|\bplay(?:back)?\s+(?:music|audio|songs?)\b/i.test(goal);
  const backend = /\b(backend|full.?stack|database|authentication|websocket|persistence|api endpoint)\b/i.test(goal);
  const browser = playback || /\b(website|web app|frontend|responsive|browser|page|ui)\b/i.test(goal);
  return { playback, browser, checks: ["Original requested outcome", ...(browser ? ["Live browser workflow", "Desktop and mobile layout"] : []), ...(playback ? ["Legitimate source provenance", "Actual unmuted playback after a user gesture"] : []), ...(backend ? ["Real frontend/backend integration and persistence tests"] : [])],
    procedure: playback ? "Playback is the primary feature. Research an official, permitted embed/source first; metadata does not prove playback. Use the provider's real controls/API and retain an official external link if embedding is blocked. Inspect after a user gesture with requireMediaPlayback:true. Native media time must advance unmuted. Never simulate playback state or replace the song with a different recording without disclosure. A single-song listening site usually needs no scraper, database or custom backend. Choose the simplest suitable stack and create a distinctive listening composition, not a generic dashboard. Inspect desktop and mobile separately."
      : backend ? "Inspect architecture and package scripts. Make coordinated frontend/backend changes. Reproduce errors, test actual API/state persistence and authorization boundaries, then exercise the browser workflow. Preserve unrelated functionality."
      : "Inspect the existing architecture and change only what the requested outcome needs. Use a suitable stack; do not impose a dashboard, a backend, or a scraper. Reproduce defects, make targeted changes, and verify real behavior." };
}
