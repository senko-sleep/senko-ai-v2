// Decides when a chat message should go to a coding job instead of being answered with code in
// the chat. This runs before the model, so it works even with small models that ignore the
// "hand it off" instruction.

const BUILD_VERB = /\b(code|build|make|create|develop|write|program|scaffold|set ?up|generate|design)\b/i;
const BUILD_THING =
  /\b(app|apps|website|web ?site|site|web ?page|landing page|page|dashboard|game|tool|playlist|player|clone|api|backend|server|frontend|full[ -]?stack|extension|bot|cli|component|portfolio|blog|store|shop|tracker|calculator|editor|project|program|react|next\.?js|vite|vue|svelte|express|typescript|tsx)\b/i;
// Follow-ups about a project that already exists in this chat.
const PROJECT_FOLLOWUP =
  /\b(run|test|tests|fix|debug|add|change|update|improve|refactor|rewrite|make it|make sure|deploy|install|fetch|api|apis|full[ -]?stack|backend|database|style|redesign|feature|works?|working|broken|error|bug)\b/i;
// Questions about code ("how do I", "what does") stay in the chat.
const QUESTION = /^\s*(how|what|why|when|which|where|can you explain|explain|is it|does|do i|should i)\b/i;

export function wantsCodeJob(content: string, chatHasProject: boolean): boolean {
  const text = content.trim();
  if (!text || text.length > 8000) return false;
  if (QUESTION.test(text) && !/\b(build|make|code|create)\s+me\b/i.test(text)) return false;
  if (BUILD_VERB.test(text) && BUILD_THING.test(text)) return true;
  return chatHasProject && PROJECT_FOLLOWUP.test(text);
}

/** Removes fenced code blocks a model wrote anyway, keeping its short explanation. */
export function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
