// When the agent stumbles it changes approach by itself, escalating each time, instead of
// stopping to ask. Real progress resets the ladder.

const TACTICS = [
  "Stay on this page but use a different control: another element, the keyboard, or a listed link.",
  "Use this site another way: its on-site search, filters, navigation menu, or a direct listing URL.",
  "Abandon this site and go to a different one that serves the goal.",
  "Take the simplest route left. Deliver what you already have with done and state exactly what is missing.",
];

export class RecoveryLadder {
  private used = 0;
  readonly maxAttempts = TACTICS.length;

  /** The next tactic to try, or null once every tactic has been used without progress. */
  next(): { attempt: number; instruction: string } | null {
    if (this.used >= TACTICS.length) return null;
    const instruction = TACTICS[this.used++];
    return { attempt: this.used, instruction };
  }

  reset() {
    this.used = 0;
  }
}

const COOKIE_BANNER = /\b(cookies?|gdpr|privacy (choices|preferences|settings)|consent preferences|manage consent)\b/i;
/** Dialogs that bind the user to something are never auto-accepted. */
const BINDING_DIALOG = /\b(terms|conditions|eula|licen[cs]e|contract|agreement|age|adult|verify|payment|purchase|subscribe|subscription|billing|delete|password|account)\b|18\+/i;

/** True only for a plain cookie/privacy banner that is safe to clear without asking. */
export function isCookieBanner(overlay: string | null | undefined): boolean {
  const text = overlay || "";
  return COOKIE_BANNER.test(text) && !BINDING_DIALOG.test(text);
}
