// Fake "are you a robot?" pages (the ClickFix / fake-CAPTCHA trick): a page dresses up as a
// human check, puts a command on the clipboard and tells the visitor to press Win+R (or open
// a terminal), paste and press Enter, which runs malware. Real checks (Cloudflare, reCAPTCHA,
// hCaptcha) never ask you to run anything, so these steps alone give the trick away.

export interface FakeVerification {
  /** One line for the user / agent. */
  reason: string;
  /** What gave it away. */
  signals: string[];
}

const VERIFY = /\b(?:verif(?:y|ication|ied)|human|robot|bot\s+check|captcha|re-?captcha|cloudflare|security\s+check|i'?m\s+not\s+a\s+robot|prove\s+you)\b/i;
// "Press Win + R", "Windows key + R", "⊞ + R", "open the Run dialog", "Win + X then Terminal", macOS Terminal.
const OPEN_RUNNER =
  /(?:\bwin(?:dows)?(?:\s*(?:key|logo\s+key|button))?\s*(?:\+|and|&)\s*["']?r\b|⊞\s*(?:\+\s*)?r\b|\brun\s+(?:dialog|box|window)\b|\bwin(?:dows)?(?:\s*key)?\s*\+\s*x\b|\bopen\s+(?:the\s+)?(?:terminal|powershell|command\s+prompt|cmd)\b|(?:⌘|cmd|command)\s*\+\s*space\b[\s\S]{0,80}terminal)/i;
const PASTE = /(?:\bctrl\s*\+\s*v\b|⌘\s*\+?\s*v\b|\bcmd\s*\+\s*v\b|\bpaste\b|\bright[-\s]?click\b[\s\S]{0,40}\bpaste\b)/i;
const RUN = /\b(?:press|hit|tap)\s+(?:the\s+)?["']?enter\b|\bclick\s+ok\b/i;
// Shell one-liners that fetch and run something.
const COMMAND =
  /\b(?:powershell(?:\.exe)?\s+(?:-\w+\s+)*|pwsh\s+|mshta(?:\.exe)?\s+https?:|cmd(?:\.exe)?\s+\/c\b|iex\s*\(|invoke-(?:expression|webrequest|restmethod)\b|iwr\s+|irm\s+|start-process\b|bitsadmin\b|certutil\s+-urlcache|rundll32\b|regsvr32\b|wscript\b|cscript\b|msiexec\s+\/[iq]|curl\s+[^|\n]{0,200}\|\s*(?:ba|z)?sh\b|wget\s+[^|\n]{0,200}\|\s*(?:ba|z)?sh\b|osascript\s+-e|base64\s+(?:-d|--decode)|frombase64string)/i;
const CLIPBOARD = /navigator\.clipboard\.writeText\s*\(|document\.execCommand\(\s*["']copy["']\s*\)|clipboardData\.setData\s*\(/i;

function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/**
 * Is this page a fake human check that tells people to run a command? Pass page text, its
 * HTML, or both. Pages that only talk *about* the scam (news, docs) need several signals in
 * the instructions themselves plus a verification framing, so they rarely match.
 */
export function detectFakeVerification(input: { text?: string; html?: string }): FakeVerification | null {
  const html = (input.html || "").slice(0, 600_000);
  const text = ((input.text || "") + " " + (html ? visibleText(html) : "")).slice(0, 200_000);
  const scripts = html ? (html.match(/<script\b[\s\S]*?<\/script>/gi) || []).join("\n") : "";

  const signals: string[] = [];
  const verify = VERIFY.test(text);
  if (OPEN_RUNNER.test(text)) signals.push("tells you to open Run / a terminal");
  if (PASTE.test(text)) signals.push("tells you to paste something");
  if (RUN.test(text)) signals.push("tells you to press Enter");
  const copiesCommand = CLIPBOARD.test(scripts) && COMMAND.test(scripts);
  if (copiesCommand) signals.push("copies a shell command to your clipboard");
  if (COMMAND.test(text)) signals.push("shows a shell command");

  const steps = signals.includes("tells you to open Run / a terminal") && signals.includes("tells you to paste something");
  // Classic page: the human-check framing plus "Win+R, Ctrl+V, Enter" (or a hidden copy of a command).
  if (verify && (steps || (copiesCommand && (signals.length >= 2 || OPEN_RUNNER.test(text) || PASTE.test(text))))) {
    return { reason: "This page is a fake \"verify you're human\" check that tries to get you to run a command on your computer (a malware trick). Real checks never ask for that.", signals };
  }
  return null;
}
